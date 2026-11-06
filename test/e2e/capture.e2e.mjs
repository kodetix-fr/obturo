// Captures of the real extension (visible part, area, full page) on a test page served locally.
// The service worker is the one of the package; the test copy only gets host_permissions (no user gesture is
// possible) and a hook that exposes its functions and records the badges (see launchExtension, hook option).
// Display scale: E2E_DPR environment variable (1, 1.5, 2...).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DPR, launchExtension } from './support/browser.mjs';
import {
  GREEN, GREY, ORANGE, RED, badges, captureRunning, clipSize, closeLibraries, finalBadge, lastShot, libraryActive, libraryPages,
  listenChannel, maxId, quota, received, resetBadges, sleep, startSite, tabActive, tabOf, until, verifyFullPage,
} from './support/capture.mjs';

describe('captures in the real extension', () => {
  let h, site, page, sw;
  let viewport; // [width, height, devicePixelRatio] of the current page

  const goto = async (height) => {
    await page.goto(`${site.origin}/p${height}.html`);
    await page.bringToFront();
    // ready means: laid out at its full height, visible, and the active tab of its window (what a capture checks). Waited for as a
    // condition: a pause long enough on a quiet machine is not on a loaded one.
    await page.waitForFunction((h) => document.readyState === 'complete' && document.documentElement.scrollHeight >= h && document.visibilityState === 'visible', height);
    await tabActive(sw, await tabOf(sw));
    viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    return viewport;
  };
  const restored = (expectedY = 0) => page.evaluate((y) => window.scrollY === y && getComputedStyle(document.getElementById('footer')).visibility === 'visible'
    && getComputedStyle(document.documentElement).scrollBehavior === 'auto', expectedY);
  const call = (name, tab) => sw.evaluate(([n, t]) => __t[n](t), [name, tab]);
  const noticeText = () => page.evaluate(() => document.getElementById('obturo-notice')?.shadowRoot?.textContent ?? null);
  // a gesture, by the name of its command (the same table as the shortcuts and the icon menu)
  const run = (name, tab) => sw.evaluate(([n, t]) => __t.run(n, t), [name, tab]);

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await sw.evaluate(() => __t.settings.setSettings({ language: 'en' })); // the texts of the notes are the English ones, whatever the system
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('visible part: image, clipboard and green OK badge', async () => {
    await goto(800);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await call('capture', tab);
    const shot = await lastShot(sw);
    assert.deepEqual(await clipSize(page), [shot.w, shot.h], 'the clipboard holds the saved image');
    assert.ok(Math.abs(shot.w - viewport[0] * DPR) <= 1 && Math.abs(shot.h - viewport[1] * DPR) <= 1, `size ${shot.w}x${shot.h}`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    assert.ok(shot.url.startsWith(site.origin) && shot.title === 'Test page', 'address and title of the page');
    assert.equal(await noticeText(), 'ObturoCapture copied and saved in the history.', 'the page says it was copied');
    await until(async () => (await noticeText()) === null, 'the confirmation goes by itself', 6000);
  });

  it('copy refused: orange "!" badge AND the shot is saved, and the page says so', async () => {
    await quota();
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    await sw.evaluate(() => { globalThis.__failCopy = true; });
    await call('capture', tab);
    await sw.evaluate(() => { globalThis.__failCopy = false; });
    assert.deepEqual(await finalBadge(sw), ['!', ORANGE]);
    assert.equal((await maxId(sw)) - before, 1, 'the shot is saved despite the refused copy');
    assert.match(await noticeText(), /^ObturoThe copy failed\. The capture is saved in the history/, 'the page says the copy failed');
  });

  it('area: cropped dimensions, clipboard, green badge', async () => {
    await quota();
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await call('startArea', tab);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(700, 500, { steps: 8 });
    await page.mouse.up();
    for (let i = 0; i < 100 && !(await badges(sw)).some((b) => b[1] === 'text' && b[2] === 'OK'); i++) await sleep(50);
    const shot = await lastShot(sw);
    const expected = [Math.floor(600 * viewport[2]), Math.floor(400 * viewport[2])];
    assert.ok(Math.abs(shot.w - expected[0]) <= 2 && Math.abs(shot.h - expected[1]) <= 2, `${shot.w}x${shot.h}, expected ~${expected}`);
    assert.deepEqual(await clipSize(page), [shot.w, shot.h]);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('overlay opened then Escape: a capture follows immediately, no blocking', async () => {
    await quota();
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await call('startArea', tab);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#obturo-overlay', { state: 'detached' });
    await call('capture', tab);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('forged messages (invalid rectangle or size, unknown type): no capture', async () => {
    await quota();
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await sw.evaluate(async (tab) => {
      const send = (msg) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (m) => chrome.runtime.sendMessage(m), args: [msg] });
      for (const msg of [
        { type: 'area', rect: { x: 0, y: 0, w: -5, h: 10 }, vw: 1000, vh: 500 },
        { type: 'area', rect: { x: 0, y: 0, w: 10, h: 10 }, vw: 0, vh: 500 },
        { type: 'area', rect: { x: 'a', y: 0, w: 10, h: 10 }, vw: 1000, vh: 500 },
        { type: 'area', rect: null, vw: 1000, vh: 500 },
        { type: 'area', vw: 1000, vh: 500 },
        { type: 'other', rect: { x: 0, y: 0, w: 10, h: 10 }, vw: 1000, vh: 500 },
      ]) await send(msg);
      await new Promise((done) => setTimeout(done, 1200)); // a capture, if any, would have time to complete
    }, tab);
    assert.equal(await maxId(sw), before);
  });

  it('page shorter than the window: falls back to the visible part', async () => {
    await quota();
    await goto(800);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await call('captureFull', tab);
    const shot = await lastShot(sw);
    assert.ok(Math.abs(shot.w - viewport[0] * viewport[2]) <= 1 && Math.abs(shot.h - viewport[1] * viewport[2]) <= 1, `${shot.w}x${shot.h}`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('12,000 px full page: position accuracy, fixed and sticky elements, lazy content, page put back in order', async () => {
    await quota();
    await goto(12000);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await call('captureFull', tab);
    const shot = await lastShot(sw);
    const v = await verifyFullPage(sw, shot, viewport[2], 12000);
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows of the graduated ruler (gap or duplicate), image ${v.W}x${v.H}`);
    assert.equal(v.header.count, 1, 'sticky header only once');
    assert.ok(v.header.first <= 2, 'header at the top');
    assert.equal(v.banner.count, 1, 'fixed banner only once');
    assert.ok(v.banner.first <= 2, 'fixed banner at the top');
    assert.equal(v.footer.count, 1, 'fixed footer only once');
    assert.ok(v.footer.last >= v.H - 3, 'fixed footer at the very bottom');
    assert.equal(v.lazyOrange, true, 'content loaded on scroll');
    assert.ok(v.H <= 16384 && v.W <= 16384 && v.W * v.H <= 32e6, `${v.W}x${v.H} outside the ceilings`);
    assert.deepEqual(await clipSize(page), [v.W, v.H]);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    assert.ok(await restored(), 'page put back in order (scroll, fixed elements visible)');
  });

  it('Escape during the capture: quick stop, nothing saved, page put back in order', async () => {
    await quota();
    await goto(12000);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    const before = await maxId(sw);
    const running = call('captureFull', tab);
    await captureRunning(sw);
    const pressed = Date.now();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await running;
    assert.ok(Date.now() - pressed < 4000, `stopped ${Date.now() - pressed} ms after Escape (the remaining tiles take more than 3 s)`);
    assert.equal(await maxId(sw), before);
    assert.ok(await restored());
  });

  it('double trigger: a single capture, image intact, grey badge for the ignored one', async () => {
    await quota();
    await goto(12000);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    const before = await maxId(sw);
    const both = sw.evaluate((tab) => Promise.all([__t.captureFull(tab), __t.captureFull(tab)]), tab); // the second one is ignored
    await captureRunning(sw);
    await sw.evaluate((tab) => __t.startArea(tab), tab); // ignored too: a capture is running
    await both;
    assert.ok((await badges(sw)).some((e) => e[1] === 'color' && e[2] === GREY), 'grey badge');
    assert.equal((await maxId(sw)) - before, 1, 'a single shot saved');
    const v = await verifyFullPage(sw, await lastShot(sw), viewport[2], 12000);
    assert.deepEqual([v.badRows, v.header.count, v.footer.count], [0, 1, 1], 'image intact');
    assert.equal(await page.evaluate(() => !document.getElementById('obturo-overlay')), true, 'no overlay during a capture');
  });

  it('tab change midway: abort, red badge, nothing saved, original page put back in order', async () => {
    await quota();
    await goto(12000);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    const before = await maxId(sw);
    const running = call('captureFull', tab);
    await captureRunning(sw);
    await sw.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: true }));
    await running;
    assert.deepEqual(await finalBadge(sw), ['ERR', RED]);
    assert.equal(await maxId(sw), before);
    assert.ok(await restored());
    for (const other of h.context.pages()) if (other !== page && other.url() === 'about:blank') await other.close();
    await page.bringToFront();
    await tabActive(sw, tab);
  });

  it('browser zoom changed midway: abort, red badge, nothing saved, page put back in order', async () => {
    await goto(12000);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    const before = await maxId(sw);
    const heightBefore = viewport[1];
    const running = call('captureFull', tab);
    await captureRunning(sw);
    await sw.evaluate((tab) => chrome.tabs.setZoom(tab.id, 1.5), tab);
    await running;
    const heightZoomed = await page.evaluate(() => innerHeight);
    await sw.evaluate((tab) => chrome.tabs.setZoom(tab.id, 0), tab); // 0 = default zoom
    await page.waitForFunction((hgt) => innerHeight === hgt, heightBefore);
    assert.notEqual(heightZoomed, heightBefore, 'precondition: the zoom changes the window height');
    assert.deepEqual(await finalBadge(sw), ['ERR', RED]);
    assert.equal(await maxId(sw), before);
    assert.ok(await restored());
  });

  // ---------------------------------------------------------------- capture and edit

  const libs = () => libraryPages(h);
  // The library opens as the active tab: back to the test page, which captureVisibleTab needs to be the visible one.
  const back = async () => {
    await closeLibraries(h);
    await page.bringToFront();
    await tabActive(sw, await tabOf(sw));
  };
  const dragArea = async () => {
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(700, 500, { steps: 8 });
    await page.mouse.up();
  };
  const newShot = (before) => until(async () => { const s = await lastShot(sw); return s.id > before ? s : null; }, 'shot saved');
  // The new shot (the one after `before`) and the library tab opened on it (#shot=<id>).
  async function openedOn(before) {
    const shot = await newShot(before);
    const lib = await until(() => libs().find((p) => p.url() === `${h.url('library.html')}#shot=${shot.id}`), `library tab opened at #shot=${shot.id}`);
    return { shot, lib };
  }

  it('capture and edit, visible part: same chain (copy, save, green badge), then the library opens on the new shot', async () => {
    await quota();
    await back();
    await goto(800);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    await run('capture-visible-edit', tab);
    const { shot } = await openedOn(before);
    assert.equal(libs().length, 1, 'a single library tab');
    assert.ok(Math.abs(shot.w - viewport[0] * DPR) <= 1 && Math.abs(shot.h - viewport[1] * DPR) <= 1, `size ${shot.w}x${shot.h}`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    await back();
    assert.deepEqual(await clipSize(page), [shot.w, shot.h], 'the image was copied before the editor took the focus');
  });

  it('capture and edit with the library already open: the same tab is reactivated and goes to the shot by its address', async () => {
    await quota();
    await back();
    await goto(800);
    await sw.evaluate(() => __t.openLibrary());
    const lib = await until(() => libs()[0], 'library open');
    await page.bringToFront();
    await until(async () => (await libraryActive(sw)) === false, 'library in the background');
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await run('capture-visible-edit', tab);
    const shot = await newShot(before);
    await until(() => lib.url() === h.url(`library.html#shot=${shot.id}`), 'the address of the tab');
    assert.equal(libs().length, 1, 'no second library tab');
    await until(() => libraryActive(sw), 'library reactivated');
    await lib.waitForFunction((id) => document.querySelector('li.shot[aria-current="true"]')?.getAttribute('data-id') === String(id), shot.id);
  });

  it('the same shot asked for again, its address already there: the tab is reactivated and told by a message', async () => {
    const lib = libs()[0];
    const [id] = new URL(lib.url()).hash.match(/\d+/);
    await listenChannel(lib);
    await page.bringToFront();
    await until(async () => (await libraryActive(sw)) === false, 'library in the background');
    await sw.evaluate((shot) => __t.openLibrary({ shot }), Number(id));
    await until(async () => (await received(lib)).some((m) => m?.type === 'open-shot' && m.id === Number(id)), 'open-shot message');
    await until(() => libraryActive(sw), 'library reactivated');
    assert.equal(lib.url(), h.url(`library.html#shot=${id}`), 'the address is as it was');
  });

  it('capture and edit, area: the overlay carries the mode, the library opens on the cropped shot', async () => {
    await quota();
    await back();
    await goto(800);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    await run('capture-area-edit', tab);
    await page.waitForSelector('#obturo-overlay[data-edit="1"]', { state: 'attached', timeout: 5000 });
    await dragArea();
    const { shot } = await openedOn(before);
    const expected = [Math.floor(600 * viewport[2]), Math.floor(400 * viewport[2])];
    assert.ok(Math.abs(shot.w - expected[0]) <= 2 && Math.abs(shot.h - expected[1]) <= 2, `${shot.w}x${shot.h}, expected ~${expected}`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('capture and edit, full page (several tiles): the library opens on the stitched shot', async () => {
    await quota();
    await back();
    await goto(2500);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    await run('capture-full-edit', tab);
    const { shot } = await openedOn(before);
    assert.ok(Math.abs(shot.h - 2500 * viewport[2]) <= 2, `height ${shot.h}, expected ~${2500 * viewport[2]}`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('capture and edit, page shorter than the window: the full-page fallback opens the library too', async () => {
    await quota();
    await back();
    await goto(800);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await run('capture-full-edit', tab);
    const { shot } = await openedOn(before);
    assert.ok(Math.abs(shot.h - viewport[1] * viewport[2]) <= 1, `${shot.w}x${shot.h}`);
  });

  it('plain captures never open the library', async () => {
    await quota();
    await back();
    await goto(800);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    await run('capture-visible', tab);
    await quota();
    await resetBadges(sw);
    await run('capture-area', tab);
    await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('obturo-overlay')?.hasAttribute('data-edit')), false, 'plain overlay');
    await dragArea();
    for (let i = 0; i < 100 && !(await badges(sw)).some((b) => b[1] === 'text' && b[2] === 'OK'); i++) await sleep(50);
    await sleep(1500); // an editor, if one was going to open, would be there
    assert.equal(libs().length, 0);
  });

  it('copy refused with "capture and edit": orange badge, shot saved, the library opens anyway', async () => {
    await quota();
    await back();
    await goto(800);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    await sw.evaluate(() => { globalThis.__failCopy = true; });
    try {
      await run('capture-visible-edit', tab);
    } finally {
      await sw.evaluate(() => { globalThis.__failCopy = false; });
    }
    await openedOn(before);
    assert.deepEqual(await finalBadge(sw), ['!', ORANGE]);
  });

  it('save fails with "capture and edit": red badge, nothing saved, nothing to open', async () => {
    await quota();
    await back();
    await goto(800);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw);
    await sw.evaluate(() => {
      globalThis.__transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = () => { throw new DOMException('simulated failure', 'QuotaExceededError'); };
    });
    try {
      await run('capture-visible-edit', tab);
    } finally {
      await sw.evaluate(() => { IDBDatabase.prototype.transaction = globalThis.__transaction; });
    }
    await sleep(800);
    assert.deepEqual(await finalBadge(sw), ['ERR', RED]);
    assert.equal(await maxId(sw), before);
    assert.equal(libs().length, 0);
  });

  it('Escape during a full-page "capture and edit": nothing saved, no library', async () => {
    await quota();
    await back();
    await goto(12000);
    const tab = await tabOf(sw);
    const before = await maxId(sw);
    await resetBadges(sw); // captureRunning reads the badges: none of the earlier tests' may be there
    const running = run('capture-full-edit', tab);
    await captureRunning(sw);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await running;
    await sleep(800); // absence to prove: the library, if one was going to open, would be there
    assert.equal(await maxId(sw), before);
    assert.equal(libs().length, 0);
    assert.ok(await restored());
  });

  it('"capture and edit" during another capture: ignored (grey badge), nothing opens', async () => {
    await quota();
    await back();
    await goto(12000);
    const tab = await tabOf(sw);
    await resetBadges(sw);
    const before = await maxId(sw);
    const running = call('captureFull', tab);
    await captureRunning(sw);
    await run('capture-visible-edit', tab); // ignored: a capture is running
    await running;
    assert.ok((await badges(sw)).some((e) => e[1] === 'color' && e[2] === GREY), 'grey badge');
    assert.equal((await maxId(sw)) - before, 1, 'a single shot saved');
    await sleep(500);
    assert.equal(libs().length, 0, 'the plain full page does not open the library');
  });
});
