// The popup of a left click on the icon, in the real extension. A real popup cannot be opened in a test (no toolbar, and the
// browser closes it by itself): popup.html is loaded as a page of the extension, which is the same document with the same scripts.
// What a real popup adds - the focus given back to the page when it closes, the clipboard after that - is NOT covered here.
// The message to the worker is sent for real by the page (and rejected there, a page in a tab has sender.tab); the accepted
// path is driven through the test hook of the worker with the sender a popup has (__t.onMessage).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  GREEN, badges, finalBadge, lastShot, libraryPages, maxId, quota, resetBadges, sleep, startSite, tabActive, tabOf, until, closeLibraries,
} from './support/capture.mjs';

const IDS = ['capture-area', 'capture-visible', 'capture-full', 'capture-area-edit', 'capture-visible-edit', 'capture-full-edit', 'open-library', 'open-settings', 'capture-delay'];
const EN = ['Area', 'Visible part', 'Full page', 'Area', 'Visible part', 'Full page', 'Open the library', 'Settings', 'Delay'];
const FR = ['Zone', 'Partie visible', 'Page entière', 'Zone', 'Partie visible', 'Page entière', 'Ouvrir la bibliothèque', 'Paramètres', 'Délai'];

/** Writes the copy of the appearance that settings.js keeps, on the origin of the extension. */
async function seedAppearance(h, value) {
  const page = await h.context.newPage();
  await page.goto(h.url('manifest.json'));
  await page.evaluate((v) => (v ? localStorage.setItem('obturo.appearance', JSON.stringify(v)) : localStorage.removeItem('obturo.appearance')), value);
  await page.close();
}

/**
 * Opens popup.html in a new page. `spy`: the page records its messages (window.__sent) and its calls to window.close (window.__closed)
 * instead of sending and closing. `commands`: replaces the answer of chrome.commands.getAll.
 * @param {import('playwright-core').BrowserContext | any} h
 * @param {{ spy?: boolean, commands?: Array<{ name: string, shortcut?: string }>, colorScheme?: 'light' | 'dark' }} [options]
 */
async function openPopup(h, { spy = false, commands, colorScheme } = {}) {
  const page = await h.context.newPage();
  if (colorScheme) await page.emulateMedia({ colorScheme });
  await page.addInitScript(({ spy, commands }) => {
    window.__sent = [];
    window.__closed = 0;
    window.__answers = [];
    if (commands) chrome.commands.getAll = async () => commands;
    window.close = () => { window.__closed++; };
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (m) => {
      window.__sent.push(m);
      if (spy) return true;
      const answer = await real(m);
      window.__answers.push(answer);
      return answer;
    };
  }, { spy, commands });
  await page.goto(h.url('popup.html'));
  await page.waitForFunction(() => !document.documentElement.classList.contains('pending'));
  return page;
}

const rows = (page) => page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map((b) => ({
  id: /** @type {HTMLElement} */ (b).dataset.id, label: b.querySelector('.label')?.textContent, aria: b.getAttribute('aria-label'),
  keys: [...b.querySelectorAll('kbd')].map((k) => k.textContent), keyshortcuts: b.getAttribute('aria-keyshortcuts'), tabindex: /** @type {HTMLElement} */ (b).tabIndex,
  group: b.closest('[role=group]')?.getAttribute('aria-labelledby') ?? null,
})));
const focused = (page) => page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.dataset?.id ?? null);

describe('popup: content, language, theme, keys', () => {
  let h;
  before(async () => { h = await launchExtension({ hook: true, instrumented: false, lang: 'en-US' }); });
  after(() => h?.close());

  it('eight actions in three groups, a switch and a delay, one icon each, English by default, first row focused, no scrollbar, 320 px wide', async () => {
    await seedAppearance(h, null);
    const page = await openPopup(h, { spy: true });
    const list = await rows(page);
    assert.deepEqual(list.map((r) => r.id), IDS);
    assert.deepEqual(list.map((r) => r.label), EN);
    assert.deepEqual(list.map((r) => r.aria), [...EN.slice(0, -1), 'Delay: Off'], 'the accessible name of a row is its text, not its shortcut; the delay says its value');
    assert.deepEqual(list.map((r) => r.tabindex), [0, -1, -1, -1, -1, -1, -1, -1, -1], 'the list is one tab stop');
    assert.equal(await focused(page), 'capture-area', 'first row focused at opening');
    const shape = await page.evaluate(() => ({
      menuRole: document.getElementById('menu')?.getAttribute('role'), menuName: document.getElementById('menu')?.getAttribute('aria-label'),
      groups: [...document.querySelectorAll('[role=group]')].map((g) => [g.querySelectorAll('[role=menuitem]').length, g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent]),
      lang: document.documentElement.lang, name: document.querySelector('.name')?.textContent,
      width: document.body.getBoundingClientRect().width, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight, height: document.body.getBoundingClientRect().height,
      icons: [...document.querySelectorAll('.item svg.ic use')].map((u) => !!document.querySelector(u.getAttribute('href') ?? '#none')),
      logo: !!document.querySelector(document.querySelector('.logo use')?.getAttribute('href') ?? '#none'),
    }));
    assert.deepEqual(shape.groups, [[3, 'Capture'], [3, 'Capture and edit'], [2, null], [0, null], [1, null]], 'then the no-trace switch (no action in it) and the delay');
    assert.equal(shape.menuRole, 'menu');
    assert.equal(shape.menuName, 'Obturo actions');
    assert.equal(shape.lang, 'en');
    assert.equal(shape.name, 'Obturo');
    assert.equal(shape.width, 320);
    assert.ok(shape.height > 250 && shape.height < 600, `height ${shape.height} fits a popup (Chrome allows 600)`);
    assert.deepEqual([shape.overflowX, shape.overflowY], [false, false], 'no scrollbar');
    assert.deepEqual(shape.icons, Array(10).fill(true), 'every row has its icon, the switch and the delay too');
    assert.ok(shape.logo);
    assert.deepEqual(h.errors, []);
    await page.close();
  });

  it('at opening the first row has the focus (Enter runs it) but is not lit: no ring, no tint until a key is pressed', async () => {
    for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
      const page = await openPopup(h, { spy: true, colorScheme });
      assert.equal(await focused(page), 'capture-area');
      await sleep(150);
      const quiet = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.item') ?? document.body); return { outline: s.outlineColor, bg: s.backgroundColor }; });
      assert.deepEqual(quiet, { outline: 'rgba(0, 0, 0, 0)', bg: 'rgba(0, 0, 0, 0)' }, `${colorScheme}: the focused row looks like the others`);
      await page.mouse.move(160, 12); // the pointer over the header, not over a row
      assert.deepEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.item') ?? document.body).backgroundColor), 'rgba(0, 0, 0, 0)', 'still not lit');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      assert.equal(await focused(page), 'capture-area');
      await sleep(150);
      const lit = await page.evaluate(() => { const s = getComputedStyle(document.activeElement ?? document.body); return { outline: s.outlineColor, bg: s.backgroundColor }; });
      assert.notEqual(lit.outline, 'rgba(0, 0, 0, 0)', 'the ring comes with the keyboard');
      assert.notEqual(lit.bg, 'rgba(0, 0, 0, 0)', 'and the tint');
      await page.close();
    }
  });

  it('shortcuts: the ones chrome.commands reports, one capsule per key, nothing for an action without a key', async () => {
    const page = await openPopup(h, { spy: true });
    const real = await page.evaluate(() => chrome.commands.getAll());
    const byName = Object.fromEntries(real.map((c) => [c.name, c.shortcut]));
    const list = await rows(page);
    const assigned = list.filter((r) => byName[r.id ?? '']);
    assert.ok(assigned.length >= 1, 'the suggested keys of the manifest are assigned');
    for (const r of list) {
      const shortcut = byName[r.id ?? ''] || '';
      assert.deepEqual(r.keys, shortcut ? shortcut.split('+') : [], `${r.id}: ${shortcut || 'no key'}`);
      assert.equal(r.keyshortcuts, shortcut || null, r.id);
    }
    for (const id of ['capture-area-edit', 'capture-visible-edit', 'capture-full-edit', 'open-settings']) assert.deepEqual(list.find((r) => r.id === id)?.keys, [], `${id} has no suggested key`);
    await page.close();
  });

  it('no key assigned at all: no capsule; a key assigned to an "edit" action shows on its row; French names for the keys', async () => {
    let page = await openPopup(h, { spy: true, commands: [] });
    assert.deepEqual((await rows(page)).flatMap((r) => r.keys), []);
    assert.equal(await page.locator('.keys').count(), 0);
    await page.close();
    await seedAppearance(h, { language: 'fr', theme: 'auto' });
    page = await openPopup(h, { spy: true, commands: [
      { name: 'capture-full-edit', shortcut: 'Ctrl+Shift+PageDown' }, { name: 'capture-area', shortcut: 'Alt+Shift+Z' }, { name: 'open-settings', shortcut: '' }, { name: 'capture-visible-edit' },
    ] });
    const list = await rows(page);
    assert.deepEqual(list.find((r) => r.id === 'capture-full-edit')?.keys, ['Ctrl', 'Maj', 'Pg suiv.']);
    assert.deepEqual(list.find((r) => r.id === 'capture-area')?.keys, ['Alt', 'Maj', 'Z']);
    assert.deepEqual(list.find((r) => r.id === 'open-settings')?.keys, []);
    assert.deepEqual(list.find((r) => r.id === 'capture-visible-edit')?.keys, []);
    await page.close();
  });

  it('a chrome.commands that fails: the rows are there without keys', async () => {
    const page = await h.context.newPage();
    await page.addInitScript(() => { chrome.commands.getAll = () => Promise.reject(new Error('no commands')); });
    await page.goto(h.url('popup.html'));
    await page.waitForFunction(() => !document.documentElement.classList.contains('pending'));
    assert.equal((await rows(page)).length, 9);
    await page.close();
    await seedAppearance(h, null);
    h.errors.length = 0; // the console error of that failure is expected
  });

  it('two links under the menu (extensions page, keyboard shortcuts): outside the list of actions, translated, one click opens a tab and closes the popup once', async () => {
    await seedAppearance(h, null);
    let page = await openPopup(h, { spy: true });
    const shape = await page.evaluate(() => ({
      links: [...document.querySelectorAll('#links .link')].map((b) => [/** @type {HTMLElement} */ (b).dataset.id, b.textContent?.trim()]),
      name: document.getElementById('links')?.getAttribute('aria-label'),
      inMenu: document.querySelectorAll('#menu .link').length,
      icons: [...document.querySelectorAll('#links svg.ic use')].map((u) => !!document.querySelector(u.getAttribute('href') ?? '#none')),
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    assert.deepEqual(shape.links, [['manage-extensions', 'Manage extensions'], ['extension-shortcuts', 'Keyboard shortcuts']]);
    assert.equal(shape.name, 'Browser pages');
    assert.equal(shape.inMenu, 0, 'not rows of the list of actions');
    assert.deepEqual(shape.icons, [true, true]);
    assert.equal(shape.overflowY, false);
    // a click opens the page in a tab and closes the popup; a second click while it closes does nothing; the worker is not involved
    await page.evaluate(() => { window.__created = []; chrome.tabs.create = /** @type {any} */ (async (/** @type {unknown} */ o) => { window.__created.push(o); }); });
    await page.locator('[data-id=extension-shortcuts]').click();
    await until(() => page.evaluate(() => window.__closed > 0), 'popup closed');
    await page.locator('[data-id=manage-extensions]').click({ force: true });
    await sleep(100);
    assert.deepEqual(await page.evaluate(() => window.__created), [{ url: 'chrome://extensions/shortcuts' }]);
    assert.equal(await page.evaluate(() => window.__sent?.length), 0, 'the worker is not involved');
    await page.close();
    // French, and the Tab key leaves the list for the links
    await seedAppearance(h, { language: 'fr', theme: 'auto' });
    page = await openPopup(h, { spy: true });
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#links .link')].map((b) => b.textContent?.trim())), ['Gérer les extensions', 'Raccourcis clavier']);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-id')), 'manage-extensions');
    await page.evaluate(() => { window.__created = []; chrome.tabs.create = /** @type {any} */ (async (/** @type {unknown} */ o) => { window.__created.push(o); }); });
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => window.__closed > 0), 'popup closed after Enter');
    assert.deepEqual(await page.evaluate(() => window.__created), [{ url: 'chrome://extensions' }]);
    await page.close();
    await seedAppearance(h, null);
  });

  it('language from the settings copy: French; back to the browser language (English here) without it; a bad copy is ignored', async () => {
    await seedAppearance(h, { language: 'fr', theme: 'auto' });
    let page = await openPopup(h, { spy: true });
    assert.deepEqual((await rows(page)).map((r) => r.label), FR);
    const fr = await page.evaluate(() => ({ lang: document.documentElement.lang, menu: document.getElementById('menu')?.getAttribute('aria-label'), titles: [...document.querySelectorAll('.group-title')].map((p) => p.textContent) }));
    assert.deepEqual(fr, { lang: 'fr', menu: 'Actions d\'Obturo', titles: ['Capturer', 'Capturer et éditer'] });
    await page.close();
    await seedAppearance(h, { language: 'auto', theme: 'auto' });
    page = await openPopup(h, { spy: true });
    assert.deepEqual((await rows(page)).map((r) => r.label), EN);
    await page.close();
    const raw = await h.context.newPage();
    await raw.goto(h.url('manifest.json'));
    await raw.evaluate(() => localStorage.setItem('obturo.appearance', '{not json'));
    await raw.close();
    page = await openPopup(h, { spy: true });
    assert.deepEqual((await rows(page)).map((r) => r.label), EN);
    await page.close();
    await seedAppearance(h, null);
  });

  // WCAG contrast of the real computed colors, in both themes, for the rows at rest and the row that is lit.
  const contrastIn = (page) => page.evaluate(() => {
    const rgb = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; return m.slice(0, 3); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const style = (el) => getComputedStyle(el);
    const rows = [...document.querySelectorAll('.item')];
    const rest = rows[3], lit = rows[0], page = style(document.body).backgroundColor;
    const kbd = document.querySelector('.keys kbd');
    return {
      label: ratio(style(rest.querySelector('.label')).color, page),
      groupTitle: ratio(style(document.querySelector('.group-title')).color, page),
      name: ratio(style(document.querySelector('.name')).color, page),
      kbd: kbd ? ratio(style(kbd).color, style(kbd).backgroundColor) : null,
      litLabel: ratio(style(lit.querySelector('.label')).color, style(lit).backgroundColor),
      iconRest: ratio(style(rest.querySelector('svg')).color, page),
      iconLit: ratio(style(lit.querySelector('svg')).color, style(lit).backgroundColor),
      ringOnLit: ratio(style(lit).outlineColor, style(lit).backgroundColor),
      theme: document.documentElement.dataset.theme ?? null,
    };
  });

  for (const theme of ['light', 'dark']) {
    it(`${theme} theme from the copy: data-theme applied before the first paint, contrasts of text >= 4.5, of icons and focus ring >= 3`, async () => {
      await seedAppearance(h, { language: 'en', theme });
      const page = await openPopup(h, { spy: true });
      await page.keyboard.press('Home'); // the row is lit by the keyboard, not at opening
      await sleep(250); // the row that is lit fades in (80 ms)
      const c = await contrastIn(page);
      assert.equal(c.theme, theme);
      for (const k of ['label', 'groupTitle', 'name', 'kbd', 'litLabel']) assert.ok(c[k] >= 4.5, `${theme} ${k}: ${c[k]?.toFixed(2)}`);
      for (const k of ['iconRest', 'iconLit', 'ringOnLit']) assert.ok(c[k] >= 3, `${theme} ${k}: ${c[k]?.toFixed(2)}`);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.equal(bg, theme === 'dark' ? 'rgb(17, 24, 38)' : 'rgb(255, 255, 255)');
      await page.close();
    });
  }

  it('theme "auto" follows the system (prefers-color-scheme), no data-theme', async () => {
    await seedAppearance(h, { language: 'en', theme: 'auto' });
    for (const colorScheme of /** @type {const} */ (['dark', 'light'])) {
      const page = await openPopup(h, { spy: true, colorScheme });
      const c = await contrastIn(page);
      assert.equal(c.theme, null);
      assert.ok(c.label >= 4.5 && c.groupTitle >= 4.5 && c.kbd >= 4.5 && c.iconRest >= 3, colorScheme);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), colorScheme === 'dark' ? 'rgb(17, 24, 38)' : 'rgb(255, 255, 255)');
      await page.close();
    }
    await seedAppearance(h, null);
  });

  it('reduced motion: no transition on the rows', async () => {
    const page = await h.context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(h.url('popup.html'));
    await page.waitForFunction(() => !document.documentElement.classList.contains('pending'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.item') ?? document.body).transitionDuration), '0s');
    await page.close();
    const normal = await openPopup(h, { spy: true });
    assert.notEqual(await normal.evaluate(() => getComputedStyle(document.querySelector('.item') ?? document.body).transitionDuration), '0s');
    await normal.close();
  });

  // ---- the no-trace switch: a setting, not an action
  const copyOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('obturo.appearance') ?? 'null'));
  const state = (page) => page.evaluate(() => ({
    checked: document.querySelector('[data-id="no-trace"]')?.getAttribute('aria-checked'),
    hint: !document.getElementById('no-trace-hint')?.hidden,
    editOff: [...document.querySelectorAll('[data-id$="-edit"]')].map((b) => b.getAttribute('aria-disabled')),
  }));

  it('the no-trace switch: off at first; flipping it sends the setting, writes the copy, greys "and edit", and leaves the popup open', async () => {
    await seedAppearance(h, { language: 'en', theme: 'auto' });
    const page = await openPopup(h, { spy: true });
    assert.deepEqual(await state(page), { checked: 'false', hint: false, editOff: [null, null, null] });
    assert.equal(await page.getAttribute('[data-id="no-trace"]', 'role'), 'menuitemcheckbox');
    assert.equal(await page.getAttribute('[data-id="no-trace"]', 'aria-label'), 'No trace');
    await page.click('[data-id="no-trace"]');
    await until(async () => (await state(page)).checked === 'true', 'the switch is on');
    assert.deepEqual(await state(page), { checked: 'true', hint: true, editOff: ['true', 'true', 'true'] });
    assert.deepEqual((await page.evaluate(() => window.__sent)).map((m) => [m.type, m.value]), [['popup-notrace', true]]);
    assert.equal((await copyOf(page)).noTrace, true, 'the copy that the pages read');
    assert.equal((await copyOf(page)).language, 'en', 'the rest of the copy is kept');
    assert.equal(await page.evaluate(() => window.__closed), 0, 'a setting: the popup stays open');
    await page.click('[data-id="capture-visible-edit"]', { force: true }); // greyed out: nothing is sent
    await sleep(200);
    assert.equal((await page.evaluate(() => window.__sent)).length, 1, 'no action sent for a greyed-out row');
    assert.equal(await page.evaluate(() => window.__closed), 0);
    await page.click('[data-id="capture-visible"]'); // a plain capture still goes
    await until(() => page.evaluate(() => window.__closed > 0), 'popup closed');
    assert.deepEqual((await page.evaluate(() => window.__sent)).map((m) => m.type), ['popup-notrace', 'popup-run']);
    await page.close();
  });

  it('the switch is on at once when the copy says so (no database), and flips back', async () => {
    await seedAppearance(h, { language: 'en', theme: 'auto', noTrace: true });
    const page = await openPopup(h, { spy: true });
    assert.deepEqual(await state(page), { checked: 'true', hint: true, editOff: ['true', 'true', 'true'] }, 'from the first frame');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp'); // the switch is the row before the last one
    assert.equal(await focused(page), 'no-trace');
    await page.keyboard.press('Space');
    await until(async () => (await state(page)).checked === 'false', 'the switch is off');
    assert.deepEqual(await state(page), { checked: 'false', hint: false, editOff: [null, null, null] });
    assert.equal((await copyOf(page)).noTrace, false);
    assert.deepEqual((await page.evaluate(() => window.__sent)).map((m) => [m.type, m.value]), [['popup-notrace', false]]);
    await page.close();
  });

  it('a switch that the worker does not take goes back to what is stored', async () => {
    await seedAppearance(h, { language: 'en', theme: 'auto' });
    const page = await openPopup(h, { spy: true });
    await page.evaluate(() => { chrome.runtime.sendMessage = async () => false; });
    await page.click('[data-id="no-trace"]');
    await until(async () => (await copyOf(page)).noTrace === false && (await state(page)).checked === 'false', 'back to off');
    assert.deepEqual(await state(page), { checked: 'false', hint: false, editOff: [null, null, null] });
    await page.close();
  });

  it('the delay control: none at first, each click goes to the next delay (3, 5, 10 s, none), sends it, writes the copy, and leaves the popup open', async () => {
    await seedAppearance(h, { language: 'en', theme: 'auto' });
    const page = await openPopup(h, { spy: true });
    const value = () => page.evaluate(() => [document.querySelector('[data-id="capture-delay"] .value')?.textContent, document.querySelector('[data-id="capture-delay"]')?.getAttribute('aria-label')]);
    assert.deepEqual(await value(), ['Off', 'Delay: Off']);
    assert.equal(await page.getAttribute('[data-id="capture-delay"]', 'role'), 'menuitem');
    for (const [seconds, text] of [[3, '3 s'], [5, '5 s'], [10, '10 s'], [0, 'Off']]) {
      await page.click('[data-id="capture-delay"]');
      await until(async () => (await value())[0] === text, `the delay reads ${text}`);
      assert.equal((await value())[1], `Delay: ${text}`);
      assert.equal((await copyOf(page)).captureDelay, seconds, 'the copy that the popup reads at opening');
      assert.equal((await copyOf(page)).language, 'en', 'the rest of the copy is kept');
    }
    assert.deepEqual((await page.evaluate(() => window.__sent)).map((m) => [m.type, m.value]), [['popup-delay', 3], ['popup-delay', 5], ['popup-delay', 10], ['popup-delay', 0]]);
    assert.equal(await page.evaluate(() => window.__closed), 0, 'a setting: the popup stays open');
    await page.close();
  });

  it('the delay is shown at once when the copy says so (no database), the keyboard changes it, and a worker that refuses puts it back', async () => {
    await seedAppearance(h, { language: 'en', theme: 'auto', captureDelay: 5 });
    const page = await openPopup(h, { spy: true });
    const value = () => page.textContent('[data-id="capture-delay"] .value');
    assert.equal(await value(), '5 s', 'from the first frame');
    assert.equal(await page.evaluate(() => document.querySelector('[data-id="capture-delay"]')?.classList.contains('on')), true, 'lit while a delay is set');
    await page.keyboard.press('End');
    assert.equal(await focused(page), 'capture-delay');
    await page.keyboard.press('Enter');
    await until(async () => (await value()) === '10 s', 'the next delay');
    await page.evaluate(() => { chrome.runtime.sendMessage = async () => false; });
    await page.keyboard.press('Space');
    await until(async () => (await value()) === '10 s' && (await copyOf(page)).captureDelay === 10, 'back to what is stored');
    assert.equal(await page.evaluate(() => window.__closed), 0);
    await page.close();
    await seedAppearance(h, { language: 'en', theme: 'auto', captureDelay: 7 });
    const bad = await openPopup(h, { spy: true });
    assert.equal(await bad.textContent('[data-id="capture-delay"] .value'), 'Off', 'a delay that is not one of the choices is none');
    await bad.close();
    await seedAppearance(h, null);
  });

  it('keyboard: arrows move (and wrap), Home and End, Enter sends the action once, Escape closes', async () => {
    const page = await openPopup(h, { spy: true });
    assert.equal(await focused(page), 'capture-area');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'capture-visible');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(page), 'capture-delay', 'wraps to the last row: the delay');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'capture-area', 'wraps to the first row');
    await page.keyboard.press('End');
    assert.equal(await focused(page), 'capture-delay');
    await page.keyboard.press('Home');
    assert.equal(await focused(page), 'capture-area');
    assert.deepEqual(await rows(page).then((l) => l.map((r) => r.tabindex)), [0, -1, -1, -1, -1, -1, -1, -1, -1], 'roving tabindex');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'capture-visible-edit');
    assert.equal((await rows(page)).findIndex((r) => r.tabindex === 0), 4);
    // the focus ring is for the keyboard
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineColor), 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => window.__closed > 0), 'popup closed');
    assert.deepEqual((await page.evaluate(() => window.__sent)).map((m) => [m.type, m.id]), [['popup-run', 'capture-visible-edit']]);
    await page.keyboard.press('Enter'); // a second Enter while it closes: nothing more is sent
    await page.keyboard.press('Space');
    await sleep(150);
    assert.equal((await page.evaluate(() => window.__sent)).length, 1);
    await page.close();

    const esc = await openPopup(h, { spy: true });
    await esc.keyboard.press('Escape');
    assert.equal(await esc.evaluate(() => [window.__closed, window.__sent.length]).then((a) => a.join()), '1,0');
    await esc.close();

    const space = await openPopup(h, { spy: true });
    await space.keyboard.press('ArrowDown');
    await space.keyboard.press('ArrowDown');
    await space.keyboard.press('Space');
    await until(() => space.evaluate(() => window.__sent.length === 1), 'message after Space');
    assert.equal((await space.evaluate(() => window.__sent))[0].id, 'capture-full');
    await space.close();
  });

  it('mouse: the row under the pointer is the lit one (the focus follows), the ring is hidden then; a key brings it back', async () => {
    const page = await openPopup(h, { spy: true });
    await page.locator('[data-id=open-library]').hover();
    assert.equal(await focused(page), 'open-library');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineColor), 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(page), 'capture-full-edit');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineColor), 'rgba(0, 0, 0, 0)');
    await page.close();
  });

  it('a click: { type: "popup-run", id, tab } with the active tab (id, window, address, title), then the popup closes; a double click sends once', async () => {
    const page = await openPopup(h, { spy: true });
    await page.locator('[data-id=capture-visible]').dblclick();
    await until(() => page.evaluate(() => window.__closed > 0), 'popup closed');
    const sent = await page.evaluate(() => window.__sent);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'popup-run');
    assert.equal(sent[0].id, 'capture-visible');
    const ids = await page.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return { id: t.id, windowId: t.windowId, url: t.url, title: t.title }; });
    assert.deepEqual(sent[0].tab, ids);
    assert.deepEqual(Object.keys(sent[0]).sort(), ['id', 'tab', 'type']);
    await page.close();
  });

  it('the real message of a page in a tab is refused by the worker (a popup has no sender.tab), and nothing runs', async () => {
    await closeLibraries(h);
    const page = await openPopup(h, { spy: false });
    await page.locator('[data-id=open-library]').click();
    await until(() => page.evaluate(() => window.__answers.length === 1), 'answer of the worker');
    assert.deepEqual(await page.evaluate(() => window.__answers), [false]);
    await sleep(500);
    assert.equal(libraryPages(h).length, 0);
    await page.close();
  });
});

describe('popup: what the worker does with the message', () => {
  let h, sw, site, page;
  /** Delivers a message to the listener of the worker the way the browser does; resolves with its answer. */
  const deliver = (m, sender = {}) => sw.evaluate(([m, s]) => new Promise((done) => {
    const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html'), ...s };
    for (const k of Object.keys(sender)) if (sender[k] === null) delete sender[k];
    __t.onMessage(m, sender, done);
  }), [m, sender]);

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, lang: 'en-US', size: { width: 1280, height: 800 } });
    sw = h.sw;
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p800.html`);
    await page.bringToFront();
    await tabActive(sw, await tabOf(sw));
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('the library: opens after the pause that lets the popup close, not before', async () => {
    await closeLibraries(h);
    const start = Date.now();
    assert.equal(await deliver({ type: 'popup-run', id: 'open-library' }), true, 'accepted at once');
    assert.equal(libraryPages(h).length, 0, 'not yet');
    await until(() => libraryPages(h).length === 1, 'library tab');
    assert.ok(Date.now() - start >= 140, `after ${Date.now() - start} ms`);
    await closeLibraries(h);
    await page.bringToFront();
  });

  it('the settings: library.html#settings', async () => {
    assert.equal(await deliver({ type: 'popup-run', id: 'open-settings' }), true);
    const lib = await until(() => libraryPages(h)[0], 'library tab');
    assert.equal(lib.url(), `${h.url('library.html')}#settings`);
    await closeLibraries(h);
    await page.bringToFront();
  });

  it('capture of the visible part through the popup path: a shot, green OK badge, same busy flag as the menu', async () => {
    await quota();
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    assert.equal(await deliver({ type: 'popup-run', id: 'capture-visible', tab }), true);
    await until(async () => (await maxId(sw)) > before, 'the shot is saved', 15_000);
    await until(async () => (await finalBadge(sw)) !== null, 'a result badge', 15_000); // the copy and the save end in either order
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    const shot = await lastShot(sw);
    assert.ok(shot.url.startsWith(site.origin) && shot.title === 'Test page', 'address and title of the page, read again by the worker');
  });

  it('the tab given by the popup is checked again: the address and title it sends are not taken as they are', async () => {
    await quota();
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    assert.equal(await deliver({ type: 'popup-run', id: 'capture-visible', tab: { ...tab, url: 'https://forged.test/', title: 'Forged' } }), true);
    await until(async () => (await maxId(sw)) > before, 'the shot is saved', 15_000);
    const shot = await lastShot(sw);
    assert.ok(shot.url.startsWith(site.origin) && shot.title === 'Test page', `${shot.url} ${shot.title}`);
  });

  it('area and edit through the popup path: the selection overlay opens in the tab, marked "edit"', async () => {
    await quota();
    const tab = await tabOf(sw);
    assert.equal(await deliver({ type: 'popup-run', id: 'capture-area-edit', tab }), true);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 8000 });
    assert.equal(await page.evaluate(() => document.getElementById('obturo-overlay')?.getAttribute('data-edit')), '1');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#obturo-overlay', { state: 'detached' });
  });

  it('refused: a sender that is not the popup (another extension, a tab, another page, no sender), a forged action or tab', async () => {
    await quota();
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await closeLibraries(h);
    await resetBadges(sw);
    const good = { type: 'popup-run', id: 'open-library' };
    const cases = [
      [good, { id: 'another-extension-id' }], [good, { id: null }], [good, { tab: { id: 1, windowId: 1 } }], [good, { url: h.url('library.html') }],
      [good, { url: `${site.origin}/p800.html` }], [good, { url: null }], [good, { url: `${h.url('popup.html')}?x` }],
      [{ ...good, id: 'capture' }, {}], [{ ...good, id: 'constructor' }, {}], [{ ...good, id: '__proto__' }, {}], [{ ...good, id: 'capture-edit' }, {}],
      [{ ...good, id: undefined }, {}],
      [{ type: 'popup-run', id: 'capture-visible' }, {}], [{ type: 'popup-run', id: 'capture-visible', tab: { id: 'x', windowId: 1 } }, {}],
      [{ type: 'popup-run', id: 'capture-visible', tab: { ...tab, id: tab.id + 1000 } }, {}], // accepted in shape, dropped when the worker looks the tab up
      [{ type: 'popup-run', id: 'capture-visible', tab: { ...tab, windowId: tab.windowId + 1000 } }, {}],
    ];
    const answers = [];
    for (const [m, s] of cases) answers.push(await deliver(m, s));
    assert.deepEqual(answers, cases.map((_, i) => i >= cases.length - 2), 'only the last two pass the shape check');
    await sleep(900);
    assert.equal(libraryPages(h).length, 0, 'no library opened');
    assert.equal(await maxId(sw), before, 'no shot');
    assert.deepEqual((await badges(sw)).filter((b) => b[1] === 'text' && b[2]), [], 'no badge: nothing ran');
  });

  it('the tab left in the meantime: the capture is dropped (another tab became the active one)', async () => {
    await quota();
    const tab = await tabOf(sw);
    const other = await h.context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await until(async () => !(await sw.evaluate((id) => chrome.tabs.get(id).then((t) => t.active), tab.id)), 'first tab no longer active');
    const before = await maxId(sw);
    assert.equal(await deliver({ type: 'popup-run', id: 'capture-visible', tab }), true);
    await sleep(900);
    assert.equal(await maxId(sw), before, 'no shot of the tab that is not active any more');
    await other.close();
    await page.bringToFront();
  });

  it('the long address of a page is kept whole for an area capture too (db.js caps every shot at 2048 characters, not the worker at 300)', async () => {
    await quota();
    const long = `${site.origin}/p800.html?q=${'a'.repeat(1500)}`;
    await page.goto(long);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete');
    await tabActive(sw, await tabOf(sw));
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await sw.evaluate((tab) => __t.startArea(tab), tab);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 6 });
    await page.mouse.up();
    await until(async () => (await badges(sw)).some((b) => b[1] === 'text' && b[2] === 'OK'), 'area captured', 15_000);
    const shot = await lastShot(sw);
    assert.equal(shot.url, long, 'the address of the page, whole');
    assert.equal(shot.url.length > 300, true);
  });
});

describe('popup: first paint', () => {
  it('cold (a new browser, nothing cached), then warm: complete paint well under the 100 ms budget; browser in French', async () => {
    const h = await launchExtension({ hook: false, instrumented: false, lang: 'fr' });
    try {
      const measure = (p) => p.evaluate(() => {
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
        return { fcp, mark: performance.getEntriesByName('obturo:popup-painted')[0]?.startTime ?? null, rows: document.querySelectorAll('[role=menuitem]').length };
      });
      const cold = await h.context.newPage();
      await cold.goto(h.url('popup.html'));
      await cold.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0 && !document.documentElement.classList.contains('pending'));
      const first = await measure(cold);
      assert.equal(first.rows, 9);
      assert.equal(await cold.locator('[data-id=open-settings] .label').textContent(), 'Paramètres', '"auto" follows the language of the browser');
      const warm = [];
      for (let i = 0; i < 7; i++) {
        await cold.reload();
        await cold.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0 && !document.documentElement.classList.contains('pending'));
        warm.push((await measure(cold)).fcp);
      }
      warm.sort((a, b) => a - b);
      console.log(`popup first paint: cold ${first.fcp?.toFixed(1)} ms (JS ready at ${first.mark?.toFixed(1)} ms), warm median ${warm[3].toFixed(1)} ms (max ${warm.at(-1).toFixed(1)})`);
      // cold, headless: the first frame of a new browser comes late whatever the page (~150-450 ms, it moves with the load of the machine:
      // 125-196 ms measured for the rows with an idle desktop and a web study running next to it); what the popup controls is the moment
      // its rows are in (JS ready, the page revealed), and the warm paint. 100 ms WARM is the budget of the bench; the cold limit is only an alarm.
      assert.ok(first.fcp !== null && first.mark !== null && first.mark < 250, `cold: rows in at ${first.mark} ms, first paint ${first.fcp} ms`);
      assert.ok(warm[3] < 100, `warm median ${warm[3]} ms`);
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });
});
