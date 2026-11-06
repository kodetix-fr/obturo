// What a read-only tab shows (another tab holds the editing lock): the capture it is given, drawn as the editor would export it,
// with Copy and Download. Nothing here writes to the history.
import { getOriginal } from './db.js';
import { byId as $, setI18n } from './dom-i18n.js';
import { displayedVersion } from './export-pure.js';

const FLASH_MS = 1500;

/** @type {{ shot: import('./db.js').Shot, original: Blob, blob: Blob, picture: HTMLCanvasElement | ImageBitmap, edited: boolean, url: string } | null} */
let shown = null;
let ticket = 0;
let flashTimer;

/**
 * Shows `shot`: its displayed version, or its original.
 * @param {import('./db.js').Shot} shot
 * @returns {Promise<boolean>} false when its original is gone
 */
export async function show(shot) {
  const mine = ++ticket;
  const original = await getOriginal(shot.id);
  if (!original) return false;
  const version = displayedVersion(shot);
  const bitmap = await createImageBitmap(original);
  /** @type {HTMLCanvasElement | ImageBitmap} */
  let picture = bitmap;
  let blob = original;
  if (version) {
    const canvas = await (await import('./export-batch.js')).renderVersion(bitmap, version);
    bitmap.close();
    picture = canvas;
    const png = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    if (!png) throw new Error('the picture could not be encoded');
    blob = /** @type {Blob} */ (png);
  }
  if (mine !== ticket) return true; // another capture was asked for meanwhile
  if (shown) URL.revokeObjectURL(shown.url);
  const url = URL.createObjectURL(blob);
  shown = { shot, original, blob, picture, edited: !!version, url };
  const img = $('viewerImg', HTMLImageElement);
  img.src = url;
  img.alt = shot.title;
  $('viewer').hidden = false;
  return true;
}

/** Wires Copy and Download. @param {(key: string) => void} warn Shows a message (a key of the dictionaries). */
export function setup(warn) {
  const copy = $('viewerCopy');
  copy.addEventListener('click', async () => {
    if (!shown) return;
    let key = 'act.copied';
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shown.blob })]);
    } catch (e) {
      console.error('Obturo: copy failed', e);
      key = 'act.copyFailed';
    }
    setI18n(copy, key);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setI18n(copy, 'act.copy'), FLASH_MS);
  });
  $('viewerDownload').addEventListener('click', async () => {
    if (!shown) return;
    const { shot, original, picture, edited } = shown;
    const { download } = await import('./export-ui.js');
    await download({ context: () => ({ shot, original, edited, size: { w: picture.width, h: picture.height }, source: () => picture }), warn });
  });
}
