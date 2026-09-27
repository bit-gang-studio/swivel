// Mirrors another app's window (Swivel's hidden Firefox) into a layer in Swivel's window with
// ScreenCaptureKit. Frames go straight from the capture to the layer as IOSurfaces, so there
// are no copies. The view lets mouse events through to Swivel's page area underneath, which
// forwards input to Firefox.

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <napi.h>
#include <map>

@interface SwivelMirrorView : NSView
@end
@implementation SwivelMirrorView
- (NSView*)hitTest:(NSPoint)point { return nil; }  // Clicks go to the page area underneath.
- (BOOL)isFlipped { return YES; }
@end

API_AVAILABLE(macos(12.3))
@interface SwivelMirror : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, strong) SwivelMirrorView* view;
@property(nonatomic, strong) SCStream* stream;
@property(nonatomic, strong) SCStreamConfiguration* config;
@property(nonatomic, assign) CMSampleBufferRef held;  // Keeps the shown surface from being reused.
@property(atomic, assign) long frames;  // Complete frames delivered, for diagnostics.
@end

@implementation SwivelMirror
- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)sb ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeScreen) return;
  CFArrayRef atts = CMSampleBufferGetSampleAttachmentsArray(sb, false);
  if (!atts || CFArrayGetCount(atts) == 0) return;
  NSDictionary* info = (__bridge NSDictionary*)CFArrayGetValueAtIndex(atts, 0);
  if ([info[SCStreamFrameInfoStatus] integerValue] != SCFrameStatusComplete) return;
  CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(sb);
  if (!pb) return;
  IOSurfaceRef surface = CVPixelBufferGetIOSurface(pb);
  if (!surface) return;
  self.frames += 1;
  CFRetain(sb);
  dispatch_async(dispatch_get_main_queue(), ^{
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    self.view.layer.contents = (__bridge id)surface;
    [CATransaction commit];
    if (self.held) CFRelease(self.held);
    self.held = sb;
  });
}
- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
}
- (void)dealloc {
  if (_held) CFRelease(_held);
}
@end

static std::map<int, id> mirrors;
static int nextMirror = 1;

static Napi::Value ScreenCaptureAccess(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), CGPreflightScreenCaptureAccess());
}

// Shows the macOS prompt (only the first time). The app must restart after it's granted.
static Napi::Value RequestScreenCaptureAccess(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), CGRequestScreenCaptureAccess());
}

// mirrorCreate(parentHandle, pid, x, y, width, height, callback(error, id)): finds pid's window
// at that screen position (points, top-left origin; Swivel just placed it there), then starts
// capturing it into a hidden view in the parent window.
static Napi::Value MirrorCreate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (@available(macOS 12.3, *)) {
    void* raw = *reinterpret_cast<void**>(info[0].As<Napi::Buffer<uint8_t>>().Data());
    NSView* parent = (__bridge NSView*)raw;
    pid_t pid = info[1].As<Napi::Number>().Int32Value();
    double x = info[2].As<Napi::Number>().DoubleValue(), y = info[3].As<Napi::Number>().DoubleValue();
    double w = info[4].As<Napi::Number>().DoubleValue(), h = info[5].As<Napi::Number>().DoubleValue();
    auto done = Napi::ThreadSafeFunction::New(env, info[6].As<Napi::Function>(), "swivel-mirror-create", 0, 1);
    int id = nextMirror++;
    CGFloat scale = parent.window.backingScaleFactor ?: 2;

    SwivelMirrorView* view = [[SwivelMirrorView alloc] initWithFrame:NSZeroRect];
    view.wantsLayer = YES;
    view.layer.contentsGravity = kCAGravityResize;
    view.layer.masksToBounds = YES;
    view.hidden = YES;
    [parent addSubview:view positioned:NSWindowAbove relativeTo:nil];

    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent* content, NSError* error) {
      // The on-screen window of that process at the position Swivel placed it (other Firefox
      // windows are hidden), ignoring small helper windows.
      SCWindow* best = nil;
      double bestScore = INFINITY;
      for (SCWindow* win in content.windows) {
        if (win.owningApplication.processID != pid || win.windowLayer != 0 || !win.isOnScreen) continue;
        if (win.frame.size.width < 100 || win.frame.size.height < 100) continue;
        double score = fabs(win.frame.origin.x - x) + fabs(win.frame.origin.y - y);
        if (score > 4) continue;
        score += (fabs(win.frame.size.width - w) + fabs(win.frame.size.height - h)) / 1000;
        if (score < bestScore) { best = win; bestScore = score; }
      }
      if (!best) {
        std::string msg = error ? error.localizedDescription.UTF8String : "Firefox window not found";
        done.BlockingCall([msg](Napi::Env env, Napi::Function cb) { cb.Call({Napi::String::New(env, msg), env.Null()}); });
        done.Release();
        return;
      }
      SCContentFilter* filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:best];
      SCStreamConfiguration* config = [SCStreamConfiguration new];
      config.width = (size_t)(best.frame.size.width * scale);
      config.height = (size_t)(best.frame.size.height * scale);
      config.minimumFrameInterval = CMTimeMake(1, 120);
      config.queueDepth = 4;
      config.showsCursor = NO;
      config.pixelFormat = kCVPixelFormatType_32BGRA;
      SwivelMirror* mirror = [SwivelMirror new];
      mirror.view = view;
      mirror.config = config;
      mirror.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:mirror];
      NSError* addError = nil;
      [mirror.stream addStreamOutput:mirror type:SCStreamOutputTypeScreen sampleHandlerQueue:dispatch_queue_create("swivel.mirror", DISPATCH_QUEUE_SERIAL) error:&addError];
      [mirror.stream startCaptureWithCompletionHandler:^(NSError* startError) {
        std::string msg = startError ? startError.localizedDescription.UTF8String : (addError ? addError.localizedDescription.UTF8String : "");
        dispatch_async(dispatch_get_main_queue(), ^{
          if (msg.empty()) mirrors[id] = mirror;
          else [view removeFromSuperview];
        });
        done.BlockingCall([msg, id](Napi::Env env, Napi::Function cb) {
          if (msg.empty()) cb.Call({env.Null(), Napi::Number::New(env, id)});
          else cb.Call({Napi::String::New(env, msg), env.Null()});
        });
        done.Release();
      }];
    }];
    return env.Undefined();
  }
  Napi::Error::New(env, "Needs macOS 12.3").ThrowAsJavaScriptException();
  return env.Undefined();
}

API_AVAILABLE(macos(12.3))
static SwivelMirror* GetMirror(const Napi::CallbackInfo& info) {
  auto it = mirrors.find(info[0].As<Napi::Number>().Int32Value());
  return it == mirrors.end() ? nil : (SwivelMirror*)it->second;
}

// mirrorSetFrame(id, x, y, w, h): where to show it in Swivel's window, points, top-left origin.
static Napi::Value MirrorSetFrame(const Napi::CallbackInfo& info) {
  if (@available(macOS 12.3, *)) {
    SwivelMirror* m = GetMirror(info);
    if (!m) return info.Env().Undefined();
    double x = info[1].As<Napi::Number>().DoubleValue(), y = info[2].As<Napi::Number>().DoubleValue();
    double w = info[3].As<Napi::Number>().DoubleValue(), h = info[4].As<Napi::Number>().DoubleValue();
    NSView* parent = m.view.superview;
    double top = parent.isFlipped ? y : parent.bounds.size.height - y - h;
    m.view.frame = NSMakeRect(x, top, w, h);
  }
  return info.Env().Undefined();
}

// mirrorResizeSource(id, width, height): the captured window changed size (points).
static Napi::Value MirrorResizeSource(const Napi::CallbackInfo& info) {
  if (@available(macOS 12.3, *)) {
    SwivelMirror* m = GetMirror(info);
    if (!m) return info.Env().Undefined();
    CGFloat scale = m.view.window.backingScaleFactor ?: 2;
    m.config.width = (size_t)(info[1].As<Napi::Number>().DoubleValue() * scale);
    m.config.height = (size_t)(info[2].As<Napi::Number>().DoubleValue() * scale);
    [m.stream updateConfiguration:m.config completionHandler:nil];
  }
  return info.Env().Undefined();
}

// mirrorFrames(id): complete frames delivered so far.
static Napi::Value MirrorFrames(const Napi::CallbackInfo& info) {
  if (@available(macOS 12.3, *)) {
    SwivelMirror* m = GetMirror(info);
    if (m) return Napi::Number::New(info.Env(), m.frames);
  }
  return Napi::Number::New(info.Env(), -1);
}

static Napi::Value MirrorSetHidden(const Napi::CallbackInfo& info) {
  if (@available(macOS 12.3, *)) {
    SwivelMirror* m = GetMirror(info);
    if (m) m.view.hidden = info[1].As<Napi::Boolean>().Value();
  }
  return info.Env().Undefined();
}

static Napi::Value MirrorDestroy(const Napi::CallbackInfo& info) {
  if (@available(macOS 12.3, *)) {
    int id = info[0].As<Napi::Number>().Int32Value();
    SwivelMirror* m = GetMirror(info);
    if (!m) return info.Env().Undefined();
    [m.stream stopCaptureWithCompletionHandler:nil];
    [m.view removeFromSuperview];
    mirrors.erase(id);
  }
  return info.Env().Undefined();
}

// windowFrames(pid): that process's windows as macOS sees them (no permission needed for bounds).
static Napi::Value WindowFrames(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  pid_t pid = info[0].As<Napi::Number>().Int32Value();
  Napi::Array out = Napi::Array::New(env);
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
  uint32_t n = 0;
  for (NSDictionary* w in (__bridge NSArray*)list) {
    if ([w[(id)kCGWindowOwnerPID] intValue] != pid) continue;
    NSDictionary* b = w[(id)kCGWindowBounds];
    if ([b[@"Width"] doubleValue] < 100) continue;
    Napi::Object o = Napi::Object::New(env);
    o.Set("x", [b[@"X"] doubleValue]);
    o.Set("y", [b[@"Y"] doubleValue]);
    o.Set("width", [b[@"Width"] doubleValue]);
    o.Set("height", [b[@"Height"] doubleValue]);
    o.Set("onScreen", [w[(id)kCGWindowIsOnscreen] boolValue]);
    o.Set("layer", [w[(id)kCGWindowLayer] intValue]);
    out.Set(n++, o);
  }
  if (list) CFRelease(list);
  return out;
}

void InitMirror(Napi::Env env, Napi::Object exports) {
  exports.Set("windowFrames", Napi::Function::New(env, WindowFrames));
  exports.Set("screenCaptureAccess", Napi::Function::New(env, ScreenCaptureAccess));
  exports.Set("requestScreenCaptureAccess", Napi::Function::New(env, RequestScreenCaptureAccess));
  exports.Set("mirrorCreate", Napi::Function::New(env, MirrorCreate));
  exports.Set("mirrorSetFrame", Napi::Function::New(env, MirrorSetFrame));
  exports.Set("mirrorResizeSource", Napi::Function::New(env, MirrorResizeSource));
  exports.Set("mirrorSetHidden", Napi::Function::New(env, MirrorSetHidden));
  exports.Set("mirrorFrames", Napi::Function::New(env, MirrorFrames));
  exports.Set("mirrorDestroy", Napi::Function::New(env, MirrorDestroy));
}
