// User settings, kept in their own small IndexedDB database so that their schema never depends on the shots database.
// Readable from the service worker, the library and Node tests (normalizeSettings is pure). setSettings tells the
// other contexts through BroadcastChannel('obturo') and a runtime message: { type: 'settings-changed' }.
import { LANGUAGES } from './languages.js';
import { CAPTURE_DELAYS } from './gestures.js';
import { done, wait } from './idb.js';

/** @typedef {{ language: string, theme: string, retentionDays: number, maxBytes: number, downloadFormat: string, downloadQuality: number, pdfLayout: string, pdfEncoding: string, filenameTemplate: string, afterCapture: string, fullPageWait: number, fullPageFixed: string, noTrace: boolean, captureDelay: number }} Settings */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  language: 'auto',       // 'auto' follows the browser UI language, else a key of LANGUAGES
  theme: 'auto',          // 'auto' | 'light' | 'dark'
  retentionDays: 30,      // history: unpinned shots older than this are purged, 0 = never purge by age
  maxBytes: 2 * 1024 ** 3, // history: size cap, 0 = no cap
  downloadFormat: 'png',  // 'png' | 'jpeg' | 'webp' | 'pdf'
  downloadQuality: 0.9,   // lossy formats (and the light PDF), 0.1 to 1
  pdfLayout: 'fit',       // 'fit' (one page the size of the image) | 'a4'
  pdfEncoding: 'flate',   // 'flate' (lossless) | 'jpeg' (light)
  afterCapture: 'ask',    // 'ask' (the capture is kept, and a page in a new tab asks what to do: edit, copy, download) | 'copy' (it is copied, and kept in the history) | 'save' (it is kept, and downloaded as a file)
  filenameTemplate: '{host}_{date}_{time}', // name of a downloaded capture, see suggestedFilename (encode.js; encode.test.js keeps its default equal to this)
  fullPageWait: 0,        // full page: ms to wait after each scroll, on top of what the capture waits for by itself (images, animations)
  fullPageFixed: 'edges', // full page: 'edges' (a fixed bar shows once, at the top or at the bottom of the image) | 'hide' (none shows)
  noTrace: false,         // no trace: a capture is copied to the clipboard and saved nowhere (nothing in the history)
  captureDelay: 0,        // seconds to wait before a capture (CAPTURE_DELAYS), the icon counting down; 0 = none
});

const THEMES = ['auto', 'light', 'dark'];
export const DOWNLOAD_FORMATS = ['png', 'jpeg', 'webp', 'pdf'];
export const PDF_LAYOUTS = ['fit', 'a4']; // the layouts of pdf.js
export const PDF_ENCODINGS = ['flate', 'jpeg']; // its encodings
export const FULL_PAGE_WAITS = [0, 500, 1000, 2000]; // ms: the choices of the settings (library.html)
export const FULL_PAGE_FIXED = ['edges', 'hide'];
export const AFTER_CAPTURE = ['ask', 'copy', 'save']; // what a capture does once it is taken (the select of the settings, library.html)
export const MAX_NAME_TEMPLATE = 80; // characters: the maxlength of the field in library.html
/** How the formats are written on screen: proper names, the same in every language. */
export const FORMAT_NAMES = Object.freeze({ png: 'PNG', jpeg: 'JPEG', webp: 'WebP', pdf: 'PDF' });
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Keeps the known keys with a valid value and falls back to the default for anything else (unknown key, wrong type,
 * out of range): a corrupted or older record can never break the extension.
 * @param {unknown} raw
 * @returns {Settings}
 */
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
  const d = DEFAULT_SETTINGS;
  return {
    language: r.language === 'auto' || Object.hasOwn(LANGUAGES, r.language) ? r.language : d.language,
    theme: THEMES.includes(r.theme) ? r.theme : d.theme,
    retentionDays: isInt(r.retentionDays, 0, 3650) ? r.retentionDays : d.retentionDays,
    maxBytes: isInt(r.maxBytes, 0, 2 ** 40) ? r.maxBytes : d.maxBytes,
    downloadFormat: DOWNLOAD_FORMATS.includes(r.downloadFormat) ? r.downloadFormat : d.downloadFormat,
    downloadQuality: typeof r.downloadQuality === 'number' && r.downloadQuality >= 0.1 && r.downloadQuality <= 1
      ? r.downloadQuality : d.downloadQuality,
    pdfLayout: PDF_LAYOUTS.includes(r.pdfLayout) ? r.pdfLayout : d.pdfLayout,
    pdfEncoding: PDF_ENCODINGS.includes(r.pdfEncoding) ? r.pdfEncoding : d.pdfEncoding,
    afterCapture: AFTER_CAPTURE.includes(r.afterCapture) ? r.afterCapture : d.afterCapture,
    filenameTemplate: typeof r.filenameTemplate === 'string' && r.filenameTemplate.trim() && r.filenameTemplate.length <= MAX_NAME_TEMPLATE
      ? r.filenameTemplate : d.filenameTemplate,
    fullPageWait: FULL_PAGE_WAITS.includes(r.fullPageWait) ? r.fullPageWait : d.fullPageWait,
    fullPageFixed: FULL_PAGE_FIXED.includes(r.fullPageFixed) ? r.fullPageFixed : d.fullPageFixed,
    noTrace: typeof r.noTrace === 'boolean' ? r.noTrace : d.noTrace,
    captureDelay: CAPTURE_DELAYS.includes(r.captureDelay) ? r.captureDelay : d.captureDelay,
  };
}

let dbp = null;
const open = () => dbp ??= new Promise((ok, ko) => {
  const r = indexedDB.open('obturo-settings', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => {
    const db = r.result;
    db.onversionchange = db.onclose = () => { db.close(); dbp = null; }; // a closed connection is not kept: the next call opens a new one
    ok(db);
  };
  r.onerror = () => { dbp = null; ko(r.error); };
});

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const db = await open();
  return normalizeSettings(await wait(db.transaction('kv').objectStore('kv').get('settings')));
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>} the settings as stored
 */
export async function setSettings(patch) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  const store = tx.objectStore('kv');
  const merged = normalizeSettings({ ...normalizeSettings(await wait(store.get('settings'))), ...patch });
  store.put(merged, 'settings');
  await done(tx);
  writeAppearance(merged);
  notifySettingsChanged();
  return merged;
}

// --- The shots the library has open ---

// The library page publishes here the shots its editor holds (or is about to hold), and the retention reads them: a pass that
// removed one of them would leave the editor writing into a shot that no longer exists. It lives next to the settings, a small
// database every context opens anyway (the service worker reads the settings when it adds a shot).
export const LIBRARY_LOCK = 'obturo-lib'; // held by the library tab that may edit, for as long as it lives
const OPEN_KEY = 'openShots';

/** The ids that can be trusted in whatever was stored: a handful of positive whole numbers. @param {unknown} raw @returns {number[]} */
export const cleanShotIds = (raw) => (Array.isArray(raw) ? raw.filter((id) => Number.isInteger(id) && id > 0).slice(0, 8) : []);

/** Published by the library tab that holds the editing lock. [] when it holds none. @param {number[]} ids */
export async function setOpenShots(ids) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(cleanShotIds(ids), OPEN_KEY);
  await done(tx);
}

// Whether a library tab is alive: the one that edits holds a Web Lock for as long as it lives, and the browser releases it when
// the tab closes or crashes. Without Web Locks nothing can be told, and keeping a shot costs less than losing one.
async function libraryIsAlive() {
  if (!navigator.locks?.query) return true;
  try {
    return !!(await navigator.locks.query()).held?.some((lock) => lock.name === LIBRARY_LOCK);
  } catch {
    return true;
  }
}

/**
 * The shots a live library holds open, which no retention pass, purge or size cap may remove. A tab that crashed or was killed
 * has let go of its lock: what it published protects nothing any more.
 * @returns {Promise<number[]>}
 */
export async function liveOpenShots() {
  const db = await open();
  const ids = cleanShotIds(await wait(db.transaction('kv').objectStore('kv').get(OPEN_KEY)));
  return ids.length && (await libraryIsAlive()) ? ids : [];
}

// A copy of the language and the theme in localStorage (shared by the pages of the extension), so that a page can show
// its first frame in the right language and theme without waiting for the settings database: opening it costs about
// 10 ms, which is a tenth of the budget of the library strip. IndexedDB stays the truth: a page confirms the copy with
// getSettings a moment later. The service worker has no localStorage and does not need it.
// The popup also reads the copy for the no-trace mode and the delay before a capture (controls it shows at once, with no database); it writes it too when
// one is changed there, since it is the page that changes the setting (through the service worker).
// ponytail: only what a first frame needs is copied (the language, the theme, the no-trace mode, the delay); add a key here if another setting must be known before IndexedDB answers.
const APPEARANCE_KEY = 'obturo.appearance';

/** @returns {{ language: string, theme: string, noTrace: boolean, captureDelay: number } | null} the copy, validated, or null if there is none yet */
export function readAppearance() {
  try {
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY));
    if (!raw || typeof raw !== 'object') return null;
    const { language, theme, noTrace, captureDelay } = normalizeSettings(raw);
    return { language, theme, noTrace, captureDelay };
  } catch {
    return null; // no localStorage, blocked, or not JSON
  }
}

/** @param {{ language: string, theme: string, noTrace?: boolean, captureDelay?: number }} settings */
export function writeAppearance({ language, theme, noTrace = false, captureDelay = 0 }) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ language, theme, noTrace, captureDelay }));
  } catch { /* no localStorage (service worker), blocked or full: the settings database is still the truth */ }
}

/**
 * Tells the other contexts that the settings changed. The pages and the service worker when it is awake listen to the
 * BroadcastChannel; a stopped service worker does not wake up for it, but it does for a runtime message. Without the
 * chrome API (Node tests) only the channel is used; nobody listening is not an error.
 */
export function notifySettingsChanged() {
  const channel = new BroadcastChannel('obturo');
  channel.postMessage({ type: 'settings-changed' });
  channel.close();
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    Promise.resolve(chrome.runtime.sendMessage({ type: 'settings-changed' })).catch(() => {}); // no receiver, context gone
  } catch { /* the extension was reloaded under this page */ }
}
