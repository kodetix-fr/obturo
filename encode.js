// Image encoding for the exports: PNG, JPEG or WebP from a bitmap or a canvas, and the name proposed for the file.
// No DOM, no chrome.* at load time: the canvases are OffscreenCanvas (a page and the service worker both have it), a
// plain HTMLCanvasElement is only used through its toBlob, so this file runs the same everywhere. The parts that are
// calculation (FORMATS, clampQuality, suggestedFilename) are tested in Node; the encoding itself by the E2E tests.

// ponytail: three formats, those the canvas of Chrome can encode (AVIF and GIF cannot be written from a canvas: the
// browser silently answers with a PNG, which encodeImage turns into an error); add one here the day Chrome encodes it.
/** @type {Record<'png' | 'jpeg' | 'webp', { mime: string, ext: string, lossy: boolean }>} */
export const FORMATS = {
  png: { mime: 'image/png', ext: 'png', lossy: false },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', lossy: true },
  webp: { mime: 'image/webp', ext: 'webp', lossy: true },
};

export const QUALITY_MIN = 0.1;
export const QUALITY_DEFAULT = 0.9;

/** @param {unknown} q @returns {number} Encoder quality in [QUALITY_MIN, 1]; the default for anything that is not a number. */
export const clampQuality = (q) => (typeof q === 'number' && Number.isFinite(q) ? Math.min(1, Math.max(QUALITY_MIN, q)) : QUALITY_DEFAULT);

/**
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<Blob | null>}
 */
function canvasToBlob(canvas, type, quality) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality }); // rejects on failure
  return new Promise((done) => canvas.toBlob(done, type, quality)); // null on failure
}

/**
 * Encodes an image.
 *
 * A canvas is encoded as it is (PNG, WebP). A bitmap, or any source for JPEG, goes through one scratch canvas, released
 * as soon as the blob is ready. JPEG has no transparency: the scratch canvas is white first, so a transparent area
 * becomes white, not black. `quality` only counts for JPEG and WebP; PNG is lossless.
 * @param {ImageBitmap | HTMLCanvasElement | OffscreenCanvas} source
 * @param {{ format?: 'png' | 'jpeg' | 'webp', quality?: number }} [options] `quality` is kept within [0.1, 1].
 * @returns {Promise<Blob>}
 */
export async function encodeImage(source, { format = 'png', quality = QUALITY_DEFAULT } = {}) {
  if (!Object.hasOwn(FORMATS, format)) throw new Error(`unknown image format: ${format}`);
  const { mime } = FORMATS[format];
  const { width, height } = source;
  if (!(width >= 1 && height >= 1)) throw new Error('cannot encode an empty image');

  /** @type {HTMLCanvasElement | OffscreenCanvas} */
  let canvas;
  /** @type {OffscreenCanvas | null} */
  let scratch = null;
  if (format === 'jpeg' || !('convertToBlob' in source || 'toBlob' in source)) {
    scratch = canvas = new OffscreenCanvas(width, height);
    // willReadFrequently: the canvas is drawn once and read back once, by the encoder; a CPU canvas skips the trip to the GPU
    // (measured: ZIP of 5 images of 3840x2160 as JPEG 470 -> 380 ms, as WebP 2070 -> 1740 ms)
    const ctx = scratch.getContext('2d', { alpha: format !== 'jpeg', willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    if (format === 'jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(source, 0, 0);
  } else {
    canvas = /** @type {HTMLCanvasElement | OffscreenCanvas} */ (source);
  }
  let blob;
  try {
    blob = await canvasToBlob(canvas, mime, clampQuality(quality));
  } finally {
    if (scratch) scratch.width = scratch.height = 0; // gives the pixels back before anything else runs
  }
  // A format the browser cannot encode comes back as a PNG, and a canvas that is too big as null: both are errors.
  if (!blob) throw new Error(`the browser could not encode ${width}x${height} px as ${mime} (image too large?)`);
  if (blob.type !== mime) throw new Error(`the browser cannot encode ${mime}`);
  return blob;
}

// --- File name ---

const pad = (n) => String(n).padStart(2, '0');
const MAX_HOST = 60; // characters of the address (or of the title) kept in the name
const MAX_STEM = 120; // characters of the whole name before the extension
// Windows device names are reserved whatever follows the first dot: `nul.example.com_2026-10-02_14-05-09.png` cannot be created.
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

// The words of a template (settings.js keeps the template, the library shows these four): anything else in braces stays as typed.
export const DEFAULT_NAME_TEMPLATE = '{host}_{date}_{time}'; // settings.js repeats it (the service worker should not load this file), encode.test.js keeps the two equal
const TOKEN = /\{(host|title|date|time)\}/g;

/**
 * Name proposed for an exported capture, from a template: by default `<host>_<YYYY-MM-DD>_<HH-mm-ss>.<ext>`, the date being the
 * one of the capture in local time. `{host}` is the site, `{title}` the title of the page, `{date}` and `{time}` the capture's.
 * Safe on Windows whatever the template and the page: no reserved character (the host can hold `:` and brackets for an IPv6
 * address, a title anything), no leading or trailing dot or space, no device name (`nul.example.com` becomes `_nul.example.com`),
 * 60 characters of host or title and 120 of name at most, `capture` when the address has no host (a `file:` page, no address)
 * or the template leaves nothing.
 * The default template has no title: it is free text, often private, and the file leaves the machine. Only a template that
 * says `{title}` puts it in.
 * @param {{ url?: string, title?: string, createdAt?: number | Date }} shot A row of the library fits as is.
 * @param {string} ext With or without the leading dot.
 * @param {string} [template]
 * @returns {string}
 */
export function suggestedFilename({ url, title, createdAt } = {}, ext = 'png', template = DEFAULT_NAME_TEMPLATE) {
  let host = '';
  try {
    host = new URL(String(url)).hostname;
  } catch {
    // no usable address: the name falls back to "capture"
  }
  host = host.replace(/[<>:"/\\|?*[\]\p{Cc}\s]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, MAX_HOST).replace(/[-.]+$/, '');
  let d = new Date(createdAt ?? Date.now());
  if (Number.isNaN(d.getTime())) d = new Date();
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const suffix = String(ext).replace(/^\./, '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const words = { host: host || 'capture', title: [...String(title ?? '')].slice(0, MAX_HOST).join(''), date: day, time };
  let stem = String(template).replace(TOKEN, (_, word) => words[word]) // one pass: a title that says `{host}` stays as it is
    .replace(/\s+/g, ' ').replace(/[<>:"/\\|?*\p{Cc}]+/gu, '-').replace(/^[\s._-]+|[\s._-]+$/g, '');
  if (RESERVED_NAME.test(stem)) stem = `_${stem}`; // `nul.example.com_2026...` or a template that is just `nul`
  return `${[...stem].slice(0, MAX_STEM).join('').replace(/[\s._-]+$/, '') || 'capture'}.${suffix}`;
}
