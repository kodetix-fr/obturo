// Undo / redo history: a stack of snapshots (strings) and a cursor. Pure: no Fabric, no DOM, testable
// with `node --test`. The editor stores the JSON { objects, crop, scale } of the displayed version in it, never pixels.

// ponytail: 50 undo levels, each a full JSON snapshot of the version (no diffs); store diffs if long sessions or heavy annotation sets need more.
export const HISTORY_MAX = 50;

/** @param {number} [max] Max number of snapshots kept; the oldest are dropped. */
export function createHistory(max = HISTORY_MAX) {
  /** @type {string[]} */
  let stack = [];
  let at = -1; // index of the current snapshot

  return {
    /**
     * Starts over with a single snapshot (the current state), or none.
     * @param {string} [snapshot]
     */
    reset(snapshot) {
      stack = snapshot === undefined ? [] : [snapshot];
      at = stack.length - 1;
    },

    /**
     * Pushes a snapshot after the current one (whatever had been undone is lost).
     * @param {string} snapshot
     * @returns {boolean} False if it is identical to the current one (nothing is added).
     */
    push(snapshot) {
      if (stack[at] === snapshot) return false;
      stack.length = at + 1;
      stack.push(snapshot);
      if (stack.length > max) stack.shift();
      at = stack.length - 1;
      return true;
    },

    /**
     * Steps back (delta < 0) or forward (delta > 0).
     * @param {number} delta
     * @returns {string | null} The snapshot reached, or null at the end of the stack.
     */
    step(delta) {
      const next = at + delta;
      if (next < 0 || next >= stack.length) return null;
      at = next;
      return stack[at];
    },

    get canUndo() { return at > 0; },
    get canRedo() { return at < stack.length - 1; },
  };
}
