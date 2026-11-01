// Language and theme of the library, and the ways of opening a shot or the settings from outside:
// live language switch (dialog, then a message of another context), theme, library.html#shot=<id>,
// the 'open-shot' message of the service worker, library.html#settings.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, drag, mapper, poll, ready, resetLibrary, seed, seedSettings, spec, tool, waitOut } from './support/editor.mjs';

const BODY_BACKGROUND = { light: 'rgb(238, 241, 246)', dark: 'rgb(9, 14, 23)' }; // --bg of library.css

describe('library: language, theme, settings, opening a shot from outside', () => {
  let h, page;
  const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lang = () => page.evaluate(() => document.documentElement.lang);
  const text = (selector) => page.locator(selector).innerText();
  const openSettings = async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
  };
  const closeSettings = async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
  };
  // Posts on the channel of the extension from the service worker, as the capture code does. The worker may have been
  // stopped since the launch: then the page itself posts (another BroadcastChannel object of the same name).
  const fromWorker = async (messages) => {
    const post = (messages) => { const c = new BroadcastChannel('obturo'); for (const m of messages) c.postMessage(m); c.close(); };
    const sw = h.context.serviceWorkers()[0];
    if (sw) await sw.evaluate(post, messages).catch(() => page.evaluate(post, messages));
    else await page.evaluate(post, messages);
  };
  const library = (settings) => resetLibrary(page, h, [spec('First', 1600, 900), spec('Second', 1280, 720)], undefined, settings);

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  it('English by default in these tests; French texts come from the dictionary', async () => {
    await library();
    await ready(page);
    await waitOut(page, 1280, 720);
    assert.equal(await lang(), 'en');
    assert.equal(await text('[data-tool="flat"] .lbl'), 'Solid fill');
    assert.equal(await text('[data-tool="blur"] .lbl'), 'Blur');
    assert.equal(await page.getAttribute('#swatches input[value="#e53935"]', 'aria-label'), 'Red', 'swatches are named');
    assert.equal(await text('#download .lbl'), 'Download');
    assert.equal(await text('#downloadFmt'), 'PNG', 'the format a click produces');
    assert.equal(await page.getAttribute('#undo', 'aria-label'), 'Undo');
    assert.equal(await page.getAttribute('#undo', 'title'), 'Undo (Ctrl+Z)');
    assert.equal(await page.locator('#strip li.shot').first().locator('button.open').getAttribute('aria-label') !== null, true);
    assert.match(await page.locator('#strip li.shot').first().locator('button.open').getAttribute('aria-label'), /^Open the capture from /);
  });

  it('language switch from the settings dialog: live, no reload, texts already displayed follow', async () => {
    await page.evaluate(() => { window.__marker = 1; }); // proves the page is not reloaded
    await openSettings();
    assert.equal(await page.inputValue('dialog select[name="language"]'), 'en', 'English is the stored choice');
    assert.equal(await page.isChecked('dialog input[name="theme"][value="auto"]'), true, 'System theme by default');
    await page.selectOption('dialog select[name="language"]', 'fr');
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    assert.equal(await page.evaluate(() => window.__marker), 1, 'the page was reloaded');
    assert.equal(await text('[data-tool="flat"] .lbl'), 'Aplat', 'static text');
    assert.equal(await text('[data-tool="blur"] .lbl'), 'Flou');
    assert.equal(await page.getAttribute('#swatches input[value="#e53935"]', 'aria-label'), 'Rouge', 'the swatches built by code follow the language');
    assert.equal(await text('#download .lbl'), 'Télécharger');
    assert.equal(await text('#out'), 'Sortie\u00a0: 1280\u00a0×\u00a0720\u00a0px', 'dynamic text typed from code');
    assert.equal(await text('#versions button'), 'Original');
    assert.equal(await page.getAttribute('#undo', 'aria-label'), 'Annuler');
    assert.match(await page.locator('#strip li.shot').first().locator('button.open').getAttribute('aria-label'), /^Ouvrir la capture du /, 'text of the strip');
    assert.equal(await page.getAttribute('.upper-canvas', 'aria-label') !== null, true);
    assert.match(await page.getAttribute('.upper-canvas', 'aria-label'), /^Capture «\u00a0Second\u00a0»/, 'label of the canvas');
    assert.match(await text('#zoomLabel'), /^\d+\xa0%$/, 'number format of the language');
    assert.equal(await text('#settingsTitle'), 'Paramètres', 'the open dialog follows too');
    const stored = await page.evaluate(async () => (await (await import(`${location.origin}/settings.js`)).getSettings()).language);
    assert.equal(stored, 'fr', 'language saved');
    await page.selectOption('dialog select[name="language"]', 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await text('#out'), 'Output: 1280 × 720 px');
    await closeSettings();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'settingsBtn', 'focus goes back to the button that opened the dialog');
  });

  it('a banner already displayed changes language too', async () => {
    await page.evaluate(() => { window.__failDb = 'write'; });
    const m = await mapper(page, 1280, 720);
    await tool(page, 'rect'); await drag(page, m, 100, 100, 300, 200);
    await page.waitForSelector('#banner:not([hidden])', { timeout: 8000 });
    assert.match(await text('#banner'), /^Saving failed/);
    await page.evaluate(() => { window.__failDb = false; }); // the settings need a write
    await seedSettings(page, { language: 'fr' });
    await page.waitForFunction(() => document.getElementById('bannerText').textContent.startsWith("L'enregistrement a échoué"));
    await seedSettings(page, { language: 'en' });
    await page.waitForFunction(() => document.documentElement.lang === 'en');
  });

  it('the settings-changed message of another page switches language and theme without reload', async () => {
    await library();
    await ready(page);
    await waitOut(page, 1280, 720);
    await page.evaluate(() => { window.__marker = 2; });
    const other = await h.context.newPage();
    await other.goto(h.url('manifest.json'));
    await seedSettings(other, { language: 'fr', theme: 'dark' });
    await other.close();
    await page.waitForFunction(() => document.documentElement.lang === 'fr' && document.documentElement.dataset.theme === 'dark');
    assert.equal(await page.evaluate(() => window.__marker), 2, 'the page was reloaded');
    assert.equal(await bodyBackground(), BODY_BACKGROUND.dark);
    assert.equal(await text('#out'), 'Sortie\u00a0: 1280\u00a0×\u00a0720\u00a0px');
  });

  it('theme: manual choice, then follows the system again', async () => {
    await library({ language: 'en', theme: 'auto' });
    await ready(page);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await bodyBackground(), BODY_BACKGROUND.light, 'light system');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await bodyBackground(), BODY_BACKGROUND.dark, 'dark system, theme Auto');
    await openSettings();
    await page.check('dialog input[name="theme"][value="light"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await bodyBackground(), BODY_BACKGROUND.light, 'Light chosen on a dark system');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
    await page.check('dialog input[name="theme"][value="dark"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await bodyBackground(), BODY_BACKGROUND.dark, 'Dark chosen on a light system');
    await page.check('dialog input[name="theme"][value="auto"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === undefined);
    assert.equal(await bodyBackground(), BODY_BACKGROUND.light, 'back to the system (light)');
    const stored = await page.evaluate(async () => (await (await import(`${location.origin}/settings.js`)).getSettings()).theme);
    assert.equal(stored, 'auto');
    await closeSettings();
    await page.emulateMedia({ colorScheme: null });
  });

  it('settings: the Full page section keeps the wait and the fixed elements, in both languages', async () => {
    await library({ language: 'en' });
    await ready(page);
    const full = () => page.evaluate(async () => { const s = await (await import(`${location.origin}/settings.js`)).getSettings(); return [s.fullPageWait, s.fullPageFixed]; });
    await openSettings();
    assert.equal(await text('dialog section[data-section="full"] h3'), 'Full page');
    assert.equal(await page.locator('#fullPageWait').inputValue(), '0', 'automatic by default');
    assert.equal(await page.isChecked('dialog input[name="fullPageFixed"][value="edges"]'), true, 'fixed elements kept at the edges by default');
    assert.deepEqual(await page.locator('#fullPageWait option').evaluateAll((els) => els.map((e) => [e.value, e.textContent])), [['0', 'Automatic'], ['500', '0.5 s'], ['1000', '1 s'], ['2000', '2 s']]);
    await page.selectOption('#fullPageWait', '1000');
    await page.check('dialog input[name="fullPageFixed"][value="hide"]');
    await poll(async () => (await full()).join() === '1000,hide', { what: 'the full page settings are stored' });
    await page.selectOption('dialog select[name="language"]', 'fr');
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    assert.equal(await text('dialog section[data-section="full"] h3'), 'Page entière');
    assert.equal(await page.locator('#fullPageWait option:checked').innerText(), '1\u00a0s');
    assert.equal(await page.locator('#fullPageWait option[value="500"]').innerText(), '0,5\u00a0s', 'the number follows the language');
    await page.selectOption('dialog select[name="language"]', 'en');
    await closeSettings();
    await openSettings(); // reopened: what was stored is shown
    assert.equal(await page.locator('#fullPageWait').inputValue(), '1000');
    assert.equal(await page.isChecked('dialog input[name="fullPageFixed"][value="hide"]'), true);
    await page.selectOption('#fullPageWait', '0');
    await page.check('dialog input[name="fullPageFixed"][value="edges"]');
    await poll(async () => (await full()).join() === '0,edges', { what: 'back to the defaults' });
    await closeSettings();
  });

  it('settings: the No trace switch keeps its state, in both languages', async () => {
    await library({ language: 'en' });
    await ready(page);
    const noTrace = () => page.evaluate(async () => (await (await import(`${location.origin}/settings.js`)).getSettings()).noTrace);
    await openSettings();
    assert.equal(await text('dialog label[for="noTrace"]'), 'No trace');
    assert.equal(await page.isChecked('#noTrace'), false, 'off by default');
    assert.match(await text('dialog section[data-section="history"] .note >> nth=0'), /^Captures are copied to the clipboard and saved nowhere/);
    await page.check('#noTrace');
    await poll(async () => (await noTrace()) === true, { what: 'no trace stored' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('obturo.appearance')).noTrace), true, 'the copy that the popup reads');
    await page.selectOption('dialog select[name="language"]', 'fr');
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    assert.equal(await text('dialog label[for="noTrace"]'), 'Sans trace');
    assert.equal(await page.isChecked('#noTrace'), true, 'still on in French');
    await page.selectOption('dialog select[name="language"]', 'en');
    await closeSettings();
    await openSettings(); // reopened: what was stored is shown
    assert.equal(await page.isChecked('#noTrace'), true);
    await page.uncheck('#noTrace');
    await poll(async () => (await noTrace()) === false, { what: 'no trace off again' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('obturo.appearance')).noTrace), false);
    await closeSettings();
  });

  it('the editor shortcuts do not act behind the open dialog', async () => {
    await library();
    await ready(page);
    await waitOut(page, 1280, 720);
    const m = await mapper(page, 1280, 720);
    await tool(page, 'rect'); await drag(page, m, 100, 100, 300, 200); // drawn and selected
    await poll(async () => (await dbDump(page)).at(-1).versions[0]?.objects.length === 1, { what: 'rectangle saved' });
    await openSettings();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await closeSettings();
    await new Promise((done) => setTimeout(done, 900)); // absence to prove: the autosave would have fired by now
    assert.equal((await dbDump(page)).at(-1).versions[0].objects.length, 1, 'the rectangle was deleted behind the dialog');
  });

  it('library.html#shot=<id> opens that shot, not the most recent one', async () => {
    await library();
    const first = (await dbDump(page))[0];
    await page.goto(h.url('manifest.json')); // a real load: from library.html, a new #hash would only fire hashchange
    await page.goto(h.url(`library.html#shot=${first.id}`));
    await ready(page);
    await waitOut(page, 1600, 900);
    assert.equal(await page.locator('#strip li.shot[aria-current="true"]').getAttribute('data-id'), String(first.id));
    await page.goto(h.url('manifest.json'));
    await page.goto(h.url('library.html#shot=99999')); // unknown: the most recent one
    await ready(page);
    await waitOut(page, 1280, 720);
  });

  it("the 'open-shot' message of the service worker opens a shot added meanwhile, in a tab already open", async () => {
    await library();
    await ready(page);
    await waitOut(page, 1280, 720);
    await page.evaluate(() => { window.__marker = 3; });
    const other = await h.context.newPage();
    await other.goto(h.url('manifest.json'));
    await seed(other, spec('Third', 1000, 500));
    await other.close();
    const third = (await dbDump(page)).find((s) => s.title === 'Third');
    await fromWorker([{ type: 'open-shot', id: third.id }]);
    await waitOut(page, 1000, 500);
    assert.equal(await page.locator('#strip li.shot[aria-current="true"]').getAttribute('data-id'), String(third.id));
    assert.equal(await page.locator('#strip li.shot').count(), 3, 'the new shot is in the strip');
    assert.equal(await page.evaluate(() => window.__marker), 3, 'the page was reloaded');
    // The same message again, and for a shot that does not exist: nothing happens, nothing breaks.
    await fromWorker([{ type: 'open-shot', id: third.id }, { type: 'open-shot', id: 424242 }]);
    await new Promise((done) => setTimeout(done, 500));
    assert.equal(await text('#out'), 'Output: 1000 × 500 px');
  });

  it('the copy of the language and the theme (localStorage): shown at once, corrected by the stored settings, rebuilt if missing', async () => {
    const copy = () => page.evaluate(() => JSON.parse(localStorage.getItem('obturo.appearance') ?? 'null'));
    await library({ language: 'en', theme: 'dark' }); // setSettings writes the copy
    await ready(page);
    assert.deepEqual(await copy(), { language: 'en', theme: 'dark', noTrace: false });
    // A stale copy (French, light) while the database says English, dark: the copy shows first, the database wins.
    await page.evaluate(() => localStorage.setItem('obturo.appearance', JSON.stringify({ language: 'fr', theme: 'light' })));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.lang === 'en' && document.documentElement.dataset.theme === 'dark');
    await ready(page);
    await waitOut(page, 1280, 720);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('obturo.appearance')).language === 'en');
    assert.deepEqual(await copy(), { language: 'en', theme: 'dark', noTrace: false }, 'the copy was repaired');
    // No copy (first visit, cleared data): the page waits for the database and writes the copy.
    await page.evaluate(() => localStorage.removeItem('obturo.appearance'));
    await page.reload();
    await page.waitForFunction(() => !document.documentElement.classList.contains('pending'));
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.deepEqual(await copy(), { language: 'en', theme: 'dark', noTrace: false }, 'the copy was rebuilt');
  });

  // Records, before any script of the page, when data-theme appears on <html> and when the first paint happens, and every Intl number
  // format built (with its time), to compare them with the marks of the library. On a page of its own, so that the init script
  // does not follow the other tests around; the shared page lets go of the editing lock first (a second library tab is read-only).
  const watchedPage = async () => {
    await page.goto(h.url('manifest.json'));
    const watched = await h.context.newPage();
    await watched.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__start = { themeAt: null, themeState: null, paints: [], numberFormats: [] };
      new MutationObserver(() => { if (w.__start.themeAt === null && document.documentElement?.dataset.theme) { w.__start.themeAt = performance.now(); w.__start.themeState = document.readyState; } })
        .observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__start.paints.push([e.name, e.startTime]); }).observe({ type: 'paint', buffered: true });
      const NumberFormat = Intl.NumberFormat;
      const Wrapped = /** @type {any} */ (function (/** @type {any[]} */ ...args) { w.__start.numberFormats.push(performance.now()); return new NumberFormat(...args); });
      Wrapped.prototype = NumberFormat.prototype;
      Wrapped.supportedLocalesOf = NumberFormat.supportedLocalesOf;
      Intl.NumberFormat = Wrapped;
    });
    return watched;
  };

  it('an explicit theme is on <html> before the first paint (theme-boot.js), not after the modules ran', async () => {
    await library({ language: 'en', theme: 'dark' }); // the system is light here: the page must not paint light first
    await ready(page);
    const watched = await watchedPage();
    try {
      for (let i = 0; i < 6; i++) {
        await watched.goto(h.url());
        await watched.bringToFront(); // a page that is not shown does not paint
        await watched.waitForFunction(() => performance.getEntriesByName('obturo:strip-painted').length > 0);
        await watched.waitForFunction(() => /** @type {any} */ (window).__start.paints.some(([name]) => name === 'first-paint')); // delivered a moment after the frame
        const s = await watched.evaluate(() => /** @type {any} */ (window).__start);
        const first = s.paints.find(([name]) => name === 'first-paint')?.[1];
        assert.ok(typeof first === 'number' && s.themeAt !== null, `load ${i}: a first paint and a theme (${JSON.stringify(s)})`);
        assert.equal(s.themeState, 'loading', `load ${i}: data-theme set by a script of the <head> while the page is parsed, not by a module after the parse (${s.themeState})`);
        assert.ok(s.themeAt <= first, `load ${i}: data-theme set at ${s.themeAt} ms, after the first paint at ${first} ms`);
        assert.equal(await watched.evaluate(() => document.documentElement.dataset.theme), 'dark');
      }
    } finally {
      await watched.close();
    }
  });

  it('no number format is built before the strip is rendered: "All history" and its count come after the first paint', async () => {
    await library({ language: 'fr', theme: 'auto' });
    await ready(page);
    const watched = await watchedPage();
    try {
      await watched.goto(h.url());
      await watched.waitForFunction(() => document.getElementById('historyAllCount')?.textContent === '2');
      const s = await watched.evaluate(() => ({ ...(/** @type {any} */ (window).__start), rendered: performance.getEntriesByName('obturo:strip-rendered')[0].startTime, painted: performance.getEntriesByName('obturo:strip-painted')[0].startTime }));
      assert.ok(s.numberFormats.length >= 1, 'the count is formatted');
      assert.ok(s.numberFormats.every((at) => at > s.painted), `a number format at ${s.numberFormats} ms, before the strip was painted (${s.rendered} rendered, ${s.painted} painted)`);
      assert.equal(await watched.getAttribute('#historyAll', 'aria-label'), "Ouvrir tout l'historique. Captures\u00a0: 2");
      await seedSettings(page, { language: 'en' });
      await watched.waitForFunction(() => document.getElementById('historyAll').getAttribute('aria-label') === 'Open the whole history. Captures: 2');
    } finally {
      await watched.close();
    }
  });

  it("the 'open-settings' message (icon menu) opens the dialog in a tab that is already open", async () => {
    await library();
    await ready(page);
    await fromWorker([{ type: 'open-settings' }]);
    await page.waitForSelector('dialog#settings[open]');
    await fromWorker([{ type: 'open-settings' }]); // already open: nothing to do, nothing breaks
    await closeSettings();
    await fromWorker([{ type: 'open-settings' }]); // and again after it was closed
    await page.waitForSelector('dialog#settings[open]');
    await closeSettings();
  });

  it('a settings change also goes out as a runtime message, which wakes a stopped service worker', async () => {
    await library();
    await ready(page);
    await page.evaluate(() => {
      window.__sent = [];
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => { window.__sent.push(args[0]); return send(...args); };
    });
    await seedSettings(page, { language: 'en' });
    assert.deepEqual(await page.evaluate(() => window.__sent), [{ type: 'settings-changed' }]);
  });

  it('library.html#settings opens the settings dialog; Esc closes it and clears the address', async () => {
    await library();
    await page.goto(h.url('manifest.json'));
    await page.goto(h.url('library.html#settings'));
    await page.waitForSelector('dialog#settings[open]');
    assert.equal(await text('#settingsTitle'), 'Settings');
    await ready(page);
    await closeSettings();
    await page.waitForFunction(() => location.hash === ''); // the close event comes a task after the attribute changes
  });

  it('no console error and no CSP violation over the whole session', async () => {
    const csp = await page.evaluate(() => window.__csp).catch(() => []);
    assert.deepEqual(csp, [], 'CSP violations');
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), [], 'console errors');
  });
});
