// Editor view (pure functions): the w x h px document is drawn at scale z, shifted by (tx, ty),
// in a cw x ch canvas. The canvas is the size of the SCREEN, never that of the image.

/** @typedef {{ z: number, tx: number, ty: number }} View Scale and offset of the document in the canvas. */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box A part of the document that the view keeps in sight. */

const MIN_Z = 0.02;
const MAX_Z = 8;
const MARGIN = 16;

// Axis smaller than the canvas: centered. Otherwise it scrolls up to the edges, with a margin.
const clampAxis = (t, doc, view) => (doc <= view ? (view - doc) / 2 : Math.min(MARGIN, Math.max(view - doc - MARGIN, t)));

// Every function takes an optional `box`: a part of the document (the capture with its beautify look around it) that is kept in sight
// instead of the whole of it. The view is moved so that the box sits at the origin, worked out as a document of the size of the box,
// and moved back.
/** @param {View} v @param {Box} box @param {1 | -1} sign */
const shift = (v, box, sign) => ({ z: v.z, tx: v.tx + sign * box.x * v.z, ty: v.ty + sign * box.y * v.z });

/** @param {View} v @param {number} cw @param {number} ch @param {number} w @param {number} h @param {Box} [box] @returns {View} */
export function clampView(v, cw, ch, w, h, box) {
  if (box) return shift(clampView(shift(v, box, 1), cw, ch, box.w, box.h), box, -1);
  return { z: v.z, tx: clampAxis(v.tx, w * v.z, cw), ty: clampAxis(v.ty, h * v.z, ch) };
}

// Fitted to the window; a very tall image (full page) is fitted to the width, at the top, and scrolls.
/** @param {number} cw @param {number} ch @param {number} w @param {number} h @param {Box} [box] @returns {View} */
export function fitView(cw, ch, w, h, box) {
  if (box) return shift(fitView(cw, ch, box.w, box.h), box, -1);
  const aw = Math.max(1, cw - 2 * MARGIN), ah = Math.max(1, ch - 2 * MARGIN);
  const z = Math.min(1, h / w > 2.5 ? aw / w : Math.min(aw / w, ah / h));
  return clampView({ z, tx: MARGIN, ty: MARGIN }, cw, ch, w, h);
}

// Zoom by a factor around the canvas point (px, py): the document point under the cursor does not move.
/** @param {View} v @param {number} factor @param {number} px @param {number} py @param {number} cw @param {number} ch @param {number} w @param {number} h @param {Box} [box] @returns {View} */
export function zoomAt(v, factor, px, py, cw, ch, w, h, box) {
  if (box) return shift(zoomAt(shift(v, box, 1), factor, px, py, cw, ch, box.w, box.h), box, -1);
  const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * factor));
  const k = z / v.z;
  return clampView({ z, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, cw, ch, w, h);
}

/** @param {View} v @param {number} dx @param {number} dy @param {number} cw @param {number} ch @param {number} w @param {number} h @param {Box} [box] @returns {View} */
export const panBy = (v, dx, dy, cw, ch, w, h, box) => clampView({ z: v.z, tx: v.tx + dx, ty: v.ty + dy }, cw, ch, w, h, box);
