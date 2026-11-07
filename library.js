// Library: the strip of recent shots + the editor.
// Budget: the strip is painted before Fabric loads at all (editor.js arrives through a dynamic import()),
// and a thumbnail never requires decoding a full-size PNG (it is generated on demand, then persisted).
// The language and the theme come from the settings (settings.js), applied before the page is shown.
import { queryShots, latestShots, countShots, getShot, getOriginal, updateShot, storeThumb, deleteShot, runRetention, setPinned } from './db.js'; // the strip holds the latest shots only
import { hostOf } from './catalog.js';
import { looksLikeImage } from './import-pure.js';
import { thumbPlan, THUMB_QUALITY, versionsKey } from './thumb-pure.js';
import { DEFAULT_SETTINGS, LIBRARY_LOCK, getSettings, readAppearance, setOpenShots, setSettings, writeAppearance } from './settings.js';
import { formatDate, formatNumber, loadLanguage, resolveLanguage, setLanguage, t } from './i18n.js';
import { applyDom, byId as $, icon, setI18n } from './dom-i18n.js';

/** @typedef {import('./db.js').Shot} Shot */

const RECENT = 12; // shots in the strip, the shortcut to the latest ones (the whole history is the sheet of history-view.js)

const strip = $('strip'), banner = $('banner'), stageMsg = $('stageMsg');

/** @type {Shot[]} */
let shots = [];        // the latest shots (RECENT at most), from the oldest to the most recent
let totalCount = 0;    // every shot of the history, not only those of the strip
/** @type {Shot | null} */
let current = null;    // the shot chosen for the editor, opening or open (it may not be in the strip: it can come from the history view)
/** @type {Promise<typeof import('./history-view.js')> | null} */
let historyModule = null; // loaded on first use
let openedId = null;   // shot the editor is showing (set once it is open)
let heldId = null;     // shot the editor holds, or still holds while another one is being opened (what the retention must not remove)
let editorPromise = null;    // promise of the editor, created on first need
let readOnly = false;  // another Obturo tab already holds the editing lock
let holdsLock = false; // this tab holds it
let booted = false;    // the first list of shots is read and drawn
let wantedId = null;   // shot asked for by the address (#shot=<id>) or by an 'open-shot' message during startup
let stripSignature = ''; // ids and thumbnail presence of what the strip shows: detects when it must be redrawn
const thumbUrls = new Map(); // id -> object URL of the displayed thumbnail: revoked as soon as it is replaced

// The strip cell of a shot, or null if it is not displayed.
const cellOf = (id) => strip.querySelector(`[data-id="${id}"]`);

// Texts are shown from keys of the dictionaries (locales/), so they follow a language change (dom-i18n.js).
const showBanner = (key, vars) => { setI18n($('bannerText'), key, vars); banner.hidden = false; };
const hideBanner = () => { banner.hidden = true; };
const showGone = (editing) => showBanner(editing ? 'msg.gone.editing' : 'msg.gone');
/**
 * @param {'loading' | 'empty' | 'error'} state
 * @param {string} title key
 * @param {string} [hint] key
 */
function showStageMsg(state, title, hint) {
  stageMsg.dataset.state = state;
  setI18n($('stageTitle'), title);
  setI18n($('stageHint'), hint);
  $('stageHint').hidden = !hint;
  stageMsg.hidden = false;
  document.body.toggleAttribute('data-empty', state === 'empty' || title === 'state.dbUnavailable'); // see library.css
  $('stageImport').hidden = state !== 'empty';
}
let noTrace = false; // the no-trace mode, as the settings last said
const showEmpty = () => showStageMsg('empty', 'state.empty', noTrace ? 'state.empty.noTrace' : 'state.empty.hint');

const LOCK_TRIES = 4;
const LOCK_RETRY_MS = 120; // a reload releases the lock of the old document a moment later

// ponytail: one editing tab at a time, the others stay read-only; saving rewrites every version of a shot (last writer wins), so two tabs would overwrite each other; per-version writes with a merge would allow several tabs.
// The lock is held for as long as the tab lives.
async function acquireLock() {
  if (!navigator.locks) return true;
  for (let i = 0; i < LOCK_TRIES; i++) {
    const got = await new Promise((done) => navigator.locks.request(LIBRARY_LOCK, { ifAvailable: true }, (lock) => {
      done(!!lock);
      return lock ? new Promise(() => {}) : undefined; // never resolved: the lock stays held until the tab closes
    }));
    if (got) return true;
    await new Promise((done) => setTimeout(done, LOCK_RETRY_MS));
  }
  return false;
}

// The retention reads this (settings.js liveOpenShots) and spares these shots, for as long as this tab holds the lock: the one on
// screen and the one the editor may still be saving into. A tab that dies stops protecting them by letting go of the lock.
function publishOpen() {
  if (!holdsLock) return;
  setOpenShots([current?.id ?? null, heldId].filter((id) => id !== null)).catch((e) => console.error('Obturo: open shots not published', e));
}

const signatureOf = (list) => list.map((s) => `${s.id}:${s.thumb ? 1 : 0}:${s.pinned ? 1 : 0}`).join();

const getEditor = () => editorPromise ??= import('./editor.js').then(({ createEditor }) => createEditor({
  stage: $('stage'),
  onSave: (id, patch) => updateShot(id, patch),
  onThumb: async (id, thumb, key) => {
    if (!(await storeThumb(id, thumb, key))) return; // the shot is gone or has moved on: this thumbnail is not its own
    const s = shots.find((x) => x.id === id);
    const img = cellOf(id)?.querySelector('img');
    if (s) s.thumb = thumb; // the thumbnail follows the displayed version (a black flat also hides the strip)
    if (s && img) setThumb(img, s);
  },
  onGone: () => showGone(true),
  onError: showBanner,
  onVersions: (s) => {
    const badge = /** @type {HTMLElement | null | undefined} */ (cellOf(s.id)?.querySelector('.badge'));
    if (badge) badge.hidden = !s.versions.length;
  },
})).catch((e) => { editorPromise = null; throw e; });

// ---------- language and theme ----------

let language = '';
/** Applies the language and the theme of `s` to the page, texts already displayed included (the texts of a language other than English are loaded first). */
async function applySettings(s) {
  const root = document.documentElement;
  noTrace = s.noTrace;
  $('noTraceBadge').hidden = !noTrace;
  if (stageMsg.dataset.state === 'empty' && !stageMsg.hidden) showEmpty();
  if (s.theme === 'light' || s.theme === 'dark') root.dataset.theme = s.theme;
  else delete root.dataset.theme;
  const lang = setLanguage(await loadLanguage(resolveLanguage(s.language, chrome.i18n.getUILanguage())));
  if (lang === language) return;
  language = lang;
  applyDom();
  relabelStrip();
  if (booted) showHistoryCount(); // the first time, after the first paint (init): formatting a number builds an Intl object, 7 to 13 ms when cold
  historyModule?.then((m) => m.relocalize()).catch(() => {});
  editorPromise?.then((e) => e.relocalize()).catch(() => {});
}

// The page was hidden until the language and the theme are known.
const reveal = () => document.documentElement.classList.remove('pending');

// Reads the stored settings, applies them and keeps the copy of settings.js up to date. Never rejects: without settings
// (database failure) the page runs with the defaults, or with the copy.
async function loadSettings() {
  let s = null;
  try {
    s = await getSettings();
    writeAppearance(s);
  } catch (e) {
    console.error('Obturo: settings unavailable', e);
  }
  if (s) await applySettings(s);
  else if (!language) await applySettings(DEFAULT_SETTINGS);
  reveal();
}

let settingsUi = null;
async function openSettings() {
  try {
    settingsUi ??= import('./settings-ui.js');
    (await settingsUi).openSettings(applySettings, () => readOnly);
  } catch (e) {
    settingsUi = null;
    console.error('Obturo: settings dialog', e);
  }
}
$('settingsBtn').addEventListener('click', openSettings);

// ---------- thumbnails ----------

const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    queueThumb(Number(/** @type {HTMLElement} */ (e.target).dataset.id));
  }
}, { root: strip });

function setThumb(img, s) {
  if (!s.thumb) return;
  URL.revokeObjectURL(thumbUrls.get(s.id)); // no effect if undefined
  const u = URL.createObjectURL(s.thumb);
  thumbUrls.set(s.id, u);
  img.src = u;
}

// ponytail: one thumbnail at a time (each one decodes a whole PNG), only for the visible cells; a small pool of 2 or 3 in parallel if the strip feels slow to fill.
let thumbQueue = Promise.resolve();
const queueThumb = (id) => { thumbQueue = thumbQueue.then(() => makeThumb(id)).catch((e) => console.error('Obturo: thumbnail', e)); };

async function makeThumb(id) {
  const s = shots.find((x) => x.id === id);
  if (!s) return;
  const thumb = await buildThumb(s);
  if (!thumb) return;
  s.thumb = thumb;
  const img = cellOf(id)?.querySelector('img');
  if (img) setThumb(img, s);
}

// The thumbnail of a shot, made once even if the strip and the history view ask for it together.
/** @type {Map<number, Promise<Blob | null>>} */
const thumbJobs = new Map();
/** Makes and stores the missing thumbnail of `s`. null if there is none to make (see below) or the shot is gone. @param {Shot} s @returns {Promise<Blob | null>} */
function buildThumb(s) {
  // An edited shot has its thumbnail written by the editor (displayed version): taking one from the original would
  // show what the annotations hide.
  if (s.thumb || s.versions.length) return Promise.resolve(s.thumb ?? null);
  let job = thumbJobs.get(s.id);
  if (!job) {
    job = renderThumb(s).finally(() => thumbJobs.delete(s.id));
    thumbJobs.set(s.id, job);
  }
  return job;
}

/** @param {Shot} s @returns {Promise<Blob | null>} */
async function renderThumb(s) {
  const stored = await getShot(s.id); // another caller (the strip, the sheet) may have made it since `s` was read
  if (!stored) return null;
  if (stored.thumb) return (s.thumb = stored.thumb);
  if (stored.versions.length) return null; // edited since `s` was read: its thumbnail is the editor's (the displayed version)
  const key = versionsKey(stored); // the state this thumbnail will show: the original
  const blob = await getOriginal(s.id);
  if (!blob) return null;
  const { keepH, k } = thumbPlan(s.w, s.h); // full page: only the top is kept
  const bmp = await createImageBitmap(blob, 0, 0, s.w, keepH, {
    resizeWidth: Math.max(1, Math.round(s.w * k)), resizeHeight: Math.max(1, Math.round(keepH * k)), resizeQuality: 'low',
  });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  const thumb = await c.convertToBlob({ type: 'image/webp', quality: THUMB_QUALITY });
  c.width = c.height = 0; // gives the pixels back at once, as the other temporary canvases do
  // Refused if the shot disappeared, or was edited while this was rendered (seconds on a large image): the original must not
  // replace the thumbnail of a version that hides part of it.
  if (!(await storeThumb(s.id, thumb, key))) return null;
  s.thumb = thumb;
  return thumb;
}

// ---------- strip ----------

// The texts of a cell that depend on the language (and on the date format).
function labelCell(li, s) {
  const when = formatDate(s.createdAt);
  li.querySelector('.open').setAttribute('aria-label', t('strip.open', { when }));
  li.querySelector('.badge').textContent = t('strip.edited');
  li.querySelector('.del').setAttribute('aria-label', t('strip.delete'));
  li.querySelector('.when').textContent = when;
}

function relabelStrip() {
  const byId = new Map(shots.map((s) => [s.id, s]));
  for (const li of /** @type {HTMLCollectionOf<HTMLElement>} */ (strip.children)) {
    const s = byId.get(Number(li.dataset.id));
    if (s) labelCell(li, s);
  }
}

function shotItem(s) {
  const li = document.createElement('li');
  li.className = 'shot';
  li.dataset.id = s.id;
  if (s.id === current?.id) li.setAttribute('aria-current', 'true');

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'open';
  open.title = `${s.title || ''}\n${s.url || ''}`.trim(); // attribute: never interpreted as HTML
  open.onclick = () => select(s.id);
  const img = new Image();
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  setThumb(img, s);
  open.append(img);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.hidden = !s.versions.length;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.append(icon('x'));
  del.onclick = () => remove(s.id);
  del.disabled = readOnly;

  const meta = document.createElement('p');
  meta.className = 'meta';
  const host = document.createElement('span');
  host.className = 'host';
  host.textContent = hostOf(s.url) || s.title || ''; // textContent: title and URL come from the captured page
  const when = document.createElement('span');
  when.className = 'when';
  meta.append(host, when);

  li.append(open, badge, del, meta);
  if (s.pinned) setPinMark(li, true);
  labelCell(li, s);
  if (!s.thumb && !s.versions.length) thumbObserver.observe(li);
  return li;
}

function renderStrip() {
  thumbObserver.disconnect();
  for (const u of thumbUrls.values()) URL.revokeObjectURL(u);
  thumbUrls.clear();
  strip.replaceChildren(...shots.toReversed().map(shotItem)); // the most recent on the left
  stripSignature = signatureOf(shots);
  if (booted) showHistoryCount(); // the first time, once the strip is painted (it costs a number format)
}

// A pinned shot is never removed automatically; its mark is made only when needed.
/** @param {Element | null | undefined} li @param {boolean} pinned */
function setPinMark(li, pinned) {
  let mark = /** @type {HTMLElement | null | undefined} */ (li?.querySelector('.pin-mark'));
  if (!mark && pinned && li) {
    mark = document.createElement('span');
    mark.className = 'pin-mark';
    mark.append(icon('pin'));
    li.append(mark);
  }
  if (mark) mark.hidden = !pinned;
}

// "All history" with the number of shots, in the language in use.
function showHistoryCount() {
  $('historyAllCount').textContent = totalCount ? formatNumber(totalCount) : '';
  $('historyAll').setAttribute('aria-label', t('hist.all.aria', { n: formatNumber(totalCount) }));
}

// ---------- actions ----------

function markCurrent(/** @type {number} */ id) {
  for (const li of /** @type {HTMLCollectionOf<HTMLElement>} */ (strip.children)) {
    if (li.dataset.id === String(id)) li.setAttribute('aria-current', 'true');
    else li.removeAttribute('aria-current');
  }
}

/** @type {Promise<typeof import('./viewer.js')> | null} */
let viewer = null;
/** A read-only tab shows the capture, with Copy and Download (viewer.js). @param {Shot} s */
async function view(s) {
  current = s;
  markCurrent(s.id);
  try {
    viewer ??= import('./viewer.js').then((m) => { m.setup(showBanner); return m; });
    if (!(await (await viewer).show(s))) return showGone(false);
    if (current === s) stageMsg.hidden = true;
  } catch (e) {
    console.error('Obturo: view failed', e);
    viewer = null;
    $('viewer').hidden = true;
    showStageMsg('error', 'state.openFailed');
  }
}

/** @param {number} id @param {Shot} [shot] the shot, when it does not come from the strip (the history view) */
async function select(id, shot) {
  const s = shot ?? shots.find((x) => x.id === id);
  if (!s) return;
  if (readOnly) return view(s);
  current = s;
  showPin();
  openedId = null;
  publishOpen(); // the new shot is protected from now on, and the one the editor still holds until it lets go
  document.body.removeAttribute('data-empty');
  hideBanner();
  markCurrent(id);
  try {
    const blob = await getOriginal(id);
    if (current?.id !== id) return; // the user clicked elsewhere during the read
    if (!blob) { showGone(false); return; }
    const editor = await getEditor();
    if (current?.id !== id) return;
    await editor.open(s, blob);
    if (current?.id === id) {
      openedId = heldId = id;
      publishOpen(); // the editor let go of the previous shot
    }
  } catch (e) {
    if (current?.id !== id) return;
    console.error('Obturo: open failed', e); // heldId is left as it was: the editor may still hold the previous shot
    showStageMsg('error', 'state.openFailed');
    showBanner('msg.openFailed');
  }
}

// Opens a shot on request of another part of the extension (address #shot=<id>, 'open-shot' message of the service
// worker). The list is read again first: the shot may have been added a moment ago.
async function openShot(id) {
  if (!booted) { wantedId = id; return; } // init() will pick it up
  historyModule?.then((m) => m.closeHistory()); // what another part asks for comes first
  let s = shots.find((x) => x.id === id);
  if (!s) {
    await refresh();
    s = shots.find((x) => x.id === id) ?? await getShot(id); // the strip holds the latest shots only
    if (!s) {
      await refresh(); // the write of the service worker may land a moment later
      s = shots.find((x) => x.id === id) ?? await getShot(id);
    }
  }
  if (readOnly || id === openedId || !s) return;
  await select(id, s);
}

async function remove(id) {
  if (readOnly) return;
  const s = shots.find((x) => x.id === id);
  if (!s) return;
  const { confirmDialog, deleteWords } = await import('./history-dialogs.js'); // the same dialog as the history
  if (!(await confirmDialog(await deleteWords([id], s)))) return;
  try {
    if (id === current?.id) {
      current = null;
      showPin();
      openedId = null;
      await (await getEditor()).close(); // saves one last time before deleting
      heldId = null;
      publishOpen();
    }
    await deleteShot(id);
  } catch (e) {
    console.error('Obturo: delete failed', e);
    showBanner('msg.deleteFailed');
    return;
  }
  shots = shots.filter((x) => x.id !== id);
  totalCount = Math.max(0, totalCount - 1);
  renderStrip();
  await refresh(); // the strip is filled again from the history, and the latest shot opens if none is open
  if (!current && !shots.length) { showEmpty(); hideBanner(); }
}

// On return to the tab: a shot may have been added (or evicted) from the service worker.
let refreshing = null;
const refresh = () => refreshing ??= doRefresh().finally(() => { refreshing = null; });
async function doRefresh() {
  try {
    const page = await queryShots({ limit: RECENT }); // the latest shots only
    const fresh = page.items.toReversed();
    totalCount = page.total;
    shots = fresh.map((s) => (current && s.id === current.id ? current : s)); // the in-memory state of the open shot is authoritative
    if (signatureOf(shots) !== stripSignature) renderStrip();
    else showHistoryCount();
    // the open shot may be older than the strip (opened from the history): look for it itself
    if (current && !fresh.some((s) => s.id === current.id) && !(await getShot(current.id))) showGone(true);
    else if (!current && shots.length) select(shots.at(-1).id);
  } catch (e) {
    console.error('Obturo: refresh failed', e);
  }
}

// The pending change is written as soon as the page may go away: hidden (another tab, minimized) or leaving. A closed tab says it
// with 'pagehide' and 'visibilitychange'; a reload or a navigation says it with 'beforeunload' only, and the page is destroyed a
// few milliseconds later: a read followed by a write has no time to finish after 'pagehide' (measured: lost every time).
const flushEditor = () => editorPromise?.then((e) => e.flush()).catch(() => {});
addEventListener('focus', refresh);
addEventListener('beforeunload', flushEditor);
addEventListener('pagehide', flushEditor);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushEditor();
  else refresh();
});

// With several library tabs the worker cannot tell which one may edit: the one that does comes forward by itself.
const bringForward = () => chrome.tabs.getCurrent()
  .then((tab) => tab?.id !== undefined && chrome.tabs.update(tab.id, { active: true }).then(() => chrome.windows.update(tab.windowId, { focused: true })))
  .catch(() => {});

// Messages of the other parts of the extension (service worker, other tabs).
const bus = new BroadcastChannel('obturo');
bus.onmessage = ({ data }) => {
  if (data?.type === 'settings-changed') getSettings().then(applySettings).catch((e) => console.error('Obturo: settings', e));
  else if (data?.type === 'open-shot' && Number.isInteger(data.id)) {
    if (!readOnly) bringForward();
    openShot(data.id);
  }
  else if (data?.type === 'open-settings') openSettings(); // the icon menu, on a tab that is already open
};

// Address: library.html#shot=<id> opens that shot, library.html#settings opens the settings.
const shotOfHash = () => { const m = /^#shot=(\d+)$/.exec(location.hash); return m ? Number(m[1]) : null; };
addEventListener('hashchange', () => {
  const id = shotOfHash();
  if (id !== null) openShot(id);
  else if (location.hash === '#settings') openSettings();
});

// ---------- import: a file picked, an image pasted or dropped (import.js, loaded on first use) ----------

let importModule = null;
let importing = false;
/** @param {File[]} files */
async function runImport(files) {
  if (readOnly || importing || !files.length) return;
  importing = true;
  try {
    if ((await getSettings().catch(() => DEFAULT_SETTINGS)).noTrace) return showBanner('import.err.noTrace'); // an import is kept in the history
    const { importFiles } = await (importModule ??= import('./import.js'));
    const { ids, failed } = await importFiles(files, t('import.pasted'));
    if (ids.length) await openShot(ids.at(-1)); // the last one: the most recent, on the left of the strip
    if (failed) showBanner(failed.key, failed.vars); // after the open, which clears the banner
  } catch (e) {
    console.error('Obturo: import failed', e);
    showBanner('import.err.failed');
  } finally {
    importing = false;
  }
}

$('noTraceBadge').addEventListener('click', () => setSettings({ noTrace: false }).catch((e) => console.error('Obturo: settings', e)));
const importInput = /** @type {HTMLInputElement} */ ($('importInput'));
$('importBtn').addEventListener('click', () => importInput.click());
$('stageImport').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  const files = [...(importInput.files ?? [])];
  importInput.value = ''; // the same file can be picked again
  runImport(files);
});

// An import is for a tab that edits, with no dialog open (the settings and the history sheet are modal: what is behind them is not
// what the user is looking at).
const canImport = () => !readOnly && !document.querySelector('dialog[open]');
// A paste into a field of the page (the text of an annotation) is the field's. Only an image is taken: the text on the clipboard is
// left to whoever wants it. The files are read here, during the event: the clipboard is not readable afterwards.
const isField = (/** @type {EventTarget | null} */ el) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
document.addEventListener('paste', (e) => {
  if (isField(e.target) || !canImport()) return;
  const files = [...(e.clipboardData?.files ?? [])].filter(looksLikeImage);
  if (!files.length) return;
  e.preventDefault();
  runImport(files);
});

// A drag of files over the page: the page takes the drop (otherwise the browser would open the file and leave the library, even in a
// read-only tab or behind a dialog), and a box says so while it can be imported. Leaving the window ends it (no relatedTarget).
const dragsFiles = (/** @type {DragEvent} */ e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
const showDrop = (/** @type {boolean} */ on) => { $('dropHint').hidden = !on; };
addEventListener('dragover', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = canImport() ? 'copy' : 'none';
  showDrop(canImport());
});
addEventListener('dragleave', (e) => { if (!e.relatedTarget) showDrop(false); });
addEventListener('drop', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  showDrop(false);
  if (canImport()) runImport([...(e.dataTransfer?.files ?? [])]);
});

// ---------- history ----------

// The history view (history-view.js) is loaded on first use, and fetched ahead once the page is idle.
function loadHistory() {
  historyModule ??= import('./history-view.js').then((m) => {
    m.setup({
      readOnly: () => readOnly,
      openShot: (shot) => select(shot.id, shot),
      makeThumb: buildThumb,
      pinned: (ids, on) => applyPinned(ids, on),
      flush: () => editorPromise?.then((e) => e.flush()).catch(() => {}) ?? Promise.resolve(),
      openSettings,
    });
    return m;
  }).catch((e) => { historyModule = null; throw e; });
  return historyModule;
}

async function showHistory() {
  try {
    (await loadHistory()).openHistory();
  } catch (e) {
    console.error('Obturo: history view', e);
  }
}
$('historyBtn').addEventListener('click', showHistory);
$('historyAll').addEventListener('click', showHistory);

// export: the "Export..." button of the selection bar (#bulkExport, in #bulkExtra) exports the selected captures as one file;
// export-ui.js is imported on the first click only.
$('bulkExport').addEventListener('click', async () => {
  try {
    const ids = (await loadHistory()).getSelectedIds();
    (await import('./export-ui.js')).openBatchExport(ids);
  } catch (e) {
    console.error('Obturo: grouped export', e);
  }
});

// The pin of the open shot (a pinned shot is never removed automatically).
const pinButton = /** @type {HTMLButtonElement} */ ($('pin'));

// A read-only tab (another one holds the editing lock) changes nothing: the delete buttons of the strip and the pin are disabled
// (the sheet of the history and the settings dialog do the same for what they hold).
function lockStripAndPin() {
  for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (strip.querySelectorAll('.del'))) button.disabled = true;
  pinButton.disabled = true;
  /** @type {HTMLButtonElement} */ ($('importBtn')).disabled = true; // an import adds a shot and opens it: not for a tab that does not edit
  /** @type {HTMLButtonElement} */ ($('stageImport')).disabled = true;
}
function showPin() {
  pinButton.setAttribute('aria-pressed', String(!!current?.pinned));
}

/** The pin state of shots changed, here or in the history view: the copies in memory, the strip, the button. @param {number[]} ids @param {boolean} pinned */
function applyPinned(ids, pinned) {
  for (const id of ids) {
    const s = shots.find((x) => x.id === id);
    if (s) {
      s.pinned = pinned;
      setPinMark(cellOf(id), pinned);
    }
    if (current?.id === id) current.pinned = pinned;
  }
  stripSignature = signatureOf(shots); // the strip is up to date: no need to redraw it
  showPin();
}

pinButton.addEventListener('click', async () => {
  if (!current || readOnly) return;
  const s = current;
  const pinned = !s.pinned;
  try {
    if (!(await setPinned(s.id, pinned))) { showGone(true); return; }
  } catch (e) {
    console.error('Obturo: pin failed', e);
    showBanner('hist.pin.failed');
    return;
  }
  applyPinned([s.id], pinned);
});

// A deletion is about to start (history view, settings): the editor lets go of the shot it holds, if it is one of them.
document.addEventListener('obturo:history-deleting', (e) => {
  const { ids, waits } = /** @type {CustomEvent} */ (e).detail;
  if (!current || !ids.includes(current.id)) return;
  current = null;
  openedId = null;
  showPin();
  const closing = editorPromise ? editorPromise.then((editor) => editor.close()).catch(() => {}) : Promise.resolve();
  waits.push(closing.then(() => { heldId = null; publishOpen(); }));
});
// Shots were removed (a deletion, a purge): the strip is read again, and the latest shot opens if none is.
document.addEventListener('obturo:history-changed', () => {
  refresh().then(() => { if (!current && !shots.length) { showEmpty(); hideBanner(); } });
});

// After the strip is painted and the editor open, so that none of it waits: the retention of the settings is applied (the shot
// open stays), then the history view is fetched ahead.
function afterStartup() {
  (window.requestIdleCallback ?? setTimeout)(async () => {
    try {
      if ((await runRetention(current?.id ?? null)).deleted) refresh();
    } catch (e) {
      console.error('Obturo: retention', e);
    }
    loadHistory().catch(() => {});
    import('./about-ui.js').then((m) => m.showNewsDot()).catch(() => {}); // the dot of the settings button, if there are news
  });
}

// ---------- startup ----------

const readTotal = () => countShots().then((n) => { totalCount = n; showHistoryCount(); }).catch(() => {}); // what "All history" says

async function init() {
  const lock = acquireLock(); // in parallel: the strip does not wait for it
  // The copy of the last visit gives the language and the theme at once; the settings database (a second one to open,
  // about 10 ms) only confirms them, off the critical path. Without a copy (first visit) the page waits for it.
  const copy = readAppearance();
  const settingsReady = copy ? applySettings({ ...DEFAULT_SETTINGS, ...copy }).then(reveal) : loadSettings();
  wantedId ??= shotOfHash();
  let wanted;
  try {
    // the strip reads the latest shots only (a page), not the whole history; the shot asked for may be an older one
    const [latest, asked] = await Promise.all([latestShots(RECENT), wantedId === null ? undefined : getShot(wantedId), settingsReady]);
    shots = latest.toReversed();
    totalCount = shots.length; // the real total comes once the strip is painted
    wanted = asked;
    performance.mark('obturo:strip-read');
  } catch (e) {
    console.error('Obturo: read failed', e);
    await settingsReady;
    showStageMsg('error', 'state.dbUnavailable');
    showBanner('msg.readFailed');
    return;
  }
  current = shots.find((s) => s.id === wantedId) ?? wanted ?? shots.at(-1) ?? null;
  renderStrip();
  performance.mark('obturo:strip-rendered');
  booted = true;
  const confirmCopy = () => { if (copy) setTimeout(loadSettings); }; // after the paint, or at once when there is none to wait for
  if (location.hash === '#settings') openSettings();
  if (!(await lock)) {
    readOnly = true;
    lockStripAndPin();
    showBanner('msg.readOnly');
    if (current) await view(current);
    else showStageMsg('error', 'state.readOnly', 'state.readOnly.hint');
    confirmCopy();
    readTotal();
    return;
  }
  holdsLock = true;
  // What the retention must spare from now on, even a stale shot (an old one asked for by the address). After the paint: it opens
  // the settings database (about 10 ms), which the strip does not wait for.
  const publishAfterPaint = () => setTimeout(publishOpen);
  if (!shots.length) { showEmpty(); confirmCopy(); publishAfterPaint(); afterStartup(); return; } // no shot: no total to read
  showStageMsg('loading', 'state.loadingEditor');
  // An image is painted with the strip BEFORE Fabric loads.
  await new Promise((ok) => requestAnimationFrame(() => { performance.mark('obturo:strip-painted'); confirmCopy(); publishAfterPaint(); setTimeout(ok); }));
  readTotal();
  await select(current.id, current);
  afterStartup();
}

init();
