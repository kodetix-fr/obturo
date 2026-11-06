// Grouped export engine: renders the DISPLAYED version of several captures WITHOUT opening the editor, encodes each one,
// and builds a single file (a ZIP of images or a multipage PDF). Loaded on first use by export-ui.js.
//
// The rendering is the one of the editor's export (output.js: renderCanvas), on a Fabric StaticCanvas that holds the
// objects of the stored version and draws the original under them, exactly as the editor does in before:render; so
// pixelation, black fills, crop and scale come out the same (export-ui.e2e.mjs compares both, pixel by pixel).
//
// Memory is bounded by ONE capture at a time: its bitmap, its rendered canvas and, for a lossless PDF, the canvas of the
// encoder are released before the next capture starts. What stays is the encoded output, which has a ceiling
// (export-pure.js: MAX_ITEMS, MAX_OUTPUT_BYTES). The main thread is given back between two captures; the rendering of one
// capture is synchronous (Fabric draws on the main thread), so the Cancel button answers between captures.
import { StaticCanvas, util } from './vendor/fabric.min.mjs';
import { source } from './shapes.js';
import { editorSync, renderCanvas } from './output.js';
import { getOriginal, getShots } from './db.js';
import { encodeImage } from './encode.js';
import { MAX_ITEMS, MAX_OUTPUT_BYTES, batchFilename, classifyExportError, displayedVersion, imageFilename, planBatch } from './export-pure.js';

/**
 * Why a capture is not in the file: `gone` (removed meanwhile, or its original is missing), `limit` (the output reached its
 * ceiling), or what classifyExportError says.
 * @typedef {'gone' | 'limit' | 'tooLarge' | 'encoder' | 'unreadable' | 'other'} Cause
 */

class ExportError extends Error {
  /** @param {'gone' | 'limit'} code */
  constructor(code) {
    super(`export: ${code}`);
    this.code = code;
  }
}

/** @param {unknown} error @returns {Cause} */
const causeOf = (error) => (error instanceof ExportError ? error.code : classifyExportError(error));

// A message to ourselves: a task that comes back at once, and is not slowed down in a hidden tab (a timer is, to 1 s).
const yieldToMain = () => new Promise((done) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => { port1.close(); done(undefined); };
  port2.postMessage(0);
});

/**
 * The stored version drawn on a canvas that belongs to the caller, from the bitmap of the original. `source.img` (read by
 * PixelRegion to draw itself) is swapped for the length of the synchronous rendering only, so an editor open in the same
 * page keeps its own image.
 * @param {ImageBitmap} bitmap
 * @param {import('./versions.js').Version} version
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderVersion(bitmap, version) {
  const canvas = new StaticCanvas(undefined, { width: 1, height: 1, renderOnAddRemove: false, enableRetinaScaling: false });
  try {
    canvas.on('before:render', ({ ctx }) => {
      const v = canvas.viewportTransform;
      ctx.save();
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
      ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
    });
    canvas.add(...await util.enlivenObjects(version.objects));
    const previous = source.img;
    source.img = bitmap;
    try {
      return renderCanvas(canvas, version, bitmap.width, bitmap.height);
    } finally {
      source.img = previous;
    }
  } finally {
    await canvas.dispose();
  }
}

/**
 * @typedef {object} BatchOptions
 * @property {number[]} ids Shots to export; the order of the file is the order of the captures.
 * @property {'zip' | 'pdf'} output
 * @property {'png' | 'jpeg' | 'webp'} [format] Image format of a ZIP.
 * @property {number} [quality] JPEG and WebP, and the pictures of a light PDF.
 * @property {'fit' | 'a4'} [layout] PDF.
 * @property {'flate' | 'jpeg'} [encoding] PDF.
 * @property {string} [template] Name template of the captures inside a ZIP (encode.js: suggestedFilename); the default one when missing.
 * @property {AbortSignal} [signal] Aborting stops after the capture in progress: nothing is built.
 * @property {(progress: { done: number, total: number }) => void} [onProgress] Before each capture, and at the end.
 */

/**
 * @typedef {object} BatchResult
 * @property {Blob | null} blob The file; null when canceled or when nothing could be exported.
 * @property {string} name Name proposed for the file.
 * @property {number} exported
 * @property {number} total
 * @property {Array<{ name: string, cause: Cause }>} failed In the order of the captures.
 * @property {boolean} canceled
 */

/**
 * Exports the displayed version of each shot into one file. A capture that fails is reported and skipped, the others go on;
 * the call only rejects when the final file cannot be built (too large for a ZIP, for instance).
 * @param {BatchOptions} options
 * @returns {Promise<BatchResult>}
 */
export async function runBatch({ ids, output, format = 'png', quality = 0.9, layout = 'fit', encoding = 'flate', template, signal, onProgress }) {
  if (output !== 'zip' && output !== 'pdf') throw new Error(`unknown output: ${output}`);
  await editorSync.flush().catch(() => {}); // what is on screen in the editor is in the database
  const { items, missing } = planBatch(ids, await getShots(ids));
  /** @type {BatchResult} */
  const result = { blob: null, name: batchFilename(output), exported: 0, total: items.length + missing.length, failed: [], canceled: false };
  result.failed.push(...missing.map((id) => ({ name: `#${id}`, cause: /** @type {Cause} */ ('gone') })));
  if (items.length > MAX_ITEMS) throw new Error(`too many captures: ${items.length} (at most ${MAX_ITEMS})`);

  const pdf = output === 'pdf' ? await import('./pdf.js') : null;
  /** @type {Array<{ name: string, blob: Blob }>} */
  const files = [];
  /** @type {import('./pdf.js').PdfImage[]} */
  const images = [];
  let bytes = 0;

  for (const [index, shot] of items.entries()) {
    if (signal?.aborted) return { ...result, canceled: true };
    onProgress?.({ done: index + missing.length, total: result.total });
    const name = imageFilename(shot, output === 'pdf' ? 'pdf' : format, template);
    let bitmap = null;
    let canvas = null;
    try {
      if (bytes >= MAX_OUTPUT_BYTES) throw new ExportError('limit');
      const original = await getOriginal(shot.id);
      if (!original) throw new ExportError('gone');
      const version = displayedVersion(shot);
      if (output === 'zip' && format === 'png' && !version) { // the original goes out as it is, never re-encoded
        files.push({ name, blob: original });
        bytes += original.size;
      } else {
        bitmap = await createImageBitmap(original);
        if (version) canvas = await renderVersion(bitmap, version);
        const picture = canvas ?? bitmap;
        if (pdf) {
          const image = await pdf.encodePdfImage(picture, picture.width, picture.height, { encoding, quality });
          images.push(image);
          bytes += image.data instanceof Blob ? image.data.size : 0;
        } else {
          const blob = await encodeImage(picture, { format, quality });
          files.push({ name, blob });
          bytes += blob.size;
        }
      }
      result.exported++;
    } catch (error) {
      if (!(error instanceof ExportError)) console.error('Obturo: grouped export, capture skipped', error);
      result.failed.push({ name, cause: causeOf(error) });
    } finally {
      bitmap?.close();
      if (canvas) canvas.width = canvas.height = 0; // gives the pixels back before the next capture
    }
    await yieldToMain();
  }
  if (signal?.aborted) return { ...result, canceled: true };
  onProgress?.({ done: result.total, total: result.total });

  if (result.exported === 0) return result;
  if (pdf) {
    result.blob = pdf.assemblePdf(images, pdf.planPages(images, layout));
  } else {
    result.blob = await (await import('./zip.js')).buildZip(files);
  }
  return result;
}
