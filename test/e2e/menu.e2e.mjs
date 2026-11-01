// The icon's right-click menu, the commands and the texts of the manifest, in the real extension. A native menu cannot
// be opened in a test: we check what the service worker asks of chrome.contextMenus (and the answer of Chrome), then
// what each entry does through the dispatch table that the clicks and the shortcuts share (__t.run).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  announceSettings, closeLibraries, libraryPages, listenChannel, menuPasses, menuRebuilt, menuState, received, recordMenu, sleep, stopServiceWorker, until,
} from './support/capture.mjs';

const LEAVES = ['capture-area', 'capture-visible', 'capture-full', 'capture-element', 'capture-area-edit', 'capture-visible-edit', 'capture-full-edit', 'capture-element-edit'];
const titles = (items) => items.map((i) => i.title);
const iconTitle = (sw) => sw.evaluate(() => chrome.action.getTitle({}));

describe('icon menu in the real extension', () => {
  let h, sw;

  before(async () => {
    // an explicit browser language: without it, Chromium follows the one of the machine, and 'auto' would follow it too
    h = await launchExtension({ hook: true, instrumented: false, lang: 'en-US' });
    sw = h.sw;
    await recordMenu(sw);
  });
  after(() => h?.close());

  it('rebuilt on a settings change: Capture / Capture and edit submenus, library, settings, English by default', async () => {
    await announceSettings(sw);
    const { items, errors } = await menuRebuilt(sw, 0);
    assert.deepEqual(errors, [], 'Chrome accepted every entry');
    assert.deepEqual(items.map((i) => i.id), [
      'capture', ...LEAVES.slice(0, 4), 'capture-edit', ...LEAVES.slice(4), 'open-library', 'open-settings',
    ]);
    assert.deepEqual(titles(items), [
      'Capture', 'Area', 'Visible part', 'Full page', 'Element', 'Capture and edit', 'Area', 'Visible part', 'Full page', 'Element', 'Open the library', 'Settings',
    ]);
    assert.deepEqual(items.filter((i) => i.parentId === 'capture').map((i) => i.id), LEAVES.slice(0, 4));
    assert.deepEqual(items.filter((i) => i.parentId === 'capture-edit').map((i) => i.id), LEAVES.slice(4));
    assert.ok(items.every((i) => i.contexts.length === 1 && i.contexts[0] === 'action'));
    assert.equal(await iconTitle(sw), 'Obturo', 'the tooltip of the icon');
  });

  it('under the limit that Chrome documents for the icon menu (more top-level entries would be ignored)', async () => {
    const limit = await sw.evaluate(() => chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT);
    assert.equal(limit, 6);
    const { items } = await menuState(sw);
    assert.ok(items.filter((i) => !i.parentId).length <= limit, 'top-level entries');
  });

  it('several rebuilds at once: no duplicate id, the menu is complete in the end', async () => {
    const before = (await menuState(sw)).rebuilds;
    await sw.evaluate(() => {
      const channel = new BroadcastChannel('obturo');
      for (let i = 0; i < 4; i++) channel.postMessage({ type: 'settings-changed' });
      channel.close();
    });
    await menuRebuilt(sw, before);
    await sleep(500); // a second pass, if the rebuilds overlapped, would show up here
    const { items, errors } = await menuState(sw);
    assert.deepEqual(errors, [], 'no "duplicate id" or any other error');
    assert.equal(items.length, 12);
  });

  it('a page that tells the worker through the runtime (which also wakes it up) gets a rebuild too', async () => {
    const before = (await menuState(sw)).rebuilds;
    const page = await h.context.newPage();
    await page.goto(h.url('library.html'));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings-changed' }));
    await menuRebuilt(sw, before);
    await page.close();
  });

  it('language chosen in the settings: the menu follows (French, then back to the browser language)', async () => {
    const page = await h.context.newPage();
    await page.goto(h.url('library.html'));
    const change = (language) => page.evaluate(async (language) => {
      const module = './settings.js'; // not a literal: the page resolves it, not the type checker
      const { setSettings } = await import(module);
      await setSettings({ language });
    }, language);
    try {
      let rebuilds = (await menuState(sw)).rebuilds;
      await change('fr');
      let { items, errors } = await menuRebuilt(sw, rebuilds);
      assert.deepEqual(titles(items), [
        'Capturer', 'Zone', 'Partie visible', 'Page entière', 'Élément', 'Capturer et éditer', 'Zone', 'Partie visible', 'Page entière', 'Élément', 'Ouvrir la bibliothèque', 'Paramètres',
      ]);
      assert.equal(await iconTitle(sw), 'Obturo', 'the tooltip of the icon follows the language chosen, not the one of the browser');
      rebuilds = (await menuState(sw)).rebuilds;
      await change('auto');
      ({ items, errors } = await menuRebuilt(sw, rebuilds));
      assert.equal(titles(items)[0], 'Capture');
      assert.equal(await iconTitle(sw), 'Obturo', 'back to the language of the browser');
      assert.deepEqual(errors, []);
    } finally {
      await change('auto');
      await page.close();
    }
  });
});

describe('a service worker that starts again', () => {
  it('clears the badge a dead worker left behind (the "n/m" of a full page, a result that was never erased)', async () => {
    const h = await launchExtension({ hook: true, instrumented: false, lang: 'en-US' });
    try {
      const page = await h.context.newPage();
      await page.goto(h.url('manifest.json'));
      const badge = () => page.evaluate(() => chrome.action.getBadgeText({}));
      // what a full page shows while it works; set from the worker itself, so that it comes after the clear that the worker made
      // when it started (two processes talking to the browser are not ordered)
      await h.sw.evaluate(() => chrome.action.setBadgeText({ text: '3/9' }));
      assert.equal(await badge(), '3/9');
      await stopServiceWorker(h, page); // the worker dies mid-capture: nobody will clear the badge
      // (no assertion that the badge is still there: the browser may start the next worker on its own at any moment)
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings-changed' })); // wakes a new worker up
      await until(async () => (await badge()) === '', 'badge cleared by the new worker', 20_000);
      assert.equal(await page.evaluate(() => chrome.action.getTitle({})), 'Obturo', 'the title is set again too');
    } finally {
      await h.close();
    }
  });
});

describe('what the entries and the shortcuts do (one dispatch table)', () => {
  let h, sw, page;
  const run = (name) => sw.evaluate((n) => __t.run(n, undefined), name);
  const libs = () => libraryPages(h);

  before(async () => {
    h = await launchExtension({ hook: true, instrumented: false, realWindow: true });
    sw = h.sw;
    page = await h.context.newPage();
    await page.goto('about:blank');
  });
  after(() => h?.close());

  it('"Open the library": a tab at library.html, none duplicated', async () => {
    await run('open-library');
    const lib = await until(() => libs()[0], 'library tab');
    assert.equal(lib.url(), h.url('library.html'));
    await run('open-library');
    await sleep(500);
    assert.equal(libs().length, 1);
  });

  it('"Settings" with the library open: the same tab, and the message that tells it to show the settings', async () => {
    const [lib] = libs();
    await listenChannel(lib);
    await lib.evaluate(() => { /** @type {any} */ (window).__kept = true; });
    await page.bringToFront();
    await run('open-settings');
    await until(async () => (await received(lib)).some((m) => m?.type === 'open-settings'), 'open-settings message');
    assert.equal(libs().length, 1);
    await until(() => lib.url() === `${h.url('library.html')}#settings`, 'address of the tab changed to #settings (hashchange, no reload)');
    assert.equal(await lib.evaluate(() => /** @type {any} */ (window).__kept), true, 'same document: the page was not reloaded');
    // integration with the page: the settings dialog is open
    await until(() => lib.evaluate(() => !!document.querySelector('dialog[open]')), 'settings dialog open');
  });

  it('"Settings" without a library tab: a new tab opened at library.html#settings', async () => {
    await closeLibraries(h);
    await run('open-settings');
    const lib = await until(() => libs()[0], 'library tab');
    assert.equal(lib.url(), `${h.url('library.html')}#settings`);
  });

  it('an unknown name, or one from the prototype, does nothing', async () => {
    await closeLibraries(h);
    for (const name of ['nothing', 'constructor', '__proto__', 'toString', '']) await run(name);
    await sleep(500);
    assert.equal(libs().length, 0);
  });
});

describe('manifest texts in the real browser', () => {
  /** @param {string} [lang] */
  async function shown(lang) {
    const h = await launchExtension({ hook: true, instrumented: false, lang });
    try {
      const inWorker = await h.sw.evaluate(() => ({
        ui: chrome.i18n.getUILanguage(),
        name: chrome.i18n.getMessage('extName'),
        description: chrome.i18n.getMessage('extDescription'),
        manifest: chrome.runtime.getManifest(),
      }));
      // what the person sees in chrome://extensions
      const page = await h.context.newPage();
      await page.goto('chrome://extensions');
      const item = page.locator('extensions-item').first();
      await item.waitFor({ timeout: 15_000 });
      return { ...inWorker, listed: { name: await item.locator('#name').innerText(), description: await item.locator('#description').innerText() } };
    } finally {
      await h.close();
    }
  }

  it('loaded unpacked, in English: the extension is called Obturo, texts resolved', async () => {
    const s = await shown('en-US');
    assert.match(s.ui, /^en/);
    assert.equal(s.name, 'Obturo');
    assert.deepEqual(s.listed, { name: 'Obturo', description: s.manifest.description }, 'chrome://extensions');
    assert.equal(s.manifest.name, 'Obturo');
    assert.equal(s.manifest.description, 'Capture, annotate and keep your screenshots. 100% local, no account.');
    assert.equal(s.manifest.action.default_title, 'Obturo');
    assert.equal(s.manifest.commands['capture-full-edit'].description, 'Capture the full page and edit');
  });

  it('in a French browser: still Obturo, description and commands in French', async () => {
    const s = await shown('fr');
    assert.match(s.ui, /^fr/);
    assert.deepEqual(s.listed, { name: 'Obturo', description: s.manifest.description }, 'chrome://extensions');
    assert.equal(s.manifest.name, 'Obturo');
    assert.match(s.manifest.description, /^Capture, annote et garde tes captures/);
    assert.equal(s.manifest.commands['capture-area-edit'].description, 'Capturer une zone et éditer');
  });
});

// The menu is rebuilt by ONE chain, one entry at a time. Seen on Vivaldi: "Capture" had its submenu arrow and "Capture and edit"
// did not, i.e. a parent shown without its children. The causes this closes: removeAll then ten create calls fired without
// waiting for each answer, rebuilds triggered by the start, onInstalled, onStartup and 'settings-changed' running over each other,
// and answers (lastError) never read. The expected tree is checked pass by pass, from the record of the calls the worker made.
const TREE = [
  ['capture', undefined], ['capture-area', 'capture'], ['capture-visible', 'capture'], ['capture-full', 'capture'], ['capture-element', 'capture'],
  ['capture-edit', undefined], ['capture-area-edit', 'capture-edit'], ['capture-visible-edit', 'capture-edit'], ['capture-full-edit', 'capture-edit'], ['capture-element-edit', 'capture-edit'],
  ['open-library', undefined], ['open-settings', undefined],
];
const shapeOf = (creates) => creates.map((c) => [c.id, c.parentId]);

describe('icon menu: one serialized rebuild', () => {
  let h;
  before(async () => { h = await launchExtension({ hook: true, instrumented: false, lang: 'en-US' }); });
  after(() => h?.close());

  it('every pass of the worker is the whole tree, parents before their children, in order, with no error from Chrome', async () => {
    await until(async () => (await menuPasses(h.sw)).length >= 1 && (await menuPasses(h.sw)).at(-1).creates.length === 12, 'first build');
    await sleep(300);
    const passes = await menuPasses(h.sw);
    assert.ok(passes.length >= 1 && passes.length <= 2, `${passes.length} pass(es) for the start of the worker and onInstalled`);
    for (const p of passes) {
      assert.deepEqual(shapeOf(p.creates), TREE);
      assert.deepEqual(p.errors, []);
    }
    const top = TREE.filter(([, parent]) => !parent).length;
    assert.ok(top <= (await h.sw.evaluate(() => chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT)), 'top-level entries, separators included (there is none)');
    assert.ok(passes.every((p) => p.creates.every((c) => c.type === undefined)), 'no separator');
  });

  it('requests that pile up (channel, runtime message, start-up events) end in at most two whole passes, never interleaved', async () => {
    const sw = h.sw;
    const before = (await menuPasses(sw)).length;
    await sw.evaluate(() => {
      const channel = new BroadcastChannel('obturo');
      for (let i = 0; i < 8; i++) channel.postMessage({ type: 'settings-changed' });
      channel.close();
    });
    const page = await h.context.newPage();
    await page.goto(h.url('library.html'));
    await Promise.all([1, 2, 3].map(() => page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings-changed' }))));
    await page.close();
    await until(async () => (await menuPasses(sw)).length > before, 'a new pass');
    await sleep(800);
    const passes = (await menuPasses(sw)).slice(before);
    assert.ok(passes.length >= 1 && passes.length <= 2, `${passes.length} passes for 11 requests`);
    for (const p of passes) {
      assert.deepEqual(shapeOf(p.creates), TREE, 'a pass is never cut by another one');
      assert.deepEqual(p.errors, []);
    }
  });

  it('language change: the next pass is the whole tree in French, still with no error', async () => {
    const sw = h.sw;
    const page = await h.context.newPage();
    await page.goto(h.url('library.html'));
    const change = (language) => page.evaluate(async (language) => {
      const module = './settings.js';
      const { setSettings } = await import(module);
      await setSettings({ language });
    }, language);
    try {
      const before = (await menuPasses(sw)).length;
      await change('fr');
      await until(async () => { const p = await menuPasses(sw); return p.length > before && p.at(-1).creates.length === 12 && p.at(-1).creates[0].title === 'Capturer'; }, 'French pass');
      await sleep(400);
      const last = (await menuPasses(sw)).at(-1);
      assert.deepEqual(shapeOf(last.creates), TREE);
      assert.deepEqual(last.creates.map((c) => c.title), ['Capturer', 'Zone', 'Partie visible', 'Page entière', 'Élément', 'Capturer et éditer', 'Zone', 'Partie visible', 'Page entière', 'Élément', 'Ouvrir la bibliothèque', 'Paramètres']);
      assert.deepEqual(last.errors, []);
    } finally {
      await change('auto');
      await page.close();
    }
  });

  it('an error that Chrome answers to a create is logged (console.error, ASCII) and the rest of the tree is still built', async () => {
    const sw = h.sw;
    await sw.evaluate(() => {
      globalThis.__errors = [];
      const log = console.error;
      console.error = (...a) => { globalThis.__errors.push(a.join(' ')); log(...a); };
      const api = /** @type {any} */ (chrome.contextMenus);
      const create = api.create;
      let first = true;
      api.create = (props, cb) => create.call(api, first ? ((first = false), { ...props, parentId: 'no-such-parent' }) : props, cb); // the first entry gets an impossible parent
    });
    const before = (await menuPasses(sw)).length;
    await announceSettings(sw);
    await until(async () => (await menuPasses(sw)).length > before, 'a pass with the failing create');
    await sleep(600);
    const errors = await sw.evaluate(() => globalThis.__errors);
    assert.ok(errors.some((e) => /^Obturo: create capture: .*no-such-parent/.test(e)), JSON.stringify(errors));
    assert.ok(errors.every((e) => /^[\x20-\x7e]+$/.test(e)), 'ASCII only');
    const last = (await menuPasses(sw)).at(-1);
    assert.equal(last.creates.length, 12, 'the other entries were still created');
  });
});
