// "Element" capture, in the real extension: a box follows the pointer over the innermost element, a click captures that element's box (clipped to
// the window) without the box itself and without the page getting the click, Alt+ArrowUp and Alt+ArrowDown go to the parent and back to the
// child, Escape cancels, an element under 5 px is ignored, and "and edit" opens the editor. The service worker is the one of the package; the
// test copy only gets host_permissions and the hook, and starts with the copy mode (no page of actions).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DPR, launchExtension } from './support/browser.mjs';
import { libraryPages, maxId, quota, resetBadges, sleep, startSite, tabActive, tabOf, until } from './support/capture.mjs';

describe('element capture', () => {
  let h, site, page, sw;
  const run = (name, tab) => sw.evaluate(([n, t]) => __t.run(n, t), [name, tab]);
  const boxRect = () => page.evaluate(() => {
    const el = document.getElementById('obturo-element');
    if (!el || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map(Math.round);
  });
  const frames = (n = 3) => page.evaluate((n) => new Promise((done) => { const tick = (k) => (k ? requestAnimationFrame(() => tick(k - 1)) : done(true)); tick(n); }), n);
  const near = (actual, expected, slack, what) => assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= slack), `${what}: ${actual} vs ${expected}`);
  /** Size of the last shot, and its colors at the given fractions of its width and height. */
  const lastShot = (points) => sw.evaluate(async (points) => {
    const [last] = (await __t.db.queryShots({ limit: 1 })).items;
    const bitmap = await createImageBitmap(await __t.db.getOriginal(last.id));
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return {
      id: last.id, w: bitmap.width, h: bitmap.height,
      colors: points.map(([fx, fy]) => [...ctx.getImageData(Math.round(fx * (bitmap.width - 1)), Math.round(fy * (bitmap.height - 1)), 1, 1).data].slice(0, 3)),
    };
  }, points);
  const build = () => page.evaluate(() => {
    document.getElementById('fixture')?.remove();
    const f = document.createElement('div');
    f.id = 'fixture';
    f.style.cssText = 'position:absolute;left:0;top:0;width:1000px;height:600px';
    const style = document.createElement('style');
    style.textContent = '#hover:hover { background: rgb(0, 200, 0) !important }';
    const make = (tag, id, css, parent = f) => {
      const el = document.createElement(tag);
      el.id = id;
      el.style.cssText = `position:absolute;${css}`;
      parent.append(el);
      return el;
    };
    const red = 'background:rgb(255,0,0)';
    const target = make('div', 'target', `left:300px;top:200px;width:300px;height:200px;${red}`);
    make('span', 'child', 'left:20px;top:20px;width:100px;height:80px;background:rgb(0,0,255)', target);
    make('div', 'tiny', 'left:700px;top:200px;width:3px;height:3px;background:rgb(0,0,0)');
    make('div', 'hover', `left:700px;top:300px;width:120px;height:90px;${red}`);
    make('div', 'tall', `left:900px;top:100px;width:200px;height:3000px;${red}`);
    f.prepend(style);
    document.body.append(f);
    window.__events = [];
    for (const el of f.querySelectorAll('div, span')) for (const type of ['click', 'pointerdown', 'mousedown']) el.addEventListener(type, () => window.__events.push(`${el.id}:${type}`));
    document.addEventListener('keydown', (e) => window.__events.push(`document:${e.key}`));
  });
  /** Starts the element pick on the test tab. */
  const start = async (name = 'capture-element') => {
    await quota();
    await page.bringToFront();
    const tab = await tabOf(sw);
    await tabActive(sw, tab);
    await resetBadges(sw);
    await run(name, tab);
    await page.waitForSelector('#obturo-element', { state: 'attached', timeout: 5000 });
    return tab;
  };
  const hover = async (x, y) => { await page.mouse.move(x, y); await frames(); };
  const gone = () => page.waitForSelector('#obturo-element', { state: 'detached', timeout: 5000 });

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await sw.evaluate(() => __t.settings.setSettings({ language: 'en' }));
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p800.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
  });
  afterEach(async () => {
    if (await page.locator('#obturo-element').count()) { await page.keyboard.press('Escape'); await gone(); }
    for (const p of libraryPages(h)) await p.close();
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('the box follows the pointer over the innermost element; a click captures its box, without the box, and the page never gets the click', async () => {
    await build();
    await start();
    assert.equal(await boxRect(), null, 'nothing under the pointer yet: no box');
    await hover(350, 250);
    near(await boxRect(), [320, 220, 100, 80], 1, 'the child under the pointer');
    await hover(550, 350);
    near(await boxRect(), [300, 200, 300, 200], 1, 'the parent under the pointer');
    const before = await maxId(sw);
    await page.mouse.down();
    await page.mouse.up();
    await gone();
    await until(async () => (await maxId(sw)) === before + 1, 'the capture');
    const shot = await lastShot([[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]);
    near([shot.w, shot.h], [300 * DPR, 200 * DPR], 2, 'the size of the element');
    for (const color of shot.colors) assert.deepEqual(color, [255, 0, 0], 'only the element: no border, no tint of the box');
    assert.deepEqual(await page.evaluate(() => window.__events), [], 'neither the press, nor the release, nor the click reached the page');
  });

  it('Alt+ArrowUp goes to the parent, Alt+ArrowDown comes back to the child, and the capture is of the one chosen', async () => {
    await build();
    await start();
    await hover(350, 250);
    near(await boxRect(), [320, 220, 100, 80], 1, 'the child');
    await page.keyboard.press('Alt+ArrowUp');
    await frames();
    near(await boxRect(), [300, 200, 300, 200], 1, 'its parent');
    await page.keyboard.press('Alt+ArrowUp');
    await frames();
    near(await boxRect(), [0, 0, 1000, 600], 1, 'the parent of the parent');
    await page.keyboard.press('Alt+ArrowDown');
    await frames();
    near(await boxRect(), [300, 200, 300, 200], 1, 'back down');
    await page.keyboard.press('Alt+ArrowDown');
    await frames();
    near(await boxRect(), [320, 220, 100, 80], 1, 'and down again');
    await page.keyboard.press('Alt+ArrowUp');
    await frames();
    const before = await maxId(sw);
    await page.mouse.down();
    await page.mouse.up();
    await until(async () => (await maxId(sw)) === before + 1, 'the capture');
    const shot = await lastShot([[0.5, 0.5]]);
    near([shot.w, shot.h], [300 * DPR, 200 * DPR], 2, 'the parent, as chosen with the keys');
    assert.deepEqual(await page.evaluate(() => window.__events.filter((e) => e.includes('keydown'))), [], "the keys of the choice were not the page's");
  });

  it('a pointer move takes the choice back from the keys', async () => {
    await build();
    await start();
    await hover(350, 250);
    await page.keyboard.press('Alt+ArrowUp');
    await frames();
    near(await boxRect(), [300, 200, 300, 200], 1, 'the parent, by key');
    await hover(352, 252);
    near(await boxRect(), [320, 220, 100, 80], 1, 'the pointer decides again');
  });

  it('Escape cancels: no box, no capture, and the page does not get the key', async () => {
    await build();
    await start();
    await hover(350, 250);
    const before = await maxId(sw);
    await page.keyboard.press('Escape');
    await gone();
    await sleep(600);
    assert.equal(await maxId(sw), before, 'nothing was captured');
    assert.deepEqual(await page.evaluate(() => window.__events), [], 'the page did not see Escape');
    await page.mouse.click(350, 250);
    assert.ok((await page.evaluate(() => window.__events)).includes('child:click'), 'and the page is back to normal: its clicks work');
  });

  it('an element under 5 px is ignored, and the pick goes on', async () => {
    await build();
    await start();
    await hover(701, 201);
    const before = await maxId(sw);
    await page.mouse.click(701, 201);
    await sleep(600);
    assert.equal(await maxId(sw), before, 'not captured');
    assert.equal(await page.locator('#obturo-element').count(), 1, 'the pick is still on');
    assert.deepEqual(await page.evaluate(() => window.__events), [], 'and the click was still not the page\'s');
  });

  it('a hover state is in the capture: the pointer stays on the element', async () => {
    await build();
    await start();
    await hover(760, 340);
    near(await boxRect(), [700, 300, 120, 90], 1, 'the element');
    const before = await maxId(sw);
    await page.mouse.down();
    await page.mouse.up();
    await until(async () => (await maxId(sw)) === before + 1, 'the capture');
    assert.deepEqual((await lastShot([[0.5, 0.5]])).colors[0], [0, 200, 0], 'green: the :hover rule applied');
  });

  it('an element taller than the window is clipped to what the window shows', async () => {
    await build();
    await start();
    const vh = await page.evaluate(() => innerHeight);
    await hover(1000, 400);
    near(await boxRect(), [900, 100, 200, vh - 100], 1, 'the box is clipped too');
    const before = await maxId(sw);
    await page.mouse.down();
    await page.mouse.up();
    await until(async () => (await maxId(sw)) === before + 1, 'the capture');
    const shot = await lastShot([[0.5, 0.5]]);
    near([shot.w, shot.h], [200 * DPR, (vh - 100) * DPR], 3, 'the visible part of the element');
  });

  it('"Capture and edit" opens the editor on the element', async () => {
    await build();
    await start('capture-element-edit');
    assert.equal(await page.getAttribute('#obturo-element', 'data-edit'), '1', 'marked, like the area selection');
    await hover(550, 350);
    const before = await maxId(sw);
    await page.mouse.down();
    await page.mouse.up();
    const lib = await until(() => libraryPages(h)[0], 'the editor', 8000);
    assert.ok(lib.url().endsWith(`#shot=${before + 1}`), lib.url());
  });

  it('a second pick while one is open does not stack another box', async () => {
    await build();
    const tab = await start();
    await run('capture-element', tab);
    await sleep(300);
    assert.equal(await page.locator('#obturo-element').count(), 1);
  });
});
