// MANUAL bench of the performance budgets (docs/ARCHITECTURE.md): npm run bench
//
// Outside continuous integration: durations depend on the hardware (and on the load of the machine during the
// measurement). The script launches Playwright's Chromium with the extension in a throwaway profile, fills the library
// with 10 shots (HD, 4K, full pages), measures, then prints a "budget, target, measured, verdict" table.
// It always exits with code 0: an "OVER BUDGET" is information, to be reread on an idle machine.
//
// Options: --json also prints all the raw measurements (to compare before and after a change).
// ponytail: the memory peak of a full-page capture is not measured here but by hand (docs/ARCHITECTURE.md); sample the
// memory of the service worker during captureFull through CDP to automate it.
import { readFileSync } from 'node:fs';
import { launchExtension } from '../test/e2e/support/browser.mjs';
import { dbDump, seed, seedSettings, sleep } from '../test/e2e/support/editor.mjs';
import { badges, quota, resetBadges, startSite, tabOf } from '../test/e2e/support/capture.mjs';
import { blankPage, madeUp, seedBulk, setPolicy } from '../test/e2e/support/history.mjs';
import { makeRows, seedRows } from '../test/e2e/support/history-ui.mjs'; // history view

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

const R = {}; // raw measurements
const rows = []; // lines of the final table
const budget = (name, target, measured, ok) => rows.push({ name, target, measured, ok });

// ---------------------------------------------------------------- editor and library

async function benchLibrary() {
  const h = await launchExtension();
  const page = await h.context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(h.url());
  await seedSettings(page, { language: 'fr' }); // the waits below match the French text of the output area ("Sortie : ...")
  try {
    // Data set: 10 mixed shots (the most recent last).
    const specs = [
      [3840, 2160, '4K a'], [1920, 1080, 'HD a'], [1920, 16384, 'Full page a'], [1920, 1080, 'HD b'], [1920, 1080, 'HD c'],
      [3840, 2160, '4K b'], [1280, 720, 'Small'], [1920, 16384, 'Full page b'], [1920, 1080, 'HD d'], [3840, 2160, '4K c (the most recent)'],
    ];
    for (const [w, h, title] of specs) await seed(page, { w, h, title, url: `https://example.test/${encodeURIComponent(title)}`, stripes: true });

    await measureStrip(page);
    await measureOpen(page, specs);
    await measureFrames(page);
    await measureDatabase(page);
    await measureBlur(page);
    await page.reload();
    await page.waitForSelector('#ui:not([disabled])', { state: 'attached', timeout: 30_000 });
    await measureExport(page);
    await measureLeaks(h, page);
    R.errors = h.errors.filter((e) => !/willReadFrequently/.test(e));
    R.csp = await page.evaluate(() => window.__csp);
  } finally {
    await h.close();
  }
}

// P1: first render of the strip, cold (no thumbnail) then warm (9 loads).
async function measureStrip(page) {
  async function load() {
    await page.reload();
    await page.waitForSelector('#ui:not([disabled])', { state: 'attached', timeout: 30_000 });
    return page.evaluate(() => {
      const mark = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null;
      const before = window.__c.calls.filter((x) => x.at <= mark('obturo:strip-painted'));
      return {
        rendered: mark('obturo:strip-rendered'), painted: mark('obturo:strip-painted'), editorLoaded: mark('obturo:editor-loaded'),
        uiReady: window.__uiReady, fullDecodesBeforePaint: before.filter((x) => !x.resize && !x.crop).length,
      };
    });
  }
  const cold = await load();
  // A cell gets its thumbnail when it scrolls into view: the strip is wider than the window, so bring the end in.
  await page.evaluate(() => { document.getElementById('strip').scrollLeft = 1e6; });
  await page.waitForFunction(() => document.querySelectorAll('#strip img[src]').length === 10, null, { timeout: 60_000 });
  await sleep(300);
  const afterThumbs = await dbDump(page);
  R.cold = { ...cold, allThumbsPersisted: afterThumbs.every((s) => s.hasThumb), versionsUntouched: afterThumbs.every((s) => s.versions.length === 0 && s.active === -1) };

  const runs = [];
  for (let i = 0; i < 9; i++) runs.push(await load());
  R.warm = {
    paintedMs: round(median(runs.map((x) => x.painted))),
    paintedMaxMs: round(Math.max(...runs.map((x) => x.painted))),
    editorReadyMs4K: round(median(runs.map((x) => x.uiReady))),
    fabricAfterPaint: runs.every((x) => x.editorLoaded > x.painted),
    fullDecodesBeforePaint: Math.max(...runs.map((x) => x.fullDecodesBeforePaint)),
  };
  budget('Strip painted (median of 9 loads)', '< 100 ms', `${R.warm.paintedMs} ms (max ${R.warm.paintedMaxMs})`, R.warm.paintedMs < 100);
  budget('Fabric loaded after the first paint', 'yes', R.warm.fabricAfterPaint ? 'yes' : 'no', R.warm.fabricAfterPaint);
  budget('Full-size PNGs decoded before the paint', '0', String(R.warm.fullDecodesBeforePaint), R.warm.fullDecodesBeforePaint === 0);
  budget('Thumbnails generated without counting as an edit', 'yes', R.cold.allThumbsPersisted && R.cold.versionsUntouched ? 'yes' : 'no', R.cold.allThumbsPersisted && R.cold.versionsUntouched);
}

// P2: opening a shot, from the click to a usable editor.
async function measureOpen(page, specs) {
  async function openTime(index, expectedText) {
    return page.evaluate(async ({ index, expectedText }) => {
      const out = document.getElementById('out');
      const ui = /** @type {HTMLFieldSetElement} */ (document.getElementById('ui'));
      const start = performance.now();
      const done = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (out.textContent === expectedText && !ui.disabled) { observer.disconnect(); resolve(undefined); }
        });
        observer.observe(out, { childList: true, characterData: true, subtree: true });
        observer.observe(ui, { attributes: true });
      });
      /** @type {HTMLElement} */ (document.querySelectorAll('#strip li.shot')[index].querySelector('button.open')).click();
      await done;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - start;
    }, { index, expectedText });
  }
  const order = specs.toReversed(); // the strip, left to right
  const wanted = ['4K c (the most recent)', 'HD d', 'Full page b', 'Small'];
  R.openMs = {};
  for (const [i, [w, h, title]] of order.entries()) {
    if (!wanted.includes(title)) continue;
    const samples = [];
    const other = order[(i + 1) % 10];
    for (let k = 0; k < 3; k++) { // we alternate with another shot to force a real opening
      await openTime((i + 1) % 10, `Sortie : ${other[0]} \u00d7 ${other[1]} px`);
      samples.push(await openTime(i, `Sortie : ${w} \u00d7 ${h} px`));
    }
    R.openMs[`${title} ${w}x${h}`] = round(median(samples));
  }
  const worst = Math.max(...Object.values(R.openMs));
  budget('Opening, click -> usable editor (HD, 4K, full page)', '< 150 ms', `${Object.entries(R.openMs).map(([k, v]) => `${k.split(' ').at(-1)} ${v}`).join(', ')} ms`, worst < 150);
}

// P3: smoothness (intervals between frames) during real interactions, on three image sizes.
async function measureFrames(page) {
  async function frames(scenario) {
    await page.evaluate(() => {
      window.__fr = { t: [], on: true };
      const loop = (ts) => { if (!window.__fr.on) return; window.__fr.t.push(ts); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await scenario();
    const t = await page.evaluate(() => { window.__fr.on = false; return window.__fr.t; });
    const d = t.slice(1).map((x, i) => x - t[i]);
    return {
      frames: t.length, fps: round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)), p95Ms: round(percentile(d, 0.95)),
      maxMs: round(Math.max(...d)), over20ms: d.filter((x) => x > 20).length,
    };
  }
  async function interactions(index, size) {
    await page.locator('#strip li.shot').nth(index).locator('button.open').click();
    await page.waitForFunction((t) => document.getElementById('out').textContent === t, `Sortie : ${size[0]} \u00d7 ${size[1]} px`);
    await sleep(400);
    const stage = await page.locator('#stage').boundingBox();
    const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
    const result = {};
    if (size[1] / size[0] < 2.5) { await page.click('#actual'); await sleep(200); } // 100 %: enough to scroll on a 4K image
    await page.mouse.move(cx, cy);
    result.panWheel = await frames(async () => {
      for (let i = 0; i < 120; i++) { await page.mouse.wheel(i % 40 < 20 ? 60 : -60, i % 40 < 20 ? 60 : -60); await sleep(8); }
    });
    await page.keyboard.down('Control');
    result.zoomWheel = await frames(async () => {
      for (let i = 0; i < 100; i++) { await page.mouse.wheel(0, i % 30 < 15 ? -50 : 50); await sleep(8); }
    });
    await page.keyboard.up('Control');
    await page.click('#fit');
    await sleep(200);
    // a pixelated region moved over the image, plus a few annotations
    const x0 = stage.x + stage.width * 0.3, y0 = stage.y + stage.height * 0.25;
    const draw = async (name, ax, ay, bx, by) => {
      await page.click(`[data-tool="${name}"]`);
      await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 8 }); await page.mouse.up();
    };
    await draw('pixel', x0, y0, x0 + 220, y0 + 110);
    await draw('blur', x0 + 20, y0 + 130, x0 + 240, y0 + 220); // a soft blur on screen for every scenario below
    await draw('rect', x0 + 300, y0 + 40, x0 + 460, y0 + 120);
    await page.click('[data-tool="text"]');
    await page.mouse.click(x0 + 20, y0 + 200);
    await page.keyboard.type('Test');
    await page.keyboard.press('Escape');
    await draw('arrow', x0 + 100, y0 + 260, x0 + 300, y0 + 200);
    await sleep(300);
    await page.click('[data-tool="select"]');
    result.dragPixelRegion = await frames(async () => {
      await page.mouse.move(x0 + 110, y0 + 55);
      await page.mouse.down();
      for (let i = 0; i < 120; i++) { await page.mouse.move(x0 + 110 + Math.sin(i / 8) * 150, y0 + 55 + Math.cos(i / 8) * 40); await sleep(6); }
      await page.mouse.up();
    });
    // Worst case of the autosave: it fires (write + thumbnail render) while we scroll.
    result.autosaveWhilePanning = await frames(async () => {
      await draw('flat', x0 + 20, y0 + 300, x0 + 140, y0 + 350);
      for (let i = 0; i < 110; i++) { await page.mouse.wheel(0, i % 2 ? 30 : -30); await sleep(8); } // ~1.6 s: covers the 500 ms delay
    });
    await sleep(700);
    return result;
  }
  R.frames = {
    'HD 1920x1080': await interactions(1, [1920, 1080]),
    '4K 3840x2160': await interactions(0, [3840, 2160]),
    'full page 1920x16384': await interactions(2, [1920, 16384]),
  };
  const all = Object.entries(R.frames).flatMap(([size, byScenario]) => Object.entries(byScenario).map(([name, f]) => ({ size, name, ...f })));
  const worstShare = Math.max(...all.map((f) => f.over20ms / f.frames));
  const worstP95 = Math.max(...all.map((f) => f.p95Ms));
  budget('Smoothness: 60 frames/s (zoom, scroll, drag, autosave)', '< 2 % of frames > 20 ms', `${round(worstShare * 100)} % at worst, p95 ${worstP95} ms, ${all.length} scenarios`, worstShare < 0.02);
}

// P4: IndexedDB, the autosave never rewrites the original.
async function measureDatabase(page) {
  R.idb = await page.evaluate(async () => {
    const db = await import(`${location.origin}/db.js`);
    const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const all = (await db.queryShots({ limit: 100 })).items;
    const big = all.find((s) => s.title === 'Full page b') ?? all[0];
    const update = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      await db.updateShot(big.id, { versions: big.versions, active: big.active });
      update.push(performance.now() - start);
    }
    const strip = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      await db.latestShots(12); // what the library reads to paint its strip
      strip.push(performance.now() - start);
    }
    // a PNG of more than 30 MB (noise, incompressible) as the service worker would send it for a very large capture
    const canvas = new OffscreenCanvas(3840, 2160);
    const g = canvas.getContext('2d');
    const data = g.createImageData(3840, 2160);
    crypto.getRandomValues(data.data.subarray(0, 65536));
    for (let o = 65536; o < data.data.length; o += 65536) data.data.copyWithin(o, 0, Math.min(65536, data.data.length - o));
    g.putImageData(data, 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    const start = performance.now();
    await db.addShot({ original: png, url: 'https://example.test/big', title: 'Big PNG', w: 3840, h: 2160 });
    const addMs = performance.now() - start;
    const added = (await db.queryShots({ limit: 100 })).items.find((s) => s.title === 'Big PNG');
    const withBig = [];
    for (let i = 0; i < 15; i++) {
      const s = performance.now();
      await db.updateShot(added.id, { versions: [{ name: 'V1', crop: null, scale: 1, objects: [] }], active: 0 });
      withBig.push(performance.now() - s);
    }
    return {
      updateShotMs: +median(update).toFixed(2), stripReadMs: +median(strip).toFixed(2), bigPngMB: +(png.size / 1048576).toFixed(1),
      addShotBigPngMs: +addMs.toFixed(1), updateShotWithBigOriginalMs: +median(withBig).toFixed(2),
    };
  });
  budget('Autosave (updateShot)', '< 20 ms', `${R.idb.updateShotMs} ms, ${R.idb.updateShotWithBigOriginalMs} ms with an original of ${R.idb.bigPngMB} MB`, Math.max(R.idb.updateShotMs, R.idb.updateShotWithBigOriginalMs) < 20);
  budget('Strip read (latestShots, 12 shots)', '< 20 ms', `${R.idb.stripReadMs} ms`, R.idb.stripReadMs < 20);
}

// P4b: the exact blur (BlurRegion.settle: reads the pixels of the region, one mean per block) of an 800 x 400 region, on 1080p and 4K.
async function measureBlur(page) {
  R.blurMs = await page.evaluate(async () => {
    const { BlurRegion, source } = await import(`${location.origin}/shapes.js`);
    const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const out = {};
    for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d');
      const gradient = g.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#f97316');
      gradient.addColorStop(1, '#3b82f6');
      g.fillStyle = gradient;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#000';
      for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h); // detail to average
      const bitmap = await createImageBitmap(c);
      const keep = source.img; // the open editor keeps its own image outside the synchronous loop
      source.img = bitmap;
      const runs = [];
      for (let i = 0; i < 9; i++) {
        const region = new BlurRegion({ left: 300 + i, top: 200, width: 800, height: 400, block: 32 }); // a new place every run: nothing is cached
        const start = performance.now();
        region.settle();
        runs.push(performance.now() - start);
        region.dispose();
      }
      source.img = keep;
      bitmap.close();
      out[`${w}x${h}`] = +median(runs).toFixed(1);
    }
    return out;
  });
  budget('Soft blur: exact validation of an 800 x 400 region', '< 50 ms (1080p), < 150 ms (4K)', `1080p ${R.blurMs['1920x1080']} ms, 4K ${R.blurMs['3840x2160']} ms`, R.blurMs['1920x1080'] < 50 && R.blurMs['3840x2160'] < 150);
}

// P5: export on demand.
async function measureExport(page) {
  async function exportMs(index, size, setup) {
    await page.locator('#strip li.shot').nth(index).locator('button.open').click();
    await page.waitForFunction((t) => document.getElementById('out').textContent === t, `Sortie : ${size[0]} \u00d7 ${size[1]} px`);
    await sleep(300);
    if (setup) await setup();
    const start = Date.now();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const bytes = readFileSync(await dl.path()).length;
    return { ms: Date.now() - start, mb: +(bytes / 1048576).toFixed(2) };
  }
  const drawRect = async () => {
    const stage = await page.locator('#stage').boundingBox();
    await page.click('[data-tool="rect"]');
    await page.mouse.move(stage.x + 200, stage.y + 100);
    await page.mouse.down();
    await page.mouse.move(stage.x + 420, stage.y + 220, { steps: 6 });
    await page.mouse.up();
    await sleep(300);
  };
  const list = (await dbDump(page)).toReversed();
  const index = (title) => list.findIndex((s) => s.title === title);
  R.exportMs = {
    'HD edited 1920x1080': await exportMs(index('HD c'), [1920, 1080], drawRect),
    '4K edited 3840x2160 (32 MB original)': await exportMs(index('Big PNG'), [3840, 2160], drawRect),
    'full page edited 1920x16384': await exportMs(index('Full page a'), [1920, 16384], drawRect),
    '4K original (no re-encoding)': await exportMs(index('4K b'), [3840, 2160], null),
  };
  const e = R.exportMs;
  budget('Edited PNG export (HD, full page)', '< 500 ms', `HD ${e['HD edited 1920x1080'].ms} ms, full page ${e['full page edited 1920x16384'].ms} ms`, Math.max(e['HD edited 1920x1080'].ms, e['full page edited 1920x16384'].ms) < 500);
  budget('Edited PNG export, 4K with a 32 MB original', '< 1500 ms', `${e['4K edited 3840x2160 (32 MB original)'].ms} ms`, e['4K edited 3840x2160 (32 MB original)'].ms < 1500);
  budget('Export of the original (no re-encoding)', '< 300 ms', `${e['4K original (no re-encoding)'].ms} ms`, e['4K original (no re-encoding)'].ms < 300);
}

// P6: leaks, open and close 24 times (8 of them with an annotation).
async function measureLeaks(h, page) {
  const cdp = await h.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const snapshot = async () => {
    for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(120); }
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const c = await page.evaluate(() => ({
      bitmapsLive: window.__c.bmp - window.__c.bmpClosed, urlsLive: window.__c.urlLive.size,
      thumbsOnScreen: document.querySelectorAll('#strip img[src]').length, canvases: document.querySelectorAll('canvas').length,
    }));
    return { jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, ...c };
  };
  const sizes = (await dbDump(page)).toReversed().map((s) => [s.w, s.h]);
  async function cycle(i) {
    const j = i % 10;
    await page.locator('#strip li.shot').nth(j).locator('button.open').click();
    await page.waitForFunction((t) => document.getElementById('out').textContent.startsWith(t), `Sortie : ${sizes[j][0]} \u00d7 ${sizes[j][1]}`, { timeout: 20_000 });
    await sleep(120);
    if (i % 3 === 0) { // an annotation on one cycle out of three: creates and destroys Fabric objects, triggers the autosave
      const stage = await page.locator('#stage').boundingBox();
      await page.click('[data-tool="flat"]');
      await page.mouse.move(stage.x + 150, stage.y + 90);
      await page.mouse.down();
      await page.mouse.move(stage.x + 260, stage.y + 160, { steps: 4 });
      await page.mouse.up();
    }
  }
  for (let i = 0; i < 4; i++) await cycle(i); // warm-up: compilation, caches, thumbnails
  await sleep(800);
  const before = await snapshot();
  for (let i = 4; i < 24; i++) await cycle(i);
  await sleep(11_000); // the download URLs are revoked after 10 s: we wait for that
  const after = await snapshot();
  R.leak = { before, after, heapGrowthMB: +(after.jsHeapMB - before.jsHeapMB).toFixed(2), nodeGrowth: after.nodes - before.nodes, listenerGrowth: after.listeners - before.listeners };
  budget('Leaks after 20 openings: JS heap', '< 1 MB', `+${R.leak.heapGrowthMB} MB`, R.leak.heapGrowthMB < 1);
  budget('Leaks: listeners, DOM nodes', '+0, < +50', `+${R.leak.listenerGrowth}, +${R.leak.nodeGrowth}`, R.leak.listenerGrowth === 0 && R.leak.nodeGrowth < 50);
  budget('Leaks: live bitmaps, live URLs', '<= 1, <= thumbnails + 1', `${after.bitmapsLive}, ${after.urlsLive} (${after.thumbsOnScreen} thumbnails)`, after.bitmapsLive <= 1 && after.urlsLive <= after.thumbsOnScreen + 1);
  budget('Fabric editors left in the page', '1 (2 canvases)', `${after.canvases} canvases`, after.canvases === 2);
}

// ---------------------------------------------------------------- captures (real extension, local pages)

async function benchCaptures() {
  const site = await startSite();
  const h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
  const sw = h.sw;
  try {
    await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    const page = await h.context.newPage();
    const goto = async (height) => {
      await page.goto(`${site.origin}/p${height}.html`);
      await page.bringToFront();
      await sleep(400);
    };

    await goto(800);
    let tab = await tabOf(sw);
    const visible = [];
    for (let i = 0; i < 7; i++) { // the first call is "cold"
      await resetBadges(sw);
      visible.push(await sw.evaluate(async (tab) => {
        const start = Date.now();
        await __t.capture(tab);
        const badge = __t.badge.find((x) => x[1] === 'text' && x[2] === 'OK');
        return badge ? badge[0] - start : null;
      }, tab));
      await quota();
    }
    R.captureVisibleMs = { cold: visible[0], warmMedian: median(visible.slice(1)) };

    const area = [];
    for (let i = 0; i < 6; i++) {
      await resetBadges(sw);
      await sw.evaluate((tab) => __t.startArea(tab), tab);
      await page.waitForSelector('#obturo-overlay', { state: 'attached', timeout: 5000 });
      await page.mouse.move(100, 100);
      await page.mouse.down();
      await page.mouse.move(700, 500, { steps: 8 });
      await page.mouse.up();
      for (let k = 0; k < 100 && !(await badges(sw)).some((b) => b[1] === 'text' && b[2] === 'OK'); k++) await sleep(50);
      const pointerUp = await page.evaluate(() => window.__up);
      area.push((await badges(sw)).find((b) => b[1] === 'text' && b[2] === 'OK')?.[0] - pointerUp);
      await quota();
    }
    R.captureAreaMs = { cold: area[0], warmMedian: median(area.slice(1)) };

    await goto(12000);
    tab = await tabOf(sw);
    await resetBadges(sw);
    const start = Date.now();
    await sw.evaluate((tab) => __t.captureFull(tab), tab);
    const wall = Date.now() - start;
    const progress = (await badges(sw)).filter((e) => e[1] === 'text' && e[2].includes('/')).map((e) => e[2]);
    const tiles = Number(progress.at(-1)?.split('/')[1] ?? 0);
    R.captureFull = { tiles, totalMs: wall, msPerTile: tiles ? Math.round(wall / tiles) : null };

    budget('Visible part capture (gesture -> OK badge)', '< 400 ms', `${R.captureVisibleMs.warmMedian} ms warm, ${R.captureVisibleMs.cold} ms cold`, R.captureVisibleMs.warmMedian < 400);
    budget('Area capture (release -> OK badge)', '< 500 ms', `${R.captureAreaMs.warmMedian} ms warm, ${R.captureAreaMs.cold} ms cold`, R.captureAreaMs.warmMedian < 500);
    budget('Full page: duration per tile (imposed floor: 550 ms)', '< 700 ms', `${R.captureFull.msPerTile} ms (${tiles} tiles, ${wall} ms in total)`, R.captureFull.msPerTile < 700);
  } finally {
    await h.close();
    await site.close();
  }
}

// ---------------------------------------------------------------- history (5,000 shots)

// A history of 5,000 made-up shots (tiny thumbnails and originals of a few KB, one in 25 edited) written straight into the
// stores, then the reads, the writes with the retention on, and a purge of 1,000 shots. Medians of 9 runs unless said.
async function benchHistory() {
  const N = 5000;
  const PURGED = 1000;
  const h = await launchExtension({ instrumented: false });
  try {
    const page = await blankPage(h);
    await setPolicy(page, { retentionDays: 0, maxBytes: 0 });
    const t0 = Date.now();
    const spec = (i, at) => ({ ...madeUp(i), createdAt: at, bytes: 3000 + (i % 7) * 400, edited: i % 25 === 0 });
    await seedBulk(page, Array.from({ length: N }, (_, i) => spec(i, t0 - (N - i) * 60_000)));
    await page.reload(); // a cold page: the first read opens the database
    // The purge takes every shot older than a date set between the 1,042nd and the 1,043rd; 42 of those 1,042 are edited and stay.
    const cutoff = t0 - (N - (PURGED + 42) + 0.5) * 60_000;
    const first = await page.evaluate(async () => {
      const db = await import(`${location.origin}/db.js`);
      const start = performance.now();
      const page = await db.queryShots();
      return { coldMs: performance.now() - start, items: page.items.length, total: page.total, next: page.next };
    });
    R.history = await page.evaluate(async ({ first, cutoff }) => {
      const db = await import(`${location.origin}/db.js`);
      const { setSettings } = await import(`${location.origin}/settings.js`);
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const time = async (fn, runs = 9) => {
        const out = [];
        for (let i = 0; i < runs; i++) {
          const start = performance.now();
          await fn();
          out.push(performance.now() - start);
        }
        return { median: +med(out).toFixed(2), max: +Math.max(...out).toFixed(2) };
      };
      const add = () => db.addShot({ original: new Blob([new Uint8Array(4000)], { type: 'image/png' }), url: 'https://bench.example.test/', title: 'Bench', w: 100, h: 50 });
      const out = { first };
      out.firstPage = await time(() => db.queryShots());
      out.secondPage = await time(() => db.queryShots({ before: first.next }));
      out.hostPage = await time(() => db.queryShots({ host: 'site7.example.test' }));
      out.search = await time(() => db.queryShots({ query: 'facture' }));
      out.searchMatches = (await db.queryShots({ query: 'facture' })).total;
      out.searchAccents = await time(() => db.queryShots({ query: 'caf\u00e9 \u00e9t\u00e9' }));
      out.searchMisses = await time(() => db.queryShots({ query: 'nothing like this' }));
      out.count = await time(() => db.countShots({ query: 'facture' }));
      out.usage = await time(() => db.storageUsage());
      out.hosts = await time(() => db.listHosts());
      await setSettings({ retentionDays: 0, maxBytes: 0 });
      await add();
      out.addAlone = await time(add);
      await setSettings({ retentionDays: 3650, maxBytes: 2 ** 40 }); // the policy looks at every shot and removes none
      await add();
      out.addWithRetention = await time(add);
      out.libraryPass = await time(() => db.runRetention());
      await setSettings({ retentionDays: 0, maxBytes: 0 });
      // an autosave every ~10 ms from the same page while the purge runs: how long does a write wait behind it?
      const target = (await db.queryShots({ limit: 1 })).items[0].id;
      const waits = [];
      let purging = true;
      const writer = (async () => {
        while (purging) {
          const start = performance.now();
          await db.updateShot(target, { active: -1 });
          waits.push(performance.now() - start);
          await new Promise((done) => setTimeout(done, 10));
        }
      })();
      const purgeStart = performance.now();
      out.purge = await db.purgeNow({ olderThanDays: (Date.now() - cutoff) / 864e5 });
      out.purge.ms = +(performance.now() - purgeStart).toFixed(1);
      purging = false;
      await writer;
      out.purge.worstWriteMs = +Math.max(...waits).toFixed(1);
      out.purge.writes = waits.length;
      out.countAfterPurge = await db.countShots();
      return out;
    }, { first, cutoff });
    // back to 5,000 shots, then the steady state of a full history: every add removes the oldest shot to stay under the cap
    await seedBulk(page, Array.from({ length: PURGED }, (_, i) => spec(i, Date.now() + i)));
    Object.assign(R.history, await page.evaluate(async () => {
      const db = await import(`${location.origin}/db.js`);
      const { setSettings } = await import(`${location.origin}/settings.js`);
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const add = () => db.addShot({ original: new Blob([new Uint8Array(4000)], { type: 'image/png' }), url: 'https://bench.example.test/', title: 'Bench', w: 100, h: 50 });
      await setSettings({ retentionDays: 0, maxBytes: 0 });
      const { bytes, count } = await db.storageUsage();
      await setSettings({ retentionDays: 0, maxBytes: bytes });
      await add();
      const times = [];
      for (let i = 0; i < 9; i++) {
        const start = performance.now();
        await add();
        times.push(performance.now() - start);
      }
      const after = await db.storageUsage();
      await setSettings({ retentionDays: 30, maxBytes: 2 * 1024 ** 3 });
      return { addAtCap: { median: +med(times).toFixed(2), max: +Math.max(...times).toFixed(2) }, atCap: { countBefore: count, countAfter: after.count } };
    }));
    R.errors = [...(R.errors ?? []), ...h.errors];
  } finally {
    await h.close();
  }
  const x = R.history;
  const added = (m) => round(m.median - x.addAlone.median);
  budget('History: first page (queryShots, 5 000 shots)', '< 30 ms', `${x.firstPage.median} ms (max ${x.firstPage.max}); first call after a reload ${round(x.first.coldMs)} ms, which includes opening the database`, x.firstPage.median < 30);
  budget('History: search (5 000 shots)', '< 50 ms', `${x.search.median} ms (max ${x.search.max}), ${x.searchMatches} matches; accents ${x.searchAccents.median} ms, no match ${x.searchMisses.median} ms`, Math.max(x.search.median, x.searchAccents.median, x.searchMisses.median) < 50);
  budget('History: addShot with the retention (5 000 shots)', '< 30 ms added', `+${added(x.addWithRetention)} ms (add alone ${x.addAlone.median} ms, with retention ${x.addWithRetention.median} ms)`, added(x.addWithRetention) < 30);
  budget('History: addShot at the size cap, removing one', '< 30 ms added', `+${added(x.addAtCap)} ms (with retention ${x.addAtCap.median} ms; ${x.atCap.countBefore} -> ${x.atCap.countAfter} shots after 10 adds)`, added(x.addAtCap) < 30);
  budget('History: purge of 1 000 shots', '< 500 ms', `${x.purge.ms} ms (${x.purge.deleted} removed, ${round(x.purge.freedBytes / 1024)} KB)`, x.purge.ms < 500 && x.purge.deleted === PURGED);
  budget('History: an autosave during that purge', '< 300 ms', `${x.purge.worstWriteMs} ms at worst over ${x.purge.writes} writes`, x.purge.worstWriteMs < 300);
  budget('History: library pass (runRetention, 5 000 shots)', '< 100 ms', `${x.libraryPass.median} ms (max ${x.libraryPass.max})`, x.libraryPass.median < 100);
}

// ---------------------------------------------------------------- history view (5,000 shots)

// The library and its history sheet on a history of 5,000 shots with real thumbnails: the strip must still paint in under 100 ms
// (it reads the latest 12 shots, not the whole history), the sheet paints its first cards in under 150 ms, scrolling stays at
// 60 frames per second with a bounded DOM, a search shows its results quickly. Against a build without the sheet (no #historyBtn)
// only the strip is measured: that is the "before" of the comparison.
async function benchHistoryView() {
  const N = 5000;
  const h = await launchExtension();
  try {
    const P = await blankPage(h);
    await setPolicy(P, { retentionDays: 0, maxBytes: 0 });
    await seedSettings(P, { language: 'en' });
    await seedRows(P, makeRows(N, { now: Date.now() }), { real: 12 });
    const page = await h.context.newPage();
    const load = async () => {
      await page.goto(h.url());
      await page.waitForSelector('#ui:not([disabled])', { state: 'attached', timeout: 30_000 });
      return page.evaluate(() => performance.getEntriesByName('obturo:strip-painted')[0]?.startTime ?? null);
    };
    await load(); // cold
    const strips = [];
    for (let i = 0; i < 9; i++) strips.push(await load());
    R.historyView = { stripPaintedMs: round(median(strips)), stripPaintedMaxMs: round(Math.max(...strips)) };
    budget('Strip painted, 5 000 shots in the history (median of 9 loads)', '< 100 ms', `${R.historyView.stripPaintedMs} ms (max ${R.historyView.stripPaintedMaxMs})`, R.historyView.stripPaintedMs < 100);
    if (!(await page.$('#historyBtn'))) return; // a build without the history view: nothing more to measure

    // first paint of the sheet, 9 openings
    await sleep(1500); // the retention pass and the warm-up of the module are done
    const opens = [];
    for (let i = 0; i < 9; i++) {
      await page.evaluate(() => performance.clearMarks());
      await page.click('#historyBtn');
      await page.waitForFunction(() => performance.getEntriesByName('obturo:history-painted').length > 0 && document.querySelectorAll('#hvGrid .hv-card').length > 0);
      opens.push(await page.evaluate(() => performance.getEntriesByName('obturo:history-painted')[0].startTime - performance.getEntriesByName('obturo:history-open')[0].startTime));
      await page.click('#hvClose');
      await page.waitForFunction(() => !document.querySelector('#history[open]'));
    }
    R.historyView.openMs = { median: round(median(opens)), max: round(Math.max(...opens)), first: round(opens[0]) };
    budget('History sheet: click -> first cards painted (5 000 shots)', '< 150 ms', `${R.historyView.openMs.median} ms (max ${R.historyView.openMs.max}, first ${R.historyView.openMs.first})`, R.historyView.openMs.max < 150);

    await page.click('#historyBtn');
    await page.waitForSelector('#hvGrid .hv-card');
    await sleep(400);
    const frames = async (scenario) => {
      await page.evaluate(() => {
        window.__fr = { t: [], on: true, cards: 0 };
        const loop = (ts) => {
          if (!window.__fr.on) return;
          window.__fr.t.push(ts);
          window.__fr.cards = Math.max(window.__fr.cards, document.querySelectorAll('#hvGrid .hv-card').length);
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      await scenario();
      const out = await page.evaluate(() => { window.__fr.on = false; return window.__fr; });
      const d = out.t.slice(1).map((x, i) => x - out.t[i]);
      return { frames: out.t.length, p95Ms: round(percentile(d, 0.95)), maxMs: round(Math.max(...d)), over20ms: d.filter((x) => x > 20).length, maxCards: out.cards };
    };
    const box = await page.locator('#hvScroll').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const wheel = await frames(async () => {
      for (let i = 0; i < 240; i++) { await page.mouse.wheel(0, i < 200 ? 140 : -140); await sleep(8); }
    });
    const fling = await frames(async () => { // 9 000 px in 150 frames, then back: faster than a hand on a wheel
      await page.evaluate(() => new Promise((done) => {
        const s = document.getElementById('hvScroll');
        let n = 0;
        const step = () => { s.scrollTop += n < 150 ? 60 : -60; if (++n < 300) requestAnimationFrame(step); else done(undefined); };
        requestAnimationFrame(step);
      }));
    });
    R.historyView.scroll = { wheel, fling };
    const worst = Math.max(wheel.over20ms / wheel.frames, fling.over20ms / fling.frames);
    budget('History sheet: scrolling (wheel, fling)', '< 2 % of frames > 20 ms', `wheel ${wheel.over20ms}/${wheel.frames}, p95 ${wheel.p95Ms} ms; fling ${fling.over20ms}/${fling.frames}, p95 ${fling.p95Ms} ms`, worst < 0.02);
    budget('History sheet: cards in the DOM while scrolling', '<= 200', String(Math.max(wheel.maxCards, fling.maxCards)), Math.max(wheel.maxCards, fling.maxCards) <= 200);

    // object URLs: only the cards in view hold one
    const live = await page.evaluate(() => ({ urls: window.__c.urlLive.size, cards: document.querySelectorAll('#hvGrid .hv-card').length, strip: document.querySelectorAll('#strip img[src]').length }));
    R.historyView.urls = live;
    budget('History sheet: live object URLs after the scroll', '<= cards + strip + 2', `${live.urls} (${live.cards} cards, ${live.strip} in the strip)`, live.urls <= live.cards + live.strip + 2);

    // a search: from the keystroke to the results painted (it waits 150 ms for the end of the typing)
    await page.evaluate(() => { document.getElementById('hvScroll').scrollTop = 0; });
    const searches = [];
    for (const text of ['facture', 'caf\u00e9 \u00e9t\u00e9', 'billing report', 'zzzz', '']) {
      searches.push([text, await page.evaluate((text) => new Promise((done) => {
        const count = document.getElementById('hvCount');
        const before = count.textContent;
        const input = /** @type {HTMLInputElement} */ (document.getElementById('hvQuery'));
        const start = performance.now();
        const watch = new MutationObserver(() => {
          if (count.textContent === before) return;
          watch.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - start)));
        });
        watch.observe(count, { childList: true, characterData: true, subtree: true });
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => { watch.disconnect(); done(null); }, 3000);
      }), text)]);
      await sleep(200);
    }
    R.historyView.searchMs = Object.fromEntries(searches.map(([k, v]) => [k || '(cleared)', v === null ? null : round(v)]));
    const worstSearch = Math.max(...searches.map(([, v]) => v ?? 9999));
    budget('History sheet: search, keystroke -> results painted (incl. the 150 ms wait)', '< 300 ms', `${Object.entries(R.historyView.searchMs).map(([k, v]) => `${k} ${v}`).join(', ')} ms`, worstSearch < 300);

    // select all results
    await page.locator('#hvGrid .hv-card').first().hover();
    await page.locator('#hvGrid .hv-card').first().locator('input[type=checkbox]').click();
    const selectAll = await page.evaluate(() => new Promise((done) => {
      const text = document.getElementById('hvSelCount');
      const start = performance.now();
      new MutationObserver((_, watch) => { if (/5.?000/.test(text.textContent)) { watch.disconnect(); requestAnimationFrame(() => done(performance.now() - start)); } }).observe(text, { childList: true, characterData: true, subtree: true });
      document.getElementById('hvSelectAll').click();
    }));
    R.historyView.selectAllMs = round(selectAll);
    budget('History sheet: select all 5 000 results', '< 100 ms', `${R.historyView.selectAllMs} ms`, selectAll < 100);
    R.errors = [...(R.errors ?? []), ...h.errors];
  } finally {
    await h.close();
  }
}

// ---------------------------------------------------------------- table

function printTable() {
  const cols = ['Budget', 'Target', 'Measured', 'Verdict'];
  const lines = rows.map((r) => [r.name, r.target, r.measured, r.ok ? 'OK' : 'OVER BUDGET']);
  const widths = cols.map((c, i) => Math.max(c.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  console.log(fmt(cols));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const l of lines) console.log(fmt(l));
  console.log(`\n${rows.filter((r) => r.ok).length} budgets met out of ${rows.length}. Measured on ${process.platform}, Node ${process.version}, Playwright's Chromium.`);
  console.log('Memory peak of the full-page capture: not measured here (see docs/ARCHITECTURE.md).');
  if (R.errors?.length) console.log(`Console errors during the measurement: ${JSON.stringify(R.errors)}`);
  if (R.csp?.length) console.log(`CSP violations: ${JSON.stringify(R.csp)}`);
}

// The popup of the icon (popup.html): from the navigation to the first paint of the complete list (rows, icons, shortcuts), median of
// 9 loads after one cold one (the first of a new browser, which also pays the first frame of the browser itself).
async function benchPopup() {
  const h = await launchExtension({ lang: 'en-US' });
  try {
    const page = await h.context.newPage();
    const load = async (first) => {
      if (!first) await page.reload(); else await page.goto(h.url('popup.html'));
      await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0 && !document.documentElement.classList.contains('pending'));
      return page.evaluate(() => ({ painted: performance.getEntriesByName('first-contentful-paint')[0].startTime, ready: performance.getEntriesByName('obturo:popup-painted')[0].startTime, rows: document.querySelectorAll('[role=menuitem]').length }));
    };
    const cold = await load(true);
    const runs = [];
    for (let i = 0; i < 9; i++) runs.push(await load(false));
    R.popup = { coldPaintedMs: round(cold.painted), coldReadyMs: round(cold.ready), paintedMs: round(median(runs.map((x) => x.painted))), paintedMaxMs: round(Math.max(...runs.map((x) => x.painted))), rows: cold.rows };
    budget('Popup painted, opening -> complete list (median of 9 loads)', '< 100 ms', `${R.popup.paintedMs} ms (max ${R.popup.paintedMaxMs}); cold: rows in at ${R.popup.coldReadyMs} ms, first frame ${R.popup.coldPaintedMs} ms`, R.popup.paintedMs < 100 && R.popup.rows === 8);
  } finally {
    await h.close();
  }
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length); // --only=history: just the history section
if (!only) {
  await benchLibrary();
  await benchCaptures();
}
if (!only || only === 'popup') await benchPopup();
if (!only || only === 'history') await benchHistory();
if (!only || only === 'histui') await benchHistoryView(); // history view
printTable();
if (process.argv.includes('--json')) console.log(`\n${JSON.stringify(R, null, 1)}`);
