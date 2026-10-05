// Embeds WKWebView, the engine Safari uses, inside an Electron window.
//
// The web view sits in a clipping container at the on-screen size. The container's bounds are the
// viewport size, so AppKit scales the page to fit while it lays out at exactly the viewport width.
// (Chosen by comparing screenshots: pageZoom stops at 0.5, and private view-scale APIs misdrew.)
// Verify changes with the Live view check workflow's screenshots, not only page-reported sizes.
// Console output and navigation events go back to JavaScript through a thread-safe function.

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <napi.h>
#include "clip.h"
#include <map>
#include <string>

struct Event {
  std::string type, a, b;
};

static void CallJs(Napi::Env env, Napi::Function fn, void*, Event* e) {
  if (env != nullptr && fn != nullptr) fn.Call({Napi::String::New(env, e->type), Napi::String::New(env, e->a), Napi::String::New(env, e->b)});
  delete e;
}
using EventFn = Napi::TypedThreadSafeFunction<void, Event, CallJs>;

// Runs in every page before its own scripts: forwards console calls and uncaught errors.
static NSString* const kConsoleHook = @"(() => {"
  "const post = (level, args) => { try { window.webkit.messageHandlers.swivel.postMessage({ level, text: args.map((a) => {"
  "  if (a instanceof Error) return a.stack || String(a);"
  "  if (typeof a === 'object') { try { return JSON.stringify(a) } catch { return String(a) } }"
  "  return String(a) }).join(' ') }) } catch {} };"
  "for (const level of ['log', 'info', 'warn', 'error', 'debug']) {"
  "  const orig = console[level].bind(console);"
  "  console[level] = (...args) => { post(level === 'warn' ? 'warning' : level, args); orig(...args) } }"
  "addEventListener('error', (e) => post('error', [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')]));"
  "addEventListener('unhandledrejection', (e) => post('error', ['Unhandled rejection: ' + (e.reason && e.reason.stack || e.reason)]));"
  "})()";

@interface SwivelWebView : NSObject <WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler>
@property(nonatomic, strong) NSView* container;
@property(nonatomic, strong) NSView* clip;
@property(nonatomic, weak) NSView* content;
@property(nonatomic, strong) WKWebView* web;
@property(nonatomic, assign) EventFn* events;
// Sign-in and certificate questions waiting for the user's answer, by request id.
@property(nonatomic, strong) NSMutableDictionary<NSNumber*, id>* waiting;
@property(nonatomic, strong) NSMutableDictionary<NSNumber*, NSURLAuthenticationChallenge*>* challenges;
@property(nonatomic, assign) int nextRequest;
@end

@implementation SwivelWebView
- (void)send:(const std::string&)type a:(const std::string&)a b:(const std::string&)b {
  if (self.events) self.events->BlockingCall(new Event{type, a, b});
}
- (void)userContentController:(WKUserContentController*)ucc didReceiveScriptMessage:(WKScriptMessage*)message {
  NSDictionary* body = [message.body isKindOfClass:[NSDictionary class]] ? message.body : @{};
  NSString* level = body[@"level"] ?: @"log";
  NSString* text = body[@"text"] ?: @"";
  [self send:"console" a:level.UTF8String b:text.UTF8String];
}
- (void)webView:(WKWebView*)w didStartProvisionalNavigation:(WKNavigation*)n {
  [self send:"loading" a:"1" b:""];
}
- (void)webView:(WKWebView*)w didCommitNavigation:(WKNavigation*)n {
  [self send:"url" a:(w.URL.absoluteString ?: @"").UTF8String b:""];
}
- (void)webView:(WKWebView*)w didFinishNavigation:(WKNavigation*)n {
  [self send:"loading" a:"0" b:""];
}
- (void)fail:(NSError*)error {
  [self send:"loading" a:"0" b:""];
  if (error.code == NSURLErrorCancelled) return;  // Replaced by a newer navigation.
  NSString* url = error.userInfo[NSURLErrorFailingURLStringErrorKey] ?: @"";
  NSString* msg = [NSString stringWithFormat:@"%@ (%@)", error.localizedDescription, url];
  [self send:"error" a:msg.UTF8String b:""];
}
- (void)webView:(WKWebView*)w didFailNavigation:(WKNavigation*)n withError:(NSError*)e {
  [self fail:e];
}
- (void)webView:(WKWebView*)w didFailProvisionalNavigation:(WKNavigation*)n withError:(NSError*)e {
  [self fail:e];
}
// A site asks for a username and password, or its certificate isn't trusted: Swivel asks the
// user (once per window) and answers through answerChallenge.
- (void)webView:(WKWebView*)w didReceiveAuthenticationChallenge:(NSURLAuthenticationChallenge*)challenge
    completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential*))done {
  NSURLProtectionSpace* space = challenge.protectionSpace;
  NSString* method = space.authenticationMethod;
  BOOL trust = [method isEqualToString:NSURLAuthenticationMethodServerTrust];
  BOOL signIn = [method isEqualToString:NSURLAuthenticationMethodHTTPBasic] || [method isEqualToString:NSURLAuthenticationMethodHTTPDigest] ||
                [method isEqualToString:NSURLAuthenticationMethodNTLM];
  if (trust) {
    CFErrorRef error = NULL;
    if (!space.serverTrust || SecTrustEvaluateWithError(space.serverTrust, &error)) {
      done(NSURLSessionAuthChallengePerformDefaultHandling, nil);
      return;
    }
    if (error) CFRelease(error);
  }
  if (!trust && !signIn) {
    done(NSURLSessionAuthChallengePerformDefaultHandling, nil);
    return;
  }
  if (!self.waiting) {
    self.waiting = [NSMutableDictionary new];
    self.challenges = [NSMutableDictionary new];
  }
  NSNumber* request = @(++self.nextRequest);
  self.waiting[request] = [done copy];
  self.challenges[request] = challenge;
  NSString* site = space.port == 443 || space.port == 80 || space.port == 0 ? space.host : [NSString stringWithFormat:@"%@:%ld", space.host, (long)space.port];
  // b: the site, then (sign-in only) how many answers were already refused.
  std::string info = std::string(site.UTF8String) + (trust ? "" : "\n" + std::to_string(challenge.previousFailureCount));
  [self send:(trust ? "trust" : "auth") a:std::to_string(request.intValue) b:info];
}
// Page dialogs: without these, alert() does nothing and confirm() is always false.
- (void)webView:(WKWebView*)w runJavaScriptAlertPanelWithMessage:(NSString*)message initiatedByFrame:(WKFrameInfo*)f completionHandler:(void (^)(void))done {
  NSAlert* alert = [NSAlert new];
  alert.messageText = message.length ? message : @" ";
  alert.informativeText = @"From the page, in WebKit (Safari).";
  if (!w.window) return done();
  [alert beginSheetModalForWindow:w.window completionHandler:^(NSModalResponse r) { done(); }];
}
- (void)webView:(WKWebView*)w runJavaScriptConfirmPanelWithMessage:(NSString*)message initiatedByFrame:(WKFrameInfo*)f completionHandler:(void (^)(BOOL))done {
  NSAlert* alert = [NSAlert new];
  alert.messageText = message.length ? message : @" ";
  alert.informativeText = @"From the page, in WebKit (Safari).";
  [alert addButtonWithTitle:@"OK"];
  [alert addButtonWithTitle:@"Cancel"];
  if (!w.window) return done(NO);
  [alert beginSheetModalForWindow:w.window completionHandler:^(NSModalResponse r) { done(r == NSAlertFirstButtonReturn); }];
}
- (void)webView:(WKWebView*)w runJavaScriptTextInputPanelWithPrompt:(NSString*)prompt defaultText:(NSString*)text initiatedByFrame:(WKFrameInfo*)f completionHandler:(void (^)(NSString*))done {
  NSAlert* alert = [NSAlert new];
  alert.messageText = prompt.length ? prompt : @" ";
  alert.informativeText = @"From the page, in WebKit (Safari).";
  [alert addButtonWithTitle:@"OK"];
  [alert addButtonWithTitle:@"Cancel"];
  NSTextField* field = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 280, 24)];
  field.stringValue = text ?: @"";
  alert.accessoryView = field;
  if (!w.window) return done(nil);
  [alert beginSheetModalForWindow:w.window completionHandler:^(NSModalResponse r) { done(r == NSAlertFirstButtonReturn ? field.stringValue : nil); }];
}
// Links that open a new window load in place instead.
- (WKWebView*)webView:(WKWebView*)w createWebViewWithConfiguration:(WKWebViewConfiguration*)c
    forNavigationAction:(WKNavigationAction*)action windowFeatures:(WKWindowFeatures*)f {
  if (action.request.URL) [w loadRequest:action.request];
  return nil;
}
- (void)observeValueForKeyPath:(NSString*)keyPath ofObject:(id)object change:(NSDictionary*)change context:(void*)context {
  // Same-document navigations (history.pushState) change the URL without a new navigation.
  if ([keyPath isEqualToString:@"URL"]) [self send:"url" a:(self.web.URL.absoluteString ?: @"").UTF8String b:""];
}
@end

static std::map<int, SwivelWebView*> views;
static std::map<int, EventFn> eventFns;
static int nextId = 1;
static std::map<std::string, WKWebsiteDataStore*> stores;

static WKWebsiteDataStore* StoreFor(const std::string& key) {
  WKWebsiteDataStore* store = stores[key];
  if (!store) store = stores[key] = [WKWebsiteDataStore nonPersistentDataStore];
  return store;
}

// Cookies of a window's data store, so Swivel can keep them the same in every engine.
@interface SwivelCookieWatcher : NSObject <WKHTTPCookieStoreObserver>
@property(nonatomic, assign) Napi::ThreadSafeFunction* changed;
@end
@implementation SwivelCookieWatcher
- (void)cookiesDidChangeInCookieStore:(WKHTTPCookieStore*)store {
  if (self.changed) self.changed->NonBlockingCall([](Napi::Env env, Napi::Function fn) { fn.Call({}); });
}
@end
static std::map<std::string, SwivelCookieWatcher*> cookieWatchers;
static std::map<std::string, Napi::ThreadSafeFunction> cookieWatchFns;

static void UnwatchCookieStore(const std::string& key) {
  SwivelCookieWatcher* watcher = cookieWatchers[key];
  if (!watcher) return;
  watcher.changed = nullptr;
  auto store = stores.find(key);
  if (store != stores.end()) [store->second.httpCookieStore removeObserver:watcher];
  cookieWatchers.erase(key);
  cookieWatchFns[key].Release();
  cookieWatchFns.erase(key);
}

static Napi::Value ReleaseStore(const Napi::CallbackInfo& info) {
  std::string key = info[0].As<Napi::String>().Utf8Value();
  UnwatchCookieStore(key);
  stores.erase(key);
  return info.Env().Undefined();
}

static NSString* SameSiteName(NSHTTPCookie* c) {
  if ([c.sameSitePolicy isEqualToString:NSHTTPCookieSameSiteStrict]) return @"Strict";
  if ([c.sameSitePolicy isEqualToString:NSHTTPCookieSameSiteLax]) return @"Lax";
  return nil;
}

// cookies(store, done): every cookie in the store, as JSON (the shape of Cookie in cookies.ts).
static Napi::Value Cookies(const Napi::CallbackInfo& info) {
  std::string key = info[0].As<Napi::String>().Utf8Value();
  auto done = Napi::ThreadSafeFunction::New(info.Env(), info[1].As<Napi::Function>(), "swivel-cookies", 0, 1);
  [StoreFor(key).httpCookieStore getAllCookies:^(NSArray<NSHTTPCookie*>* cookies) {
    NSMutableArray* out = [NSMutableArray new];
    for (NSHTTPCookie* c in cookies) {
      NSMutableDictionary* d = [@{ @"name": c.name, @"value": c.value, @"domain": c.domain, @"path": c.path, @"httpOnly": @(c.isHTTPOnly), @"secure": @(c.isSecure) } mutableCopy];
      if (c.expiresDate && !c.isSessionOnly) d[@"expires"] = @(c.expiresDate.timeIntervalSince1970);
      NSString* sameSite = SameSiteName(c);
      if (sameSite) d[@"sameSite"] = sameSite;
      [out addObject:d];
    }
    NSData* data = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    std::string json = data ? std::string((const char*)data.bytes, data.length) : "[]";
    auto fn = done;
    fn.NonBlockingCall([json](Napi::Env env, Napi::Function cb) { cb.Call({Napi::String::New(env, json)}); });
    fn.Release();
  }];
  return info.Env().Undefined();
}

static NSHTTPCookie* CookieFromJson(const std::string& json) {
  NSData* data = [NSData dataWithBytes:json.data() length:json.size()];
  NSDictionary* d = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![d isKindOfClass:[NSDictionary class]]) return nil;
  NSMutableDictionary* p = [NSMutableDictionary new];
  p[NSHTTPCookieName] = d[@"name"];
  p[NSHTTPCookieValue] = d[@"value"];
  p[NSHTTPCookieDomain] = d[@"domain"];
  p[NSHTTPCookiePath] = d[@"path"] ?: @"/";
  if ([d[@"secure"] boolValue]) p[NSHTTPCookieSecure] = @"TRUE";
  if ([d[@"httpOnly"] boolValue]) p[@"HttpOnly"] = @"TRUE";
  if (d[@"expires"]) p[NSHTTPCookieExpires] = [NSDate dateWithTimeIntervalSince1970:[d[@"expires"] doubleValue]];
  NSString* sameSite = d[@"sameSite"];
  if ([sameSite isEqualToString:@"Strict"]) p[NSHTTPCookieSameSitePolicy] = NSHTTPCookieSameSiteStrict;
  else if ([sameSite isEqualToString:@"Lax"]) p[NSHTTPCookieSameSitePolicy] = NSHTTPCookieSameSiteLax;
  return [NSHTTPCookie cookieWithProperties:p];
}

// setCookie(store, json)
static Napi::Value SetCookie(const Napi::CallbackInfo& info) {
  NSHTTPCookie* cookie = CookieFromJson(info[1].As<Napi::String>().Utf8Value());
  if (cookie) [StoreFor(info[0].As<Napi::String>().Utf8Value()).httpCookieStore setCookie:cookie completionHandler:nil];
  return info.Env().Undefined();
}

// deleteCookie(store, name, domain, path)
static Napi::Value DeleteCookie(const Napi::CallbackInfo& info) {
  WKHTTPCookieStore* store = StoreFor(info[0].As<Napi::String>().Utf8Value()).httpCookieStore;
  NSString* name = [NSString stringWithUTF8String:info[1].As<Napi::String>().Utf8Value().c_str()];
  NSString* domain = [NSString stringWithUTF8String:info[2].As<Napi::String>().Utf8Value().c_str()];
  NSString* path = [NSString stringWithUTF8String:info[3].As<Napi::String>().Utf8Value().c_str()];
  [store getAllCookies:^(NSArray<NSHTTPCookie*>* cookies) {
    for (NSHTTPCookie* c in cookies)
      if ([c.name isEqualToString:name] && [c.domain isEqualToString:domain] && [c.path isEqualToString:path]) [store deleteCookie:c completionHandler:nil];
  }];
  return info.Env().Undefined();
}

// watchCookies(store, changed): calls back whenever the store's cookies change.
static Napi::Value WatchCookies(const Napi::CallbackInfo& info) {
  std::string key = info[0].As<Napi::String>().Utf8Value();
  UnwatchCookieStore(key);
  cookieWatchFns[key] = Napi::ThreadSafeFunction::New(info.Env(), info[1].As<Napi::Function>(), "swivel-cookie-watch", 0, 1);
  // Don't keep the app alive for a watcher.
  cookieWatchFns[key].Unref(info.Env());
  SwivelCookieWatcher* watcher = [SwivelCookieWatcher new];
  watcher.changed = &cookieWatchFns[key];
  cookieWatchers[key] = watcher;
  [StoreFor(key).httpCookieStore addObserver:watcher];
  return info.Env().Undefined();
}

static Napi::Value UnwatchCookies(const Napi::CallbackInfo& info) {
  UnwatchCookieStore(info[0].As<Napi::String>().Utf8Value());
  return info.Env().Undefined();
}

static SwivelWebView* Get(const Napi::CallbackInfo& info) {
  auto it = views.find(info[0].As<Napi::Number>().Int32Value());
  return it == views.end() ? nil : it->second;
}

// create(parentViewHandle: Buffer, onEvent: (type, a, b) => void): number
static Napi::Value Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto handle = info[0].As<Napi::Buffer<uint8_t>>();
  void* raw = *reinterpret_cast<void**>(handle.Data());  // Electron's handle is an NSView*.
  NSView* parent = (__bridge NSView*)raw;
  int id = nextId++;
  eventFns[id] = EventFn::New(env, info[1].As<Napi::Function>(), "swivel-webkit-events", 0, 1);

  SwivelWebView* v = [SwivelWebView new];
  v.events = &eventFns[id];

  WKWebViewConfiguration* config = [WKWebViewConfiguration new];
  // Each Swivel window's own in-memory data store (info[2] is its key), shared with no other
  // window and separate from Safari. Gone when released.
  config.websiteDataStore = StoreFor(info.Length() > 2 && info[2].IsString() ? info[2].As<Napi::String>().Utf8Value() : "");
  [config.userContentController addScriptMessageHandler:v name:@"swivel"];
  [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:kConsoleHook
                                                                      injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                                   forMainFrameOnly:NO]];
  // Resolve scaling and fonts the same way Safari does.
  config.preferences.javaScriptCanOpenWindowsAutomatically = YES;
  // Identify as the installed Safari, like Safari does. Without "Version/x Safari/605.1.15" sites
  // (Google, for one) don't recognise the browser and serve old fallback pages.
  NSString* safari = [[NSBundle bundleWithPath:@"/Applications/Safari.app"] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
  config.applicationNameForUserAgent = [NSString stringWithFormat:@"Version/%@ Safari/605.1.15", safari ?: @"18.0"];

  v.container = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 100, 100)];
  v.container.wantsLayer = YES;
  v.container.layer.masksToBounds = YES;  // Never draw outside the page area.
  v.container.hidden = YES;
  v.web = [[WKWebView alloc] initWithFrame:v.container.bounds configuration:config];
  v.web.navigationDelegate = v;
  v.web.UIDelegate = v;
  // Mobile mode: an iPhone's or iPad's browser ID instead of this Mac's.
  if (info.Length() > 3 && info[3].IsString() && !info[3].As<Napi::String>().Utf8Value().empty())
    v.web.customUserAgent = [NSString stringWithUTF8String:info[3].As<Napi::String>().Utf8Value().c_str()];
  if (@available(macOS 13.3, *)) v.web.inspectable = YES;  // Safari's Web Inspector can attach.
  [v.web addObserver:v forKeyPath:@"URL" options:NSKeyValueObservingOptionNew context:nil];
  [v.container addSubview:v.web];
  v.content = parent;
  v.clip = SwivelMakeClip(parent);
  [v.clip addSubview:v.container];
  views[id] = v;
  return Napi::Number::New(env, id);
}

// setFrame(id, x, y, width, height, viewportWidth, viewportHeight) in window points, top-left origin.
static Napi::Value SetFrame(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  if (!v) return info.Env().Undefined();
  double x = info[1].As<Napi::Number>().DoubleValue(), y = info[2].As<Napi::Number>().DoubleValue();
  double w = info[3].As<Napi::Number>().DoubleValue(), h = info[4].As<Napi::Number>().DoubleValue();
  double vw = info[5].As<Napi::Number>().DoubleValue(), vh = info[6].As<Napi::Number>().DoubleValue();
  v.container.frame = NSMakeRect(x, y, w, h);  // In the clip view: content top-left coordinates.
  // Container bounds at the viewport size make AppKit scale the full-size web view down to the
  // container's frame, so the page lays out at exactly the viewport width.
  v.container.bounds = NSMakeRect(0, 0, vw, vh);
  v.web.frame = NSMakeRect(0, 0, vw, vh);
  return info.Env().Undefined();
}

// setClip(id, x, y, width, height): show the view only inside that rect (window points, top-left).
// setClip(id) with no rect: no clipping.
static Napi::Value SetClip(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  if (!v) return info.Env().Undefined();
  if (info.Length() < 5) SwivelClipReset(v.clip, v.content);
  else SwivelClipTo(v.clip, v.content, info[1].As<Napi::Number>().DoubleValue(), info[2].As<Napi::Number>().DoubleValue(),
                    info[3].As<Napi::Number>().DoubleValue(), info[4].As<Napi::Number>().DoubleValue());
  return info.Env().Undefined();
}

// clickAt(windowHandle, x, y): test hook, a real click in window points (top-left).
static Napi::Value ClickAt(const Napi::CallbackInfo& info) {
  void* raw = *reinterpret_cast<void**>(info[0].As<Napi::Buffer<uint8_t>>().Data());
  SwivelClickAt((__bridge NSView*)raw, info[1].As<Napi::Number>().DoubleValue(), info[2].As<Napi::Number>().DoubleValue());
  return info.Env().Undefined();
}

// answerChallenge(id, request, username?, password?): the user's answer to an "auth" or "trust"
// event. Sign-in: a username and password. Certificate: any string to proceed. Nothing: cancel.
static Napi::Value AnswerChallenge(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  if (!v) return info.Env().Undefined();
  NSNumber* request = @(info[1].As<Napi::Number>().Int32Value());
  void (^done)(NSURLSessionAuthChallengeDisposition, NSURLCredential*) = v.waiting[request];
  NSURLAuthenticationChallenge* challenge = v.challenges[request];
  if (!done || !challenge) return info.Env().Undefined();
  [v.waiting removeObjectForKey:request];
  [v.challenges removeObjectForKey:request];
  if (info.Length() < 3 || !info[2].IsString()) {
    done(NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
  } else if ([challenge.protectionSpace.authenticationMethod isEqualToString:NSURLAuthenticationMethodServerTrust]) {
    done(NSURLSessionAuthChallengeUseCredential, [NSURLCredential credentialForTrust:challenge.protectionSpace.serverTrust]);
  } else {
    NSString* user = [NSString stringWithUTF8String:info[2].As<Napi::String>().Utf8Value().c_str()];
    NSString* pass = info.Length() > 3 && info[3].IsString() ? [NSString stringWithUTF8String:info[3].As<Napi::String>().Utf8Value().c_str()] : @"";
    done(NSURLSessionAuthChallengeUseCredential, [NSURLCredential credentialWithUser:user password:pass persistence:NSURLCredentialPersistenceNone]);
  }
  return info.Env().Undefined();
}

static Napi::Value Load(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  std::string url = info[1].As<Napi::String>();
  NSURL* u = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
  if (v && u) [v.web loadRequest:[NSURLRequest requestWithURL:u]];
  return info.Env().Undefined();
}

static Napi::Value History(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  std::string action = info[1].As<Napi::String>();
  if (!v) return info.Env().Undefined();
  if (action == "back") [v.web goBack];
  else if (action == "forward") [v.web goForward];
  else [v.web reload];
  return info.Env().Undefined();
}

static Napi::Value SetHidden(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  if (v) v.container.hidden = info[1].As<Napi::Boolean>().Value();
  return info.Env().Undefined();
}

static Napi::Value SetDark(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  if (v) v.web.appearance = [NSAppearance appearanceNamed:info[1].As<Napi::Boolean>().Value() ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  return info.Env().Undefined();
}

// evaluate(id, script): runs JavaScript in the page. Used by tests.
static Napi::Value Evaluate(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  std::string js = info[1].As<Napi::String>();
  if (v) [v.web evaluateJavaScript:[NSString stringWithUTF8String:js.c_str()] completionHandler:nil];
  return info.Env().Undefined();
}

// evaluateWithResult(id, script, requestId): the script's string result comes back as a
// 'result' event with a = requestId, b = result (empty on error).
static Napi::Value EvaluateWithResult(const Napi::CallbackInfo& info) {
  SwivelWebView* v = Get(info);
  std::string js = info[1].As<Napi::String>();
  std::string requestId = info[2].As<Napi::String>();
  if (!v) return info.Env().Undefined();
  __weak SwivelWebView* weak = v;
  [v.web evaluateJavaScript:[NSString stringWithUTF8String:js.c_str()]
          completionHandler:^(id result, NSError* error) {
            NSString* text = [result isKindOfClass:[NSString class]] ? result : @"";
            [weak send:"result" a:requestId b:text.UTF8String];
          }];
  return info.Env().Undefined();
}

static Napi::Value Destroy(const Napi::CallbackInfo& info) {
  int id = info[0].As<Napi::Number>().Int32Value();
  SwivelWebView* v = Get(info);
  if (!v) return info.Env().Undefined();
  [v.web removeObserver:v forKeyPath:@"URL"];
  [v.web.configuration.userContentController removeScriptMessageHandlerForName:@"swivel"];
  [v.web stopLoading];
  [v.clip removeFromSuperview];
  v.events = nullptr;
  views.erase(id);
  eventFns[id].Release();
  eventFns.erase(id);
  return info.Env().Undefined();
}

void InitMirror(Napi::Env env, Napi::Object exports);

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  InitMirror(env, exports);
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("setFrame", Napi::Function::New(env, SetFrame));
  exports.Set("setClip", Napi::Function::New(env, SetClip));
  exports.Set("answerChallenge", Napi::Function::New(env, AnswerChallenge));
  exports.Set("clickAt", Napi::Function::New(env, ClickAt));
  exports.Set("load", Napi::Function::New(env, Load));
  exports.Set("history", Napi::Function::New(env, History));
  exports.Set("setHidden", Napi::Function::New(env, SetHidden));
  exports.Set("setDark", Napi::Function::New(env, SetDark));
  exports.Set("evaluate", Napi::Function::New(env, Evaluate));
  exports.Set("evaluateWithResult", Napi::Function::New(env, EvaluateWithResult));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  exports.Set("releaseStore", Napi::Function::New(env, ReleaseStore));
  exports.Set("cookies", Napi::Function::New(env, Cookies));
  exports.Set("setCookie", Napi::Function::New(env, SetCookie));
  exports.Set("deleteCookie", Napi::Function::New(env, DeleteCookie));
  exports.Set("watchCookies", Napi::Function::New(env, WatchCookies));
  exports.Set("unwatchCookies", Napi::Function::New(env, UnwatchCookies));
  return exports;
}

NODE_API_MODULE(webkit_view, Init)
