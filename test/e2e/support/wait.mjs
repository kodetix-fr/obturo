// The one way the end-to-end tests wait: for a condition (poll), never for a fixed time when something must appear.
// A fixed wait is for an absence only (nothing may happen), and its margin has a name.

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** How long an absence is watched: something that was going to happen would have by now, with room to spare on a slow machine. */
export const ABSENCE_MS = 1500;

/** Retries `fn` until it returns a truthy value and returns it; fails with `what` after `timeout` ms. */
export async function poll(fn, { timeout = 10_000, interval = 40, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(interval);
  }
}

/** Waits until `fn` returns something truthy and returns it (`what` first, as the capture tests write it). */
export const until = (fn, what, timeout = 8000) => poll(fn, { what, timeout });
