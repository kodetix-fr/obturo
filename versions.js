// Model of the versions of a shot (pure functions, testable with `node --test`).
//   shot.versions = [{ name, crop, scale, objects }]   objects = Fabric JSON, never pixels
//   shot.active   = index of the displayed version, -1 = the original (immutable)
// Each function takes { versions, active } and returns a new state, without mutating anything.
import { extraOf, framedSize, styleOf } from './beautify-pure.js';
import { clamp } from './pure.js';

/**
 * Rectangle in image (or canvas) px.
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

/**
 * A version: what it takes to redraw the shot from its original.
 * @typedef {object} Version
 * @property {string} name `V1`, `V2`...
 * @property {Rect | null} crop Crop, null = the whole image.
 * @property {number} scale Output scale, 1 = original size.
 * @property {object[]} objects Annotations, serialized by Fabric (JSON, never pixels).
 * @property {import('./beautify-pure.js').Beautify | null} [beautify] Background, padding, corners, shadow and frame around the capture; absent or null = none.
 */

/**
 * The versions state of a shot.
 * @typedef {{ versions: Version[], active: number }} VersionState
 */

/** @returns {Version} */
export const blankVersion = () => ({ name: '', crop: null, scale: 1, objects: [], beautify: null });

// Smallest free "Vn": after deleting V2, the next one becomes V2 again (no duplicate).
const nextName = (versions) => {
  const used = new Set(versions.map((v) => v.name));
  let n = 1;
  while (used.has(`V${n}`)) n++;
  return `V${n}`;
};

// New version = copy of the displayed state (or blank from the original), without the beautify look: it is turned on per version. It becomes the active one.
/** @param {VersionState} state @returns {VersionState} */
export function createVersion({ versions, active }) {
  const copy = versions[active] ? structuredClone(versions[active]) : blankVersion();
  copy.name = nextName(versions);
  copy.beautify = null;
  return { versions: [...versions, copy], active: versions.length };
}

export const MAX_NAME = 24;
/** A name as it is kept: one line, spaces collapsed, at most MAX_NAME characters. @param {unknown} value */
export const cleanVersionName = (value) => [...String(value ?? '').replace(/\s+/g, ' ').trim()].slice(0, MAX_NAME).join('').trim();
/** Is it a name the person chose (not the `V1`, `V2` that Obturo gives)? @param {unknown} name */
export const isChosenName = (name) => typeof name === 'string' && name !== '' && !/^V\d+$/.test(name);

// A version renamed: an empty name gives it back the smallest free `Vn`.
/** @param {VersionState} state @param {number} i @param {unknown} name @returns {VersionState} */
export function renameVersion({ versions, active }, i, name) {
  if (!versions[i]) return { versions, active };
  const next = cleanVersionName(name) || nextName(versions.filter((_, j) => j !== i));
  return { versions: versions.map((v, j) => (j === i ? { ...v, name: next } : v)), active };
}

// Deleting the displayed version falls back on the previous one (or the next one if it was the first).
/** @param {VersionState} state @param {number} i @returns {VersionState} */
export function deleteVersion({ versions, active }, i) {
  if (!versions[i]) return { versions, active };
  const left = versions.filter((_, j) => j !== i);
  if (i < active) return { versions: left, active: active - 1 };
  if (i > active) return { versions: left, active };
  return { versions: left, active: left.length ? Math.max(0, i - 1) : -1 };
}

/** @param {VersionState} state @param {number} i @returns {VersionState} */
export function pickVersion({ versions, active }, i) {
  return { versions, active: Number.isInteger(i) && i >= -1 && i < versions.length ? i : active };
}

// Crop clamped to the image, in integers, at least 1 px. null if it covers the whole image (= no crop).
/** @param {Rect} c @param {number} w @param {number} h @returns {Rect | null} */
export function clampCrop(c, w, h) {
  const x = clamp(Math.round(c.x), 0, w - 1);
  const y = clamp(Math.round(c.y), 0, h - 1);
  const cw = clamp(Math.round(c.w), 1, w - x);
  const ch = clamp(Math.round(c.h), 1, h - y);
  return x === 0 && y === 0 && cw === w && ch === h ? null : { x, y, w: cw, h: ch };
}

// Size of the capture itself in the output: crop, then scale. `v` absent = the original.
// floor and not round: the output never exceeds the covered area (otherwise the last row / column would be
// semi-transparent); the epsilon absorbs floating-point errors (1600 * (1000 / 1600) = 999.999...).
/** @param {number} w @param {number} h @param {Version} [v] */
export function innerSize(w, h, v) {
  const c = v?.crop ?? { w, h };
  const s = v?.scale ?? 1;
  return { w: Math.max(1, Math.floor(c.w * s + 1e-6)), h: Math.max(1, Math.floor(c.h * s + 1e-6)) };
}

// Size of the exported image: the capture, and what the beautify look adds around it.
/** @param {number} w @param {number} h @param {Version} [v] */
export function outputSize(w, h, v) {
  const inner = innerSize(w, h, v);
  return framedSize(inner.w, inner.h, styleOf(v));
}

// Scale that gives `target` px of width for a `cropW` px area (clamped to 1%..1000%).
export const scaleForWidth = (cropW, target) => Math.min(10, Math.max(0.01, target / cropW));

// Output ceiling: beyond it, toBlob returns null (canvas too large) and nothing can be exported.
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 100e6;

// Max scale for a cw x ch area; rounded down so the output stays under both ceilings. `extra`: what the beautify look adds around it
// (extraOf), which counts in both: (cw s + x) (ch s + y) <= MAX_PIXELS.
export function maxScale(cw, ch, extra = { x: 0, y: 0 }) {
  const { x, y } = extra;
  const a = cw * ch, b = cw * y + ch * x, c = x * y - MAX_PIXELS;
  const byArea = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return Math.floor(Math.min((MAX_SIDE - x) / cw, (MAX_SIDE - y) / ch, byArea) * 1e4) / 1e4;
}

// Scale brought back to the ceiling if needed: { scale, capped }.
/** @param {number} cw @param {number} ch @param {number} scale @param {import('./beautify-pure.js').Beautify | null} [style] */
export function capScale(cw, ch, scale, style = null) {
  const max = maxScale(cw, ch, extraOf(style));
  return scale > max ? { scale: max, capped: true } : { scale, capped: false };
}
