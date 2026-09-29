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
