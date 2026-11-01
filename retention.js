// Retention policy of the history, pure (no chrome.*, IndexedDB or DOM) so it can be tested with `node --test`.
// db.js feeds it the light entries of the catalog and deletes what it returns.

const DAY = 24 * 60 * 60 * 1000;

/**
 * What the policy needs to know about a shot.
 * @typedef {object} ShotInfo
 * @property {number} id
 * @property {number} createdAt Capture timestamp (ms).
 * @property {number} bytes Size of the original, in bytes.
 * @property {boolean} pinned Kept by the user: never removed automatically.
 * @property {boolean} edited The shot has at least one version.
 */

/**
 * The shots no pass may remove besides the pinned ones: one id, a list or a set of them, or nothing.
 * @typedef {number | Iterable<number> | null | undefined} Keep
 */
/** @param {Keep} keep @returns {Set<number>} */
const keepSet = (keep) => new Set(keep == null ? [] : typeof keep === 'number' ? [keep] : keep);

/**
 * @typedef {object} Plan
 * @property {number[]} ids Shots to delete, in the order the policy removes them.
 * @property {number} freedBytes Sum of the sizes of `ids`.
 * @property {boolean} overCap The size cap is set and the shots that stay are still above it: only pinned shots (and
 *   the shots to keep) are left to remove, so the cap cannot be met.
 */

/**
 * Which shots to delete, given the retention settings.
 *
 * - A pinned shot, and the shots in `keep` (the one that was just added, the ones open in the library), are never removed.
 * - Age: an unpinned, unedited shot older than `retentionDays` days goes (0 = never). An edited shot escapes it.
 * - Size: while the total is above `maxBytes` (0 = no cap), the oldest unpinned unedited shots go first, then the oldest
 *   unpinned edited ones. When nothing removable is left and the total is still above the cap, nothing more is done and
 *   `overCap` says so.
 *
 * @param {ShotInfo[]} shots
 * @param {number} now Current timestamp (ms).
 * @param {{ retentionDays: number, maxBytes: number }} policy
 * @param {Keep} [keep]
 * @returns {Plan}
 */
export function planPurge(shots, now, { retentionDays, maxBytes }, keep = null) {
  const spared = keepSet(keep);
  const size = (s) => (s.bytes > 0 ? s.bytes : 0); // a missing or invalid size counts as 0
  const removable = (s) => !s.pinned && !spared.has(s.id);
  /** @type {Set<number>} */
  const gone = new Set();
  /** @type {number[]} */
  const ids = [];
  let total = 0;
  let freedBytes = 0;
  for (const s of shots) total += size(s);
  const drop = (s) => {
    gone.add(s.id);
    ids.push(s.id);
    total -= size(s);
    freedBytes += size(s);
  };

  if (retentionDays > 0) {
    const cutoff = now - retentionDays * DAY;
    for (const s of shots) if (removable(s) && !s.edited && s.createdAt < cutoff) drop(s);
  }

  let overCap = false;
  if (maxBytes > 0 && total > maxBytes) {
    const oldestFirst = shots.filter((s) => removable(s) && !gone.has(s.id))
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    for (const edited of [false, true]) {
      for (const s of oldestFirst) if (!!s.edited === edited && size(s) > 0 && total > maxBytes) drop(s); // 0 bytes: removing it would free nothing
    }
    overCap = total > maxBytes;
  }
  return { ids, freedBytes, overCap };
}

/**
 * What a purge would do, for the preview shown before the user confirms: the plan of planPurge, what is left, and how many pinned and
 * edited shots the purge spares (those it would have taken had they been neither pinned nor edited).
 * @param {ShotInfo[]} shots
 * @param {number} now
 * @param {{ retentionDays: number, maxBytes: number }} policy
 * @param {Keep} [keep] The shots a real purge would leave alone, whatever the options (the ones open in the library).
 * @returns {{ deleted: number, freedBytes: number, overCap: boolean, keptPinned: number, keptEdited: number, remaining: { count: number, bytes: number } }}
 */
export function previewPlan(shots, now, policy, keep = null) {
  const plan = planPurge(shots, now, policy, keep);
  const unprotected = planPurge(shots.map((s) => ({ ...s, pinned: false, edited: false })), now, policy, keep);
  const gone = new Set(plan.ids);
  const byId = new Map(shots.map((s) => [s.id, s]));
  let keptPinned = 0;
  let keptEdited = 0;
  for (const id of unprotected.ids) {
    const s = byId.get(id);
    if (!s || gone.has(id)) continue;
    if (s.pinned) keptPinned++;
    else if (s.edited) keptEdited++;
  }
  const total = shots.reduce((sum, s) => sum + (s.bytes > 0 ? s.bytes : 0), 0);
  return {
    deleted: plan.ids.length, freedBytes: plan.freedBytes, overCap: plan.overCap, keptPinned, keptEdited,
    remaining: { count: shots.length - plan.ids.length, bytes: total - plan.freedBytes },
  };
}
