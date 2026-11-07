// Quarter turns of a capture: a version shows the original turned `turn` times by 90 degrees clockwise, and its crop and its annotations are
// in the turned image. The turn is the whole of it; the original is never rewritten. No DOM, no Fabric, testable with `node --test`.

/** @param {unknown} value @returns {number} the quarter turns (0 to 3), 0 for anything else (a version saved before the turn existed has none) */
export const cleanTurn = (value) => (Number.isInteger(value) ? (((/** @type {number} */ (value)) % 4) + 4) % 4 : 0);

/** The size of a `w` x `h` image once it is turned `turn` quarter turns. @param {number} w @param {number} h @param {unknown} turn */
export const turnedSize = (w, h, turn) => (cleanTurn(turn) % 2 ? { w: h, h: w } : { w, h });

/** Where a point goes in a quarter turn of an image `h` px high (the turned image is `h` px wide). @param {number} x @param {number} y @param {number} h */
export const turnPoint = (x, y, h) => ({ x: h - y, y: x });

/** A rectangle after the same quarter turn; null stays null. @param {{ x: number, y: number, w: number, h: number } | null} r @param {number} h */
export const turnRect = (r, h) => r && { x: h - r.y - r.h, y: r.x, w: r.h, h: r.w };

/** The points of a free shape (x then y, as fractions of its box) after a quarter turn of the box. @param {number[]} pts */
export const turnPts = (pts) => pts.map((p, i) => (i % 2 ? pts[i - 1] : 1 - pts[i + 1]));

/**
 * The transform that draws a `w` x `h` image turned `turn` quarter turns: [a, b, c, d, e, f] of CanvasRenderingContext2D.setTransform. Whole
 * numbers only, so that every pixel lands on a pixel and nothing is resampled.
 * @param {unknown} turn @param {number} w @param {number} h
 * @returns {[number, number, number, number, number, number]}
 */
export function turnMatrix(turn, w, h) {
  switch (cleanTurn(turn)) {
    case 1: return [0, 1, -1, 0, h, 0];
    case 2: return [-1, 0, 0, -1, w, h];
    case 3: return [0, -1, 1, 0, 0, w];
    default: return [1, 0, 0, 1, 0, 0];
  }
}
