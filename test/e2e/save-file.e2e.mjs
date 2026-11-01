// "After a capture: save the file", in the real extension: the capture is kept, a tab opens in the background (the captured page keeps the focus),
// downloads the capture with the format and the file name of the settings, and closes. No trace only copies, "and edit" opens the editor, and a
// download that cannot happen brings the tab forward. The service worker is the one of the package; the test copy only gets host_permissions and
// the hook, and keeps the REAL defaults.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchExtension } from './support/browser.mjs';
import { GREEN, finalBadge, libraryPages, maxId, quota, resetBadges, sleep, startSite, tabActive, tabOf, until } from './support/capture.mjs';
import { sha256 } from './support/editor.mjs';

describe('after a capture: save the file', () => {
  let h, site, page, sw;
  const downloads = [];
  const call = (name, tab) => sw.evaluate(([n, t]) => __t[n](t), [name, tab]);
  const set = (patch) => sw.evaluate((p) => __t.settings.setSettings(p), patch);
  const choosers = () => h.context.pages().filter((p) => p.url().split(/[?#]/)[0] === h.url('chooser.html'));
  const original = (id) => sw.evaluate(async (id) => Array.from(new Uint8Array(await (await __t.db.getOriginal(id)).arrayBuffer())), id);
  const tabs = (windowId) => sw.evaluate(async (windowId) => (await chrome.tabs.query({ windowId })).map((t) => ({ id: t.id, active: t.active, openerTabId: t.openerTabId })), windowId);
  const closeChoosers = async () => { for (const p of choosers()) await p.close().catch(() => {}); };
  /** Takes the visible part and waits for the download that the background tab makes. */
  const capture = async () => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = downloads.length;
    const maxBefore = await maxId(sw);
    await resetBadges(sw);
    await call('capture', tab);
    await until(() => downloads.length > before, 'the download', 15_000);
    const dl = downloads.at(-1);
    return { tab, dl, id: await maxId(sw), maxBefore, buf: readFileSync(await dl.path()) };
  };

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realDefaults: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    h.context.on('page', (p) => p.on('download', (d) => downloads.push(d))); // every page is watched from its creation: the download comes right after it loads
    await set({ language: 'en', afterCapture: 'save' });
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p800.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
  });
  afterEach(async () => {
    await closeChoosers();
    for (const p of libraryPages(h)) await p.close();
    await set({ noTrace: false, downloadFormat: 'png', filenameTemplate: '{host}_{date}_{time}' });
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('the capture is kept and downloaded as it is, the captured page keeps the focus, and the tab closes itself', async () => {
    await page.evaluate(() => navigator.clipboard.writeText('what was there before'));
    const { tab, dl, id, maxBefore, buf } = await capture();
    assert.equal(id, maxBefore + 1, 'one capture kept');
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN], 'kept');
    assert.match(dl.suggestedFilename(), /^127\.0\.0\.1_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
    assert.equal(sha256(buf), sha256(Buffer.from(await original(id))), 'the original, byte for byte');
    const here = await tabs(tab.windowId);
    const chooser = here.find((t) => t.openerTabId === tab.id);
    assert.ok(chooser, `the tab that downloads, opened by the captured page: ${JSON.stringify(here)}`);
    assert.equal(chooser.active, false, 'the tab that downloads stays in the background');
    assert.equal(here.find((t) => t.id === tab.id).active, true, 'the captured page keeps the focus');
    await until(() => choosers().length === 0, 'the tab closes itself', 6000);
    assert.equal(await sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, tab.id), true, 'and the captured page is still the one in front');
    assert.equal(libraryPages(h).length, 0, 'no library opened');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'what was there before', 'nothing was put on the clipboard');
  });

  it('the format and the file name template of the settings apply', async () => {
    await set({ downloadFormat: 'webp', filenameTemplate: '{title}' });
    const webp = await capture();
    assert.equal(webp.dl.suggestedFilename(), 'Test page.webp');
    assert.equal(webp.buf.subarray(0, 4).toString('latin1') + webp.buf.subarray(8, 12).toString('latin1'), 'RIFFWEBP');
    await set({ downloadFormat: 'pdf' });
    const pdf = await capture();
    assert.equal(pdf.dl.suggestedFilename(), 'Test page.pdf');
    assert.equal(pdf.buf.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('an area capture is saved too', async () => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = downloads.length;
    await call('startArea', tab);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 6 });
    await page.mouse.up();
    await until(() => downloads.length > before, 'the download of the area', 15_000);
    assert.equal(readFileSync(await downloads.at(-1).path()).subarray(1, 4).toString('latin1'), 'PNG');
  });

  it('no trace only copies: nothing is kept, no tab, no file', async () => {
    await set({ noTrace: true });
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = downloads.length;
    const maxBefore = await maxId(sw);
    await call('capture', tab);
    await sleep(1500);
    assert.equal(downloads.length, before, 'no download');
    assert.equal(choosers().length, 0, 'no tab');
    assert.equal(await maxId(sw), maxBefore, 'nothing kept');
  });

  it('"Capture and edit" opens the editor and downloads nothing', async () => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = downloads.length;
    const maxBefore = await maxId(sw);
    await sw.evaluate((t) => __t.capture(t, undefined, true), tab);
    const lib = await until(() => libraryPages(h)[0], 'the editor');
    assert.ok(lib.url().endsWith(`#shot=${maxBefore + 1}`), lib.url());
    await sleep(1000);
    assert.equal(downloads.length, before, 'no download');
    assert.equal(choosers().length, 0, 'no tab that downloads');
  });

  it('a capture that is gone brings the tab forward, with the reason', async () => {
    const tab = await tabOf(sw);
    const gone = await sw.evaluate(async (windowId) => (await chrome.tabs.create({ url: chrome.runtime.getURL('chooser.html#shot=987654&save=1'), active: false, windowId })).id, tab.windowId);
    const win = await until(() => choosers()[0], 'the tab');
    await win.waitForSelector('#state[data-kind="error"]');
    await until(() => sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, gone), 'the tab comes forward', 5000);
    assert.equal(await win.locator('#state').innerText(), 'This capture no longer exists.');
  });
});
