// The original image turned by quarter turns, as a bitmap the editor and the exports draw like the original.
import { cleanTurn, turnMatrix, turnedSize } from './turn-pure.js';

/**
 * `bitmap` turned `turn` quarter turns clockwise: a new bitmap that belongs to the caller, or `bitmap` itself when there is no turn.
 * @param {ImageBitmap} bitmap @param {unknown} turn @returns {Promise<ImageBitmap>}
 */
export async function turnedBitmap(bitmap, turn) {
  const quarter = cleanTurn(turn);
  if (!quarter) return bitmap;
  const { w, h } = turnedSize(bitmap.width, bitmap.height, quarter);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(...turnMatrix(quarter, bitmap.width, bitmap.height));
  ctx.drawImage(bitmap, 0, 0);
  return createImageBitmap(canvas);
}
