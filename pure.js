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

// --- The limits of a canvas ---

export const MAX_DIM = 16384;      // max side of a canvas
// ponytail: final canvas capped at 32 Mpx (~128 MB of RGBA; peak measured in the service worker: ~400 MB with 1080p tiles, ~680 MB with 4K), beyond that the page is scaled down (canvasSize); a streaming PNG encoder would lift it.
export const MAX_PIXELS = 32e6;
