// The shapes an area can take (rectangle, rounded rectangle, ellipse, free): which exist, the corner radii that draw each one in a box, and
// the shape that a box with given radii is. The radii (`rx`, `ry` of a Fabric Rect) are the whole description of the first three: they are
// saved with the object and resized with it. A FREE shape is a list of points (`pts`) in the box, as fractions of its width and height,
// so that it is resized with the box too. No DOM, no Fabric, testable with `node --test`.

export const SHAPES = /** @type {const} */ (['rect', 'round', 'ellipse', 'free']);
export const DEFAULT_SHAPE = 'rect';

/** The ends an arrow can have: a head at the end, none (a plain line), a head at both ends. */
export const ENDS = /** @type {const} */ (['end', 'none', 'both']);
export const DEFAULT_ENDS = 'end';

/** @param {unknown} value @returns {'end' | 'none' | 'both'} the ends, or the default for anything else (an arrow saved before the choice existed has none: a head at the end) */
export const cleanEnds = (value) => ENDS.find((e) => e === value) ?? DEFAULT_ENDS;

/** Radius of the corners of a rounded rectangle, as a part of its short side. */
export const ROUND_RATIO = 0.25;

/** @param {unknown} value @returns {'rect' | 'round' | 'ellipse' | 'free'} the shape, or the default for anything else */
export const cleanShape = (value) => SHAPES.find((s) => s === value) ?? DEFAULT_SHAPE;

/**
 * The corner radii that draw `shape` in a `w` x `h` box: none for a rectangle, a quarter of the short side for a rounded one, half the
 * width and half the height for an ellipse.
 * @param {string} shape @param {number} w @param {number} h
 * @returns {{ rx: number, ry: number }}
 */
export function shapeRadii(shape, w, h) {
  if (shape === 'ellipse') return { rx: w / 2, ry: h / 2 };
  if (shape === 'round') {
    const r = Math.max(0, Math.min(w, h)) * ROUND_RATIO;
    return { rx: r, ry: r };
  }
  return { rx: 0, ry: 0 };
}

/**
 * The shape of a `width` x `height` box with corner radii `rx`, `ry` (the box of an object as it is saved: no scale applied to any of
 * the four). A box with points is free; an ellipse is a box whose radii are half its sides; no radius is a rectangle; anything between is
 * a rounded rectangle.
 * @param {{ width?: number, height?: number, rx?: number, ry?: number, pts?: number[] }} box
 * @returns {'rect' | 'round' | 'ellipse' | 'free'}
 */
export function shapeOf({ width = 0, height = 0, rx = 0, ry = 0, pts }) {
  if (pts && pts.length >= MIN_POINTS * 2) return 'free';
  if (!(rx > 0 && ry > 0)) return 'rect';
  return rx >= width / 2 - 0.5 && ry >= height / 2 - 0.5 ? 'ellipse' : 'round';
}

// --- Free shapes ---

/** A free shape needs at least this many points (two make a line: the brush of the highlighter, nothing for an area). */
export const MIN_POINTS = 2;

/**
 * Drops the points of a path that a straight line between the others replaces within `tolerance` (Ramer-Douglas-Peucker): a hand
 * drawn path of thousands of points becomes a few dozens, and looks the same. The ends are always kept.
 * @param {Array<[number, number]>} points @param {number} tolerance
 * @returns {Array<[number, number]>}
 */
export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  /** @type {Array<[number, number]>} */
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = /** @type {[number, number]} */ (stack.pop());
    let far = -1, farthest = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i], points[a], points[b]);
      if (d > farthest) { far = i; farthest = d; }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Distance from point `p` to the segment `a` `b`. @param {[number, number]} p @param {[number, number]} a @param {[number, number]} b */
function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Length of a path. @param {Array<[number, number]>} points */
export const pathLength = (points) => points.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0), 0);

/**
 * The box and the points of a free shape, from the points of the path in the document: the box is their bounds, widened by `pad` on every side
 * (the half width of a brush), and `pts` is the path as fractions of that box, x then y, to 4 decimals. A box is never narrower than 1 px (a
 * straight path), so a division by it is always possible.
 * @param {Array<[number, number]>} points @param {number} [pad]
 * @returns {{ left: number, top: number, width: number, height: number, pts: number[] }}
 */
export function freeGeometry(points, pad = 0) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const left = Math.min(...xs) - pad, top = Math.min(...ys) - pad;
  const width = Math.max(1, Math.max(...xs) + pad - left), height = Math.max(1, Math.max(...ys) + pad - top);
  const round = (/** @type {number} */ v) => Math.round(v * 1e4) / 1e4;
  return { left, top, width, height, pts: points.flatMap(([x, y]) => [round((x - left) / width), round((y - top) / height)]) };
}
