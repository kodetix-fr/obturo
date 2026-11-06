// Pure logic of the numbered marker (the disc with a number that marks a step on an image): which number comes next, how big the disc
// is, what ink the number is written with. No DOM, no Fabric, testable with `node --test`.
import { clamp } from './pure.js';
import { solidColor } from './mask-pure.js';

/** Smallest and largest diameter of a medium marker, in image px: it follows the width of the image (1 / 40), within these bounds. */
export const MARKER_DIAMETER = { min: 24, max: 96, divisor: 40 };
const LEAST_DIAMETER = 20; // whatever the setting: below this a digit cannot be read

/**
 * The diameter of a new marker, in image px, for an image `docWidth` px wide and the thin / medium / thick setting (`factor`:
 * 0.6, 1 or 1.8, the same radios as the stroke).
 * @param {number} docWidth @param {number} [factor]
 */
export const markerDiameter = (docWidth, factor = 1) => Math.max(LEAST_DIAMETER, Math.round(clamp(docWidth / MARKER_DIAMETER.divisor, MARKER_DIAMETER.min, MARKER_DIAMETER.max) * factor));

/**
 * The number of the next marker: the smallest whole number from 1 that no marker has. After 1, 2 and 3, it is 4; if the 2 is deleted,
 * it is 2 again (the person who deletes a step to place it again wants its number back).
 * @param {Iterable<unknown>} numbers The numbers the markers already carry (anything else is ignored).
 */
export function nextMarkerNumber(numbers) {
  const used = new Set([...numbers].filter((n) => Number.isInteger(n) && /** @type {number} */ (n) > 0));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * The numbers of the markers that stay after others were deleted: when the markers made a plain sequence 1, 2, 3... the numbers above a
 * deleted one come down, so that the steps read 1, 2, 3 again. Numbers typed by hand (a repeated one, a gap) are left as they are.
 * @param {number[]} kept The numbers of the markers that stay. @param {number[]} removed The numbers of the deleted ones.
 * @returns {number[]} The new numbers of the markers that stay, in the same order.
 */
export function closeGaps(kept, removed) {
  const before = [...kept, ...removed].sort((a, b) => a - b);
  if (!removed.length || before.some((n, i) => n !== i + 1)) return kept;
  const gone = removed.toSorted((a, b) => a - b);
  return kept.map((n) => n - gone.filter((g) => g < n).length);
}

/**
 * White or near black, whichever suits `fill`: white as long as it keeps a contrast of 3:1 (what WCAG asks of large text, and a number
 * in a disc is large and bold), that is on a color of relative luminance up to 0.3. That keeps white on red, blue, green and gray, the
 * colors of a marker, and goes dark on yellow and the light colors. A color that is not `#rrggbb` gets white.
 * @param {unknown} fill
 * @returns {'#ffffff' | '#111111'}
 */
export function markerInk(fill) {
  const hex = solidColor(fill);
  if (!hex) return '#ffffff';
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.3 ? '#ffffff' : '#111111';
}

/** Font size of the number, in px, for a disc of diameter `d`: a number of two or three digits is set smaller to stay inside. @param {number} d @param {number} n */
export const markerFontSize = (d, n) => d * (n < 10 ? 0.56 : n < 100 ? 0.44 : 0.34);

// --- The legend: a short text beside the disc, in a pill of the color of the marker ---

export const LEGEND_MAX = 60; // characters

/** The text of a legend as it is stored: one line, spaces collapsed, at most LEGEND_MAX characters. '' is no legend. @param {unknown} value */
export const cleanLegend = (value) => [...String(value ?? '').replace(/\s+/g, ' ').trim()].slice(0, LEGEND_MAX).join('').trim();

/** Font size of the legend for a disc of diameter `d`. @param {number} d */
export const legendFontSize = (d) => d * 0.5;

/**
 * The pill of a legend for a disc of diameter `d` and a text `textWidth` px wide (measured at legendFontSize(d)): its width and height,
 * the padding of the text, and the gap between the disc and the pill. Everything follows `d`, so the legend is resized with the disc.
 * @param {number} d @param {number} textWidth
 */
export function legendBox(d, textWidth) {
  const padX = d * 0.35;
  return { gap: d * 0.2, padX, height: d * 0.8, width: textWidth + 2 * padX };
}

// --- The side of the legend, and the number ---

/** The side of the disc where the legend is written. */
export const MARKER_SIDES = /** @type {const} */ (['right', 'left']);

/** @param {unknown} value @returns {'right' | 'left'} 'left', or 'right' for anything else (a marker saved before the choice existed) */
export const cleanSide = (value) => (value === 'left' ? 'left' : 'right');

/**
 * The number typed for a marker: a whole number from 1 to 999 (three digits is what the disc holds), or null.
 * @param {unknown} value @returns {number | null}
 */
export function cleanMarkerNumber(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 ? n : null;
}

// The box of a marker holds the disc (a square of side `d`) and, when there is a legend, its `footprint` (the gap and the pill) on one
// side of it. These two functions say where the box is for a disc at `cx`, and where the disc is in a box: the disc stays where it is
// when the legend grows, changes side or goes away.
/** Left edge of the box of a disc centered at `cx`. @param {number} cx @param {number} d @param {number} footprint @param {'right' | 'left'} side */
export const boxLeft = (cx, d, footprint, side) => (side === 'left' ? cx - d / 2 - footprint : cx - d / 2);

/** Center of the disc in the box that starts at `left`. @param {number} left @param {number} d @param {number} footprint @param {'right' | 'left'} side */
export const discCenterX = (left, d, footprint, side) => (side === 'left' ? left + footprint + d / 2 : left + d / 2);

/**
 * Where a legend goes when nobody chose: on the right, unless it would leave the image and fits on the left.
 * @param {number} cx Center of the disc. @param {number} d @param {number} footprint @param {number} imageWidth
 * @returns {'right' | 'left'}
 */
export function autoSide(cx, d, footprint, imageWidth) {
  const outRight = cx + d / 2 + footprint > imageWidth;
  const fitsLeft = cx - d / 2 - footprint >= 0;
  return outRight && fitsLeft ? 'left' : 'right';
}
