// Pure functions (no chrome.* or indexedDB) so they can be tested with `node --test`.

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Rect in CSS px of a vw x vh viewport -> rect in image px (iw x ih), clamped to the image on BOTH sides
// (a rect that overflows on the left or top is cropped, not shifted). w or h = 0 if the rect is outside the image.
// The factor comes from the image/viewport ratio: it absorbs devicePixelRatio and the browser zoom.
/**
 * @param {import('./versions.js').Rect} r Rectangle in CSS px.
 * @param {number} vw Viewport width, in CSS px.
 * @param {number} vh
 * @param {number} iw Captured image width, in px.
 * @param {number} ih
 * @returns {import('./versions.js').Rect}
 */
export function cropRect(r, vw, vh, iw, ih) {
  const sx = iw / vw, sy = ih / vh;
  const x0 = Math.max(0, Math.round(r.x * sx)), x1 = Math.min(iw, Math.round((r.x + r.w) * sx));
  const y0 = Math.max(0, Math.round(r.y * sy)), y1 = Math.min(ih, Math.round((r.y + r.h) * sy));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

// Validates the overlay message (trust boundary: any script of the extension can send one).
// Returns { rect, vw, vh } with finite numbers only (size > 0), else null.
/**
 * @param {any} m Message received from the overlay (untrusted).
 * @returns {{ rect: import('./versions.js').Rect, vw: number, vh: number } | null}
 */
export function cleanArea(m) {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const r = m?.rect;
  if (!r || !num(r.x) || !num(r.y) || !num(r.w) || !(r.w > 0) || !num(r.h) || !(r.h > 0)) return null;
  if (!num(m.vw) || !(m.vw > 0) || !num(m.vh) || !(m.vh > 0)) return null;
  return { rect: { x: r.x, y: r.y, w: r.w, h: r.h }, vw: m.vw, vh: m.vh };
}

// Width and height of a PNG, read from its IHDR header (bytes 16 to 23): avoids a full decode.
/** @param {Blob} blob @returns {Promise<{ w: number, h: number }>} */
export async function pngSize(blob) {
  const v = new DataView(await blob.slice(16, 24).arrayBuffer());
  return { w: v.getUint32(0), h: v.getUint32(4) };
}

// --- Capture of the tab: from the data URL to the bytes ---

// captureVisibleTab answers with a data URL. fetch(dataUrl).then((r) => r.blob()) costs about 40 ms per MB of PNG in the
// service worker (measured: 0.5, 2, 9 and 30 MB take 22, 82, 620 and 900 ms); decoding the base64 text directly takes 6, 14,
// 101 and 127 ms with atob and a loop, and 1.5, 4, 39 and 43 ms with Uint8Array.fromBase64 (Chrome 140 and later).
/** @type {((b64: string) => Uint8Array<ArrayBuffer>) | undefined} */
const nativeFromBase64 = /** @type {any} */ (Uint8Array).fromBase64?.bind(Uint8Array);

/**
 * The bytes of a base64 text: the native decoder when the browser has one, atob and a loop otherwise.
 * @param {string} b64
 * @param {((b64: string) => Uint8Array<ArrayBuffer>) | null} [native] The native decoder (the browser's by default), `null` forces the fallback: for the tests.
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function base64Bytes(b64, native = nativeFromBase64 ?? null) {
  if (native) return native(b64);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Splits a base64 data URL ("data:image/png;base64,...") into its base64 text, which the clipboard copy reuses as it is, and
 * the bytes it stands for.
 * @param {string} dataUrl
 * @param {((b64: string) => Uint8Array<ArrayBuffer>) | null} [native] See base64Bytes.
 * @returns {{ b64: string, bytes: Uint8Array<ArrayBuffer> }}
 */
export function decodeDataUrl(dataUrl, native) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) throw new Error('not a base64 data URL');
  const b64 = dataUrl.slice(comma + 1);
  return { b64, bytes: base64Bytes(b64, native) };
}

// --- Full page: scroll by tiles, then stitch them in an OffscreenCanvas ---

// ponytail: at most 100 tiles (~55 s of capture at Chrome's 2 calls/s); a taller page is cut and only its top is kept (planTiles). Split the page across several shots to keep the rest.
export const MAX_TILES = 100;
export const MAX_DIM = 16384;      // max side of a canvas
// ponytail: final canvas capped at 32 Mpx (~128 MB of RGBA; peak measured in the service worker: ~400 MB with 1080p tiles, ~680 MB with 4K), beyond that the page is scaled down (canvasSize); a streaming PNG encoder would lift it.
export const MAX_PIXELS = 32e6;

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

// --- Import: an image that comes from outside (a file, a paste, a drop) ---

export const IMPORT_MAX_BYTES = 64 * 1024 ** 2; // a file bigger than this is not even decoded
export const IMPORT_MAX_SIDE = MAX_DIM;         // the side of a canvas: the editor cannot draw more
export const IMPORT_MAX_PIXELS = MAX_PIXELS;    // the same 32 Mpx as a capture

/** Is this image within what the library takes? @param {{ w: number, h: number, bytes: number }} image */
export const importFits = ({ w, h, bytes }) => bytes <= IMPORT_MAX_BYTES && w >= 1 && h >= 1
  && w <= IMPORT_MAX_SIDE && h <= IMPORT_MAX_SIDE && w * h <= IMPORT_MAX_PIXELS;

// A dropped file can come with no type: its name says what it is meant to be. The decoder has the last word.
/** @param {{ type?: string, name?: string }} file */
export const looksLikeImage = ({ type, name }) => String(type ?? '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(String(name ?? ''));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG is kept as it is; the first 8 bytes tell. @param {ArrayLike<number>} bytes */
export const isPng = (bytes) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

// What a file says its size is, read from its header before anything is decoded: a small file can declare an image of billions of
// pixels (a PNG of one color is a few KB at any size) and the decoder would try to build it. PNG, GIF, BMP, JPEG and WebP; null for
// any other format (AVIF: the decoder's own limits hold) or a header cut short. The first 256 KB are enough for a JPEG with a big EXIF.
/** @param {ArrayLike<number>} b The first bytes of the file. @returns {{ w: number, h: number } | null} */
export function declaredSize(b) {
  const be16 = (/** @type {number} */ i) => b[i] * 256 + b[i + 1];
  const le16 = (/** @type {number} */ i) => b[i] + b[i + 1] * 256;
  const be32 = (/** @type {number} */ i) => be16(i) * 65536 + be16(i + 2);
  const le32 = (/** @type {number} */ i) => le16(i) + le16(i + 2) * 65536;
  const le24 = (/** @type {number} */ i) => le16(i) + b[i + 2] * 65536;
  const tag = (/** @type {number} */ i, /** @type {string} */ s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (isPng(b) && b.length >= 24) return { w: be32(16), h: be32(20) };
  if (tag(0, 'GIF') && b.length >= 10) return { w: le16(6), h: le16(8) };
  if (tag(0, 'BM') && b.length >= 26) return { w: le32(18), h: Math.abs(le32(22) | 0) }; // the height is negative for a top-down bitmap
  if (b[0] === 0xff && b[1] === 0xd8) {
    // walk the segments up to the first start of frame: marker, length (which counts itself), data
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; } // a fill byte
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: be16(i + 7), h: be16(i + 5) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // markers with no length
      i += 2 + be16(i + 2);
    }
    return null;
  }
  if (tag(0, 'RIFF') && tag(8, 'WEBP') && b.length >= 30) {
    if (tag(12, 'VP8X')) return { w: le24(24) + 1, h: le24(27) + 1 };
    if (tag(12, 'VP8L') && b[20] === 0x2f) { // 14 bits of width - 1, then 14 of height - 1
      const bits = le32(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (tag(12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
  }
  return null;
}

// The title of an imported image: its file name without the extension. A browser names a pasted image "image.png": that says
// nothing, the fallback (a text of the language) is used for it, as for a name that is empty once the extension is gone.
/** @param {unknown} name @param {string} fallback */
export function importTitle(name, fallback) {
  const stem = String(name ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return !stem || /^(image|untitled|unnamed|blob)$/i.test(stem) ? fallback : stem;
}

// --- Strip thumbnail ---

const THUMB_WIDTH = 240; // px
// ponytail: a very tall shot (full page) gets a thumbnail of its top only, its height capped at 2/3 of the width; a scaled-down overview of the whole page if the top is not enough.
const THUMB_MAX_RATIO = 2 / 3; // max height / width
export const THUMB_QUALITY = 0.8; // WebP

// For an image (or an area) of w x h px: the height kept (only the top if it is very tall) and the
// downscale factor (never an enlargement).
/** @param {number} w @param {number} h @returns {{ keepH: number, k: number }} */
export function thumbPlan(w, h) {
  return { keepH: Math.min(h, Math.round(w * THUMB_MAX_RATIO)), k: Math.min(1, THUMB_WIDTH / w) };
}

// The state a thumbnail was rendered from: the database stores it only if the shot still has this state (a rendering that
// took longer than a later edit must not replace the thumbnail of that edit, which may hide what the older one shows).
// A row that never had a version reads as the original, like a new shot.
/** @param {{ versions?: unknown[], active?: number }} state @returns {string} */
export const versionsKey = ({ versions, active }) => JSON.stringify([versions ?? [], active ?? -1]);
