// The popup that a left click on the icon opens: the actions of the icon menu, each with its icon and its keyboard shortcut.
// Quick on purpose (budget: 100 ms from opening to the first complete paint, see scripts/bench.mjs): no database, nothing
// but the copy of the language and the theme in localStorage (settings.js), and the shortcuts from chrome.commands. The
// page is hidden (class "pending") until the rows are in.
//
// A click sends { type: 'popup-run', id, tab } to the service worker and closes the popup; the worker waits for the page to get
// its focus back, then runs the action (sw.js).
import { CAPTURE_DELAYS, POPUP_ICONS, popupGroups, popupLanguage, shortcutKeys } from './gestures.js';
import TEXTS from './locales/popup.js';
import { APPEARANCE_KEY } from './bus.js';

// The texts of the rows are the 'menu.*' ones of the icon menu, with the 'popup.*' ones: only these two small parts of each language
// are loaded (locales/popup.js, not i18n.js with the whole interface of the library, which costs a few dozen milliseconds when the
// browser is cold), statically: an import() on demand came too late on a cold start (see locales/popup.js).
let lang = 'en';
const t = (/** @type {string} */ key) => TEXTS[lang]?.[key] ?? TEXTS.en[key] ?? key;

const SVG = 'http://www.w3.org/2000/svg';
/** An icon of the sprite in popup.html. @param {string} name */
function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const menu = /** @type {HTMLElement} */ (document.getElementById('menu'));
/** @type {HTMLButtonElement[]} */
const items = [];
let sent = false; // one click is enough: the popup closes right after it
let noTrace = false; // the no-trace switch: from the copy at opening, then what the person flips
let flipping = false; // a flip is being stored
let delay = 0; // the delay before a capture, in seconds: from the copy at opening, then what the person picks
let picking = false; // a choice of delay is being stored

/** @param {string} id The action. */
async function run(id) {
  if (sent) return;
  sent = true;
  for (const item of items) item.setAttribute('aria-disabled', 'true');
  try {
    // activeTab is granted to the active tab of the window by the opening of the popup
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({ type: 'popup-run', id, tab: tab && { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title } });
  } catch (e) {
    console.error('Obturo:', e);
  }
  window.close();
}

// Two plain links under the list of actions: the page of the browser that lists the extensions, and the one where their keyboard
// shortcuts are set (the three "and edit" actions have no key until the user gives one). They open a tab; the worker is not involved.
// ponytail: 'chrome://' also resolves in the Chromium browsers that rename the page (Vivaldi, Edge, Brave); pick the scheme from the user agent if one stops doing it.
const LINKS = [
  { id: 'manage-extensions', title: 'popup.manage', icon: 'puzzle', url: 'chrome://extensions' },
  { id: 'extension-shortcuts', title: 'popup.shortcuts', icon: 'keyboard', url: 'chrome://extensions/shortcuts' },
];

/** @param {string} url */
async function openPage(url) {
  if (sent) return;
  sent = true;
  try {
    await chrome.tabs.create({ url });
  } catch (e) {
    console.error('Obturo:', e);
  }
  window.close();
}

function links() {
  const nav = /** @type {HTMLElement} */ (document.getElementById('links'));
  nav.setAttribute('aria-label', t('popup.links'));
  for (const def of LINKS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    button.dataset.id = def.id;
    button.append(icon(def.icon), t(def.title));
    button.addEventListener('click', () => openPage(def.url));
    nav.append(button);
  }
}

/** @param {{ id: string, title: string }} def @param {string[]} keys @param {string} shortcut */
function row(def, keys, shortcut) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'item';
  button.dataset.id = def.id;
  button.setAttribute('role', 'menuitem');
  button.setAttribute('aria-label', t(def.title));
  button.tabIndex = -1;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t(def.title);
  button.append(icon(POPUP_ICONS[def.id]), label);
  if (keys.length) {
    const box = document.createElement('span');
    box.className = 'keys';
    box.setAttribute('aria-hidden', 'true'); // read through aria-keyshortcuts
    for (const key of keys) {
      const cap = document.createElement('kbd');
      cap.textContent = key;
      box.append(cap);
    }
    button.setAttribute('aria-keyshortcuts', shortcut);
    button.append(box);
  }
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') !== 'true') run(def.id); // "and edit" is off while no trace is on
  });
  return button;
}

// The no-trace switch under the actions: a setting and not an action, so the popup stays open. The copy of the settings that the pages
// read is written here at once (the popup has localStorage, the worker has not), and the worker is asked to store the setting, change
// the icon and the menu. If the worker does not take it, the switch goes back to what is stored.
/** @param {boolean} on */
function paintNoTrace(on) {
  document.querySelector('[data-id="no-trace"]')?.setAttribute('aria-checked', String(on));
  const hint = /** @type {HTMLElement} */ (document.getElementById('no-trace-hint'));
  hint.hidden = !on;
  for (const item of items) {
    if (!item.dataset.id?.endsWith('-edit')) continue;
    if (on) item.setAttribute('aria-disabled', 'true');
    else item.removeAttribute('aria-disabled');
  }
}

/** @param {Record<string, unknown>} patch */
function writeCopy(patch) {
  try {
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null');
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ ...(raw && typeof raw === 'object' ? raw : {}), ...patch }));
  } catch { /* no localStorage, or not JSON: the worker has the setting all the same */ }
}

/** @param {boolean} on */
function setNoTrace(on) {
  noTrace = on;
  writeCopy({ noTrace: on });
  paintNoTrace(on);
}

async function flipNoTrace() {
  if (flipping) return;
  flipping = true;
  const wanted = !noTrace;
  setNoTrace(wanted);
  let taken = false;
  try {
    taken = (await chrome.runtime.sendMessage({ type: 'popup-notrace', value: wanted })) === true;
  } catch (e) {
    console.error('Obturo:', e);
  }
  if (!taken) setNoTrace(!wanted);
  flipping = false;
}

function noTraceGroup() {
  const box = document.createElement('div');
  box.className = 'group';
  box.setAttribute('role', 'group');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'item';
  button.dataset.id = 'no-trace';
  button.setAttribute('role', 'menuitemcheckbox');
  button.setAttribute('aria-label', t('popup.noTrace'));
  button.setAttribute('aria-describedby', 'no-trace-hint');
  button.tabIndex = -1;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t('popup.noTrace');
  const knob = document.createElement('span');
  knob.className = 'switch';
  knob.setAttribute('aria-hidden', 'true');
  button.append(icon('notrace'), label, knob);
  button.addEventListener('click', flipNoTrace);
  const hint = document.createElement('p');
  hint.className = 'group-hint';
  hint.id = 'no-trace-hint';
  hint.textContent = t('popup.noTraceHint');
  items.push(button);
  box.append(button, hint);
  return box;
}

// The delay before a capture, under the switch: one row that goes through the choices (none, 3, 5, 10 s) at each click, stored the same way
// as the switch. The popup stays open: the delay only matters for the next capture.
/** @param {number} seconds */
function paintDelay(seconds) {
  const button = /** @type {HTMLElement} */ (document.querySelector('[data-id="capture-delay"]'));
  const value = seconds ? t('popup.delayValue').replace('{n}', String(seconds)) : t('popup.delayOff');
  /** @type {HTMLElement} */ (button.querySelector('.value')).textContent = value;
  button.setAttribute('aria-label', `${t('popup.delay')}: ${value}`);
  button.classList.toggle('on', seconds > 0);
}

/** @param {number} seconds */
function setDelay(seconds) {
  delay = seconds;
  writeCopy({ captureDelay: seconds });
  paintDelay(seconds);
}

async function nextDelay() {
  if (picking) return;
  picking = true;
  const was = delay;
  const wanted = CAPTURE_DELAYS[(CAPTURE_DELAYS.indexOf(was) + 1) % CAPTURE_DELAYS.length];
  setDelay(wanted);
  let taken = false;
  try {
    taken = (await chrome.runtime.sendMessage({ type: 'popup-delay', value: wanted })) === true;
  } catch (e) {
    console.error('Obturo:', e);
  }
  if (!taken) setDelay(was);
  picking = false;
}

function delayGroup() {
  const box = document.createElement('div');
  box.className = 'group';
  box.setAttribute('role', 'group');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'item';
  button.dataset.id = 'capture-delay';
  button.setAttribute('role', 'menuitem');
  button.tabIndex = -1;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t('popup.delay');
  const value = document.createElement('span');
  value.className = 'value';
  value.setAttribute('aria-hidden', 'true'); // read through aria-label
  button.append(icon('timer'), label, value);
  button.addEventListener('click', nextDelay);
  items.push(button);
  box.append(button);
  return box;
}

// Arrows, Home and End move between the rows (the list is one tab stop); Enter and Space click, as on any button; Escape closes.
document.addEventListener('keydown', (e) => {
  document.documentElement.classList.remove('mouse', 'idle');
  const at = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement)); // -1: nothing focused yet
  const move = { ArrowDown: at + 1, ArrowUp: at < 0 ? items.length - 1 : at - 1, Home: 0, End: items.length - 1 }[e.key];
  if (e.key === 'Escape') window.close();
  if (move === undefined) return;
  e.preventDefault();
  items[(move + items.length) % items.length].focus();
});
// The pointer lights the row under it (the focus moves with it); a key brings the focus ring back. At opening the first row has the
// focus (Enter runs it) but is not lit ("idle"): it would read as a mode already chosen.
document.addEventListener('pointermove', (e) => {
  document.documentElement.classList.add('mouse');
  const row = e.target instanceof Element ? e.target.closest('.item') : null;
  if (!row) return;
  document.documentElement.classList.remove('idle');
  if (row !== document.activeElement) /** @type {HTMLElement} */ (row).focus();
});
menu.addEventListener('focusin', (e) => {
  for (const item of items) item.tabIndex = item === e.target ? 0 : -1;
});

async function init() {
  // the copy of the language that settings.js keeps in localStorage (the library or the worker wrote it); none yet: the browser's
  let copy = null;
  try { copy = localStorage.getItem(APPEARANCE_KEY); } catch { /* no localStorage: the browser's language */ }
  lang = popupLanguage(copy, chrome.i18n.getUILanguage());
  try {
    const saved = JSON.parse(copy ?? 'null');
    noTrace = saved?.noTrace === true;
    delay = CAPTURE_DELAYS.includes(saved?.captureDelay) ? saved.captureDelay : 0;
  } catch { /* not JSON: off */ }
  document.documentElement.lang = lang;
  menu.setAttribute('aria-label', t('popup.menu'));
  /** @type {Record<string, string>} */
  const shortcuts = {};
  try {
    for (const c of await chrome.commands.getAll()) if (c.name && c.shortcut) shortcuts[c.name] = c.shortcut;
  } catch (e) {
    console.error('Obturo:', e); // no shortcut shown, the rows still work
  }
  performance.mark('obturo:popup-keys');
  const frame = document.createDocumentFragment();
  for (const [n, group] of popupGroups().entries()) {
    const box = document.createElement('div');
    box.className = 'group';
    box.setAttribute('role', 'group');
    if (group.title) {
      const title = document.createElement('p');
      title.className = 'group-title';
      title.id = `group-${n}`;
      title.textContent = t(group.title);
      box.setAttribute('aria-labelledby', title.id);
      box.append(title);
    }
    for (const def of group.items) {
      const shortcut = shortcuts[def.id] ?? '';
      const button = row(def, shortcutKeys(shortcut, lang), shortcut);
      items.push(button);
      box.append(button);
    }
    frame.append(box);
  }
  frame.append(noTraceGroup(), delayGroup());
  menu.replaceChildren(frame);
  paintNoTrace(noTrace);
  paintDelay(delay);
  links();
  items[0].tabIndex = 0;
  document.documentElement.classList.add('idle');
  document.documentElement.classList.remove('pending');
  items[0].focus();
  performance.mark('obturo:popup-painted');
  // The dot of the news and the request for a review read the settings database: after the paint, never before.
  import('./popup-notice.js').then((m) => m.run(t, openPage)).catch((e) => console.error('Obturo:', e));
}
init().catch((e) => {
  console.error('Obturo:', e);
  document.documentElement.classList.remove('pending');
});
