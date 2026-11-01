// What the icon's right-click menu contains and where a gesture sends the user, as data and pure functions (no chrome.*,
// no i18n import): sw.js builds the menu from it, the tests check it without a browser.
import { resolveLanguage } from './languages.js';
//
// A leaf is named after the action it runs, which is also the name of the manifest command that does the same thing
// (capture-area, capture-visible-edit...): the keyboard shortcuts and the menu share one dispatch table in sw.js.

// Chrome shows at most chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT (6) top-level entries in the menu of the
// extension icon and silently ignores the following ones (documented: "Any items beyond this limit will be ignored").
// Submenus (parentId) are not top-level entries; a test keeps the menu under the limit (gestures.test.js holds the number,
// menu.e2e.mjs reads it from the browser).

/** @typedef {{ id: string, title: string, children?: MenuDef[] }} MenuDef `title` is a key of locales/*.sw.js. */

/** @type {MenuDef[]} */
export const MENU = [
  { id: 'capture', title: 'menu.capture', children: [
    { id: 'capture-area', title: 'menu.area' },
    { id: 'capture-visible', title: 'menu.visible' },
    { id: 'capture-full', title: 'menu.full' },
    { id: 'capture-element', title: 'menu.element' },
  ] },
  { id: 'capture-edit', title: 'menu.captureEdit', children: [
    { id: 'capture-area-edit', title: 'menu.area' },
    { id: 'capture-visible-edit', title: 'menu.visible' },
    { id: 'capture-full-edit', title: 'menu.full' },
    { id: 'capture-element-edit', title: 'menu.element' },
  ] },
  { id: 'open-library', title: 'menu.library' },
  { id: 'open-settings', title: 'menu.settings' },
];

/**
 * The entries for chrome.contextMenus.create, in creation order: a parent always comes before its children.
 * @param {(key: string) => string} translate
 * @param {MenuDef[]} [defs]
 * @param {string} [parentId]
 * @returns {Array<{ id: string, title: string, contexts: ['action'], parentId?: string }>}
 */
export function menuItems(translate, defs = MENU, parentId) {
  return defs.flatMap((d) => [
    { id: d.id, title: translate(d.title), contexts: /** @type {['action']} */ (['action']), ...(parentId && { parentId }) },
    ...menuItems(translate, d.children ?? [], d.id),
  ]);
}

/**
 * How to show something in the library: the address to open when there is no library tab yet, and the message for the
 * one that is already open (BroadcastChannel 'obturo').
 * @param {{ shot?: number, settings?: boolean }} [target] A capture to open in the editor, or the settings panel.
 * @returns {{ hash: string, message: { type: string, id?: number } | null }}
 */
export function libraryTarget({ shot, settings } = {}) {
  if (Number.isInteger(shot)) return { hash: `#shot=${shot}`, message: { type: 'open-shot', id: shot } };
  if (settings) return { hash: '#settings', message: { type: 'open-settings' } };
  return { hash: '', message: null };
}

// ---------- left-click popup ----------

// The popup (popup.html) shows the same actions as the menu above: its groups come from MENU (the parents with children
// become a titled group, the leaves a last group without title), so there is one table. `POPUP_ICONS` names the symbol
// (#i-<name> of the sprite in popup.html) of each action; gestures.test.js checks that the page has them all.
/** @type {Record<string, string>} */
export const POPUP_ICONS = {
  'capture-area': 'area', 'capture-visible': 'visible', 'capture-full': 'full',
  'capture-element': 'element', 'capture-area-edit': 'area-edit', 'capture-visible-edit': 'visible-edit', 'capture-full-edit': 'full-edit',
  'capture-element-edit': 'element-edit',
  'open-library': 'history', 'open-settings': 'sliders',
};

/**
 * @param {MenuDef[]} [defs]
 * @returns {Array<{ title?: string, items: MenuDef[] }>} `title` is a key of locales/*.sw.js, absent for the last group.
 */
export function popupGroups(defs = MENU) {
  return [
    ...defs.filter((d) => d.children).map((d) => ({ title: d.title, items: d.children ?? [] })),
    { items: defs.filter((d) => !d.children) },
  ];
}

/** The actions the popup may ask for. */
export const POPUP_IDS = popupGroups().flatMap((g) => g.items.map((i) => i.id));

/**
 * Validates the message { type: 'popup-run', id, tab } that the popup sends. Only the shape is checked here (the sender and the
 * tab itself are checked by sw.js): a known action, and for a capture a tab with whole-number ids.
 * @param {any} m
 * @returns {{ id: string, tab?: { id: number, windowId: number, url: string, title: string } } | null}
 */
export function cleanPopupRun(m) {
  if (m?.type !== 'popup-run' || typeof m.id !== 'string' || !POPUP_IDS.includes(m.id)) return null;
  const whole = (n) => Number.isInteger(n) && n >= 0;
  const text = (s) => (typeof s === 'string' ? s : '');
  const tab = m.tab;
  if (tab && whole(tab.id) && whole(tab.windowId)) return { id: m.id, tab: { id: tab.id, windowId: tab.windowId, url: text(tab.url), title: text(tab.title) } };
  return m.id.startsWith('capture-') ? null : { id: m.id }; // a capture needs its tab, the library and the settings do not
}

/**
 * Validates the message { type: 'popup-notrace', value } that the popup sends when its no-trace switch is flipped: only the shape
 * (the sender is checked by sw.js).
 * @param {any} m @returns {boolean | null} The wanted state, or null if the message is not that.
 */
export const cleanNoTrace = (m) => (m?.type === 'popup-notrace' && typeof m.value === 'boolean' ? m.value : null);

/** The delays before a capture, in seconds (the select of the settings and the control of the popup); 0 is none. */
export const CAPTURE_DELAYS = [0, 3, 5, 10];

/**
 * Validates the message { type: 'popup-delay', value } that the popup sends when its delay control is changed: only the shape (the sender
 * is checked by sw.js).
 * @param {any} m @returns {number | null} The wanted delay, or null if the message is not that.
 */
export const cleanDelay = (m) => (m?.type === 'popup-delay' && CAPTURE_DELAYS.includes(m.value) ? m.value : null);

/**
 * Validates the message { type: 'chooser-edit', id } that the page of actions after a capture sends (chooser.html): the capture to open
 * in the editor, a whole number from 1. Only the shape (the sender is checked by sw.js).
 * @param {any} m @returns {number | null}
 */
export const cleanChooserEdit = (m) => (m?.type === 'chooser-edit' && Number.isInteger(m.id) && m.id > 0 ? m.id : null);

// How a shortcut of chrome.commands.getAll() reads in the popup. Chrome answers 'Alt+Shift+Z' on Windows and Linux and the symbols
// of the platform ('⇧⌥Z') on a Mac; both give one capsule per key. Words that a keyboard prints differently in French are
// translated, the others stay as Chrome writes them. Keyboards sold for the other languages of the extension print the English words.
const KEY_NAMES = {
  fr: { Shift: 'Maj', Space: 'Espace', Delete: 'Suppr', Insert: 'Inser', Home: 'Début', End: 'Fin', PageUp: 'Pg préc.', PageDown: 'Pg suiv.' },
  de: { Shift: 'Umschalt', Space: 'Leertaste', Delete: 'Entf', Insert: 'Einfg', Home: 'Pos1', End: 'Ende', PageUp: 'Bild auf', PageDown: 'Bild ab' },
  es: { Shift: 'Mayús', Space: 'Espacio', Delete: 'Supr', Insert: 'Insert', Home: 'Inicio', End: 'Fin', PageUp: 'Re Pág', PageDown: 'Av Pág' },
};
const KEY_SYMBOLS = { Up: '↑', Down: '↓', Left: '←', Right: '→', Comma: ',', Period: '.' };
// ponytail: on a Mac the letters and symbols are kept as Chrome gives them; map Ctrl to the command key here if a plus-separated form shows up there.
/**
 * @param {string | undefined} shortcut
 * @param {string} [lang] Language code of the interface.
 * @returns {string[]} The keys, in order; empty when no key is assigned.
 */
export function shortcutKeys(shortcut, lang = 'en') {
  if (!shortcut) return [];
  const keys = shortcut.includes('+') ? shortcut.split('+').filter(Boolean) : [...shortcut];
  if (shortcut.endsWith('++')) keys.push('+'); // the key '+' itself
  const names = /** @type {Record<string, string>} */ (KEY_NAMES[/** @type {'fr'} */ (lang)] ?? {});
  return keys.map((k) => KEY_SYMBOLS[/** @type {keyof typeof KEY_SYMBOLS} */ (k)] ?? names[k] ?? k);
}

/**
 * The language of the popup: the one in the copy of the settings that settings.js keeps in localStorage (raw text, as stored), else
 * the language of the browser, else English (resolveLanguage, without loading i18n.js).
 * @param {string | null} raw @param {string} ui Browser language, e.g. 'fr-FR'.
 */
export function popupLanguage(raw, ui) {
  let setting = 'auto';
  try { setting = JSON.parse(raw ?? 'null')?.language ?? 'auto'; } catch { /* not JSON: the browser's language */ }
  return resolveLanguage(typeof setting === 'string' ? setting : 'auto', ui);
}
