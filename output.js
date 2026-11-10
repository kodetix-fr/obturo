// Full-resolution rendering of a version of the shot: the image to export (the clipboard, the downloads) and the strip thumbnail. The functions
// receive the Fabric canvas, the version and the size of the original; they touch neither the UI nor the editor
// state. No pixel is computed before it is asked for (export, save).
import { innerSize } from './versions.js';
import { thumbPlan, THUMB_QUALITY, THUMB_WIDTH } from './thumb-pure.js';
import { framedSize, styleOf } from './beautify-pure.js';
import { drawBeautified } from './beautify.js';

/**
 * Draws the original under what Fabric renders, with the view matrix of the canvas: the image is not a Fabric object, the editor and the
 * grouped export both draw it in 'before:render'.
 * @param {any} canvas @param {CanvasRenderingContext2D} ctx @param {CanvasImageSource} image
 */
export function drawUnder(canvas, ctx, image) {
  const v = canvas.viewportTransform;
  ctx.save();
  ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

// Renders the region of the document starting at `from` (x, y), at scale `scale`, into a w x h px canvas. The view
// is reset to the identity for the duration of the call: we export in document coordinates, not screen ones.
function renderRegion(canvas, from, scale, w, h) {
  const viewport = canvas.viewportTransform;
  canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
  try {
    // 1e-6: the output canvas truncates its size, without it 100.0000001 px -> 99
    return canvas.toCanvasElement(scale, { left: from.x, top: from.y, width: w / scale + 1e-6, height: h / scale + 1e-6 });
  } finally {
    canvas.viewportTransform = viewport;
    canvas.requestRenderAll();
  }
}

// The capture drawn inside its beautify look, or as it is without one; `inner` is given back to the browser either way.
function framed(inner, style, k) {
  if (!style) return inner;
  try {
    return drawBeautified(inner, style, k);
  } finally {
    inner.width = inner.height = 0;
  }
}

/**
 * The displayed version rendered, crop, scale and beautify look applied, as a canvas that belongs to the caller (it sets its width and
 * height to 0 once it is done, to give the pixels back). Synchronous: the canvas of the editor, or any Fabric canvas that
 * draws the original under the objects, is not touched after the call. Used by every export, single or grouped.
 * @param {any} canvas Fabric canvas that holds the objects of the version (and draws the original in before:render).
 * @param {import('./versions.js').Version} version
 * @param {number} W Width of the original.
 * @param {number} H Height of the original.
 * @returns {HTMLCanvasElement}
 */
export function renderCanvas(canvas, version, W, H) {
  const crop = version.crop ?? { x: 0, y: 0, w: W, h: H };
  const size = innerSize(W, H, version);
  return framed(renderRegion(canvas, crop, version.scale, size.w, size.h), styleOf(version), 1);
}

// The thumbnail of a version that has a look: the top of the capture (see thumbPlan) inside its look, reduced to the width of a thumbnail
// and never larger than the output.
function renderFramedThumb(canvas, version, W, H) {
  const area = version.crop ?? { x: 0, y: 0, w: W, h: H };
  const style = styleOf(version);
  const { keepH } = thumbPlan(area.w, area.h);
  const full = framedSize(Math.floor(area.w * version.scale + 1e-6), Math.floor(keepH * version.scale + 1e-6), style);
  const ratio = Math.min(THUMB_WIDTH / full.w, 1 / version.scale); // the output px -> this drawing's px
  const k = version.scale * ratio; // the px of the original -> this drawing's px
  return framed(renderRegion(canvas, area, k, Math.max(1, Math.floor(area.w * k)), Math.max(1, Math.floor(keepH * k))), style, ratio);
}

/**
 * PNG of a version, crop and scale applied.
 * @param {any} canvas Fabric canvas of the editor.
 * @param {import('./versions.js').Version} version
 * @param {number} W Width of the original.
 * @param {number} H Height of the original.
 * @returns {Promise<Blob>}
 */
export async function renderPng(canvas, version, W, H) {
  const el = renderCanvas(canvas, version, W, H);
  try {
    const blob = await new Promise((done) => el.toBlob(done, 'image/png'));
    if (!blob) throw new Error('image too large for the browser');
    return blob;
  } finally {
    el.width = el.height = 0; // the canvas is ours (see renderCanvas): its pixels go back now, not at the next garbage collection
  }
}

// The editor registers here how it writes its pending changes (they are written a moment after the change): a grouped export reads the
// database, and must find there what is on screen.
export const editorSync = { flush: () => Promise.resolve() };

/**
 * Strip thumbnail: the DISPLAYED version rendered (a black flat must hide the thumbnail too), not the original.
 * For a full page, the top only. `version` absent = the original.
 * @param {any} canvas
 * @param {import('./versions.js').Version | undefined} version
 * @param {number} W
 * @param {number} H
 * @returns {Promise<Blob | null>}
 */
export async function renderThumb(canvas, version, W, H) { // async: a thumbnail failure must never prevent saving the versions
  const area = version?.crop ?? { x: 0, y: 0, w: W, h: H };
  const { keepH, k } = thumbPlan(area.w, area.h);
  const el = styleOf(version)
    ? renderFramedThumb(canvas, version, W, H)
    : renderRegion(canvas, area, k, Math.max(1, Math.floor(area.w * k)), Math.max(1, Math.floor(keepH * k)));
  try {
    return await new Promise((done) => el.toBlob(done, 'image/webp', THUMB_QUALITY));
  } finally {
    el.width = el.height = 0;
  }
}
