// The scripts injected into pages, outside the extension: fullpage.js (scrolling, fixed and sticky elements, putting
// the page back in order) and overlay.js (area selection). They are loaded in an ordinary page, as the service worker
// does.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { REPO } from './support/browser.mjs';
import { poll } from './support/editor.mjs';
import { pickScroller, planTiles } from '../../fullpage-pure.js';

const TOTAL = 12000;
const VIEW = 700;
const SNAPS = Array.from({ length: TOTAL / 1000 }, (_, i) => `<div class=snap style="top:${i * 1000}px"></div>`).join('');

// 12,000 px page with the hard cases: smooth scrolling and mandatory scroll snap, graduated ruler (the color of a row
// gives its position), sticky header, fixed elements at the top and bottom, content loaded on scroll
// (IntersectionObserver).
const HTML = `<!doctype html><html><head><meta charset=utf-8><style>
html { scroll-behavior: smooth; scroll-snap-type: y mandatory; }
.snap { position:absolute; left:0; width:10px; height:1000px; scroll-snap-align:start; }
body { margin:0; height:${TOTAL}px; position:relative; font:20px sans-serif; }
#ruler { position:absolute; left:0; top:0; }
header { position:sticky; top:0; height:60px; margin-left:20px; background:#1a5fb4; color:#fff; z-index:5 }
#banner { position:fixed; top:0; right:0; width:200px; height:40px; background:#c01c28; z-index:9 }
#footer { position:fixed; bottom:0; left:20px; right:0; height:50px; background:#26a269; z-index:9 }
#pre { position:fixed; top:100px; right:0; width:50px; height:50px; background:#f5c211; visibility:visible; }
#pre2 { position:sticky; top:10px; height:20px; margin-left:20px; background:#999; }
#lazy { position:absolute; top:4900px; left:100px; width:300px; height:300px; background:#888 }
#lazy.seen { background:#ff7800 }
</style></head><body>
<canvas id=ruler width=8 height=${TOTAL}></canvas>
<header>sticky</header><div id=pre2></div><div id=banner></div><div id=footer></div><div id=pre></div>
<div id=lazy></div>${SNAPS}
<script>
const c = document.getElementById('ruler').getContext('2d');
const img = c.createImageData(8, ${TOTAL});
for (let y = 0; y < ${TOTAL}; y++) for (let x = 0; x < 8; x++) {
  const i = (y * 8 + x) * 4; img.data[i] = (y >> 8) & 255; img.data[i+1] = y & 255; img.data[i+2] = 128; img.data[i+3] = 255;
}
c.putImageData(img, 0, 0);
new IntersectionObserver((es) => es.forEach(e => e.isIntersecting && e.target.classList.add('seen'))).observe(document.getElementById('lazy'));
</script></body></html>`;

describe('fullpage.js: driving the page during a full-page capture', () => {
  let browser, page, script, yInitial, snapBefore, scrollTypeBefore;
  const visibility = (selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).visibility, selector);
  const position = (selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).position, selector);
  const scrollType = () => page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType);
  // State of all the inline styles of the page (value and priority): putting the page back in order must restore them
  // identically.
  const snapshot = () => page.evaluate(() => /** @type {HTMLElement[]} */ ([document.documentElement, ...document.body.querySelectorAll('*')])
    .filter((e) => e.tagName !== 'CANVAS')
    .map((e) => `${e.tagName}#${e.id}|${e.style.cssText}|${e.style.getPropertyPriority('visibility')}`));
  const scrollBlocked = () => page.evaluate(() => {
    const wheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    const touch = new Event('touchmove', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(wheel);
    document.body.dispatchEvent(touch);
    return wheel.defaultPrevented && touch.defaultPrevented;
  });
  const keyBlocked = (key) => page.evaluate((k) => {
    const e = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  }, key);
  const go = (y, phase) => page.evaluate(([yy, p]) => window.__obturoFull.go(yy, p), [y, phase]);
  // What sw.js does at the start: describe, pick, take the target.
  const start = async () => {
    const scan = await page.evaluate(() => window.__obturoFull.begin());
    const pick = pickScroller(scan.cands, scan.doc, scan.vw, scan.vh);
    return { scan, pick, m: await page.evaluate((i) => window.__obturoFull.aim(i), pick) };
  };

  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: VIEW } });
    await page.setContent(HTML);
    script = readFileSync(join(REPO, 'fullpage.js'), 'utf8');
    await page.evaluate(() => window.scrollTo({ top: 1234, behavior: 'instant' }));
    yInitial = await page.evaluate(() => scrollY); // mandatory snap resets 1234 to a snap point
    snapBefore = await snapshot();
    scrollTypeBefore = await scrollType();
  });
  after(() => browser?.close());

  it('begin and aim: the document is the target (nothing else scrolls), page measurements, scroll snap neutralized', async () => {
    await page.evaluate(script);
    const { scan, pick, m } = await start();
    assert.deepEqual(scan, { vw: 1280, vh: VIEW, dpr: 1, doc: { user: true, max: TOTAL - VIEW }, frame: 0, cands: [] });
    assert.equal(pick, -1);
    assert.deepEqual(m, { box: { x: 0, y: 0, w: 1280, h: VIEW }, max: TOTAL - VIEW, vw: 1280, vh: VIEW, dpr: 1 });
    assert.ok(scrollTypeBefore.includes('mandatory'));
    assert.equal(await scrollType(), 'none', 'scroll snap neutralized during the capture');
  });

  it('wheel, touch and scroll keys blocked; the other keys are not', async () => {
    assert.ok(await scrollBlocked());
    for (const key of ['PageDown', 'ArrowDown', 'End', ' ']) assert.ok(await keyBlocked(key), key);
    assert.ok(!(await keyBlocked('a')), 'the other keys are not blocked');
  });

  it('tile plan: 18 tiles, the last one stuck to the bottom', () => {
    const { ys } = planTiles(TOTAL, VIEW, 1);
    assert.equal(ys.length, 18);
    assert.equal(ys.at(-1), TOTAL - VIEW);
  });

  it('first tile: actual y 0 despite smooth scrolling and snap; fixed at the top visible, fixed at the bottom hidden', async () => {
    const r = await go(0, 'first');
    assert.deepEqual(r, { y: 0, cancelled: false, vh: VIEW, max: TOTAL - VIEW, box: { x: 0, y: 0, w: 1280, h: VIEW } });
    assert.equal(await visibility('#banner'), 'visible');
    assert.equal(await visibility('#footer'), 'hidden');
    assert.equal(await position('header'), 'sticky');
    assert.equal(await visibility('#pre'), 'visible', 'fixed at the top whose visibility is already inline');
  });

  it('middle tiles: actual y = requested y, fixed elements hidden, sticky back in place, lazy content loaded', async () => {
    const { ys } = planTiles(TOTAL, VIEW, 1);
    for (const y of ys.slice(1, -1)) assert.equal((await go(y, 'mid')).y, y, `actual y for ${y}`);
    assert.deepEqual([await visibility('#banner'), await visibility('#footer'), await visibility('#pre')], ['hidden', 'hidden', 'hidden']);
    assert.deepEqual([await position('header'), await position('#pre2')], ['static', 'static']);
    assert.ok(await page.evaluate(() => document.getElementById('lazy').classList.contains('seen')), 'the lazy content had time to load');
  });

  it('last tile: fixed at the bottom visible; a position that is too low is brought back to the maximum', async () => {
    assert.equal((await go(11300, 'last')).y, 11300);
    assert.equal(await visibility('#banner'), 'hidden');
    assert.equal(await visibility('#footer'), 'visible');
    assert.equal((await go(11900, 'last')).y, 11300, 'requesting 11900 gives an actual scroll of 11300');
  });

  it('Escape: go reports the cancellation', async () => {
    await page.keyboard.press('Escape');
    assert.equal((await go(500, 'mid')).cancelled, true);
  });

  it('end: inline styles, position, behavior and snap restored to the original, inputs free again', async () => {
    assert.equal(await page.evaluate(() => window.__obturoFull.end()), true);
    await poll(async () => (await snapshot()).join() === snapBefore.join(), { what: 'inline styles restored', timeout: 3000 });
    assert.equal(await page.evaluate(() => scrollY), yInitial, 'scroll position restored');
    assert.equal(await page.evaluate(() => document.documentElement.style.scrollBehavior), '');
    assert.equal(await scrollType(), scrollTypeBefore);
    assert.ok(!(await scrollBlocked()) && !(await keyBlocked('PageDown')), 'wheel, touch and keys free');
    assert.equal(await page.evaluate(() => window.__obturoFull.end()), true, 'end is idempotent');
  });

  it('reinjection without end (service worker dead midway): the previous state is restored', async () => {
    await page.evaluate(() => window.scrollTo({ top: 3000, behavior: 'instant' }));
    const y = await page.evaluate(() => scrollY);
    const before = await snapshot();
    await start();
    await go(3000, 'mid');
    assert.equal(await visibility('#footer'), 'hidden', 'the page is indeed modified');
    await page.evaluate(script);
    await poll(async () => (await snapshot()).join() === before.join(), { what: 'state restored by the reinjection', timeout: 3000 });
    assert.equal(await page.evaluate(() => scrollY), y);
  });

  it('15 s watchdog: the page restores itself if the service worker disappears', async () => {
    const y = await page.evaluate(() => scrollY);
    const before = await snapshot();
    await start();
    await go(3000, 'mid');
    await poll(async () => (await snapshot()).join() === before.join(), { what: 'page put back in order by the watchdog', timeout: 20_000, interval: 250 });
    assert.equal(await page.evaluate(() => scrollY), y);
    await assert.rejects(go(100, 'mid'), /restored/, 'go after the restoration is refused');
    assert.equal(await visibility('#footer'), 'visible', 'the page is not hidden again');
    assert.deepEqual(await snapshot(), before);
  });
});

// An application shell: the document is still (overflow hidden), a panel scrolls. The shell itself is fixed to the window, a
// bar sits outside the panel, a toast covers its top, another its bottom. Smooth scrolling and mandatory snap on the panel,
// a sticky header in it. Also in the panel, what is NOT a scroller: a text area that scrolls, a block that scrolls sideways
// only; and a small box that does scroll (found, but too small to win).
const PANEL_H = 5000;
const APP_HTML = `<!doctype html><html><head><meta charset=utf-8><style>
html, body { margin:0; height:100%; overflow:hidden; }
#app { position:fixed; top:0; left:0; right:0; bottom:0; }
#bar { position:fixed; top:0; left:0; right:0; height:40px; background:#c01c28; z-index:9 }
#pane { position:absolute; top:40px; left:100px; right:0; bottom:0; overflow-y:auto; scroll-behavior:smooth; scroll-snap-type:y mandatory; }
#content { position:relative; height:${PANEL_H}px; }
.snap { position:absolute; left:0; width:10px; height:1000px; scroll-snap-align:start; }
#head { position:sticky; top:0; height:50px; background:#1a5fb4; z-index:5 }
#toast { position:fixed; top:60px; right:20px; width:80px; height:40px; background:#f5c211; z-index:9 }
#cookie { position:fixed; bottom:10px; left:140px; width:200px; height:40px; background:#26a269; z-index:9 }
#side { position:fixed; top:40px; left:0; width:100px; bottom:0; background:#555; }
#text { position:absolute; top:1100px; left:20px; width:300px; height:100px; }
#wide { position:absolute; top:1250px; left:20px; width:400px; height:120px; overflow-x:auto; }
#wide div { width:3000px; height:100px; background:#ccc }
#small { position:absolute; top:1260px; left:500px; width:200px; height:100px; overflow-y:auto; }
#small div { height:600px; background:#ddd }
</style></head><body>
<div id=app><div id=bar></div><div id=side></div><div id=toast></div><div id=cookie></div>
<div id=pane><div id=content>
<div id=head></div><textarea id=text></textarea><div id=wide><div></div></div><div id=small><div></div></div>
${Array.from({ length: PANEL_H / 1000 }, (_, i) => `<div class=snap style="top:${i * 1000}px"></div>`).join('')}
</div></div></div>
<script>document.getElementById('text').value = 'line\\n'.repeat(200);</script>
</body></html>`;

describe('fullpage.js: a scroller inside the page', () => {
  let browser, page, script, paneBefore, snapBefore;
  const call = (method, ...args) => page.evaluate(([m, a]) => window.__obturoFull[m](...a), [method, args]);
  const style = (selector, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, prop]);
  const paneTop = () => page.evaluate(() => document.getElementById('pane').scrollTop);
  const snapshot = () => page.evaluate(() => /** @type {HTMLElement[]} */ ([...document.querySelectorAll('html, body, body *')]).map((e) => `${e.tagName}#${e.id}|${e.style.cssText}`));
  const load = async (html) => {
    await page.setContent(html);
    await page.evaluate(script);
  };
  let started;

  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    script = readFileSync(join(REPO, 'fullpage.js'), 'utf8');
    await page.setContent(APP_HTML);
    await page.evaluate(() => document.getElementById('pane').scrollTo({ top: 1000, behavior: 'instant' })); // a snap point: the panel stays there
    paneBefore = await paneTop();
    assert.equal(paneBefore, 1000);
    snapBefore = await snapshot();
    await page.evaluate(script);
  });
  after(() => browser?.close());

  it('begin: the panel is found; the text area, the sideways scroller and the document are not candidates; the panel is picked', async () => {
    const scan = await call('begin');
    assert.deepEqual([scan.vw, scan.vh, scan.dpr], [1280, 700, 1]);
    assert.deepEqual(scan.doc, { user: false, max: 0 }, 'overflow hidden: the user cannot scroll the document');
    const sizes = scan.cands.map((c) => [c.w, c.h, c.max]);
    assert.deepEqual(sizes.toSorted((a, b) => b[0] - a[0]), [[1180, 660, PANEL_H - 660], [200, 100, 500]], 'the panel, and the small box');
    const panel = scan.cands.find((c) => c.w === 1180);
    assert.deepEqual([panel.x, panel.y], [100, 40]);
    const pick = pickScroller(scan.cands, scan.doc, scan.vw, scan.vh);
    assert.equal(scan.cands[pick].w, 1180);
    started = pick;
  });

  it('aim: the panel is the target, with its box and its range; smooth scrolling and snap are neutralized on it', async () => {
    const m = await call('aim', started);
    assert.deepEqual(m, { box: { x: 100, y: 40, w: 1180, h: 660 }, max: PANEL_H - 660, vw: 1280, vh: 700, dpr: 1 });
    assert.equal(await style('#pane', 'scrollBehavior'), 'auto');
    assert.equal(await style('#pane', 'scrollSnapType'), 'none');
  });

  it('first tile: the panel goes to the top, not the window; top elements over the panel stay, bottom ones hide', async () => {
    const r = await call('go', 0, 'first');
    assert.deepEqual(r, { y: 0, cancelled: false, vh: 700, max: PANEL_H - 660, box: { x: 100, y: 40, w: 1180, h: 660 } });
    assert.equal(await style('#toast', 'visibility'), 'visible');
    assert.equal(await style('#cookie', 'visibility'), 'hidden');
    assert.equal(await style('#head', 'position'), 'sticky');
  });

  it('middle tiles: the actual position of the panel, the window untouched; what covers the panel hides, what does not stays', async () => {
    for (const y of [660, 1320, 2640]) assert.equal((await call('go', y, 'mid')).y, y);
    assert.equal(await paneTop(), 2640);
    assert.equal(await page.evaluate(() => scrollY), 0, 'the window did not move');
    assert.deepEqual([await style('#toast', 'visibility'), await style('#cookie', 'visibility')], ['hidden', 'hidden']);
    assert.equal(await style('#head', 'position'), 'static', 'sticky: back in its place');
    assert.equal(await style('#bar', 'visibility'), 'visible', 'a fixed bar outside the panel is not touched');
    assert.equal(await style('#side', 'visibility'), 'visible');
    assert.equal(await style('#app', 'visibility'), 'visible', 'the shell, which holds the panel, is not hidden');
  });

  it('last tile: a position too low is brought back to the maximum, the bottom element shows, the top one hides', async () => {
    assert.equal((await call('go', PANEL_H, 'last')).y, PANEL_H - 660);
    assert.deepEqual([await style('#toast', 'visibility'), await style('#cookie', 'visibility')], ['hidden', 'visible']);
  });

  it('go reports a panel that grew (lazy loading) and one that moved', async () => {
    await page.evaluate(() => { document.getElementById('content').style.height = '6500px'; });
    const r = await call('go', 0, 'mid');
    assert.equal(r.max, 6500 - 660);
    assert.deepEqual(await call('size'), { max: 6500 - 660 });
    await page.evaluate(() => { document.getElementById('pane').style.left = '150px'; });
    assert.deepEqual((await call('go', 0, 'mid')).box, { x: 150, y: 40, w: 1130, h: 660 }, 'the box is the current one');
    await page.evaluate(() => { document.getElementById('content').style.removeProperty('height'); document.getElementById('pane').style.removeProperty('left'); });
  });

  it('end: the panel is back where it was, styles, smooth scrolling, snap and inputs as before', async () => {
    assert.equal(await call('end'), true);
    await poll(async () => (await snapshot()).join() === snapBefore.join(), { what: 'inline styles restored', timeout: 3000 });
    assert.equal(await paneTop(), paneBefore);
    assert.equal(await style('#pane', 'scrollBehavior'), 'smooth');
    assert.equal(await style('#pane', 'scrollSnapType'), 'y mandatory');
    assert.equal(await page.evaluate(() => scrollY), 0);
    const wheel = await page.evaluate(() => {
      const e = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
      document.getElementById('pane').dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert.equal(wheel, false, 'the wheel is free again, in the panel too');
    assert.equal(await call('end'), true, 'end is idempotent');
  });

  it('the wheel is blocked in the panel during the capture', async () => {
    await call('begin');
    await call('aim', started);
    const wheel = await page.evaluate(() => {
      const e = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
      document.getElementById('pane').dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert.equal(wheel, true);
    await call('end');
  });

  it('a panel removed from the page during the capture: go refuses, and end still restores everything', async () => {
    const before = await snapshot();
    await call('begin');
    await call('aim', started);
    await call('go', 700, 'mid');
    await page.evaluate(() => document.getElementById('pane').remove());
    await assert.rejects(call('go', 1400, 'mid'), /scroller gone/);
    await call('end');
    assert.equal(await style('#cookie', 'visibility'), 'visible');
    assert.equal(await style('#toast', 'visibility'), 'visible');
    assert.ok((await snapshot()).length < before.length, 'the panel is gone, the rest is as it was');
  });

  it('a scroller that is gone between begin and aim is refused', async () => {
    await load(APP_HTML);
    const scan = await call('begin');
    const pick = pickScroller(scan.cands, scan.doc, scan.vw, scan.vh);
    await page.evaluate(() => document.getElementById('pane').remove());
    await assert.rejects(call('aim', pick), /scroller gone/);
    await call('end');
  });

  it('nested scrollers are both candidates; the one with the most content on screen is picked', async () => {
    await load(`<!doctype html><body style="margin:0;overflow:hidden">
      <div id=outer style="position:absolute;inset:0;overflow-y:auto"><div style="height:1000px;position:relative">
        <div id=inner style="position:absolute;top:100px;left:100px;width:900px;height:420px;overflow-y:auto"><div style="height:6000px"></div></div>
      </div></div></body>`);
    const scan = await call('begin');
    assert.deepEqual(scan.cands.map((c) => [c.w, c.h, c.max]).toSorted((a, b) => b[0] - a[0]), [[1280, 700, 300], [900, 420, 5580]]);
    const pick = pickScroller(scan.cands, scan.doc, scan.vw, scan.vh);
    assert.equal(scan.cands[pick].w, 900, 'the inner one: 42% of the window x 5,580 against 100% x 300');
    const m = await call('aim', pick);
    assert.deepEqual(m.box, { x: 100, y: 100, w: 900, h: 420 });
    assert.equal((await call('go', 1000, 'mid')).y, 1000);
    assert.equal(await page.evaluate(() => document.getElementById('inner').scrollTop), 1000);
    assert.equal(await page.evaluate(() => document.getElementById('outer').scrollTop), 0, 'the outer one is not moved');
    await call('end');
  });

  it('body that scrolls on its own (html fixed to the window): the body is a scroller; with the usual html it is the document', async () => {
    await load('<!doctype html><html style="height:100%;overflow:hidden"><body style="margin:0;height:100%;overflow:auto"><div style="height:4000px"></div></body></html>');
    const scan = await call('begin');
    assert.deepEqual(scan.cands.map((c) => [c.w, c.h, c.max]), [[1280, 700, 3300]]);
    assert.equal(scan.doc.user, false);
    await call('end');
    await load('<!doctype html><body style="margin:0;overflow:auto"><div style="height:4000px"></div></body>');
    const usual = await call('begin');
    assert.deepEqual(usual.cands, [], 'the body passes its overflow to the window: it is not a scroller');
    assert.deepEqual(usual.doc, { user: true, max: 3300 });
    await call('end');
  });

  it('a scroller in an open shadow root is found', async () => {
    await load(`<!doctype html><body style="margin:0;overflow:hidden"><div id=host style="position:absolute;inset:0"></div>
      <script>
        const open = document.getElementById('host').attachShadow({ mode: 'open' });
        open.innerHTML = '<div id=in style="position:absolute;inset:0;overflow-y:auto"><div style="height:4000px"></div></div>';
      </script></body>`);
    const scan = await call('begin');
    assert.deepEqual(scan.cands.map((c) => [c.w, c.h, c.max]), [[1280, 700, 3300]]);
    const m = await call('aim', 0);
    assert.equal(m.max, 3300);
    assert.equal((await call('go', 900, 'mid')).y, 900);
    await call('end');
  });

  it('a scroller clipped away or off the screen is not found; one under a cover still is (it scrolls)', async () => {
    await load(`<!doctype html><body style="margin:0;overflow:hidden">
      <div id=shown style="position:absolute;left:0;top:0;width:640px;height:700px;overflow-y:auto"><div style="height:3000px"></div></div>
      <div id=covered style="position:absolute;left:640px;top:0;width:640px;height:700px;overflow-y:auto"><div style="height:3000px"></div></div>
      <div style="position:fixed;left:640px;top:0;width:640px;height:700px;background:#000"></div>
      <div style="position:absolute;left:-5000px;top:0;width:640px;height:700px;overflow-y:auto"><div style="height:3000px"></div></div>
      <div style="position:absolute;left:0;top:0;width:640px;height:700px;overflow:hidden;clip-path:inset(0 0 0 100%)"><div style="overflow-y:auto;height:700px"><div style="height:3000px"></div></div></div>
    </body>`);
    const scan = await call('begin');
    assert.deepEqual(scan.cands.map((c) => [c.x, c.w, c.max]).toSorted((a, b) => a[0] - b[0]), [[0, 640, 2300], [640, 640, 2300]], 'the off-screen and the clipped ones are not there');
    await call('end');
  });

  it('detection on a page of 20,000 nodes: under 30 ms', async () => {
    await load(`<!doctype html><body style="margin:0;overflow:hidden"><div id=pane style="position:absolute;inset:0;overflow-y:auto"><div id=list></div></div>
      <script>
        const list = document.getElementById('list');
        const rows = document.createDocumentFragment();
        for (let i = 0; i < 4000; i++) {
          const row = document.createElement('div');
          row.style.cssText = 'height:20px;overflow:hidden';
          for (let j = 0; j < 4; j++) row.append(document.createElement('span'));
          rows.append(row);
        }
        list.append(rows);
      </script></body>`);
    const count = await page.evaluate(() => document.querySelectorAll('*').length);
    assert.ok(count >= 20000, `${count} nodes`);
    const times = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < 9; i++) {
        const t0 = performance.now();
        const scan = window.__obturoFull.begin();
        const t1 = performance.now();
        window.__obturoFull.aim(0); // the scan of the fixed and sticky elements: walks the whole DOM, as it always did
        out.push([t1 - t0, scan.cands.length, performance.now() - t1]);
        window.__obturoFull.end();
      }
      return out;
    });
    const sorted = times.map((t) => t[0]).toSorted((a, b) => a - b);
    const median = sorted[4];
    const aims = times.map((t) => t[2]).toSorted((a, b) => a - b);
    console.log(`      on ${count} nodes: choosing the scroller (begin) median ${median.toFixed(2)} ms, worst ${sorted.at(-1).toFixed(2)} ms; looking for fixed and sticky elements (aim) median ${aims[4].toFixed(1)} ms`);
    assert.ok(times.every((t) => t[1] === 1), 'the pane, found each time');
    assert.ok(median < 30, `${median} ms`);
  });
});

describe('overlay.js: selecting an area with the mouse', () => {
  let browser, page, script;
  const messages = () => page.evaluate(() => window.__msgs ?? []);
  const overlayCount = () => page.evaluate(() => document.querySelectorAll('#obturo-overlay').length);

  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    await page.setContent("<body style='margin:0;height:3000px'>x</body>");
    // chrome.runtime.sendMessage is replaced by a simple record of the messages
    await page.evaluate(() => { window.chrome = { runtime: { sendMessage: (m) => { (window.__msgs ||= []).push(m); } } }; });
    script = readFileSync(join(REPO, 'overlay.js'), 'utf8');
  });
  after(() => browser?.close());

  it('idempotent injection, no touch scrolling', async () => {
    await page.evaluate(script);
    await page.evaluate(script);
    assert.equal(await overlayCount(), 1);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('obturo-overlay')).touchAction), 'none');
  });

  it('the right button starts no selection and does not close the overlay', async () => {
    await page.mouse.move(60, 60);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(300, 300, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    assert.equal(await overlayCount(), 1);
    assert.equal(await page.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('obturo-overlay').firstChild).style.display), 'none');
    assert.equal((await messages()).length, 0);
  });

  it('at most one style write per frame during the drag', async () => {
    await page.evaluate(() => {
      const selection = document.querySelector('#obturo-overlay > div');
      window.__mutations = 0;
      window.__frames = 0;
      new MutationObserver((list) => { window.__mutations += list.length; }).observe(selection, { attributes: true });
      const loop = () => { window.__frames++; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(900, 500, { steps: 240 }); // 240 pointermove events
    await poll(() => page.evaluate(() => window.__frames > 0), { what: 'frames rendered' });
    const [mutations, frames] = await page.evaluate(() => [window.__mutations, window.__frames]);
    assert.ok(mutations <= frames + 1, `${mutations} writes over ${frames} frames for 240 pointermove`);
  });

  it('a burst of 300 pointermove causes only one style write', async () => {
    const writes = await page.evaluate(async () => {
      const box = document.getElementById('obturo-overlay');
      const selection = box.firstChild;
      const twoFrames = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      await twoFrames();
      let n = 0;
      const observer = new MutationObserver((list) => { n += list.length; });
      observer.observe(selection, { attributes: true });
      for (let i = 0; i < 300; i++) box.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 + i, clientY: 150 + i / 2, bubbles: true }));
      await twoFrames();
      observer.disconnect();
      return n;
    });
    assert.equal(writes, 1);
  });

  it('a single "area" message (rectangle, window size, address, title), then the overlay disappears', async () => {
    await page.mouse.up();
    await poll(async () => (await messages()).length === 1, { what: 'message sent' });
    const [message] = await messages();
    assert.equal(message.type, 'area');
    assert.deepEqual(message.rect, { x: 100, y: 100, w: 800, h: 400 });
    assert.deepEqual([message.vw, message.vh], [1280, 700]);
    assert.ok('url' in message && 'title' in message && !('t' in message), 'message fields');
    assert.equal(message.edit, false, 'plain area: not "capture and edit"');
    assert.equal(await overlayCount(), 0);
  });

  it('"capture and edit": the mode written on the element by the service worker travels in the message', async () => {
    await page.evaluate(() => { window.__msgs = []; });
    await page.evaluate(script);
    await page.evaluate(() => document.getElementById('obturo-overlay').setAttribute('data-edit', '1'));
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(500, 300, { steps: 5 });
    await page.mouse.up();
    await poll(async () => (await messages()).length === 1, { what: 'message sent' });
    const [message] = await messages();
    assert.equal(message.type, 'area');
    assert.equal(message.edit, true);
    assert.deepEqual(message.rect, { x: 100, y: 100, w: 400, h: 200 });
  });

  it('a selection under 5 px is ignored; Escape cancels; pointercancel cancels cleanly', async () => {
    await page.evaluate(() => { window.__msgs = []; });
    await page.evaluate(script);
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(60, 52, { steps: 3 });
    await page.mouse.up();
    await poll(async () => (await overlayCount()) === 0, { what: 'overlay removed' });
    await page.waitForTimeout(250); // the message would leave two frames later: absence to prove
    assert.equal((await messages()).length, 0, 'selection too small is ignored');

    await page.evaluate(script);
    await page.keyboard.press('Escape');
    assert.equal(await overlayCount(), 0, 'Escape cancels');

    await page.evaluate(script);
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 5 });
    await page.evaluate(() => document.getElementById('obturo-overlay').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
    await page.mouse.up();
    await poll(async () => (await overlayCount()) === 0, { what: 'overlay removed after pointercancel' });
    await page.waitForTimeout(250);
    assert.equal((await messages()).length, 0, 'pointercancel: no message');
  });
});
