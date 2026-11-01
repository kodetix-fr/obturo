// Full page of pages whose content scrolls in a panel (web applications), in the real extension. The pages are in
// support/scroller.mjs: a graduated ruler, numbered bands and a sticky header make the image checkable at the pixel (order, no
// hole, no duplicate, the sticky header once); fixed elements outside the panel must not be in it, fixed elements over it
// once each. Display scale: E2E_DPR environment variable (1, 1.5, 2...).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DPR, launchExtension } from './support/browser.mjs';
import {
  GREEN, RED, badges, captureRunning, clipSize, finalBadge, lastShot, maxId, quota, resetBadges, tabActive, tabOf,
} from './support/capture.mjs';
import { PANE, startScrollSite, verifyPanel } from './support/scroller.mjs';
import enSw from '../../locales/en.sw.js';

describe('full page of a panel that scrolls, in the real extension', () => {
  let h, site, page, sw;
  let win; // [innerWidth, innerHeight, devicePixelRatio]

  const goto = async (path) => {
    await page.goto(`${site.origin}${path}`);
    await page.bringToFront();
    await page.waitForFunction(() => window.__ready === true && document.readyState === 'complete' && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
    win = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    return win;
  };
  const fullPage = async () => {
    await quota();
    await resetBadges(sw);
    await sw.evaluate((tab) => __t.captureFull(tab), await tabOf(sw));
    return lastShot(sw);
  };
  // the box of a panel, as the page sees it
  const box = (selector) => page.evaluate((s) => {
    const e = document.querySelector(s);
    return { cw: e.clientWidth, ch: e.clientHeight, sh: e.scrollHeight };
  }, selector);
  // everything a capture must give back: inline styles, where the panels are, what the stylesheet says of the scroll
  const state = () => page.evaluate(() => ({
    styles: /** @type {HTMLElement[]} */ ([...document.querySelectorAll('html, body, body *')]).filter((e) => e.tagName !== 'CANVAS').map((e) => `${e.tagName}#${e.id}|${e.style.cssText}`),
    scroll: [scrollX, scrollY, ...[...document.querySelectorAll('.panel')].map((e) => e.scrollTop)],
    css: [...document.querySelectorAll('.panel')].map((e) => [getComputedStyle(e).scrollBehavior, getComputedStyle(e).scrollSnapType]),
    toast: getComputedStyle(document.getElementById('toast') ?? document.body).visibility,
    foot: getComputedStyle(document.getElementById('foot') ?? document.body).visibility,
    wheelFree: !(() => {
      const e = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    })(),
  }));
  const progress = async () => (await badges(sw)).filter((e) => e[1] === 'text' && /^\d+\/\d+$/.test(e[2])).map((e) => ({ at: e[0], n: Number(e[2].split('/')[0]), of: Number(e[2].split('/')[1]) }));
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  // The height of an image of `css` CSS px: exact at an integer display scale; at a fractional one the scale of the image is its
  // height over the window's, which is off dpr by up to half a row per window height (the window height is a whole number of CSS px).
  const nearH = (h, css) => near(h, css * DPR, Number.isInteger(DPR) ? 2 : 2 + Math.round(css * DPR * 0.001));

  // What the page was told (notice.js): the text of the box, or null. The settings of the full page, set from the service worker.
  const noticeText = () => page.evaluate(() => document.getElementById('obturo-notice')?.shadowRoot?.textContent ?? null);
  const setFull = (patch) => sw.evaluate((p) => __t.settings.setSettings(p), patch);
  /** The bands of a panel of 5,000 px, in order, each in its own color (verifyPanel). */
  const bands = async (shot, contentH = 5000) => {
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows of the ruler from row ${v.firstBadRow}`);
    assert.deepEqual([v.badBands, v.bands], [[], Math.floor(contentH / 250)], 'every band in its own color, in order');
    return v;
  };

  before(async () => {
    site = await startScrollSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await setFull({ language: 'en' }); // the notices are read in English, whatever the language of the machine
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    page = await h.context.newPage();
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('application shell (the window does not scroll, a panel does): the whole panel, and only the panel', async () => {
    await goto('/s/shell.html');
    const pane = await box('#pane');
    assert.equal(pane.sh, 5000, 'precondition: the panel holds 5,000 px');
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'precondition: the window has nothing to scroll');
    const before = await state();
    const shot = await fullPage();
    assert.ok(near(shot.w, pane.cw * DPR) && nearH(shot.h, 5000), `${shot.w}x${shot.h}, expected ~${pane.cw * DPR}x${5000 * DPR}: the width of the panel, the height of its content`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: 5000 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows of the ruler from row ${v.firstBadRow} (a hole or a duplicate), image ${v.W}x${v.H}`);
    assert.deepEqual([v.badBands, v.bands], [[], 20], 'the 20 bands in order, each with its color');
    assert.deepEqual([v.red.count, v.redEdge.count], [0, 0], 'the bar outside the panel is not in the image');
    assert.equal(v.header.count, 0);
    assert.equal(v.toast.count, 1, 'the toast over the panel once');
    assert.ok(v.toast.first <= 12 * win[2] + 3, `... at the top (row ${v.toast.first})`);
    assert.equal(v.foot.count, 1, 'the footer over the panel once');
    assert.ok(v.foot.last >= v.H - 3, `... at the very bottom (row ${v.foot.last} of ${v.H})`);
    assert.deepEqual(await clipSize(page), [shot.w, shot.h], 'the clipboard holds the image');
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    const tiles = await progress();
    assert.ok(tiles.length >= 5 && tiles.every((t) => t.of === tiles[0].of), `${tiles.length} tiles of a fixed plan`);
    const perTile = (tiles.at(-1).at - tiles[0].at) / (tiles.length - 1);
    assert.ok(perTile < 700, `${perTile} ms per tile (the floor is 550)`);
    assert.deepEqual(await state(), before, 'the page is as it was: styles, positions, smooth scrolling, snap, footer, wheel');
  });

  it('sticky header in the panel, shell fixed to the window: the header once at the top, nothing hidden by mistake', async () => {
    await goto('/s/shell.html?sticky=1&root=fixed');
    const before = await state();
    const shot = await fullPage();
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: 5000 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual(v.badBands, []);
    assert.equal(v.header.count, 1, 'the sticky header once');
    assert.ok(v.header.first <= 2, `... at the top (row ${v.header.first})`);
    assert.ok(v.header.last < 62 * win[2], `... 60 px high (to row ${v.header.last})`);
    assert.deepEqual([v.red.count, v.toast.count, v.foot.count], [0, 1, 1]);
    assert.deepEqual(await state(), before);
  });

  it('nested scrollers: the one with the most content is the image, the outer one stays where it was', async () => {
    await goto('/s/nested.html');
    const list = await box('#list');
    assert.equal(list.sh, 6000);
    const before = await state();
    const shot = await fullPage();
    assert.ok(near(shot.w, list.cw * DPR) && nearH(shot.h, 6000), `${shot.w}x${shot.h}, expected ~${list.cw * DPR}x${6000 * DPR}`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: 6000 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual([v.badBands, v.bands], [[], 24]);
    assert.equal(v.header.count, 1, 'the sticky header of the list once');
    assert.deepEqual(await state(), before, 'both panels put back, including the outer one');
  });

  it('content that grows while the tiles are taken (lazy loading): the image follows, the footer stays at the very bottom', async () => {
    // The content starts 20 px past a whole number of tiles: the tile stuck to the old bottom ends 20 px into the next whole one, so
    // the footer it shows would stay in the middle of the image if it were not hidden again.
    const tile = (await goto('/s/shell.html'))[1] - PANE.top;
    const [start, step] = DPR > 1 ? [2 * tile + 20, 500] : [3 * tile + 20, 1500]; // the canvas limits (32 Mpx) hold at any display scale
    await goto(`/s/grow.html?delay=60&start=${start}&step=${step}`);
    const final = start + 3 * step;
    const shot = await fullPage();
    assert.equal(await page.evaluate(() => window.__h), final, 'precondition: the content grew three times');
    const tiles = await progress();
    assert.ok(tiles.at(-1).of > tiles[0].of, `the plan grew: ${tiles[0].of} tiles at the start, ${tiles.at(-1).of} at the end`);
    assert.ok(nearH(shot.h, final), `height ${shot.h}, expected ~${final * DPR}: the content as it ended`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: final });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual(v.badBands, []);
    assert.equal(v.toast.count, 1);
    assert.equal(v.foot.count, 1, 'the footer once: it was hidden again on the tile that stopped being the last one');
    assert.ok(v.foot.last >= v.H - 3, 'at the very bottom');
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('content that arrives after the last tile was positioned: one more look, the image follows', async () => {
    const [start, step] = DPR > 1 ? [2000, 500] : [3000, 1500];
    await goto(`/s/grow.html?delay=350&start=${start}&step=${step}`);
    const final = start + 3 * step;
    const shot = await fullPage();
    assert.equal(await page.evaluate(() => window.__h), final);
    assert.ok(nearH(shot.h, final), `height ${shot.h}, expected ~${final * DPR}`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: final });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual(v.badBands, []);
    assert.ok(v.foot.last >= v.H - 3, 'the footer is at the very bottom');
  });

  // Only at the display scale 1, where the limits are the same for everyone: 16,384 px a side.
  it('growth past the limits of the canvas is not followed: the top of the page, at full resolution, no scaling', { skip: DPR !== 1 }, async () => {
    await goto('/s/grow.html?delay=60&start=3000&step=6000'); // 3,000 -> 9,000 -> 15,000 -> 21,000 px
    const shot = await fullPage();
    assert.equal(await page.evaluate(() => window.__h), 21000, 'precondition: the content grew three times');
    assert.equal(shot.w, (await box('#pane')).cw, 'not scaled down');
    assert.ok(near(shot.h, 15000, 2), `height ${shot.h}: the page as far as the canvas could follow it`);
    const v = await verifyPanel(sw, shot, { dpr: 1, contentH: 15000 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual(v.badBands, []);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('sideways scrolling and a text area are not scrollers: the visible part, as a page that fits', async () => {
    await goto('/s/sideways.html');
    const shot = await fullPage();
    assert.ok(near(shot.w, win[0] * win[2]) && near(shot.h, win[1] * win[2]), `${shot.w}x${shot.h}, expected the window ${win[0] * win[2]}x${win[1] * win[2]}`);
    assert.equal((await progress()).length, 0, 'a single capture, no tiles');
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
    assert.equal(await noticeText(), null, 'a page that fits is not a failure: nothing is said');
  });

  it('the document scrolls and a small box scrolls too: the document, as before', async () => {
    await goto('/s/doc.html');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 2600);
    const shot = await fullPage();
    assert.ok(near(shot.w, win[0] * win[2]) && nearH(shot.h, 2600), `${shot.w}x${shot.h}`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: 2600 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual(v.badBands, []);
    assert.equal(v.header.count, 1, 'the sticky header once');
    assert.equal(v.redEdge.count, 1, 'the fixed bar of the page once, at the top');
    assert.ok(v.redEdge.first <= 2);
    assert.equal(v.toast.count, 1);
    assert.equal(v.foot.count, 1);
    assert.ok(v.foot.last >= v.H - 3);
  });

  it('Escape during the capture of a panel: quick stop, nothing saved, panel, window and styles put back', async () => {
    await goto('/s/shell.html');
    await page.evaluate(() => document.getElementById('pane').scrollTo({ top: 1000, behavior: 'instant' })); // a snap point
    const before = await state();
    assert.equal(before.scroll[2], 1000);
    await quota();
    await resetBadges(sw);
    const saved = await maxId(sw);
    const running = sw.evaluate((tab) => __t.captureFull(tab), await tabOf(sw));
    await captureRunning(sw);
    const pressed = Date.now();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await running;
    assert.ok(Date.now() - pressed < 4000, `stopped ${Date.now() - pressed} ms after Escape`);
    assert.equal(await maxId(sw), saved);
    assert.deepEqual(await state(), before);
  });

  it('a capture that starts from a scrolled panel: the image still starts at the top of the content, the panel goes back', async () => {
    await goto('/s/shell.html?sticky=1');
    await page.evaluate(() => document.getElementById('pane').scrollTo({ top: 3000, behavior: 'instant' }));
    const before = await state();
    assert.equal(before.scroll[2], 3000);
    const shot = await fullPage();
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: 5000 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.equal(v.header.count, 1);
    assert.ok(v.header.first <= 2);
    assert.deepEqual(await state(), before, 'back at 3000');
  });

  it('content that gets shorter while the tiles are taken: the image ends where the content ends, no blank rows', async () => {
    await goto('/s/shell.html?shrink=3500');
    const shot = await fullPage();
    assert.equal(await page.evaluate(() => window.__h), 3500, 'precondition: the content shrank');
    assert.ok(nearH(shot.h, 3500), `height ${shot.h}, expected ~${3500 * DPR}`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: 3500 });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}`);
    assert.deepEqual(v.badBands, []);
    const tiles = await progress();
    assert.ok(tiles.length < tiles[0].of, `${tiles.length} tiles taken of ${tiles[0].of} planned: it stopped at the new bottom`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('a panel that reaches below the window, with a border: only what shows is in the image, inside the border', async () => {
    await goto('/s/shell.html?tall=420');
    const pane = await box('#pane');
    assert.equal(pane.ch, win[1] - PANE.top + 420 - 12, 'precondition: 420 px of the panel are below the window');
    const shown = win[1] - PANE.top - 6; // from the inside of the top border to the bottom of the window
    const shot = await fullPage();
    assert.ok(near(shot.w, pane.cw * DPR), `width ${shot.w}, expected ${pane.cw * DPR}: the inside of the border`);
    assert.ok(nearH(shot.h, (pane.sh - (pane.ch - shown))), `height ${shot.h}, expected ~${(pane.sh - (pane.ch - shown)) * DPR}`);
    const v = await verifyPanel(sw, shot, { dpr: win[2], contentH: Math.round(shot.h / win[2]) });
    assert.equal(v.badRows, 0, `${v.badRows} wrong rows from row ${v.firstBadRow}: the ruler is at the left edge of the inside of the border`);
    assert.deepEqual(v.badBands, []);
    assert.equal(v.foot.count, 1);
    assert.ok(v.foot.last >= v.H - 3);
  });

  it('a panel that moves while it scrolls (a header that folds away): the capture stops, red badge, nothing saved, page put back', async () => {
    await goto('/s/shell.html?collapse=1');
    const before = await state();
    await quota();
    await resetBadges(sw);
    const saved = await maxId(sw);
    await sw.evaluate((tab) => __t.captureFull(tab), await tabOf(sw));
    assert.deepEqual(await finalBadge(sw), ['ERR', RED]);
    assert.equal(await maxId(sw), saved);
    assert.ok((await noticeText())?.includes(enSw['sw.full.fail.moved']), `the page says why: ${await noticeText()}`);
    await page.evaluate(() => { document.getElementById('pane').style.removeProperty('top'); }); // the page's own script moved it
    const after = await state();
    assert.deepEqual(after.styles.filter((s) => !s.startsWith('DIV#pane|')), before.styles.filter((s) => !s.startsWith('DIV#pane|')));
    assert.deepEqual([after.scroll, after.css, after.toast, after.foot, after.wheelFree], [before.scroll, before.css, before.toast, before.foot, before.wheelFree]);
  });

  // ---- The corpus of difficult pages (support/scroller.mjs): what web applications do that a full-page capture must survive. ----

  it('fade-in after the scroll (a CSS transition): the capture waits for the animation to end, no band caught half transparent', async () => {
    await goto('/s/fade.html');
    const v = await bands(await fullPage());
    assert.equal(v.header.count, 0);
    assert.equal(await noticeText(), null, 'a complete capture says nothing');
  });

  it('images loaded after the scroll (lazy loading, 600 ms): the capture waits for them', async () => {
    await goto('/s/lazyimg.html?delay=600');
    await bands(await fullPage());
  });

  it('a list drawn by script 1.2 s after the scroll: missed without a wait, complete with the wait of the settings', async () => {
    await goto('/s/virtual.html?delay=1200');
    const missed = await verifyPanel(sw, await fullPage(), { dpr: win[2], contentH: 5000 });
    assert.ok(missed.badBands.length > 0, 'precondition: a script that draws late is not seen by the automatic wait (it would need no setting)');
    await setFull({ fullPageWait: 2000 });
    try {
      await goto('/s/virtual.html?delay=1200');
      await bands(await fullPage());
    } finally {
      await setFull({ fullPageWait: 0 });
    }
  });

  it('a header that turns fixed once the page has scrolled (a "sticky on scroll" script): once at the top, not on every tile', async () => {
    await goto('/s/headroom.html');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 3000);
    const v = await bands(await fullPage(), 3000);
    assert.equal(v.header.count, 1, 'the header once');
    assert.ok(v.header.first <= 2, `... at the top (row ${v.header.first})`);
    assert.ok(v.header.last < 62 * win[2], `... 60 px high (to row ${v.header.last})`);
  });

  it('fixed elements inside the open shadow root of a web component: once each, the toast at the top, the footer at the bottom', async () => {
    await goto('/s/shadow.html');
    const v = await bands(await fullPage(), 2600);
    assert.equal(v.toast.count, 1, 'the toast once');
    assert.equal(v.foot.count, 1, 'the footer once');
    assert.ok(v.foot.last >= v.H - 3, `... at the very bottom (row ${v.foot.last} of ${v.H})`);
  });

  it('fixed elements set to "Hide": none shows, the sticky header of the panel still does', async () => {
    await setFull({ fullPageFixed: 'hide' });
    try {
      await goto('/s/shell.html?sticky=1');
      const v = await bands(await fullPage());
      assert.equal(v.header.count, 1, 'the sticky header is content, not a bar over it');
      assert.deepEqual([v.toast.count, v.foot.count], [0, 0], 'the toast and the footer over the panel are hidden');
    } finally {
      await setFull({ fullPageFixed: 'edges' });
    }
  });

  it('a page held by a big frame: the visible part, and the page says that the frame is not scrolled', async () => {
    await goto('/s/frame.html');
    const shot = await fullPage();
    assert.ok(near(shot.w, win[0] * win[2]) && near(shot.h, win[1] * win[2]), `${shot.w}x${shot.h}, expected the window`);
    assert.equal((await progress()).length, 0, 'no tiles');
    assert.ok((await noticeText())?.includes(enSw['sw.full.frame']), `the page says so: ${await noticeText()}`);
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });

  it('a document that overflows and the user cannot scroll (a dialog open over a page): the whole page, scrolled by script', async () => {
    await goto('/s/locked.html');
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight === 3000 && getComputedStyle(document.body).overflowY === 'hidden'), 'precondition: 3,000 px and a locked scroll');
    await bands(await fullPage(), 3000);
    assert.equal(await noticeText(), null, 'a complete capture says nothing');
  });

  // Only at the display scale 1, where the limits are the same for everyone: 16,384 px a side, 31 tiles of that window at most.
  it('a page longer than a capture can hold: the image stops where the limits say, reduced to fit, and the page says both', { skip: DPR !== 1 }, async () => {
    await goto('/s/tall.html?h=36000');
    const shot = await fullPage();
    assert.ok(shot.h >= 16380 && shot.h <= 16384, `height ${shot.h}: the canvas limit`);
    const text = await noticeText();
    assert.ok(text?.includes(enSw['sw.full.cut']), `cut: ${text}`);
    assert.match(text ?? '', /reduced to \d+%/, 'reduced');
    assert.deepEqual(await finalBadge(sw), ['OK', GREEN]);
  });
});
