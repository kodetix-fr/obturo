// Pure functions (no chrome.* or indexedDB) so they can be tested with `node --test`.

// --- Strip thumbnail ---

export const THUMB_WIDTH = 240; // px
// ponytail: a very tall shot (full page) gets a thumbnail of its top only, its height capped at 2/3 of the width; a scaled-down overview of the whole page if the top is not enough.
const THUMB_MAX_RATIO = 2 / 3; // max height / width
export const THUMB_QUALITY = 0.8; // WebP

// For an image (or an area) of w x h px: the height kept (only the top if it is very tall) and the
// downscale factor (never an enlargement).
/** @param {number} w @param {number} h @returns {{ keepH: number, k: number }} */
export function thumbPlan(w, h) {
  return { keepH: Math.min(h, Math.round(w * THUMB_MAX_RATIO)), k: Math.min(1, THUMB_WIDTH / w) };
}

// The state a thumbnail was rendered from: the database stores it only if the shot still has this state (a rendering that
// took longer than a later edit must not replace the thumbnail of that edit, which may hide what the older one shows).
// A row that never had a version reads as the original, like a new shot.
/** @param {{ versions?: unknown[], active?: number }} state @returns {string} */
export const versionsKey = ({ versions, active }) => JSON.stringify([versions ?? [], active ?? -1]);
