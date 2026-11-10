// The no-trace mode, in the real extension: a capture is copied and saved nowhere (the three kinds), "and edit" is refused with the reason,
// the icon, the tooltip and the menu follow the setting, a copy that fails says so, and turning the mode off brings the history back.
// The service worker is the one of the package; the test copy only gets host_permissions (no user gesture is possible) and the hook.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  RED, badges, clipSize, closeLibraries, finalBadge, libraryPages, menuState, quota, resetBadges, startSite, stopServiceWorker, tabActive, tabOf, until, waitBadge,
} from './support/capture.mjs';
import { seedSettings } from './support/editor.mjs';
import enSw from '../../locales/en.sw.js';
import frSw from '../../locales/fr.sw.js';

const VIOLET = '#7c3aed';
const GREEN = '#26a269';

describe('no trace: copy only, nothing saved', () => {
  let h, site, page, sw, viewport;
  const call = (name, tab) => sw.evaluate(([n, t]) => __t[n](t), [name, tab]);
  const run = (name, tab) => sw.evaluate(([n, t]) => __t.run(n, t), [name, tab]);
  const count = () => sw.evaluate(async () => (await __t.db.queryShots({ limit: 1000 })).items.length);
  const setNoTrace = (on) => sw.evaluate((on) => __t.settings.setSettings({ noTrace: on }), on);
  const title = () => sw.evaluate(() => chrome.action.getTitle({}));
  const noticeText = () => page.evaluate(() => document.getElementById('obturo-notice')?.shadowRoot?.textContent ?? null);
  /** The entries of the menu as the last rebuild left them, once `check` holds. */
  const menuWhere = (check, what) => until(async () => { const s = await menuState(sw); return check(s.items) ? s.items : null; }, what);

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await sw.evaluate(() => __t.settings.setSettings({ language: 'en', noTrace: false }));
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p2500.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.documentElement.scrollHeight >= 2500 && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
    viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('off (the default): a capture is saved, as always', async () => {
    await quota();
    const before = await count();
    await call('capture', await tabOf(sw));
    assert.equal(await count(), before + 1);
    assert.equal(await title(), 'Obturo');
  });

  it('on: the visible part is copied and saved nowhere, violet OK badge, the tooltip and the menu follow', async () => {
    const menus = (await menuState(sw)).rebuilds;
    await setNoTrace(true);
    await until(async () => (await title()) === 'Obturo (no trace)', 'the tooltip says it');
    const items = await menuWhere((list) => list.length === 12 && list.find((i) => i.id === 'capture-edit')?.enabled === false, '"Capture and edit" greyed out in the menu');
    assert.equal(items.find((i) => i.id === 'capture')?.enabled, undefined, 'a plain capture still works');
    assert.ok((await menuState(sw)).rebuilds > menus, 'the menu was rebuilt');
    await quota();
    const before = await count();
    await resetBadges(sw);
    await call('capture', await tabOf(sw));
    assert.deepEqual(await finalBadge(sw), ['OK', VIOLET]);
    assert.deepEqual(await clipSize(page), [Math.round(viewport[0] * viewport[2]), Math.round(viewport[1] * viewport[2])], 'the image is on the clipboard');
    assert.equal(await count(), before, 'nothing in the history');
    assert.equal(await libraryPages(h).length, 0, 'no library opened');
  });

  it('on: an area is copied and saved nowhere', async () => {
    await quota();
    const tab = await tabOf(sw);
    const before = await count();
    await resetBadges(sw);
    await call('startArea', tab);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(700, 500, { steps: 8 });
    await page.mouse.up();
    await waitBadge(sw, 'OK');
    assert.deepEqual(await finalBadge(sw), ['OK', VIOLET]);
    const [w, h2] = await clipSize(page);
    assert.ok(Math.abs(w - 600 * viewport[2]) <= 2 && Math.abs(h2 - 400 * viewport[2]) <= 2, `${w}x${h2}: the area, on the clipboard`);
    assert.equal(await count(), before, 'nothing in the history');
  });

  it('on: the full page is copied and saved nowhere', async () => {
    await quota();
    const before = await count();
    await resetBadges(sw);
    await call('captureFull', await tabOf(sw));
    assert.deepEqual(await finalBadge(sw), ['OK', VIOLET]);
    const [w, h2] = await clipSize(page);
    assert.ok(h2 > viewport[1] * viewport[2] * 2, `${w}x${h2}: taller than two windows: the whole page`);
    assert.equal(await count(), before, 'nothing in the history');
  });

  it('on: "and edit" is refused with the reason, in the page: nothing captured, nothing copied, no library, no overlay', async () => {
    // the clipboard holds the full page now: a visible capture would replace it with the window
    const [w0, h0] = await clipSize(page);
    for (const name of ['capture-visible-edit', 'capture-full-edit', 'capture-area-edit', 'capture-element-edit']) {
      await quota();
      const before = await count();
      await resetBadges(sw);
      await run(name, await tabOf(sw));
      await until(async () => (await noticeText()) !== null, `the page says why (${name})`);
      assert.ok((await noticeText()).includes(enSw['sw.noTrace.edit']), `${name}: ${await noticeText()}`);
      assert.equal(await count(), before, `${name}: nothing saved`);
      assert.equal(await page.locator('#obturo-overlay, #obturo-element').count(), 0, `${name}: no area or element selection`);
      assert.equal(libraryPages(h).length, 0, `${name}: no library`);
      assert.deepEqual(await clipSize(page), [w0, h0], `${name}: the clipboard is as it was`);
      assert.equal((await badges(sw)).filter((b) => b[1] === 'text' && ['OK', '!', 'ERR'].includes(b[2])).length, 0, `${name}: no result badge`);
    }
  });

  it('on: a copy that fails says so, and the image is nowhere (red badge, a note in the page)', async () => {
    await quota();
    const before = await count();
    await resetBadges(sw);
    await sw.evaluate(() => { globalThis.__failCopy = true; });
    await call('capture', await tabOf(sw));
    await sw.evaluate(() => { globalThis.__failCopy = false; });
    assert.deepEqual(await finalBadge(sw), ['ERR', RED]);
    await until(async () => (await noticeText())?.includes(enSw['sw.noTrace.copyFailed']), 'the note about the failed copy');
    assert.equal(await count(), before, 'nothing in the history');
  });

  it('turned off again: the history is back, the tooltip, the icon and the menu too', async () => {
    await setNoTrace(false);
    await until(async () => (await title()) === 'Obturo', 'the tooltip is back');
    const items = await menuWhere((list) => list.length === 12 && list.find((i) => i.id === 'capture-edit')?.enabled === undefined, '"Capture and edit" back in the menu');
    assert.equal(items.length, 12);
    await quota();
    const before = await count();
    await resetBadges(sw);
    await call('capture', await tabOf(sw));
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    assert.equal(await count(), before + 1, 'saved again');
  });

  it('the capture and edit variants work again once the mode is off', async () => {
    await setNoTrace(true);
    await until(async () => (await title()) === 'Obturo (no trace)', 'on');
    await setNoTrace(false);
    await until(async () => (await title()) === 'Obturo', 'off');
    await quota();
    const before = await count();
    await run('capture-visible-edit', await tabOf(sw));
    await until(async () => (await count()) === before + 1 && libraryPages(h).length === 1, 'captured and opened in the library');
  });

  it('a capture follows the settings it started with, whatever is changed while it runs', async () => {
    await closeLibraries(h);
    await page.bringToFront();
    await tabActive(sw, await tabOf(sw));
    await quota();
    const before = await count();
    await resetBadges(sw);
    await sw.evaluate(() => {
      const grab = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
      chrome.tabs.captureVisibleTab = async (...args) => {
        const png = await grab(...args);
        await __t.settings.setSettings({ noTrace: true });
        return png;
      };
      globalThis.__restoreGrab = () => { chrome.tabs.captureVisibleTab = grab; };
    });
    try {
      await call('capture', await tabOf(sw));
    } finally {
      await sw.evaluate(() => globalThis.__restoreGrab());
      await setNoTrace(false);
    }
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    assert.equal(await count(), before + 1, 'kept in the history: the capture began with no trace off');
  });

  it('on a worker that has not set its language yet, the note of "and edit" comes in the language of the settings', async () => {
    await sw.evaluate(() => __t.settings.setSettings({ language: 'fr', noTrace: true }));
    await menuWhere((list) => list.find((i) => i.id === 'capture-edit')?.enabled === false, 'the menu follows the settings');
    try {
      await sw.evaluate((tab) => { __t.i18n.setLanguage('en'); return __t.run('capture-visible-edit', tab); }, await tabOf(sw));
      await until(async () => (await noticeText())?.includes(frSw['sw.noTrace.edit']), 'the note, in French');
    } finally {
      await sw.evaluate(() => __t.settings.setSettings({ language: 'en', noTrace: false }));
    }
  });

  it('no console error over the whole session (the 404 of the test page for its icon is not ours)', () => {
    assert.deepEqual(h.errors.filter((e) => !e.includes('Failed to load resource')), []);
  });
});

describe('no trace: the mode lives in the settings, not in the worker', () => {
  it('a worker that restarts puts the tooltip and the menu back from the stored setting', async () => {
    const h = await launchExtension({ hook: true, instrumented: false, lang: 'en-US' });
    try {
      const page = await h.context.newPage();
      await page.goto(h.url('manifest.json'));
      const title = () => page.evaluate(() => chrome.action.getTitle({}));
      await seedSettings(page, { language: 'en', noTrace: true });
      await until(async () => (await title()) === 'Obturo (no trace)', 'the tooltip says it');
      await stopServiceWorker(h, page);
      await page.evaluate(() => chrome.action.setTitle({ title: 'something else' })); // what a stopped worker cannot undo
      assert.equal(await title(), 'something else');
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings-changed' })); // wakes a new worker up
      await until(async () => (await title()) === 'Obturo (no trace)', 'the new worker reads the setting and sets the tooltip again', 20_000);
      await seedSettings(page, { noTrace: false });
      await until(async () => (await title()) === 'Obturo', 'and off again', 20_000);
    } finally {
      await h.close();
    }
  });
});
