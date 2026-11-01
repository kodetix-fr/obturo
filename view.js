// Editor view (pure functions): the w x h px document is drawn at scale z, shifted by (tx, ty),
// in a cw x ch canvas. The canvas is the size of the SCREEN, never that of the image.

/** @typedef {{ z: number, tx: number, ty: number }} View Scale and offset of the document in the canvas. */

const MIN_Z = 0.02;
const MAX_Z = 8;
const MARGIN = 16;

// Axis smaller than the canvas: centered. Otherwise it scrolls up to the edges, with a margin.
const clampAxis = (t, doc, view) => (doc <= view ? (view - doc) / 2 : Math.min(MARGIN, Math.max(view - doc - MARGIN, t)));

/** @param {View} v @param {number} cw @param {number} ch @param {number} w @param {number} h @returns {View} */
export function clampView(v, cw, ch, w, h) {
  return { z: v.z, tx: clampAxis(v.tx, w * v.z, cw), ty: clampAxis(v.ty, h * v.z, ch) };
}

// Fitted to the window; a very tall image (full page) is fitted to the width, at the top, and scrolls.
/** @param {number} cw @param {number} ch @param {number} w @param {number} h @returns {View} */
export function fitView(cw, ch, w, h) {
  const aw = Math.max(1, cw - 2 * MARGIN), ah = Math.max(1, ch - 2 * MARGIN);
  const z = Math.min(1, h / w > 2.5 ? aw / w : Math.min(aw / w, ah / h));
  return clampView({ z, tx: MARGIN, ty: MARGIN }, cw, ch, w, h);
}

// Zoom by a factor around the canvas point (px, py): the document point under the cursor does not move.
/** @param {View} v @param {number} factor @param {number} px @param {number} py @param {number} cw @param {number} ch @param {number} w @param {number} h @returns {View} */
export function zoomAt(v, factor, px, py, cw, ch, w, h) {
  const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * factor));
  const k = z / v.z;
  return clampView({ z, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, cw, ch, w, h);
}

/** @param {View} v @param {number} dx @param {number} dy @param {number} cw @param {number} ch @param {number} w @param {number} h @returns {View} */
export const panBy = (v, dx, dy, cw, ch, w, h) => clampView({ z: v.z, tx: v.tx + dx, ty: v.ty + dy }, cw, ch, w, h);
