// Debounced save with a single writer. The write and the errors are injected: testable without a browser.
//   schedule()  something changed; the write happens `delay` ms after the last change
//   flush()     writes right away what is pending (closing a shot) and waits for it to finish
// One write at a time; whatever changes during a write goes out right after.
/**
 * @param {object} options
 * @param {() => Promise<boolean | void>} options.write Writes the current state; `false` = the shot no longer exists.
 * @param {number} [options.delay] Delay after the last change, in ms.
 * @param {() => void} [options.onGone] Called when `write` answers `false`.
 * @param {(error: unknown) => void} [options.onError] Called when `write` fails.
 */
export function createSaver({ write, delay = 500, onGone, onError }) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let dirty = false;
  /** @type {Promise<void> | null} */
  let writing = null;

  async function run() {
    while (dirty) {
      dirty = false;
      try {
        if ((await write()) === false) onGone?.(); // the shot no longer exists: do not insist
      } catch (e) {
        dirty = true; // nothing is lost: the next change or the closing retries
        onError?.(e);
        return;
      }
    }
  }

  // The finally is set AFTER the call: a write that ends without waiting (nothing to write, stale timer)
  // cannot reset `writing` to null before it has been assigned, which would leave it stuck forever.
  const save = () => (writing ??= run().finally(() => { writing = null; }));

  return {
    get pending() { return dirty || !!writing; }, // stays true if the last write failed
    schedule() {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(save, delay);
    },
    async flush() {
      clearTimeout(timer);
      // At most 2 passes: the 1st finishes the write in flight, the 2nd picks up what changed in the meantime
      // (and does not loop if the write keeps failing).
      for (let i = 0; i < 2 && (dirty || writing); i++) await save();
    },
  };
}
