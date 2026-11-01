// "After a capture: ask what to do" (the default), in the real extension: a capture of any kind is kept (and not copied), a page opens in a tab next to
// the captured one and offers the actions (edit, copy, download as PNG, JPEG, WebP or PDF), each one does what it says and closes the tab (the
// captured page is back), "and edit" and the no-trace mode never ask, and the page only obeys its own tab. The service worker is the one of the package; the
// test copy only gets host_permissions and the hook (no gesture is possible), and keeps the REAL defaults (the other capture tests ask for the copy).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DPR, launchExtension } from './support/browser.mjs';
import { GREEN, badges, clipSize, finalBadge, libraryPages, maxId, quota, resetBadges, sleep, startSite, tabActive, tabOf, until } from './support/capture.mjs';
import { sha256 } from './support/editor.mjs';

describe('after a capture: ask what to do', () => {
  let h, site, page, sw;
  const call = (name, tab) => sw.evaluate(([n, t]) => __t[n](t), [name, tab]);
  const run = (name, tab) => sw.evaluate(([n, t]) => __t.run(n, t), [name, tab]);
  const set = (patch) => sw.evaluate((p) => __t.settings.setSettings(p), patch);
  const choosers = () => h.context.pages().filter((p) => p.url().split(/[?#]/)[0] === h.url('chooser.html'));
  const shotCount = () => sw.evaluate(async () => (await __t.db.queryShots({ limit: 1000 })).items.length);
  const original = (id) => sw.evaluate(async (id) => Array.from(new Uint8Array(await (await __t.db.getOriginal(id)).arrayBuffer())), id);
  const closeLibraries = async () => { for (const p of libraryPages(h)) await p.close(); };
  const closeChoosers = async () => { for (const p of choosers()) await p.close().catch(() => {}); };
  /** The page of actions that appears (in a tab) after `start`, once its capture is on screen. */
  const opened = async (start, before = new Set(choosers())) => {
    const maxBefore = await maxId(sw);
    await resetBadges(sw);
    await start();
    const win = await until(() => choosers().find((p) => !before.has(p)), 'the page of actions', 8000);
    await win.waitForSelector('#preview:not([hidden])');
    const id = await maxId(sw);
    assert.equal(id, maxBefore + 1, 'one capture kept');
    return { win, id };
  };
  /** Takes the visible part and waits for the page of actions. */
  const capture = async () => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    return opened(() => call('capture', tab));
  };

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realDefaults: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await set({ language: 'en' }); // nothing else is touched: the defaults are the ones of a fresh install
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p800.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
  });
  afterEach(closeChoosers); // a test that fails must not leave its tab to the next one
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('a fresh install asks: the capture is kept, a page offers the actions, and nothing was put on the clipboard unasked', async () => {
    assert.equal((await sw.evaluate(() => __t.settings.getSettings())).afterCapture, 'ask', 'the default');
    await page.evaluate(() => navigator.clipboard.writeText('what was there before'));
    const { win, id } = await capture();
    assert.equal(win.url(), h.url(`chooser.html#shot=${id}`));
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN], 'kept');
    assert.equal(await win.locator('h1').innerText(), 'Capture saved. What now?');
    const shot = await sw.evaluate(async (id) => (await __t.db.getShot(id)), id);
    assert.equal(await win.locator('#caption').innerText(), `${new URL(shot.url).host} · ${shot.w} × ${shot.h} px`); // the host as the strip shows it (with its port)
    assert.deepEqual(await win.locator('button.act, .fmt').evaluateAll((els) => els.map((e) => [e.id || e.dataset.format, e.disabled])), [['edit', false], ['copy', false], ['png', false], ['jpeg', false], ['webp', false], ['pdf', false]]);
    assert.equal(await win.evaluate(() => document.activeElement?.id), 'edit', 'the keyboard is on the main action');
    assert.deepEqual(await win.locator('#preview').evaluate((img) => [img.naturalWidth, img.naturalHeight]), [shot.w, shot.h], 'the preview is the capture');
    await page.bringToFront();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'what was there before', 'the clipboard is untouched');
    assert.equal(libraryPages(h).length, 0, 'no library opened');
    await closeChoosers();
  });

  it('it opens as the active tab, next to the captured page which is its opener; closing it brings the captured page back', async () => {
    const tab = await tabOf(sw);
    const { win } = await capture();
    const tabs = await sw.evaluate(async (windowId) => (await chrome.tabs.query({ windowId })).map((t) => ({ id: t.id, index: t.index, active: t.active, openerTabId: t.openerTabId })), tab.windowId);
    const chooser = tabs.find((t) => t.openerTabId === tab.id);
    assert.ok(chooser, `a tab opened by the captured page: ${JSON.stringify(tabs)}`);
    assert.equal(chooser.active, true, 'the active tab');
    assert.equal(chooser.index, tabs.find((t) => t.id === tab.id).index + 1, 'right next to the captured page');
    assert.equal(await sw.evaluate(async () => (await chrome.windows.getAll()).filter((w) => w.type === 'popup').length), 0, 'no window of its own');
    await win.bringToFront();
    await win.click('#close').catch(() => {});
    await until(() => choosers().length === 0, 'closed');
    assert.equal(await sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, tab.id), true, 'the captured page is shown again');
  });

  it('an area capture asks too, with the size of the area', async () => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const { win, id } = await opened(async () => {
      await run('capture-area', tab);
      await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
      await page.mouse.move(100, 100);
      await page.mouse.down();
      await page.mouse.move(700, 500, { steps: 8 });
      await page.mouse.up();
    });
    const shot = await sw.evaluate(async (id) => (await __t.db.getShot(id)), id);
    const expected = [Math.floor(600 * DPR), Math.floor(400 * DPR)];
    assert.ok(Math.abs(shot.w - expected[0]) <= 2 && Math.abs(shot.h - expected[1]) <= 2, `${shot.w}x${shot.h}, expected ~${expected}`);
    assert.equal(await win.locator('#caption').innerText(), `${new URL(shot.url).host} · ${shot.w} × ${shot.h} px`); // the host as the strip shows it (with its port)
    assert.equal(libraryPages(h).length, 0);
    await win.close();
  });

  it('copy: the clipboard holds the capture, and the tab closes itself', async () => {
    const { win, id } = await capture();
    await win.bringToFront();
    await win.click('#copy');
    await until(async () => (await win.locator('#copyLabel').innerText().catch(() => 'Copied')) === 'Copied', 'the confirmation');
    await until(() => choosers().length === 0, 'the tab closes itself after a copy', 4000);
    const shot = await sw.evaluate(async (id) => (await __t.db.getShot(id)), id);
    await page.bringToFront();
    assert.deepEqual(await clipSize(page), [shot.w, shot.h], 'the clipboard holds the capture');
  });

  it('download: PNG is the original as it is, JPEG, WebP and PDF are written with the file name of the settings; the tab closes and the file is whole', async () => {
    const get = async (format) => {
      const { win, id } = await capture();
      await win.bringToFront();
      const [dl] = await Promise.all([win.waitForEvent('download', { timeout: 20_000 }), win.click(`.fmt[data-format="${format}"]`)]);
      await until(() => choosers().length === 0, `the tab closes itself after a ${format} download`, 6000);
      assert.equal(await dl.failure(), null, `the ${format} download was not cut by the window closing`);
      return { id, name: dl.suggestedFilename(), buf: readFileSync(await dl.path()) };
    };
    const png = await get('png');
    assert.match(png.name, /^127\.0\.0\.1_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
    assert.equal(sha256(png.buf), sha256(Buffer.from(await original(png.id))), 'the original, byte for byte');
    const jpeg = await get('jpeg');
    assert.match(jpeg.name, /\.jpg$/);
    assert.deepEqual([...jpeg.buf.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
    const webp = await get('webp');
    assert.match(webp.name, /\.webp$/);
    assert.equal(webp.buf.subarray(0, 4).toString('latin1') + webp.buf.subarray(8, 12).toString('latin1'), 'RIFFWEBP');
    const pdf = await get('pdf');
    assert.match(pdf.name, /\.pdf$/);
    assert.equal(pdf.buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.buf.subarray(-1024).toString('latin1').includes('%%EOF'), 'a whole PDF');
    // the file name template of the settings applies here too, as it is at the click
    await set({ filenameTemplate: '{title}' });
    assert.equal((await get('png')).name, 'Test page.png');
    await set({ filenameTemplate: '{host}_{date}_{time}' });
  });

  it('edit: the editor opens on that capture, and the tab goes away', async () => {
    const { win, id } = await capture();
    await win.bringToFront();
    await win.click('#edit');
    const lib = await until(() => libraryPages(h)[0], 'the library tab');
    assert.ok(lib.url().endsWith(`#shot=${id}`), lib.url());
    await until(() => choosers().length === 0, 'the tab closes itself');
    await closeLibraries();
  });

  it('after a choice nothing more is taken: a second click while the tab is closing does nothing', async () => {
    const { win } = await capture();
    await win.bringToFront();
    let downloads = 0;
    win.on('download', () => downloads++);
    await win.click('.fmt[data-format="png"]');
    await win.click('.fmt[data-format="jpeg"]').catch(() => {});
    await until(() => choosers().length === 0, 'closed', 6000);
    assert.equal(downloads, 1, 'one download, not two');
  });

  it('Escape and the Close button close the tab; the capture stays in the history', async () => {
    const before = await shotCount();
    const { win } = await capture();
    await win.bringToFront();
    await win.keyboard.press('Escape').catch(() => {}); // the page goes away under the call
    await until(() => choosers().length === 0, 'closed by Escape');
    const second = await capture();
    await second.win.bringToFront();
    await second.win.click('#close').catch(() => {});
    await until(() => choosers().length === 0, 'closed by the button');
    assert.equal(await shotCount(), before + 2, 'both captures are in the history');
  });

  it('"Capture and edit" opens the editor and never asks; the no-trace mode copies and never asks', async () => {
    await quota();
    await closeChoosers();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = await shotCount();
    await resetBadges(sw);
    await run('capture-visible-edit', tab);
    await until(() => libraryPages(h)[0], 'the editor');
    await sleep(800);
    assert.equal(choosers().length, 0, 'no page of actions beside the editor');
    assert.equal(await shotCount(), before + 1);
    await closeLibraries();
    await quota();
    await set({ noTrace: true });
    await page.bringToFront();
    await tabActive(sw, tab);
    await resetBadges(sw);
    await call('capture', tab);
    for (let i = 0; i < 100 && !(await badges(sw)).some((b) => b[1] === 'text' && b[2] === 'OK'); i++) await sleep(50);
    await sleep(800);
    assert.equal(choosers().length, 0, 'nothing is kept in no-trace mode: nothing to ask about');
    assert.equal(await shotCount(), before + 1, 'nothing saved');
    assert.ok(Array.isArray(await clipSize(page)), 'the capture was copied');
    await set({ noTrace: false });
  });

  it('the page only obeys its own tab: a forged "edit" from anywhere else does nothing', async () => {
    const before = libraryPages(h).length;
    const answers = await sw.evaluate(async () => {
      const ask = (sender, m) => new Promise((done) => { __t.onMessage(m, sender, done); setTimeout(() => done('no answer'), 500); });
      const own = chrome.runtime.id;
      return [
        await ask({ id: own, url: `chrome-extension://${own}/library.html` }, { type: 'chooser-edit', id: 1 }), // another page of the extension
        await ask({ id: 'someone-else', url: `chrome-extension://${own}/chooser.html#shot=1` }, { type: 'chooser-edit', id: 1 }), // another extension
        await ask({ id: own, url: `chrome-extension://${own}/chooser.html#shot=1` }, { type: 'chooser-edit', id: 'DROP TABLE' }), // not a number
        await ask({ id: own, url: `chrome-extension://${own}/chooser.html#shot=1` }, { type: 'chooser-edit', id: -3 }),
      ];
    });
    assert.deepEqual(answers, [false, false, false, false]);
    await sleep(500);
    assert.equal(libraryPages(h).length, before, 'no library opened');
  });

  it('a capture that no longer exists is said, and nothing is offered', async () => {
    const page2 = await h.context.newPage();
    await page2.goto(h.url('chooser.html#shot=987654'));
    await page2.waitForSelector('#state[data-kind="error"]');
    assert.equal(await page2.locator('#state').innerText(), 'This capture no longer exists.');
    assert.equal(await page2.locator('button.act:not([disabled]), .fmt:not([disabled])').count(), 0, 'every action is off');
    await page2.goto(h.url('chooser.html')); // no address at all
    await page2.waitForSelector('#state[data-kind="error"]');
    await page2.close();
  });

  it('the settings offer the choice (ask first), and the page follows the language', async () => {
    const lib = await h.context.newPage();
    await lib.goto(h.url('library.html#settings'));
    await lib.waitForSelector('dialog#settings[open]');
    assert.equal(await lib.locator('#afterCapture').inputValue(), 'ask', 'a fresh install asks');
    assert.deepEqual(await lib.locator('#afterCapture option').allInnerTexts(), ['Ask what to do', 'Copy it', 'Save the file']);
    await lib.selectOption('#afterCapture', 'copy');
    await until(async () => (await sw.evaluate(() => __t.settings.getSettings())).afterCapture === 'copy', 'the choice is stored');
    await lib.selectOption('#afterCapture', 'save');
    await until(async () => (await sw.evaluate(() => __t.settings.getSettings())).afterCapture === 'save', 'the third choice is stored');
    await lib.selectOption('#afterCapture', 'ask');
    await until(async () => (await sw.evaluate(() => __t.settings.getSettings())).afterCapture === 'ask', 'and back');
    await lib.close();
    await set({ language: 'fr' });
    const { win } = await capture();
    assert.equal(await win.locator('h1').innerText(), 'Capture enregistrée. Et maintenant\u00a0?');
    assert.equal(await win.locator('#edit b').innerText(), 'Éditer et annoter');
    assert.equal(await win.locator('#copyLabel').innerText(), 'Copier dans le presse-papiers');
    await set({ language: 'en' });
    await closeChoosers();
  });

  it('copy mode is the quick way as before: copied, saved, no page', async () => {
    await set({ afterCapture: 'copy' });
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = await shotCount();
    await resetBadges(sw);
    await call('capture', tab);
    await until(async () => (await shotCount()) === before + 1, 'saved');
    await sleep(500);
    assert.equal(choosers().length, 0);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    const shot = await sw.evaluate(async () => (await __t.db.queryShots({ limit: 1 })).items[0]);
    assert.deepEqual(await clipSize(page), [shot.w, shot.h], 'copied');
  });
});
