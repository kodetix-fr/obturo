// "Delay before capture", in the real extension: the badge counts the seconds down while the page stays usable, the capture is taken when the delay
// is over (so what was opened meanwhile is in it), any capture gesture cancels the wait, a tab left in the meantime is not captured, an area
// selection starts after the delay, and the service worker is still the same after the longest one. The service worker is the one of the package;
// the test copy only gets host_permissions and the hook, and starts with the copy mode (the capture tests are about the delay, not the page of actions).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { badges, libraryPages, maxId, quota, resetBadges, sleep, startSite, tabActive, tabOf, until } from './support/capture.mjs';
import { ABSENCE_MS } from './support/wait.mjs';

describe('delay before a capture', () => {
  let h, site, page, sw;
  const run = (name, tab) => sw.evaluate(([n, t]) => __t.run(n, t), [name, tab]);
  const set = (patch) => sw.evaluate((p) => __t.settings.setSettings(p), patch);
  const texts = async () => (await badges(sw)).filter((e) => e[1] === 'text').map((e) => e[2]);
  /** The pixel at the middle of the original of the last shot. */
  const middle = () => sw.evaluate(async () => {
    const [last] = (await __t.db.queryShots({ limit: 1 })).items;
    const bitmap = await createImageBitmap(await __t.db.getOriginal(last.id));
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return [...ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data];
  });
  /** A message to the listener of the worker the way the browser delivers it; resolves with its answer. */
  const deliver = (m, sender = {}) => sw.evaluate(([m, s]) => new Promise((done) => {
    const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html'), ...s };
    for (const k of Object.keys(sender)) if (sender[k] === null) delete sender[k];
    __t.onMessage(m, sender, done);
  }), [m, sender]);
  const ready = async () => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    await resetBadges(sw);
    return tab;
  };

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await set({ language: 'en' });
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p800.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
  });
  afterEach(async () => {
    await set({ captureDelay: 0 });
    for (const p of libraryPages(h)) await p.close();
    await page.evaluate(() => { document.documentElement.style.background = ''; });
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('3 s: the badge counts 3, 2, 1, the page stays usable, and what changed meanwhile is in the capture', async () => {
    await set({ captureDelay: 3 });
    const tab = await ready();
    const before = await maxId(sw);
    const start = Date.now();
    const job = run('capture-visible', tab);
    await sleep(1200);
    assert.equal(await page.locator('#obturo-overlay').count(), 0, 'no overlay while it waits');
    await page.mouse.click(400, 300);
    assert.equal(typeof (await page.evaluate(() => window.__up)), 'number', 'the page took the click: it stays usable');
    await page.evaluate(() => { document.documentElement.style.background = 'rgb(255, 0, 0)'; }); // what a menu opened during the wait would be
    await job;
    await until(async () => (await maxId(sw)) === before + 1, 'the capture');
    assert.ok(Date.now() - start >= 2900, `taken after the delay, not before (${Date.now() - start} ms)`);
    const list = await texts();
    assert.deepEqual(list.filter((x) => ['3', '2', '1'].includes(x)), ['3', '2', '1'], `the countdown: ${list}`);
    assert.equal(list.at(-1), 'OK', 'then the result');
    assert.deepEqual((await middle()).slice(0, 3), [255, 0, 0], 'the capture shows the page as it was when the delay ended');
  });

  it('without a delay a capture is immediate and the badge never counts', async () => {
    const tab = await ready();
    const before = await maxId(sw);
    await run('capture-visible', tab);
    await until(async () => (await maxId(sw)) === before + 1, 'the capture');
    assert.equal((await texts()).some((x) => /^\d+$/.test(x)), false, 'no countdown');
  });

  it('a second capture gesture during the wait cancels it: the badge is cleared and nothing is taken', async () => {
    await set({ captureDelay: 5 });
    const tab = await ready();
    const before = await maxId(sw);
    const first = run('capture-visible', tab);
    await sleep(1200);
    await run('capture-full', tab); // any capture gesture, here another kind: the shortcut, the menu and the popup all go through run
    assert.equal((await texts()).at(-1), '', 'the badge is cleared at once');
    await first;
    await sleep(5000 + ABSENCE_MS); // past the countdown of 5 s, which would have ended in a capture
    assert.equal(await maxId(sw), before, 'nothing was taken, neither by the first nor by the second');
    assert.equal((await texts()).at(-1), '', 'and no result badge');
    await run('open-settings', tab); // a gesture that is not a capture does not cancel anything and does not wait
    await closeLibs();
  });

  it('a tab left during the wait is not captured: another page would be', async () => {
    await set({ captureDelay: 3 });
    const tab = await ready();
    const before = await maxId(sw);
    const job = run('capture-visible', tab);
    await sleep(800);
    const other = await h.context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await job;
    await sleep(500);
    assert.equal(await maxId(sw), before, 'nothing was taken');
    assert.equal((await texts()).at(-1), '', 'the badge is cleared');
    await other.close();
    await page.bringToFront();
    await tabActive(sw, tab);
  });

  it('an area: no overlay during the wait, it appears when the delay is over', async () => {
    await set({ captureDelay: 3 });
    const tab = await ready();
    const job = run('capture-area', tab);
    await sleep(1500);
    assert.equal(await page.locator('#obturo-overlay').count(), 0, 'not yet');
    await job;
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#obturo-overlay', { state: 'detached' });
  });

  it('an element pick: no box during the wait, the pick starts when the delay is over', async () => {
    await set({ captureDelay: 3 });
    const tab = await ready();
    const job = run('capture-element', tab);
    await sleep(1500);
    assert.equal(await page.locator('#obturo-element').count(), 0, 'not yet');
    await job;
    await page.waitForSelector('#obturo-element', { state: 'attached', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#obturo-element', { state: 'detached' });
  });

  it('"and edit" waits too, then opens the editor on the capture', async () => {
    await set({ captureDelay: 3 });
    const tab = await ready();
    const before = await maxId(sw);
    const start = Date.now();
    await run('capture-visible-edit', tab);
    const lib = await until(() => libraryPages(h)[0], 'the editor', 8000);
    assert.ok(Date.now() - start >= 2900, 'after the delay');
    assert.ok(lib.url().endsWith(`#shot=${before + 1}`), lib.url());
  });

  it('the longest delay, 10 s: the badge counts from 10, and it is the same service worker at the end', async () => {
    await set({ captureDelay: 10 });
    const tab = await ready();
    const before = await maxId(sw);
    const origin = await sw.evaluate(() => performance.timeOrigin);
    await run('capture-visible', tab);
    await until(async () => (await maxId(sw)) === before + 1, 'the capture', 5000);
    assert.equal(await sw.evaluate(() => performance.timeOrigin), origin, 'the worker was not stopped and restarted meanwhile');
    const list = await texts();
    assert.deepEqual(list.filter((x) => /^\d+$/.test(x)), ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1']);
    assert.equal(list.at(-1), 'OK');
  });

  it('the message of the popup: only from the popup, one of the delays, 0 included', async () => {
    assert.equal(await deliver({ type: 'popup-delay', value: 5 }), true);
    assert.equal((await sw.evaluate(() => __t.settings.getSettings())).captureDelay, 5);
    assert.equal(await deliver({ type: 'popup-delay', value: 0 }), true);
    assert.equal((await sw.evaluate(() => __t.settings.getSettings())).captureDelay, 0);
    const refused = [
      [{ type: 'popup-delay', value: 3 }, { id: 'another-extension-id' }], [{ type: 'popup-delay', value: 3 }, { tab: { id: 1, windowId: 1 } }],
      [{ type: 'popup-delay', value: 3 }, { url: h.url('library.html') }], [{ type: 'popup-delay', value: 3 }, { url: null }],
      [{ type: 'popup-delay', value: 4 }, {}], [{ type: 'popup-delay', value: '3' }, {}], [{ type: 'popup-delay' }, {}],
    ];
    for (const [m, s] of refused) assert.equal(await deliver(m, s), false, JSON.stringify([m, s]));
    assert.equal((await sw.evaluate(() => __t.settings.getSettings())).captureDelay, 0, 'none of them stored anything');
  });

  const closeLibs = async () => { for (const p of libraryPages(h)) await p.close(); };
});
