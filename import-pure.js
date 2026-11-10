// Pure functions (no chrome.* or indexedDB) so they can be tested with `node --test`.
import { MAX_DIM, MAX_PIXELS } from './pure.js';

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
/** A PNG is kept without its metadata, not decoded and encoded again; the first 8 bytes tell. @param {ArrayLike<number>} bytes */
export const isPng = (bytes) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

// The chunks of a PNG that are not critical and that change what it shows or how it is read: transparency, color, resolution, animation.
// Every other one goes: the texts (tEXt, zTXt, iTXt), the EXIF block, the time of the last change, the suggested palettes, and whatever a
// program wrote in a chunk of its own (a name, a place, a device, a date).
const KEPT_CHUNKS = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);

/**
 * A PNG without its metadata chunks, the other bytes untouched (the pixels are not decoded). null when the chunks do not add up (the
 * caller writes the image again from what the decoder made of it).
 * @param {Uint8Array} bytes
 * @returns {Uint8Array | null}
 */
export function stripPngMetadata(bytes) {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {Uint8Array[]} */
  const kept = [bytes.subarray(0, 8)];
  let first = true, ended = false;
  for (let at = 8; at < bytes.length;) {
    if (ended || at + 12 > bytes.length) return null;
    const end = at + 12 + view.getUint32(at); // length, type, data, crc
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if ((type === 'IHDR') !== first) return null;
    first = false;
    ended = type === 'IEND';
    const critical = (bytes[at + 4] & 0x20) === 0; // an uppercase first letter: the file cannot be read without it
    if (critical || KEPT_CHUNKS.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
  }
  if (!ended) return null;
  const out = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of kept) { out.set(part, at); at += part.length; }
  return out;
}

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
