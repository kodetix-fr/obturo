// Import of images that come from outside the extension: files picked or dropped, an image pasted. Loaded on first use by
// library.js (a dynamic import), so it costs nothing at startup.
// Everything is kept as a PNG, like a capture (the editor, the thumbnails and the exports all start from one): a PNG file as it is,
// anything else decoded and written again without loss (a JPEG becomes a bigger PNG, a GIF gives its first image). The address of
// an imported shot is empty, its title the name of the file.
import { addShot } from './db.js';
import { IMPORT_MAX_BYTES, declaredSize, importFits, importTitle, isPng, looksLikeImage } from './pure.js';

/** A refusal with the key of its text (locales/*.ui.js). @param {string} key */
const refuse = (key) => Object.assign(new Error(key), { key });

/** The image as a PNG: what the decoder gave, drawn on a canvas of its size. @param {ImageBitmap} bmp */
async function toPng(bmp) {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(bmp, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  canvas.width = canvas.height = 0; // the pixels go back now, not when the garbage collector comes
  return blob;
}

/** @param {File} file @param {string} fallbackTitle @returns {Promise<number>} the id of the new shot */
async function importOne(file, fallbackTitle) {
  if (!looksLikeImage(file) || file.size === 0) throw refuse('import.err.type');
  if (file.size > IMPORT_MAX_BYTES) throw refuse('import.err.big'); // not even decoded
  // What the header declares is checked before the decoder is asked to build the image: a few KB can say 40,000 x 40,000 px.
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const declared = declaredSize(head);
  if (declared && !importFits({ ...declared, bytes: file.size })) throw refuse('import.err.big');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw refuse('import.err.type'); // not an image, or one this browser cannot decode
  }
  try {
    const { width: w, height: h } = bmp;
    if (!importFits({ w, h, bytes: file.size })) throw refuse('import.err.big');
    const original = isPng(head) ? file.slice(0, file.size, 'image/png') : await toPng(bmp); // a Blob, not the File: no name or date kept
    return await addShot({ original, url: '', title: importTitle(file.name, fallbackTitle), w, h });
  } finally {
    bmp.close();
  }
}

/**
 * Adds each file to the history, one at a time (a decoded image is big). A file that cannot be added is skipped and the first of
 * them is reported; the others are added all the same.
 * @param {File[]} files
 * @param {string} fallbackTitle The title of an image with no name of its own (a pasted one).
 * @returns {Promise<{ ids: number[], failed: null | { key: string, vars: { name: string } } }>} The ids in the order of the files.
 */
export async function importFiles(files, fallbackTitle) {
  /** @type {number[]} */
  const ids = [];
  /** @type {null | { key: string, vars: { name: string } }} */
  let failed = null;
  for (const file of files) {
    try {
      ids.push(await importOne(file, fallbackTitle));
    } catch (e) {
      const key = /** @type {any} */ (e)?.key;
      if (!key) throw e; // the database, not the file: the caller says so
      failed ??= { key, vars: { name: file.name || fallbackTitle } };
    }
  }
  return { ids, failed };
}
