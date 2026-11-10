import { addShot } from './db.js';
import { cropRect, cleanArea, pngSize, decodeDataUrl } from './pure.js';
import { planTiles, growPlan, pickScroller, clipBox, isCut, unscrolledKey, failureKey } from './fullpage-pure.js';
import { createStitcher } from './fullpage-stitch.js';
import { menuItems, libraryTarget, cleanNoTrace, cleanDelay, cleanPopupRun, cleanChooserEdit } from './gestures.js';
import { t, plural, addTexts, setLanguage, resolveLanguage } from './i18n.js';
import SW_TEXTS from './locales/sw.js';
import { DEFAULT_SETTINGS, getSettings, setSettings } from './settings.js';
import { removeNotice, showNotice } from './notice.js';
import { countCapture, noteInstalled } from './about.js';
import { BUS_NAME, MESSAGES } from './bus.js';

// The texts of the worker in every language (a worker cannot import() a language on demand): the menu, the tooltip, the notices.
for (const [lang, texts] of Object.entries(SW_TEXTS)) addTexts(lang, texts);

/** The captured tab, as the shot keeps it. @typedef {{ id: number, windowId: number, url?: string, title?: string }} Tab */

// At load time: constants and listeners only, no work (the service worker restarts often). The one exception is the
// rebuild of the icon menu (end of the file): asynchronous, a few messages to the browser, off the capture path.
const TILE_INTERVAL_MS = 550; // Chrome limits captureVisibleTab to 2 calls/s: 550 ms between two call starts
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Badges: green = captured and copied, orange = saved but NOT copied (no focus), violet = copied and not saved (no trace),
// red = failure, grey = capture ignored (another one is running), blue = full-page progress.
const GREEN = '#26a269', ORANGE = '#e5a50a', RED = '#c01c28', GREY = '#777', BLUE = '#1a5fb4', VIOLET = '#7c3aed';
const RESULT_BADGE_MS = 1500; // how long a result is shown
const IGNORED_BADGE_MS = 800; // how long the "capture ignored" badge is shown
const COPIED_NOTE_MS = 2500; // how long the note that says the capture was copied stays on the page
let badgeTimer;
/** @param {string} text @param {string} color @param {number} [ms] How long it is shown, 0 = until the next badge. */
const badge = (text, color, ms = RESULT_BADGE_MS) => {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (ms) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
};
const fail = (e) => { console.error('Obturo:', e); badge('ERR', RED); };
// A capture kept in the history is one more for the count behind the request for a review (about-pure.js); a lost count costs nothing.
const countKept = () => countCapture().catch((e) => console.error('Obturo:', e));

// ponytail: one capture at a time (area, visible part, full page); a capture triggered during another one is dropped with a grey badge; queue them if people ask for it.
let busy = false;
// What the capture tells on the page when it is over, in one box (a note about the cover or the page does not replace the one about the copy).
// `long`: more than the confirmation of the copy, which stays a few seconds only.
const said = { lines: /** @type {string[]} */ ([]), error: false, long: false };
let lastNote = { tabId: -1, at: 0 };
let editing = false; // the capture that runs ends in the editor ("Capture and edit"): there is no question to ask about it
// The settings a capture follows, read once when it starts: the switches can be flipped while it runs and it keeps the state it started with.
// Unreadable: the defaults (copy it, keep it, nothing hidden). The language is set here, so every text of the capture comes in the chosen one.
/** @returns {Promise<import('./settings.js').Settings>} */
const readSettings = async () => {
  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  setLanguage(resolveLanguage(settings.language, chrome.i18n.getUILanguage()));
  return settings;
};

/**
 * @param {(settings: import('./settings.js').Settings) => Promise<unknown>} job A capture; what it returns says whether the shot was saved (see `save`).
 * @param {boolean} [edit] "Capture and edit": once the shot is copied and saved, show it in the editor.
 */
const exclusive = async (job, edit) => {
  if (busy) return badge('...', GREY, IGNORED_BADGE_MS);
  busy = true;
  editing = !!edit;
  said.lines.length = 0;
  said.error = said.long = false;
  let saved;
  try { saved = await job(await readSettings()); } catch (e) { fail(e); } finally { busy = false; editing = false; }
  if (!edit || !saved) return; // nothing saved (cancelled, failed): nothing to open
  try { await openLibrary(typeof saved === 'number' ? { shot: saved } : undefined); } catch (e) { fail(e); }
};

// Promise -> true if it succeeds (or its boolean value, or what it returns), false otherwise, and never rejects.
const succeeds = (promise) => promise.then((v) => v ?? true, (e) => { console.error('Obturo:', e); return false; });

// The page that asks what to do with a capture (chooser.html): copy it, edit it, download it. A tab next to the captured one, the captured tab
// as its opener, so that closing it brings the person back to the page. No permission is needed to create a tab.
const CHOOSER_URL = chrome.runtime.getURL('chooser.html');
// With `save` the page downloads the capture by itself, in a tab that stays in the background (a worker has no DOM to write a file, and
// chrome.downloads is a permission): the person stays on the captured page, and the page only comes forward if the download fails.
/**
 * @param {number} shot The id of the capture in the history. @param {Tab} tab The captured tab. @param {boolean} [save]
 */
async function openChooser(shot, tab, save = false) {
  const url = `${CHOOSER_URL}#shot=${shot}${save ? '&save=1' : ''}`;
  try {
    return await chrome.tabs.create({ url, active: !save, openerTabId: tab.id, windowId: tab.windowId });
  } catch {
    return chrome.tabs.create({ url, active: !save }); // the captured tab is gone: the page opens in the window in use
  }
}

// Reactivates the library tab that is already open (a 2nd one would be read-only because of the navigator.locks lock),
// otherwise creates one. No extra permission: getContexts, tabs.update and windows.update do not require "tabs".
// Chrome 116 minimum. `target` (see libraryTarget): a capture to open in the editor, or the settings panel. A new tab
// gets it in its address (#shot=<id>, #settings). So does the tab that is already open when its address differs (only
// the hash changes: a hashchange, or the load of the address if the tab is still loading); when the address is already
// there, the tab is told by a message (the settings panel gets both). Several library tabs can exist (a duplicated tab):
// a capture is then only announced, and the one that may edit takes it and brings itself forward (library.js).
/** @param {{ shot?: number, settings?: boolean }} [target] */
async function openLibrary(target) {
  const lib = chrome.runtime.getURL('library.html');
  const { hash, message } = libraryTarget(target);
  const announce = () => {
    if (!message) return;
    const channel = new BroadcastChannel(BUS_NAME);
    channel.postMessage(message);
    channel.close();
  };
  const open = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] }))
    .filter((c) => c.documentUrl?.split(/[?#]/)[0] === lib); // hash and query ignored
  if (open.length > 1 && target?.shot) return announce();
  if (open[0]) {
    const here = new URL(open[0].documentUrl ?? lib);
    const navigate = hash !== '' && here.hash !== hash;
    here.hash = hash;
    const reused = await chrome.tabs.update(open[0].tabId, { active: true, ...(navigate && { url: here.href }) }).catch(() => null); // closed in the meantime
    if (reused) {
      if (!navigate || target?.settings) announce();
      return chrome.windows.update(open[0].windowId, { focused: true }).catch(() => {});
    }
  }
  await chrome.tabs.create({ url: lib + hash });
}

// The clipboard does not exist in a service worker: we write from the page of the tab.
// ponytail: the copy depends on the focus of the tab's document; when it fails (orange badge) the shot is still saved and can be copied from the library. No alternative has been tried: a document that is never focused (offscreen) is not known to be allowed to write an image to the clipboard.
// `b64` is the PNG as base64 text when the caller already has it (the capture of the visible part comes as such): it is
// passed on as it is, instead of encoding the Blob again.
async function copyToClipboard(tabId, blob, b64) {
  b64 ??= await new Promise((done) => {
    const f = new FileReader();
    f.onload = () => {
      const dataUrl = /** @type {string} */ (f.result); // readAsDataURL: "data:image/png;base64,..."
      done(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    f.readAsDataURL(blob);
  });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [b64],
    func: (b64) => {
      // The same decoding as base64Bytes (pure.js); this function is serialized into the page, nothing can be imported.
      const fromBase64 = /** @type {any} */ (Uint8Array).fromBase64;
      let bytes;
      if (fromBase64) {
        bytes = fromBase64.call(Uint8Array, b64);
      } else {
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      }
      const png = new Blob([bytes], { type: 'image/png' });
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(() => true, () => false);
    },
  });
  return result;
}

// The copy goes first (the user wants to paste right away), the IndexedDB write runs in parallel.
// Resolves with what addShot gave back (the id of the new shot), false if it was not saved.
/** @param {Tab} tab @param {import('./settings.js').Settings} settings @param {Blob} blob @param {number} w @param {number} h @param {string} [b64] The PNG as base64 text, if known. @param {number} [covered] How many sensitive items the image has covered, when it was asked to cover them. @returns {Promise<number | boolean>} */
async function save(tab, settings, blob, w, h, b64, covered) {
  // "Ask what to do" (a page offers the actions) and "Save the file" (the page downloads it): the capture is kept and nothing goes to the
  // clipboard unasked. Not in the no-trace mode (nothing is kept) and not for "Capture and edit" (the editor is the answer).
  if (settings.afterCapture !== 'copy' && !settings.noTrace && !editing) {
    const kept = await succeeds(addShot({ original: blob, url: tab.url, title: tab.title, w, h, covered }));
    if (!kept) { badge('ERR', RED); return kept; }
    badge('OK', GREEN);
    countKept();
    openChooser(/** @type {number} */ (kept), tab, settings.afterCapture === 'save').catch(fail);
    return kept;
  }
  const copied = succeeds(copyToClipboard(tab.id, blob, b64));
  if (settings.noTrace) { // no trace: the copy is the whole capture, nothing is written anywhere (so nothing to open either)
    if (await copied) { badge('OK', VIOLET); said.lines.push(t('sw.copied.noTrace')); }
    else { badge('ERR', RED); notice(tab, [t('sw.noTrace.copyFailed')], 'error'); } // the image is nowhere else: say so
    return false;
  }
  const stored = succeeds(addShot({ original: blob, url: tab.url, title: tab.title, w, h, covered }));
  if (await copied) { badge('OK', GREEN); if (!editing) said.lines.push(t('sw.copied')); }
  else { badge('!', ORANGE); said.lines.push(t('sw.copyFailed')); said.error = true; }
  const saved = await stored;
  if (saved) countKept();
  else badge('ERR', RED);
  return saved;
}

// PNG of the visible part of the tab (not decoded): the Blob, and the base64 text it was made from, which the clipboard
// copy takes as it is. The data URL is decoded here and not through fetch(), which costs about 40 ms per MB (see pure.js).
async function grabTabPng(tab) {
  const { b64, bytes } = decodeDataUrl(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
  return { blob: new Blob([bytes], { type: 'image/png' }), b64 };
}

/** @param {Tab} tab @param {import('./settings.js').Settings} settings @param {{ rect: import('./versions.js').Rect, vw: number, vh: number }} [area] An area, absent for the visible part. @param {boolean} [covered] The sensitive text is covered: it is uncovered as soon as the image is taken. */
async function shoot(tab, settings, area, covered) {
  await dropNote(tab);
  let { blob, b64 } = await grabTabPng(tab);
  if (covered) await uncover(tab);
  const hidden = covered ? await coveredCount(tab) : undefined;
  let { w, h } = await pngSize(blob); // PNG header, no decoding
  if (area) {
    const c = cropRect(area.rect, area.vw, area.vh, w, h);
    if (c.w < 1 || c.h < 1) throw new Error('area outside the page');
    const bmp = await createImageBitmap(blob, c.x, c.y, c.w, c.h); // a single decode, already cropped
    const out = new OffscreenCanvas(c.w, c.h);
    const ctx = out.getContext('2d', { willReadFrequently: true }); // CPU canvas, see openCanvas in fullpage-stitch.js
    if (!ctx) { bmp.close(); throw new Error('2D context unavailable'); }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    blob = await out.convertToBlob({ type: 'image/png' });
    b64 = undefined; // the cropped image is another PNG
    w = c.w; h = c.h;
  }
  return save(tab, settings, blob, w, h, b64, hidden);
}
/** @param {Tab} tab @param {{ rect: import('./versions.js').Rect, vw: number, vh: number }} [area] @param {boolean} [edit] */
const capture = (tab, area, edit) => exclusive(async (settings) => {
  const saved = await hiding(tab, settings, (covered) => shoot(tab, settings, area, covered), area?.rect);
  await saySo(tab);
  return saved;
}, edit);

// ---------- sensitive text ----------

// With "Hide sensitive text" on, redact.js covers in black what sensitive.js finds in the text of the page, for the length of one image.
// An image is never taken with the text showing: when the cover cannot be put up, the capture fails (red badge).
/** Calls a method of redact.js in the page of the tab. @param {Tab} tab @param {'apply' | 'clear' | 'result'} method @param {...unknown} args */
function callRedact(tab, method, ...args) {
  return chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: /** @param {'apply' | 'clear' | 'result'} m @param {any[]} a */ (m, a) => /** @type {any} */ (window).__obturoRedact[m](...a),
    args: [method, args],
  }).then(([r]) => r?.result);
}
const injectRedact = (tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['sensitive.js', 'redact.js'] });
// The page goes back to what it was; a tab that is gone has nothing to put back.
const uncover = (tab) => callRedact(tab, 'clear').catch(() => {});

/** How many sensitive items the image has covered, undefined when the page cannot say. @param {Tab} tab */
const coveredCount = async (tab) => (await callRedact(tab, 'result').catch(() => null))?.hidden;

/** What the capture tells the user about the hiding: how many items, that there were none, that the search was cut short. @param {Tab} tab */
async function redactNote(tab) {
  const r = await callRedact(tab, 'result').catch(() => null);
  if (!r) return [];
  return [r.hidden ? plural(r.hidden, 'sw.redact.one', 'sw.redact.other') : t('sw.redact.none'), ...(r.incomplete ? [t('sw.redact.partial')] : [])];
}

/**
 * Runs a capture of one image, `job(covered)`, with the sensitive text covered when the settings ask for it, then says what was hidden.
 * @param {Tab} tab @param {import('./settings.js').Settings} settings @param {(covered: boolean) => Promise<unknown>} job @param {import('./versions.js').Rect} [region] The part of the window the image keeps (an area).
 */
async function hiding(tab, settings, job, region) {
  if (!settings.redactSensitive) return job(false);
  await injectRedact(tab);
  await callRedact(tab, 'apply', region);
  let saved;
  try {
    saved = await job(true);
  } finally {
    await uncover(tab);
  }
  const lines = await redactNote(tab);
  said.lines.push(...lines);
  if (lines.length) said.long = true;
  return saved;
}

// ---------- full page ----------

// The tab must stay active in its window during the WHOLE capture, checked before AND after each captureVisibleTab
// (otherwise we would capture another tab or a resized window).
const stillThere = async (tab) => {
  const t = await chrome.tabs.get(tab.id);
  return t.active && t.windowId === tab.windowId;
};
async function grabTabPngChecked(tab) {
  if (!(await stillThere(tab))) throw new Error('tab changed during the capture');
  const { blob } = await grabTabPng(tab);
  if (!(await stillThere(tab))) throw new Error('tab changed during the capture');
  return blob;
}

/**
 * What a full page scrolls and where it shows: what fullpage.js measured (`box`: its content area in the window, `max`: how far it
 * scrolls), `vis`: the part of that box inside the window, `view`: its height (one tile, CSS px), `inner`: a scroller, not the document.
 * @typedef {FullPageMeasure & { vis: import('./versions.js').Rect, view: number, inner: boolean }} Target
 */
// Same box, give or take 2 CSS px (layout rounding).
const sameBox = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= 2);

/**
 * Calls a method of fullpage.js in the page of the tab.
 * @param {Tab} tab
 * @param {'begin' | 'aim' | 'go' | 'size' | 'end'} method
 * @param {...unknown} args
 * @returns {Promise<any>} What the method returns: FullPageScan (begin), FullPageMeasure (aim), FullPageStep (go), { max } (size), boolean (end).
 */
function callPage(tab, method, ...args) {
  return chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: /** @param {'begin' | 'aim' | 'go' | 'size' | 'end'} m @param {any[]} a */ (m, a) => /** @type {any} */ (window.__obturoFull)[m](...a),
    args: [method, args],
  }).then(([r]) => {
    if (r?.result == null) throw new Error(`page did not answer (${method})`);
    return r.result;
  });
}

// We scroll, capture each tile, paste it into the canvas right away and close its bitmap (never more than one decoded
// tile at a time).
// Memory of the extension process, MEASURED (Chromium 143, WorkingSet peak minus the 45 MB idle state): +277 MB for a
// 22.8 Mpx canvas (1080p tiles), +629 MB for 32 Mpx (4K tiles of 7.5 Mpx), i.e. 12 to 20 bytes per pixel of final
// canvas (pixels + copy during the PNG encoding + decoded tile). MAX_PIXELS (pure.js) caps it at 32 Mpx: peak ~400 MB
// (1080p tiles) to ~680 MB (4K tiles), released at the end of the capture. To go lower still, lower MAX_PIXELS.
// Duration: ~550 ms per tile (2 calls/s limit), the settling time of the page is covered by that wait.
// What the capture does not handle (iframes, several scrolling columns, animations) is listed in fullpage.js and fullpage-pure.js.
// What is scrolled is the document or, for a web application that keeps the document still, a scroller inside it (pickScroller).
// Tiles are positions of its scroll: the tile at `y` shows, in the box of the target, the content from `y` down.
// What the image is not (cut, reduced, the visible part only) or why the capture stopped goes into `notes`, said on the page at the end.
/** @param {Tab} tab @param {import('./settings.js').Settings} settings @param {string[]} notes */
async function fullPageTiles(tab, settings, notes) {
  try {
    if (settings.redactSensitive) await injectRedact(tab);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fullpage.js'] });
    const scan = /** @type {FullPageScan} */ (await callPage(tab, 'begin', { wait: settings.fullPageWait, fixed: settings.fullPageFixed }));
    const pick = pickScroller(scan.cands, scan.doc, scan.vw, scan.vh);
    const aimed = /** @type {FullPageMeasure} */ (await callPage(tab, 'aim', pick));
    const vis = clipBox(aimed.box, aimed.vw, aimed.vh); // a tile shows the part of the target that is in the window
    /** @type {Target} */
    const m = { ...aimed, vis, view: vis.h, inner: pick >= 0 };
    let plan = planTiles(m.max + m.view, m.view, m.dpr);
    if (plan.ys.length < 2) { // no vertical overflow: the visible part, and a word if the page looks like it has more
      const key = unscrolledKey(scan);
      if (key) notes.push(t(key));
      if (settings.redactSensitive) await callRedact(tab, 'apply');
      return await shoot(tab, settings, undefined, settings.redactSensitive);
    }

    const tol = 1 / m.dpr + 1; // the browser snaps a scroll to a device pixel
    let stitcher;
    let lastCallAt = 0;
    let lastMax = m.max; // how far the target scrolled when it was last looked at: the page is cut if it is longer than the plan

    // Positions the target and checks that nothing moved under the capture.
    const place = async (y, phase) => {
      const r = /** @type {FullPageStep} */ (await callPage(tab, 'go', y, phase));
      if (r.cancelled) return r; // Escape during the capture
      lastMax = r.max;
      if (r.vh !== m.vh) throw new Error('window resized or zoom changed during the capture');
      if (m.inner && !sameBox(r.box, m.box)) throw new Error('scrolled area moved during the capture');
      return r;
    };
    // The target may grow while the tiles are taken (lazy loading, infinite scroll): the plan is made again and the canvas
    // follows, as far as the limits allow. Returns the index of the next tile in the new plan, -1 if nothing changed.
    // ponytail: growth is noticed when a tile is positioned (about 120 ms after the scroll) and once after the last tile; content that arrives later is cut. Wait for the network to be idle.
    const regrow = (max, y) => {
      const g = growPlan(plan, max + m.view, m.view, m.dpr, y);
      if (!g || (stitcher && !stitcher.extend(g.covered))) return -1;
      plan = g;
      return g.next;
    };

    for (let i = 0; i >= 0 && i < plan.ys.length;) {
      const y = plan.ys[i];
      const phase = i === 0 ? 'first' : i === plan.ys.length - 1 ? 'last' : 'mid';
      badge(`${i + 1}/${plan.ys.length}`, BLUE, 0);
      let r = await place(y, phase);
      let next = r.cancelled ? -1 : regrow(r.max, y);
      if (next >= 0 && phase === 'last') r = await place(y, 'mid'); // no longer the last tile: what is anchored at the bottom stays hidden
      if (r.cancelled) { badge('', GREY, 0); return; }
      // r.y short of y: the bottom is here (the content shrank, or the target does not scroll)
      if (next < 0) next = phase === 'last' || r.y < y - tol ? plan.ys.length : i + 1;
      // the page settling (go) already covered part of the wait; max(0): a huge negative delay
      // (lastCallAt = 0 on the 1st tile) is converted to a 32-bit integer by setTimeout and never ends
      await sleep(Math.max(0, lastCallAt + TILE_INTERVAL_MS - Date.now()));
      if (settings.redactSensitive) await callRedact(tab, 'apply'); // content that loaded while the page scrolled is covered too; before lastCallAt: the search does not count in the two calls a second
      lastCallAt = Date.now();
      const bmp = await createImageBitmap(await grabTabPngChecked(tab));
      try {
        stitcher ??= createStitcher(bmp, m, plan.covered);
      } catch (e) {
        bmp.close();
        throw e;
      }
      stitcher.paste(bmp, r.y);
      i = next;
      // what the last tile triggers (lazy loading) often arrives after it was positioned: one more look before stopping
      if (i >= plan.ys.length) {
        lastMax = (await callPage(tab, 'size')).max;
        i = regrow(lastMax, y);
      }
    }
    await callPage(tab, 'end'); // the page is put back in order before the encoding, which can take long
    const { blob, w, h, k } = await stitcher.finish();
    if (isCut(plan.covered, lastMax + m.view)) notes.push(t('sw.full.cut'));
    if (k < 0.995) notes.push(t('sw.full.scaled', { n: Math.round(k * 100) }));
    return await save(tab, settings, blob, w, h, undefined, settings.redactSensitive ? await coveredCount(tab) : undefined);
  } finally {
    await callPage(tab, 'end').catch(() => {}); // idempotent: safety net if an error interrupted the loop
    if (settings.redactSensitive) await uncover(tab);
  }
}

/**
 * Says something to the user on the page of the tab: a box for a few seconds (notice.js). Never throws: a page that cannot be
 * scripted any more (closed, navigated away) has nobody to tell, and the badge already says what happened.
 * @param {Tab} tab @param {string[]} lines @param {'info' | 'error'} [tone] @param {number} [ms] see showNotice
 */
async function notice(tab, lines, tone = 'info', ms) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showNotice, args: ['Obturo', lines.join(' '), tone, ms ?? null] });
  } catch { /* nobody to tell */ }
}

/** The one box of the end of a capture: the copy, the cover, the page. @param {Tab} tab */
async function saySo(tab) {
  if (!said.lines.length) return;
  const lines = said.lines.splice(0);
  lastNote = { tabId: tab.id, at: Date.now() };
  await notice(tab, lines, said.error ? 'error' : 'info', said.long ? undefined : COPIED_NOTE_MS);
}

// A short note must not be in the image of the capture that follows it.
const dropNote = (tab) => (lastNote.tabId === tab.id && Date.now() - lastNote.at < COPIED_NOTE_MS + 500
  ? chrome.scripting.executeScript({ target: { tabId: tab.id }, func: removeNotice }).catch(() => {})
  : undefined);

// The full page, and what it tells the user: in the language of the settings, once the page is back in order (the box must not be
// in the image). A capture that stops says why and is still a failure (red badge, nothing saved).
/** @param {Tab} tab @param {import('./settings.js').Settings} settings */
async function fullPage(tab, settings) {
  /** @type {string[]} */
  const notes = [];
  let saved;
  try {
    saved = await fullPageTiles(tab, settings, notes);
  } catch (e) {
    await notice(tab, [t(failureKey(e))], 'error');
    throw e;
  }
  if (saved !== undefined && settings.redactSensitive) notes.push(...await redactNote(tab));
  if (notes.length) said.long = true;
  said.lines.push(...notes);
  await saySo(tab);
  return saved;
}
/** @param {Tab} tab @param {boolean} [edit] */
const captureFull = (tab, edit) => exclusive((settings) => fullPage(tab, settings), edit);

// ---------- user gestures ----------

// No flag while the overlay is open (it would stay stuck after an Escape): we only refuse to open one while a capture
// is running. `edit` ("capture and edit") is written on the overlay element, which carries it back in its message: the
// service worker may be stopped while the user is still selecting, so nothing is kept in memory.
// An element pick (element.js) works the same way: it answers with the same message, the box of the element being the area.
// ponytail: an overlay that is already open keeps its mode when a second gesture asks for the other one; send both modes through the injection if people mix them up.
/** @param {Tab} tab @param {string} file The script that selects. @param {string} id The id of the element it adds to the page. @param {boolean} edit */
const startPicker = async (tab, file, id, edit) => {
  if (busy) return badge('...', GREY, IGNORED_BADGE_MS);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    if (edit) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (id) => window.document.getElementById(id)?.setAttribute('data-edit', '1'),
        args: [id],
      });
    }
  } catch (e) {
    fail(e);
  }
};
const startArea = (tab, edit = false) => startPicker(tab, 'overlay.js', 'obturo-overlay', edit);
const startElement = (tab, edit = false) => startPicker(tab, 'element.js', 'obturo-element', edit);

// The delay before a capture: the badge counts the seconds down and the page stays usable, so that a menu or a tooltip can be opened. Any
// capture gesture during the wait cancels it. The worker stays awake: every tick is a call to the badge API, which restarts its idle timer.
/** @type {{ cancelled: boolean } | null} */
let countdown = null;
const cancelCountdown = () => {
  if (countdown) countdown.cancelled = true;
  countdown = null;
  badge('', GREY, 0);
};
/**
 * Waits `seconds` (none: no wait). Resolves false when the capture must not go on: cancelled, another one is running,
 * or the tab is no longer the one in front (captureVisibleTab would take another).
 * @param {Tab} tab @param {number} seconds
 */
async function afterDelay(tab, seconds) {
  if (!seconds) return true;
  if (busy) return void badge('...', GREY, IGNORED_BADGE_MS);
  const mine = (countdown = { cancelled: false });
  for (let left = seconds; left > 0 && !mine.cancelled; left--) {
    badge(String(left), BLUE, 0);
    await sleep(1000);
  }
  if (countdown === mine) countdown = null;
  if (mine.cancelled) return false;
  badge('', GREY, 0);
  return stillThere(tab).catch(() => false);
}

// One table for the keyboard shortcuts (manifest commands) and the icon menu: the name of a command is also the id of
// its menu entry (see gestures.js).
const ACTIONS = {
  'capture-area': (tab) => startArea(tab),
  'capture-visible': (tab) => capture(tab),
  'capture-full': (tab) => captureFull(tab),
  'capture-element': (tab) => startElement(tab),
  'capture-area-edit': (tab) => startArea(tab, true),
  'capture-visible-edit': (tab) => capture(tab, undefined, true),
  'capture-full-edit': (tab) => captureFull(tab, true),
  'capture-element-edit': (tab) => startElement(tab, true),
  'open-library': () => openLibrary(),
  'open-settings': () => openLibrary({ settings: true }),
};
/** @param {string} name Command or menu entry. @param {any} [tab] The active tab (chrome.tabs.Tab). */
const run = async (name, tab) => {
  if (!Object.hasOwn(ACTIONS, name)) return undefined;
  if (!name.startsWith('capture-')) return ACTIONS[name](tab);
  if (countdown) return cancelCountdown();
  const settings = await readSettings();
  // "and edit" opens the capture in the library: with no trace there is none to open, and the person is told why
  if (name.endsWith('-edit') && settings.noTrace) {
    if (tab) await notice(tab, [t('sw.noTrace.edit')]);
    return undefined;
  }
  if (!(await afterDelay(tab, settings.captureDelay))) return undefined;
  return ACTIONS[name](tab);
};

chrome.commands.onCommand.addListener(run);
chrome.contextMenus.onClicked.addListener((info, tab) => run(String(info.menuItemId), tab));

// ---------- left-click popup ----------

// A click on a row of popup.html sends { type: 'popup-run', id, tab } and closes the popup. The popup has to be gone, and the page
// back in focus, before an action starts: the copy to the clipboard and the Escape of the area selection need the focus of the
// page. So we wait a moment, then check that the tab is still the active one of its window, give its window the focus if it
// lacks it, and run the action through the same table as the shortcuts and the menu (`run`: same busy flag, same badges).
const POPUP_SETTLE_MS = 150; // ponytail: a fixed wait, enough for the popup to close on the machines tried; wait for the focus of the tab's document (a message from the page) if copies fail after a popup click.
/** @param {{ id: string, tab?: Tab }} request */
async function runFromPopup({ id, tab }) {
  await sleep(POPUP_SETTLE_MS);
  if (!tab) return run(id);
  const live = await chrome.tabs.get(tab.id).catch(() => null); // address and title as the browser has them now, not as the message says
  if (!live || !live.active || live.windowId !== tab.windowId) return; // closed, moved or left in the meantime: nothing is captured by mistake
  const win = await chrome.windows.get(live.windowId).catch(() => null);
  if (win && !win.focused) await chrome.windows.update(live.windowId, { focused: true }).catch(() => {}); // only when it lacks it
  return run(id, { id: live.id, windowId: live.windowId, url: live.url ?? tab.url, title: live.title ?? tab.title });
}

// Message from the popup: from the extension itself, from the popup page and not from a tab (a content script or the overlay
// has sender.tab). Answers at once (true = accepted) so that the popup knows the worker has it before it closes.
const POPUP_URL = chrome.runtime.getURL('popup.html');
/** @param {chrome.runtime.MessageSender} sender */
const isFromPopup = (sender) => sender.id === chrome.runtime.id && !sender.tab && sender.url === POPUP_URL;
/** @param {any} m @param {chrome.runtime.MessageSender} sender @param {(accepted: boolean) => void} respond */
function onPopupRun(m, sender, respond) {
  const request = isFromPopup(sender) ? cleanPopupRun(m) : null;
  respond(!!request);
  if (request) runFromPopup(request).catch(fail);
}

// Message from the popup: its no-trace switch was flipped. Same sender rule as above. The setting is stored here (the worker then
// rebuilds the menu, the tooltip and the icon, which follow it); the popup shows the state it asked for and takes it back if told no.
/** @param {any} m @param {chrome.runtime.MessageSender} sender @param {(accepted: boolean) => void} respond */
function onPopupNoTrace(m, sender, respond) {
  const value = isFromPopup(sender) ? cleanNoTrace(m) : null;
  if (value === null) return respond(false);
  setSettings({ noTrace: value }).then(() => respond(true), (e) => { fail(e); respond(false); });
  return true; // the answer comes once the setting is stored
}

// Message from the popup: its delay control was changed. Same sender rule and same answer as the no-trace switch.
/** @param {any} m @param {chrome.runtime.MessageSender} sender @param {(accepted: boolean) => void} respond */
function onPopupDelay(m, sender, respond) {
  const value = isFromPopup(sender) ? cleanDelay(m) : null;
  if (value === null) return respond(false);
  setSettings({ captureDelay: value }).then(() => respond(true), (e) => { fail(e); respond(false); });
  return true; // the answer comes once the setting is stored
}

// Message from the window of actions after a capture: "Edit". Only from that page of the extension (its address, with its #shot).
// The answer comes once the editor is open, so that the window of actions closes after it and not over it.
/** @param {any} m @param {chrome.runtime.MessageSender} sender @param {(accepted: boolean) => void} respond */
function onChooserEdit(m, sender, respond) {
  const id = sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === CHOOSER_URL ? cleanChooserEdit(m) : null;
  if (!id) return void respond(false);
  openLibrary({ shot: id }).then(() => respond(true), (e) => { fail(e); respond(false); });
  return true; // the answer comes once the editor is open
}

// Message from the overlay: only from the main frame of a tab, shape validated before any computation.
function onMessage(m, sender, respond) {
  if (m?.type === MESSAGES.settingsChanged) return void rebuildMenu(); // sent by pages that want the stopped worker to wake up
  if (m?.type === 'popup-run') return onPopupRun(m, sender, respond);
  if (m?.type === 'popup-notrace') return onPopupNoTrace(m, sender, respond);
  if (m?.type === 'popup-delay') return onPopupDelay(m, sender, respond);
  if (m?.type === 'chooser-edit') return onChooserEdit(m, sender, respond);
  if (m?.type !== 'area' || sender.frameId !== 0 || !sender.tab) return;
  const area = cleanArea(m);
  if (!area) return;
  const { id, windowId, url, title } = sender.tab; // too long an address or title: db.js cuts them, for every kind of capture
  capture({ id, windowId, url: String(url || m.url || ''), title: String(title || m.title || '') }, area, m.edit === true);
}
chrome.runtime.onMessage.addListener(onMessage);

// ---------- right-click menu on the icon ----------

// The menu is rebuilt (removeAll first, so the same id is never created twice) at every start of the worker, which
// covers the installation, an update, a reload and the first event after a restart of the browser, then when the
// settings change (language). Chrome keeps the entries between two runs of the worker, so a rebuild is the only way to be sure
// of what is there; it is done one entry at a time, each one created once the previous answer is in: a parent always exists
// before its children, and no two rebuilds interleave their calls. Requests that arrive during a rebuild (the start, onInstalled,
// onStartup and 'settings-changed' come within milliseconds) are served by ONE more pass after it, that reads the settings
// as they are then. A BroadcastChannel message only reaches a worker that is awake; the one that wakes it is the runtime message above.
// The tooltip of the icon follows the chosen language too: the manifest's one (__MSG_actionTitle__) follows the browser's
// language only, so it is set here, at every start like the menu. (The description of the extension and those of the
// shortcuts come from the manifest only: no API changes them, they keep the browser's language.)
const MENU_SETTLE_MS = 30; // lets the start-up events of the worker pile up behind the pass that is waiting
/** Logs the error of the last call to chrome.contextMenus, if any (it must be read in the callback). @param {string} what */
const menuError = (what) => {
  const e = chrome.runtime.lastError;
  if (e) console.error(`Obturo: ${what}: ${e.message}`);
};
// Callback forms: the promise forms exist only since Chrome 123.
const removeAllMenus = () => new Promise((done) => chrome.contextMenus.removeAll(() => { menuError('removeAll'); done(undefined); }));
/** @param {chrome.contextMenus.CreateProperties} item */
const createMenu = (item) => new Promise((done) => chrome.contextMenus.create(item, () => { menuError(`create ${item.id}`); done(undefined); }));

// While the no-trace mode is on the icon is violet and the tooltip says so (the mode must not be forgotten), and "Capture and edit"
// is greyed out in the menu (nothing is saved, so there is nothing to edit).
const ICONS = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
const NO_TRACE_ICONS = { 16: 'icons/notrace16.png', 32: 'icons/notrace32.png' };

async function buildMenu() {
  const settings = await getSettings().catch(() => null); // no settings: the browser language
  setLanguage(resolveLanguage(settings?.language ?? 'auto', chrome.i18n.getUILanguage()));
  const noTrace = !!settings?.noTrace;
  chrome.action.setTitle({ title: noTrace ? `${t('sw.actionTitle')} (${t('sw.noTrace.title')})` : t('sw.actionTitle') });
  chrome.action.setIcon({ path: noTrace ? NO_TRACE_ICONS : ICONS }).catch((e) => console.error('Obturo: icon', e));
  await removeAllMenus();
  for (const item of menuItems(t)) await createMenu(noTrace && item.id === 'capture-edit' ? { ...item, enabled: false } : item);
}
let menuChain = Promise.resolve();
let menuWaiting = false; // a pass is queued and has not started yet: it will see whatever changed until it does
function rebuildMenu() {
  if (menuWaiting) return menuChain;
  menuWaiting = true;
  menuChain = menuChain
    .then(() => sleep(MENU_SETTLE_MS))
    .then(() => { menuWaiting = false; return buildMenu(); })
    .catch((e) => console.error('Obturo:', e));
  return menuChain;
}
rebuildMenu();
// A worker that stopped during a capture (crash, reload, update) leaves its badge behind: the "3/9" of a full page would
// stay until the next capture. A worker that starts has no capture running, so whatever the badge says is stale.
chrome.action.setBadgeText({ text: '' });
chrome.runtime.onInstalled.addListener(rebuildMenu);
chrome.runtime.onInstalled.addListener((details) => noteInstalled(details).catch((e) => console.error('Obturo:', e)));
chrome.runtime.onStartup.addListener(rebuildMenu);
const settingsChannel = new BroadcastChannel(BUS_NAME);
settingsChannel.onmessage = (e) => { if (e.data?.type === MESSAGES.settingsChanged) rebuildMenu(); };
