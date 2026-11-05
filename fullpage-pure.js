// Pure functions (no chrome.* or indexedDB) so they can be tested with `node --test`.
// Full page: the plan of the tiles, which element scrolls, and what the user is told when the image is not the whole page.
import { MAX_DIM, MAX_PIXELS } from './pure.js';

// --- Full page: scroll by tiles, then stitch them in an OffscreenCanvas ---

// ponytail: at most 100 tiles (~55 s of capture at Chrome's 2 calls/s); a taller page is cut and only its top is kept (planTiles). Split the page across several shots to keep the rest.
export const MAX_TILES = 100;

const MIN_SCALE = 0.5; // a page is never shrunk by more than half to fit the canvas

// Max number of tiles for a tile of `view` CSS px at `dpr`: beyond that, the canvas (capped at MAX_DIM) would
// force shrinking the page by more than half (MIN_SCALE), so capturing more is pointless. Clamped to [1, MAX_TILES].
/** @param {number} view @param {number} dpr */
export const maxTiles = (view, dpr) =>
  Math.min(MAX_TILES, Math.max(1, Math.floor(MAX_DIM / (MIN_SCALE * view * (dpr > 0 ? dpr : 1)))));

// Scroll positions (CSS px) that cover `total` with tiles of `view` px.
// The last one is stuck to the bottom: the browser clamps it, so it overlaps the previous one.
// `covered` = height actually covered (cut at maxTiles tiles: the top of the page is kept).
/** @param {number} total @param {number} view @param {number} [dpr] @returns {{ covered: number, ys: number[] }} */
export function planTiles(total, view, dpr = 1) {
  if (!(view >= 1)) return { covered: total, ys: [0] };
  const covered = Math.min(total, view * maxTiles(view, dpr));
  const ys = [];
  for (let y = 0; y + view < covered; y += view) ys.push(y);
  ys.push(Math.max(0, covered - view));
  return { covered, ys };
}

// Size of the final canvas. imgW = usable width of a tile (image px), sy = image px per CSS px.
// Past the limits, a uniform scale k < 1 applies (no distortion).
/** @param {number} covered @param {number} imgW @param {number} sy @returns {{ k: number, w: number, h: number }} */
export function canvasSize(covered, imgW, sy) {
  const fullH = Math.round(covered * sy);
  const k = Math.min(1, MAX_DIM / imgW, MAX_DIM / fullH, Math.sqrt(MAX_PIXELS / (imgW * fullH)));
  return { k, w: Math.floor(imgW * k), h: Math.floor(fullH * k) };
}

// Where to paste a tile taken at the ACTUAL scroll position y (CSS px): srcRows image rows, scale k.
// At k = 1 the height is an integer (no resampling); the extra row covers rounding errors, and the next tile
// paints over it.
// `covered` = first canvas row that the tiles already pasted do not cover. At a fractional display scale
// (125%, 150%) the browser snaps scrolling to the physical pixel: the actual scroll drifts from the plan,
// and rounding can leave an empty row between two tiles. The tile is then stretched upward to fill it.
// `height` = rows of the canvas. The same rounding can leave the last row or two empty (the height of the canvas is rounded
// on its own): a tile that stops 1 or 2 rows short of the bottom is stretched down to it.
/**
 * @param {number} y
 * @param {number} sy
 * @param {number} srcRows
 * @param {number} k
 * @param {number} [covered]
 * @param {number} [height]
 * @returns {{ dy: number, dh: number }}
 */
export function tileDest(y, sy, srcRows, k, covered = Infinity, height = Infinity) {
  const top = Math.round(y * sy * k);
  const dy = Math.min(top, covered);
  const dh = top + Math.ceil(srcRows * k) - dy;
  const short = height - (dy + dh);
  return { dy, dh: short > 0 && short <= 2 ? dh + short : dh };
}

// --- Full page: which element scrolls, and a height that grows ---

export const MIN_SCROLL = 8; // px: less content than this to scroll is a rounding error or a decoration, not a scroller
// A scroller must show at least this share of the window. Above 1/3 on purpose: fullpage.js looks for scrollers under 9
// points of the window (1/6, 1/2 and 5/6 of each side), and a box with both sides over 1/3 of the window holds one of them.
export const MIN_SHARE = 0.4;

/**
 * An element the page scrolls inside of: its client box in the window (CSS px) and how far it scrolls
 * (scrollHeight - clientHeight).
 * @typedef {{ x: number, y: number, w: number, h: number, max: number }} Scroller
 */

// The part of a box (CSS px) that is inside a vw x vh window.
/** @param {import('./versions.js').Rect} b @param {number} vw @param {number} vh @returns {import('./versions.js').Rect} */
export function clipBox(b, vw, vh) {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.max(0, Math.min(vw, b.x + b.w) - x), h: Math.max(0, Math.min(vh, b.y + b.h) - y) };
}

// What a full page scrolls: the document, or a scroller inside it (most web applications keep the document still and scroll a
// panel). Each candidate that scrolls by more than MIN_SCROLL px and shows at least MIN_SHARE of the window scores the
// scrollable content it offers on screen: the surface it shows x the px it scrolls. The document scores the surface of the
// window x the px it scrolls, but only if the user can scroll it (not `overflow: hidden` on the page). The best score wins;
// the document on a tie (a page that scrolls and has no panel that scrolls more stays as it was), the first candidate between
// two candidates. Of nested scrollers the one with the most to show wins, not the outermost.
// ponytail: one scroller per capture, the others (a second column, a sidebar) are not in the image, and a scroller in an iframe is not seen; capture them in turn and put them side by side, and inject the frames.
/**
 * @param {Scroller[]} cands
 * @param {{ user: boolean, max: number }} doc `user`: the document can be scrolled by the user; `max`: how far it scrolls.
 * @param {number} vw Window size, CSS px.
 * @param {number} vh
 * @returns {number} Index in `cands`, -1 for the document.
 */
export function pickScroller(cands, doc, vw, vh) {
  const win = vw * vh;
  let best = -1;
  let top = doc.user && doc.max > MIN_SCROLL ? win * doc.max : 0;
  cands.forEach((c, i) => {
    if (!(c.max > MIN_SCROLL)) return; // also false for NaN
    const v = clipBox(c, vw, vh);
    const shown = v.w * v.h;
    if (!(shown >= MIN_SHARE * win) || shown * c.max <= top) return;
    best = i;
    top = shown * c.max;
  });
  return best;
}

// The height that is scrolled may grow while the tiles are taken (lazy loading, infinite scroll). The plan is then made
// again for the new height, and the capture goes on with the first position past `doneY`, the tile just taken. Both plans
// agree up to there (multiples of `view`), except for a last tile stuck to the old bottom, which the new plan passes by.
// Growth is followed within the usual limits (MAX_TILES, the canvas) because planTiles applies them.
// Returns null if the plan would not reach MIN_SCROLL px further (rounding of a layout, or the limits already hold).
/**
 * @param {{ covered: number }} plan Current plan.
 * @param {number} total Scrollable height now, CSS px.
 * @param {number} view
 * @param {number} dpr
 * @param {number} doneY Position of the tile just taken.
 * @returns {null | { covered: number, ys: number[], next: number }} `next`: index of the next tile in the new plan.
 */
export function growPlan(plan, total, view, dpr, doneY) {
  const bigger = planTiles(total, view, dpr);
  if (!(bigger.covered >= plan.covered + MIN_SCROLL)) return null;
  return { ...bigger, next: bigger.ys.findIndex((y) => y > doneY) };
}

// --- Full page: what the user is told when the image is not the whole page ---
// The keys are texts of locales/*.sw.js; sw.js shows them on the page (notice.js).

// The page is longer than what the plan covers (the limits of the canvas, or growth that could not be followed).
/** @param {number} covered CSS px the plan covers. @param {number} total CSS px the target scrolls, plus its window. */
export const isCut = (covered, total) => total >= covered + MIN_SCROLL;

export const FRAME_SHARE = 0.5; // a frame that shows this much of the window holds the page, as far as the user can tell

// A page with nothing to scroll gives the visible part. When a big frame holds the page, the page does have more: say so.
// (A document that cannot be scrolled by the user is not this case: fullpage.js scrolls it by script, and the whole page is captured.)
// ponytail: a page that scrolls by itself (a canvas, a custom scroll) has nothing to tell it by and gives the visible part without a word.
/** @param {{ frame: number }} scan What fullpage.js found. @returns {string | null} */
export function unscrolledKey(scan) {
  return scan.frame >= FRAME_SHARE ? 'sw.full.frame' : null;
}

// Why a full page stopped, from the message of its error (sw.js and fullpage.js write them, Chrome writes the last ones).
/** @param {unknown} error @returns {string} */
export function failureKey(error) {
  const m = String(/** @type {any} */ (error)?.message ?? error);
  if (/resized|zoom|size changed/.test(m)) return 'sw.full.fail.resized';
  if (/\bmoved|scroller gone/.test(m)) return 'sw.full.fail.moved';
  if (/tab changed/.test(m)) return 'sw.full.fail.tab';
  if (/did not answer|restored|No tab|was removed|closed|Cannot access/.test(m)) return 'sw.full.fail.page';
  return 'sw.full.fail.other';
}
