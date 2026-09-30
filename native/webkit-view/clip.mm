// Clip views: every native page view (Safari view, Firefox mirror) sits in one, so it can be cut
// off at the edge of an area, e.g. a canvas frame panned under Swivel's toolbar. A clip view is
// flipped and its bounds origin is the clip rect's top-left, so children are placed in window
// content coordinates (top-left origin) whatever the clip.
#import <Cocoa/Cocoa.h>
#include "clip.h"

@interface SwivelClip : NSView
@end
@implementation SwivelClip
- (BOOL)isFlipped { return YES; }
// Clicks go to the page inside, or through to the window beneath: the clip itself is never a target.
- (NSView*)hitTest:(NSPoint)point {
  NSView* hit = [super hitTest:point];
  return hit == self ? nil : hit;
}
@end

NSView* SwivelMakeClip(NSView* content) {
  SwivelClip* clip = [[SwivelClip alloc] initWithFrame:content.bounds];
  clip.wantsLayer = YES;
  clip.layer.masksToBounds = YES;
  SwivelClipReset(clip, content);
  [content addSubview:clip positioned:NSWindowAbove relativeTo:nil];
  return clip;
}

void SwivelClipTo(NSView* clip, NSView* content, double x, double y, double w, double h) {
  double top = content.isFlipped ? y : content.bounds.size.height - y - h;
  clip.autoresizingMask = NSViewNotSizable;
  clip.frame = NSMakeRect(x, top, w, h);
  clip.bounds = NSMakeRect(x, y, w, h);
}

void SwivelClipReset(NSView* clip, NSView* content) {
  clip.frame = content.bounds;
  clip.bounds = NSMakeRect(0, 0, content.bounds.size.width, content.bounds.size.height);
  clip.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
}

// Test hook: a real left click at x, y (window content points, top-left), sent through the window
// like a mouse click, so it's hit-tested by macOS exactly as a user's would be.
void SwivelClickAt(NSView* content, double x, double y) {
  NSWindow* window = content.window;
  NSPoint inContent = NSMakePoint(x, content.isFlipped ? y : content.bounds.size.height - y);
  NSPoint p = [content convertPoint:inContent toView:nil];
  NSEventType types[] = {NSEventTypeLeftMouseDown, NSEventTypeLeftMouseUp};
  for (NSEventType type : types) {
    NSEvent* e = [NSEvent mouseEventWithType:type location:p modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                                windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
    [NSApp postEvent:e atStart:NO];
  }
}
