import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MENU, POPUP_ICONS, POPUP_IDS, cleanChooserEdit, cleanNoTrace, cleanPopupRun, libraryTarget, menuItems, popupGroups, popupLanguage, shortcutKeys } from './gestures.js';
import en from './locales/en.js';
import fr from './locales/fr.js';

const identity = (key) => key;

const TOP_LEVEL_LIMIT = 6; // chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT

test('menu: under the limit of top-level entries that Chrome shows for the icon menu (separators count too)', () => {
  const top = menuItems(identity).filter((i) => !i.parentId);
  const separators = top.filter((i) => /** @type {any} */ (i).type === 'separator').length; // none today: a separator would be one more top-level entry
  assert.ok(top.length <= TOP_LEVEL_LIMIT, `${top.length} top-level entries`);
  assert.equal(separators, 0);
  assert.equal(top.length, 4);
});

test('menu: Capture, Capture and edit (area, visible part, full page each), library, settings - in this order', () => {
  const shape = (defs) => defs.map((d) => (d.children ? [d.id, shape(d.children)] : d.id));
  assert.deepEqual(shape(MENU), [
    ['capture', ['capture-area', 'capture-visible', 'capture-full']],
    ['capture-edit', ['capture-area-edit', 'capture-visible-edit', 'capture-full-edit']],
    'open-library',
    'open-settings',
  ]);
});

test('menuItems: parents before their children, unique ids, every entry in the icon menu', () => {
  const items = menuItems(identity);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'duplicate id');
  items.forEach((item, n) => {
    assert.deepEqual(item.contexts, ['action']);
    if (item.parentId) {
      const parent = items.findIndex((i) => i.id === item.parentId);
      assert.ok(parent >= 0 && parent < n, `${item.id}: parent ${item.parentId} not created before it`);
      assert.equal(items[parent].parentId, undefined, 'a single level of submenu');
    }
  });
  assert.deepEqual(items.filter((i) => i.parentId === 'capture').map((i) => i.id), ['capture-area', 'capture-visible', 'capture-full']);
  assert.deepEqual(items.filter((i) => i.parentId === 'capture-edit').map((i) => i.id), ['capture-area-edit', 'capture-visible-edit', 'capture-full-edit']);
});

test('menuItems: titles come from the translate function, nothing is left untranslated', () => {
  for (const [name, dict] of [['en', en], ['fr', fr]]) {
    const items = menuItems((key) => dict[key]);
    assert.equal(items.length, 10);
    for (const item of items) assert.ok(typeof item.title === 'string' && item.title.trim(), `${name}: no text for ${item.id}`);
  }
  const titles = menuItems((key) => fr[key]).map((i) => i.title);
  assert.deepEqual(titles.slice(0, 4), ['Capturer', 'Zone', 'Partie visible', 'Page entière']);
  assert.ok(titles.includes('Capturer et éditer') && titles.includes('Paramètres'));
});

test('menuItems: a custom list of definitions (the tree is data)', () => {
  const items = menuItems((k) => k.toUpperCase(), [{ id: 'a', title: 'x', children: [{ id: 'b', title: 'y' }] }, { id: 'c', title: 'z' }]);
  assert.deepEqual(items, [
    { id: 'a', title: 'X', contexts: ['action'] },
    { id: 'b', title: 'Y', contexts: ['action'], parentId: 'a' },
    { id: 'c', title: 'Z', contexts: ['action'] },
  ]);
});

test('libraryTarget: the address for a new tab and the message for the one already open', () => {
  assert.deepEqual(libraryTarget(), { hash: '', message: null });
  assert.deepEqual(libraryTarget({}), { hash: '', message: null });
  assert.deepEqual(libraryTarget({ shot: 42 }), { hash: '#shot=42', message: { type: 'open-shot', id: 42 } });
  assert.deepEqual(libraryTarget({ settings: true }), { hash: '#settings', message: { type: 'open-settings' } });
});

test('libraryTarget: an id that is not an integer never reaches the address', () => {
  for (const shot of [NaN, Infinity, -Infinity, 1.5, '3', null]) {
    assert.deepEqual(libraryTarget({ shot: /** @type {any} */ (shot) }), { hash: '', message: null }, String(shot));
  }
});

// ---------- popup ----------

test('popupGroups: the groups of the menu (Capture, Capture and edit), then the library and the settings without a title', () => {
  const shape = popupGroups().map((g) => [g.title ?? null, g.items.map((i) => i.id)]);
  assert.deepEqual(shape, [
    ['menu.capture', ['capture-area', 'capture-visible', 'capture-full']],
    ['menu.captureEdit', ['capture-area-edit', 'capture-visible-edit', 'capture-full-edit']],
    [null, ['open-library', 'open-settings']],
  ]);
  assert.deepEqual(POPUP_IDS, shape.flatMap(([, ids]) => ids));
});

test('popup: every action has an icon, and popup.html has that symbol, plus its logo and the pencil badge', () => {
  const html = readFileSync(new URL('popup.html', import.meta.url), 'utf8');
  const symbols = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map((m) => m[1]));
  for (const id of POPUP_IDS) assert.ok(symbols.has(POPUP_ICONS[id]), `${id}: no symbol #i-${POPUP_ICONS[id]} in popup.html`);
  assert.deepEqual(Object.keys(POPUP_ICONS).sort(), [...POPUP_IDS].sort(), 'an icon for every action and no other');
  for (const name of ['logo', 'pencil']) assert.ok(symbols.has(name), name);
  // the library and the settings use the symbols of the library page, byte for byte
  const library = readFileSync(new URL('library.html', import.meta.url), 'utf8');
  for (const name of ['history', 'sliders']) {
    const symbol = (text) => new RegExp(`<symbol id="i-${name}"[^>]*>.*?</symbol>`, 's').exec(text)?.[0];
    assert.equal(symbol(html), symbol(library), name);
  }
});

test('cleanNoTrace: the state asked for by the switch of the popup, a boolean, nothing else', () => {
  assert.equal(cleanNoTrace({ type: 'popup-notrace', value: true }), true);
  assert.equal(cleanNoTrace({ type: 'popup-notrace', value: false }), false);
  for (const bad of [null, undefined, 'popup-notrace', {}, { type: 'popup-notrace' }, { type: 'popup-notrace', value: 'true' }, { type: 'popup-notrace', value: 1 },
    { type: 'popup-notrace', value: null }, { type: 'popup-run', value: true }, { type: 'settings-changed', value: true }]) assert.equal(cleanNoTrace(bad), null, JSON.stringify(bad));
});

test('cleanPopupRun: a known action, and a tab with whole-number ids for a capture', () => {
  const tab = { id: 7, windowId: 3, url: 'https://example.test/', title: 'Example' };
  assert.deepEqual(cleanPopupRun({ type: 'popup-run', id: 'capture-area', tab }), { id: 'capture-area', tab });
  assert.deepEqual(cleanPopupRun({ type: 'popup-run', id: 'capture-full-edit', tab: { ...tab, url: 5, title: null } }),
    { id: 'capture-full-edit', tab: { id: 7, windowId: 3, url: '', title: '' } });
  assert.deepEqual(cleanPopupRun({ type: 'popup-run', id: 'open-library' }), { id: 'open-library' }, 'the library needs no tab');
  assert.deepEqual(cleanPopupRun({ type: 'popup-run', id: 'open-settings', tab: { id: -1 } }), { id: 'open-settings' });
  for (const bad of [
    null, undefined, 'popup-run', {}, { type: 'area', id: 'capture-area', tab },
    { type: 'popup-run' }, { type: 'popup-run', id: 'capture' }, { type: 'popup-run', id: 'capture-edit', tab },
    { type: 'popup-run', id: 'constructor', tab }, { type: 'popup-run', id: '__proto__', tab }, { type: 'popup-run', id: ['capture-area'], tab },
    { type: 'popup-run', id: 'capture-area' }, { type: 'popup-run', id: 'capture-area', tab: { ...tab, id: 1.5 } },
    { type: 'popup-run', id: 'capture-area', tab: { ...tab, windowId: '3' } }, { type: 'popup-run', id: 'capture-visible', tab: { ...tab, id: -2 } },
  ]) assert.equal(cleanPopupRun(bad), null, JSON.stringify(bad));
});

test('shortcutKeys: one capsule per key, nothing when no key is assigned', () => {
  assert.deepEqual(shortcutKeys('Alt+Shift+Z'), ['Alt', 'Shift', 'Z']);
  assert.deepEqual(shortcutKeys('Ctrl+Shift+PageDown'), ['Ctrl', 'Shift', 'PageDown']);
  assert.deepEqual(shortcutKeys(''), []);
  assert.deepEqual(shortcutKeys(undefined), []);
  assert.deepEqual(shortcutKeys('Ctrl+Up'), ['Ctrl', '↑']);
  assert.deepEqual(shortcutKeys('Alt+Comma'), ['Alt', ',']);
  assert.deepEqual(shortcutKeys('Ctrl++'), ['Ctrl', '+']);
});

test('shortcutKeys: the keys a French keyboard prints in French; the symbols of a Mac come one by one', () => {
  assert.deepEqual(shortcutKeys('Alt+Shift+Z', 'fr'), ['Alt', 'Maj', 'Z']);
  assert.deepEqual(shortcutKeys('Ctrl+Shift+PageDown', 'fr'), ['Ctrl', 'Maj', 'Pg suiv.']);
  assert.deepEqual(shortcutKeys('Alt+Space', 'fr'), ['Alt', 'Espace']);
  assert.deepEqual(shortcutKeys('Alt+Shift+Z', 'en'), ['Alt', 'Shift', 'Z'], 'English keeps the words of Chrome');
  assert.deepEqual(shortcutKeys('Alt+Shift+Z', 'de'), ['Alt', 'Umschalt', 'Z'], 'a German keyboard prints Umschalt');
  assert.deepEqual(shortcutKeys('Alt+Shift+Z', 'ja'), ['Alt', 'Shift', 'Z'], 'a language whose keyboards print the English words keeps them');
  assert.deepEqual(shortcutKeys('⇧⌥Z'), ['⇧', '⌥', 'Z']);
  assert.deepEqual(shortcutKeys('⌘⇧Y', 'fr'), ['⌘', '⇧', 'Y']);
});

test('popupLanguage: the language of the settings copy, else the browser, else English (resolveLanguage)', () => {
  assert.equal(popupLanguage('{"language":"fr","theme":"dark"}', 'en-US'), 'fr');
  assert.equal(popupLanguage('{"language":"en"}', 'fr-FR'), 'en');
  assert.equal(popupLanguage('{"language":"auto"}', 'fr_CA'), 'fr');
  assert.equal(popupLanguage(null, 'fr-FR'), 'fr', 'no copy yet');
  assert.equal(popupLanguage(null, 'de-DE'), 'de');
  assert.equal(popupLanguage(null, 'pt-PT'), 'pt-BR', 'a region that is not translated takes the translated one');
  assert.equal(popupLanguage(null, 'nl'), 'en');
  assert.equal(popupLanguage('{not json', 'fr'), 'fr');
  assert.equal(popupLanguage('{"language":"klingon"}', 'de'), 'de');
  for (const bad of ['{"language":"constructor"}', '{"language":5}', '[]', '"fr"', 'null']) assert.equal(popupLanguage(bad, 'xx'), 'en', bad);
});

test('cleanChooserEdit: the capture to open in the editor, a whole number from 1, nothing else', () => {
  assert.equal(cleanChooserEdit({ type: 'chooser-edit', id: 7 }), 7);
  for (const id of [0, -1, 1.5, NaN, Infinity, '7', null, undefined, {}, [7]]) assert.equal(cleanChooserEdit({ type: 'chooser-edit', id }), null, String(id));
  for (const m of [{ id: 7 }, { type: 'popup-run', id: 7 }, { type: 'chooser-edit' }, null, undefined, 'chooser-edit', 7]) assert.equal(cleanChooserEdit(m), null, JSON.stringify(m));
});
