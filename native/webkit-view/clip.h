#import <Cocoa/Cocoa.h>

/** A clip view filling content, added on top. Children use content's top-left coordinates. */
NSView* SwivelMakeClip(NSView* content);
/** Show children only inside x, y, w, h (content top-left coordinates). */
void SwivelClipTo(NSView* clip, NSView* content, double x, double y, double w, double h);
/** No clipping: the clip view fills content again. */
void SwivelClipReset(NSView* clip, NSView* content);
