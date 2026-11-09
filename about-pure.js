// What Obturo keeps on this computer about itself: the last version whose news was seen, and how many captures were taken since the
// request for a review (asked at most twice, never again after an answer). A bare number and a version: nothing about a capture.
// No DOM, no storage, testable with `node --test`.

/** The minor release that the text 'about.news' of the dictionaries talks about (the line of the manifest version, "0.3" for 0.3.0). */
export const NEWS_FOR = '0.3';

export const REVIEW_STEP = 15; // captures before the first request, and between two
export const MAX_ASKS = 2; // the request is shown twice at most

const STORE = 'https://chromewebstore.google.com/detail';
export const LINKS = Object.freeze({
  reviews: `${STORE}/kaafiicmlbdchfalaljmbeoblihjbnih/reviews`,
  issues: 'https://github.com/kodetix-fr/obturo/issues',
  oblitero: `${STORE}/oblitero-pdf-merge-redact/ofnapekaofoabpfodbffomjkpljmbdfd`,
});

/** @typedef {{ seen: string | null, captures: number, asked: number, next: number | null }} Notice */

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** "0.2" for "0.2.1", null for anything that is not a version. @param {unknown} version @returns {string | null} */
export function minorOf(version) {
  const m = typeof version === 'string' ? VERSION.exec(version) : null;
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
}

/** Is the minor release of `a` older than that of `b`? False when either is not a version. @param {unknown} a @param {unknown} b */
export function minorBefore(a, b) {
  const [x, y] = [minorOf(a), minorOf(b)];
  if (!x || !y) return false;
  const [xa, xb] = x.split('.').map(Number), [ya, yb] = y.split('.').map(Number);
  return xa < ya || (xa === ya && xb < yb);
}

const count = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);

/**
 * What was stored, made safe: anything unknown or out of range falls back to the start (no news seen, no capture, a first request after
 * REVIEW_STEP captures). `next: null` is kept: it means "never".
 * @param {unknown} raw @returns {Notice}
 */
export function cleanNotice(raw) {
  const r = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
  return {
    seen: minorOf(r.seen) ? r.seen : null,
    captures: count(r.captures) ?? 0,
    asked: Math.min(count(r.asked) ?? 0, MAX_ASKS),
    next: r.next === null ? null : count(r.next) ?? REVIEW_STEP,
  };
}

/**
 * The state after the extension was installed or updated: a first install has nothing new to read, and an update from a version
 * that never kept any state starts from the version it came from.
 * @param {Notice} n @param {string} current @param {{ reason?: string, previousVersion?: string }} details of chrome.runtime.onInstalled
 * @returns {Notice}
 */
export function installed(n, current, { reason, previousVersion } = {}) {
  if (reason === 'install') return { ...n, seen: current };
  if (reason === 'update' && !n.seen) return { ...n, seen: minorOf(previousVersion) ? /** @type {string} */ (previousVersion) : current };
  return n;
}

/** Is there news to show: the text is about this release line, and the last version seen is of an older one. @param {Notice} n @param {string} current */
export const hasNews = (n, current) => minorOf(current) === NEWS_FOR && minorBefore(n.seen, current);

/** The news were seen. @param {Notice} n @param {string} current @returns {Notice} */
export const newsSeen = (n, current) => (minorOf(current) ? { ...n, seen: current } : n);

/** A capture was kept. @param {Notice} n @returns {Notice} */
export const captured = (n) => ({ ...n, captures: Math.min(n.captures + 1, 1e6) });

/** Is it time to ask for a review? @param {Notice} n */
export const shouldAsk = (n) => n.next !== null && n.captures >= n.next;

/**
 * The request was shown: that is one of the two, answered or not (a request that is ignored comes back once, after REVIEW_STEP more
 * captures, and then never).
 * @param {Notice} n @returns {Notice}
 */
export function askShown(n) {
  const asked = Math.min(n.asked + 1, MAX_ASKS);
  return { ...n, asked, next: asked >= MAX_ASKS ? null : n.captures + REVIEW_STEP };
}

/** The review was given, or refused for good. @param {Notice} n @returns {Notice} */
export const askClosed = (n) => ({ ...n, next: null });
