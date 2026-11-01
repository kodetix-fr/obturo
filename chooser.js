// The window that asks what to do with a capture just taken (settings: "After a capture", "Ask what to do"; opened by sw.js with the id of
// the capture in its address: chooser.html#shot=<id>) in a tab next to the captured page. The capture is already in the history: this page reads
// it from there and offers the actions: edit it (the worker opens the editor), copy it, download it as PNG, JPEG, WebP or PDF (the format
// settings of the library, and the file name template, apply). A choice that worked closes the tab and brings the captured page back: the
// answer is given. Nothing leaves the machine and no permission is needed. With `&save=1` (setting "Save the file") the tab opens in the
// background and downloads the capture by itself, in the stored format; it comes forward only if that fails.
import { DEFAULT_SETTINGS, getSettings } from './settings.js';
import { loadLanguage, resolveLanguage, setLanguage, t } from './i18n.js';
import { applyDom, setI18n } from './dom-i18n.js';
import { getOriginal, getShot } from './db.js';
import { hostOf } from './catalog.js';
import { download as exportFile } from './export-ui.js';

// ponytail: after a download the tab waits a fixed time before it closes, for the browser to take the file (it reads the blob of this page, which goes
// with it); chrome.downloads would say when the download has started, at the cost of a permission. A copy needs only the time to be seen.
const CLOSE_AFTER_MS = { copy: 500, download: 1500 };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const id = Number(params.get('shot'));
const auto = params.get('save') === '1'; // "Save the file": the page was opened in the background and downloads the capture by itself
const state = /** @type {HTMLElement} */ ($('state'));

/** @type {import('./db.js').Shot | null} */
let shot = null;
/** @type {Blob | null} */
let original = null;
let busy = false;
let closing = false; // a choice worked: the tab is about to go, nothing more is taken

/** What the page says at the bottom: a key of the dictionaries (none clears it), a kind ('ok' or 'error') and variables. @param {string} [key] @param {string} [kind] @param {Record<string, string | number>} [vars] */
function say(key, kind = '', vars) {
  setI18n(state, key, vars);
  state.dataset.kind = kind;
}

const buttons = () => /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('button.act, .fmt')]);

/** Runs one action at a time; a failure is said and leaves the page as it was. @param {() => Promise<void>} job */
async function act(job) {
  if (busy || closing || !original || !shot) return;
  busy = true;
  say();
  try {
    await job();
  } catch (e) {
    console.error('Obturo: chooser', e);
    say('chooser.failed', 'error');
  } finally {
    busy = false;
  }
}

/** Closes this tab and shows the captured page again (what the browser does for the opener of a tab that is closed, made certain). */
async function closeTab() {
  try {
    const here = await chrome.tabs.getCurrent();
    if (here?.openerTabId !== undefined && !auto) await chrome.tabs.update(here.openerTabId, { active: true }).catch(() => {}); // gone, or in another window: nothing to show
    if (here?.id !== undefined) { await chrome.tabs.remove(here.id); return; }
  } catch { /* fall through */ }
  window.close();
}

/** Brings this tab forward: a download that was left to it in the background did not happen, and the page says why. */
const surface = () => chrome.tabs.getCurrent().then((tab) => tab?.id !== undefined && chrome.tabs.update(tab.id, { active: true })).catch(() => {});

/** The tab goes away shortly: a choice was made, and it worked. @param {number} ms */
const closeSoon = (ms) => {
  closing = true;
  setTimeout(closeTab, ms);
};

const copy = () => act(async () => {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': /** @type {Blob} */ (original) })]);
  setI18n(/** @type {HTMLElement} */ ($('copyLabel')), 'chooser.copied');
  closeSoon(CLOSE_AFTER_MS.copy);
});

// The same download as the editor's (export-ui.js): the original as it is for a PNG, else encoded (or a PDF) with the settings of the
// library as they are now, named by its template. The context hands the original over as the bitmap of an unedited capture.
const download = (/** @type {string} */ format) => act(async () => {
  const blob = /** @type {Blob} */ (original);
  const bitmap = await createImageBitmap(blob);
  try {
    const out = await exportFile({
      context: () => (shot ? { shot, original: blob, edited: false, size: { w: bitmap.width, h: bitmap.height }, source: () => bitmap } : null),
      warn: (key) => say(key, 'error'),
      settings: { downloadFormat: format },
    });
    if (!out) return;
    say('chooser.downloaded', 'ok', { name: out.name });
    closeSoon(CLOSE_AFTER_MS.download);
  } finally {
    bitmap.close();
  }
});

const edit = () => act(async () => {
  await chrome.runtime.sendMessage({ type: 'chooser-edit', id });
  closeTab();
});

async function start() {
  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  setLanguage(await loadLanguage(resolveLanguage(settings.language, chrome.i18n.getUILanguage())));
  applyDom();
  $('close').addEventListener('click', closeTab);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTab(); });
  $('edit').addEventListener('click', edit);
  $('copy').addEventListener('click', copy);
  for (const b of document.querySelectorAll('.fmt')) b.addEventListener('click', () => download(/** @type {HTMLElement} */ (b).dataset.format ?? 'png'));

  try {
    [shot, original] = Number.isInteger(id) && id > 0 ? [await getShot(id), await getOriginal(id)] : [null, null];
  } catch (e) {
    console.error('Obturo: chooser', e);
  }
  if (!shot || !original) { say('chooser.gone', 'error'); if (auto) surface(); return; }
  const preview = /** @type {HTMLImageElement} */ ($('preview'));
  preview.src = URL.createObjectURL(original);
  preview.hidden = false;
  const host = hostOf(shot.url);
  const size = t('chooser.size', { w: shot.w, h: shot.h });
  $('caption').textContent = host ? `${host} · ${size}` : size;
  for (const b of buttons()) b.disabled = false;
  /** @type {HTMLElement} */ ($('edit')).focus();
  if (!auto) return;
  await download(settings.downloadFormat);
  if (!closing) surface();
}

start().catch((e) => console.error('Obturo: chooser', e));
