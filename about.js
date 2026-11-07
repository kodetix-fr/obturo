// The state of about-pure.js, kept in the settings database (key 'about'), for the pages and the service worker. Nothing here is sent anywhere.
import { readKv, updateKv } from './settings.js';
import { askClosed, askShown, captured, cleanNotice, hasNews, installed, newsSeen, shouldAsk } from './about-pure.js';

const KEY = 'about';
const version = () => chrome.runtime.getManifest().version;

/** @param {(n: import('./about-pure.js').Notice) => import('./about-pure.js').Notice} change */
const update = (change) => updateKv(KEY, (stored) => change(cleanNotice(stored)));

export const readNotice = async () => cleanNotice(await readKv(KEY));

/** Is there news to read in this version? */
export const newsPending = async () => hasNews(await readNotice(), version());

export const markNewsSeen = () => update((n) => newsSeen(n, version()));

/** One more capture kept in the history. */
export const countCapture = () => update(captured);

/** @param {{ reason?: string, previousVersion?: string }} details of chrome.runtime.onInstalled */
export const noteInstalled = (details) => update((n) => installed(n, version(), details));

/**
 * Is it time to ask for a review? When it is, the request counts as shown now (see askShown), so that a popup closed without an answer
 * does not ask again at its next opening.
 */
export async function takeReviewAsk() {
  if (!shouldAsk(await readNotice())) return false; // nothing to write when it is not the time
  let ask = false;
  await update((n) => {
    ask = shouldAsk(n);
    return ask ? askShown(n) : n;
  });
  return ask;
}

/** The review was given, or refused: never again. */
export const closeReviewAsk = () => update(askClosed);
