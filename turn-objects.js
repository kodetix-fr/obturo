// What a quarter turn of the capture does to the objects drawn on it.
import { Rect } from './vendor/fabric.min.mjs';
import { Marker } from './shapes.js';
import { autoSide } from './marker-pure.js';
import { turnPoint, turnPts } from './turn-pure.js';

// An object after a quarter turn clockwise of an image `h` px high. A rectangle that is not tilted (an outline, a solid fill, a free area,
// a hiding region, the highlighter, the spotlight) stays upright: its box turns. A marker stays upright too, its disc goes where the turn
// takes it. Anything else turns with the image.
export function turnObject(o, h) {
  const to = turnPoint(o.getCenterPoint().x, o.getCenterPoint().y, h);
  if (o instanceof Marker) {
    const { disc } = o.parts();
    const c = turnPoint(disc.cx, disc.cy, h);
    o.set({ top: c.y - o.height / 2 });
    o.fit(c.x);
    if (o.sideAuto && o.label) o.setSide(autoSide(c.x, o.height, o.width - o.height, h));
  } else if (o instanceof Rect && !o.angle) {
    o.set({ width: o.height, height: o.width, rx: o.ry, ry: o.rx });
    if (o.pts) o.set({ pts: turnPts(o.pts) });
    o.setPositionByOrigin(to, 'center', 'center');
  } else {
    o.set({ angle: ((o.angle || 0) + 90) % 360 });
    o.setPositionByOrigin(to, 'center', 'center');
  }
  o.setCoords();
}
