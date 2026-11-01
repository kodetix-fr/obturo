// PDF export: one raster image per page, no library. Two halves:
//  - the PURE half (planPages, packRgb, assemblePdf): page geometry and the binary layout of the file, objects, cross
//    reference table and stream lengths, tested in Node;
//  - the BROWSER half (buildPdf): turns the sources into image streams with OffscreenCanvas, CompressionStream and the
//    JPEG encoder of encode.js, then hands them to the pure half.
// No DOM, no chrome.*: it runs in a page and in the service worker.
//
// A page is a picture, so the text of a capture is NOT selectable or searchable in the PDF, and its links are gone;
// the same as the PNG it comes from. An OCR layer would be a new feature (and a recognition engine to ship).
//
// The pixels travel as Blobs and typed arrays that go into the final Blob by reference: the image bytes are never
// concatenated, and a sliced page (`a4`, or a very tall `fit` page) reuses ONE image object for all its slices, so
// the pixels are stored once. The cost is on the reader: it clips the image to each page's MediaBox.

import { encodeImage } from './encode.js';

const PT_PER_PX = 0.75; // 96 dpi screen pixels -> 72 dpi points
export const MAX_PAGE_PT = 14400; // 200 inches: the largest page that the PDF readers accept
const MIN_PAGE_PT = 3; // and the smallest
// ponytail: A4 only, no margin, a small image is enlarged to the full width; add Letter and a margin if people ask.
export const A4 = { w: 595, h: 842 }; // points

// ponytail: 100 million pixels per image (the output cap of the editor, about 300 MB of RGB going through the encoder
// by strips), one image at a time; raise it, or tile the image into several XObjects, if a reader of 16384+ px captures
// asks for more.
const MAX_PIXELS = 100e6;

// Rows of RGBA read from the canvas at a time: about 512 KB (a 4K page is 33 rows). Measured on Chromium: a strip that
// stays in the CPU cache is 30 to 40% faster than 2 MB or 8 MB strips on a screenshot, and no slower on a photograph.
const STRIP_BYTES = 512 * 1024;

const num = (v) => String(Number(v.toFixed(3))); // 595, 7500, 12.5: no exponent, no trailing zeros

// --- Geometry (pure) ---

/**
 * Pages of the PDF for images of the given pixel sizes. An image gives one page, or several when it is cut into slices.
 * Every slice of an image is the same picture drawn with a different vertical offset: the MediaBox does the cutting.
 *
 * - `fit`: the page has the size of the image at 96 dpi (px x 0.75 = pt). Past 14,400 pt it is cut into equal pages,
 *   each at most 14,400 pt tall; an image wider than that is scaled to the limit.
 * - `a4`: the image is scaled to the width of an A4 page (595 pt), whatever its size, and cut into slices of an A4
 *   height (842 pt). The last page is blank under the end of the image.
 * @param {Array<{ width: number, height: number }>} sizes Pixel sizes.
 * @param {'fit' | 'a4'} layout
 * @returns {Array<{ image: number, w: number, h: number, drawW: number, drawH: number, y: number }>}
 *   `w` x `h`: MediaBox; `drawW` x `drawH`: size of the image on the page; `y`: where its bottom edge sits on this page.
 */
export function planPages(sizes, layout) {
  const pages = [];
  sizes.forEach(({ width, height }, image) => {
    let w, h, drawW, drawH, count;
    if (layout === 'a4') {
      w = A4.w;
      h = A4.h;
      drawW = A4.w;
      drawH = (height * A4.w) / width;
      count = Math.max(1, Math.ceil(drawH / A4.h - 1e-9));
    } else {
      drawW = width * PT_PER_PX;
      drawH = height * PT_PER_PX;
      const small = MIN_PAGE_PT / Math.min(drawW, drawH);
      if (small > 1) { drawW *= small; drawH *= small; } // a 1 px image is 0.75 pt: below what a reader accepts
      if (drawW > MAX_PAGE_PT) { drawH *= MAX_PAGE_PT / drawW; drawW = MAX_PAGE_PT; }
      count = Math.max(1, Math.ceil(drawH / MAX_PAGE_PT - 1e-9));
      w = drawW;
      h = drawH / count; // equal pages
    }
    for (let k = 0; k < count; k++) {
      // The top of the image sits k pages above the top of this one: its bottom edge is at (k + 1) * h - drawH.
      pages.push({ image, w, h, drawW, drawH, y: (k + 1) * h - drawH });
    }
  });
  return pages;
}

// --- Pixels (pure) ---

/**
 * Drops the alpha byte of `pixels` RGBA pixels (what getImageData returns) to get the RGB rows of a Flate stream. The
 * canvas was flattened on white before, so the alpha byte is always 255.
 * ponytail: plain RGB, no PNG predictor (`/Predictor 12`): measured on Chromium it makes a UI screenshot 70% BIGGER
 * (168 KB against 99 KB at 1080p) and a photograph-like image 38% smaller; screenshots are the main case, and `jpeg`
 * is there for photographs. Choose the predictor per image if photographic captures turn out to dominate.
 * @param {Uint8ClampedArray | Uint8Array} rgba pixels x 4 bytes.
 * @param {number} pixels
 * @param {Uint8Array} out At least pixels x 3 bytes.
 */
export function packRgb(rgba, pixels, out) {
  for (let s = 0, o = 0, end = pixels * 4; s < end; s += 4, o += 3) {
    out[o] = rgba[s];
    out[o + 1] = rgba[s + 1];
    out[o + 2] = rgba[s + 2];
  }
}

// --- File layout (pure) ---

/**
 * @typedef {Blob | Uint8Array<ArrayBuffer>} Chunk
 * @typedef {object} PdfImage
 * @property {number} width Pixels.
 * @property {number} height
 * @property {'FlateDecode' | 'DCTDecode'} filter FlateDecode: zlib stream of RGB rows, 8 bits; DCTDecode: a JPEG file.
 * @property {Chunk | Chunk[]} data The stream, as it goes into the file.
 */

const encoder = new TextEncoder();
const size = (chunk) => (chunk instanceof Blob ? chunk.size : chunk.byteLength);
// "%PDF-1.4", then a comment of four bytes above 127, so that a transfer program treats the file as binary
const HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/**
 * Binary layout of the PDF: catalog, page tree, info, one XObject per image, one page and one content stream per
 * entry of `pages`, then the cross reference table (20 bytes per entry) and the trailer. Nothing is copied: the image
 * streams are parts of the returned Blob.
 * ponytail: one flat page tree (every page is a kid of the root), classic cross reference table, PDF 1.4; readers are
 * fine with hundreds of pages, build a balanced tree and a cross reference stream if a document ever needs thousands.
 * @param {PdfImage[]} images
 * @param {ReturnType<typeof planPages>} pages Each `image` is an index into `images`.
 * @returns {Blob} `application/pdf`
 */
export function assemblePdf(images, pages) {
  if (!images.length || !pages.length) throw new Error('a PDF needs at least one page');
  const first = 4; // objects: 1 catalog, 2 page tree, 3 info, images from 4
  const firstPage = first + images.length; // then a page and its content, two by two
  /** @type {Chunk[]} */
  const parts = [HEADER];
  const offsets = [0]; // object 0 is the head of the free list
  let at = HEADER.length;
  const put = (chunk) => { parts.push(chunk); at += size(chunk); };
  const text = (s) => put(encoder.encode(s));
  // Object `n`: a dictionary (`entries`, between the brackets) and, for a stream, its bytes with the exact /Length.
  /** @param {number} n @param {string} entries @param {Chunk[]} [stream] */
  const object = (n, entries, stream) => {
    offsets[n] = at;
    if (!stream) return text(`${n} 0 obj\n<< ${entries} >>\nendobj\n`);
    text(`${n} 0 obj\n<< ${entries} /Length ${stream.reduce((t, c) => t + size(c), 0)} >>\nstream\n`);
    stream.forEach(put);
    text('\nendstream\nendobj\n');
  };

  const kids = pages.map((_, i) => `${firstPage + 2 * i} 0 R`).join(' ');
  object(1, '/Type /Catalog /Pages 2 0 R');
  object(2, `/Type /Pages /Kids [${kids}] /Count ${pages.length}`);
  object(3, '/Producer (Obturo)');
  images.forEach((img, i) => {
    object(first + i, `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB`
      + ` /BitsPerComponent 8 /Filter /${img.filter}`, Array.isArray(img.data) ? img.data : [img.data]);
  });
  pages.forEach((p, i) => {
    const page = firstPage + 2 * i;
    if (!images[p.image]) throw new Error(`page ${i} points to a missing image`);
    object(page, `/Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}]`
      + ` /Resources << /XObject << /Im0 ${first + p.image} 0 R >> >> /Contents ${page + 1} 0 R`);
    object(page + 1, '', [encoder.encode(`q ${num(p.drawW)} 0 0 ${num(p.drawH)} 0 ${num(p.y)} cm /Im0 Do Q`)]);
  });

  const count = offsets.length; // objects 0 to the last one
  const xref = at;
  const rows = offsets.map((o, n) => (n === 0 ? '0000000000 65535 f \n' : `${String(o).padStart(10, '0')} 00000 n \n`));
  text(`xref\n0 ${count}\n${rows.join('')}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// --- Pixels (browser) ---

/**
 * Lossless image stream: the source on white (a transparent area is white, not black), RGB at 8 bits, deflated as it
 * is read, in strips. Memory: the canvas, one strip of RGBA and of RGB, and the compressed bytes.
 * @param {ImageBitmap | HTMLCanvasElement | OffscreenCanvas} source
 * @param {number} width
 * @param {number} height
 * @returns {Promise<PdfImage>}
 */
async function flateImage(source, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false }); // CPU canvas: fast readbacks
  if (!ctx) throw new Error('2D context unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  const rows = Math.max(1, Math.min(height, Math.floor(STRIP_BYTES / (4 * width))));
  const out = new Uint8Array(rows * width * 3);
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const chunks = [];
  const deflate = new CompressionStream('deflate'); // zlib format, which is what FlateDecode reads
  const drained = deflate.readable.pipeTo(new WritableStream({ write: (c) => { chunks.push(c); } }));
  const writer = deflate.writable.getWriter();
  try {
    for (let y = 0; y < height; y += rows) {
      const n = Math.min(rows, height - y);
      packRgb(ctx.getImageData(0, y, width, n).data, width * n, out);
      await writer.write(n === rows ? out : out.subarray(0, n * width * 3)); // `out` is reused once this resolves
    }
    await writer.close();
    await drained;
  } catch (e) {
    writer.abort(e).catch(() => {});
    drained.catch(() => {});
    throw e;
  } finally {
    canvas.width = canvas.height = 0;
  }
  return { width, height, filter: 'FlateDecode', data: new Blob(chunks) };
}

/**
 * Lossy image stream: the JPEG file of the source, on white, as it is.
 * @param {ImageBitmap | HTMLCanvasElement | OffscreenCanvas} source
 * @param {number} width
 * @param {number} height
 * @param {number} quality
 * @returns {Promise<PdfImage>}
 */
async function jpegImage(source, width, height, quality) {
  if (source.width === width && source.height === height) {
    return { width, height, filter: 'DCTDecode', data: await encodeImage(source, { format: 'jpeg', quality }) };
  }
  const scaled = new OffscreenCanvas(width, height); // the caller wants another size: draw it scaled first
  scaled.getContext('2d')?.drawImage(source, 0, 0, width, height);
  try {
    return { width, height, filter: 'DCTDecode', data: await encodeImage(scaled, { format: 'jpeg', quality }) };
  } finally {
    scaled.width = scaled.height = 0;
  }
}

function checkPage(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('invalid page size');
  if (width * height > MAX_PIXELS) throw new Error('image too large for a PDF page');
}

/**
 * The image stream of ONE page (what `buildPdf` does for each of its pages), for a caller that renders its pages one at a
 * time and cannot hold them all (export-batch.js): keep the results, then `assemblePdf(images, planPages(sizes, layout))`.
 * @param {ImageBitmap | HTMLCanvasElement | OffscreenCanvas} source
 * @param {number} width Size in pixels that the image has in the PDF; a source of another size is drawn scaled.
 * @param {number} height
 * @param {{ encoding?: 'flate' | 'jpeg', quality?: number }} [options] `quality` only counts for `jpeg`.
 * @returns {Promise<PdfImage>}
 */
export async function encodePdfImage(source, width, height, { encoding = 'flate', quality = 0.92 } = {}) {
  if (encoding !== 'flate' && encoding !== 'jpeg') throw new Error(`unknown PDF encoding: ${encoding}`);
  checkPage(width, height);
  return encoding === 'jpeg' ? jpegImage(source, width, height, quality) : flateImage(source, width, height);
}

/**
 * Builds a PDF, one page (or several, see `planPages`) per image.
 *
 * Pages go through the encoder one after the other, so only one canvas is alive at a time. `flate` is lossless and
 * heavy for photographs; `jpeg` is far lighter and lossy. The text of the pictures is not selectable (see the top).
 * @param {Array<{ source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas, width: number, height: number }>} pages
 *   `width` x `height` is the size in pixels that the image has in the PDF; a source of another size is drawn scaled.
 * @param {{ layout?: 'fit' | 'a4', encoding?: 'flate' | 'jpeg', quality?: number }} [options] `quality` only counts for `jpeg`.
 * @returns {Promise<Blob>} `application/pdf`
 */
export async function buildPdf(pages, { layout = 'fit', encoding = 'flate', quality = 0.92 } = {}) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('a PDF needs at least one page');
  if (layout !== 'fit' && layout !== 'a4') throw new Error(`unknown PDF layout: ${layout}`);
  if (encoding !== 'flate' && encoding !== 'jpeg') throw new Error(`unknown PDF encoding: ${encoding}`);
  for (const { width, height } of pages) checkPage(width, height);
  const images = [];
  for (const { source, width, height } of pages) images.push(await encodePdfImage(source, width, height, { encoding, quality }));
  return assemblePdf(images, planPages(pages, layout));
}
