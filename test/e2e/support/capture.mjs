// Helpers to drive the captures of the real extension: local test site, badge log, reading the last saved shot,
// clipboard. The functions that take `sw` run in the service worker of the test copy (see SW_HOOK in browser.mjs).
import { once } from 'node:events';
import { createServer } from 'node:http';
import { poll, sleep, until } from './wait.mjs';

export { sleep, until } from './wait.mjs';

export const GREEN = '#26a269';
export const ORANGE = '#e5a50a';
export const RED = '#c01c28';
export const GREY = '#777';

// Test page of `height` CSS px: a graduated ruler (the color of a row gives its vertical position), a sticky header,
// a fixed banner at the top right, a fixed footer at the bottom, and a block that only changes color once seen (lazy
// loading).
const pageHtml = (height) => `<!doctype html><html><head><meta charset=utf-8><title>Test page</title><style>
body { margin:0; position:relative; font:20px sans-serif; height:${height}px }
#ruler { position:absolute; left:0; top:0; width:8px; height:${height}px; image-rendering:pixelated }
header { position:sticky; top:0; height:60px; margin-left:20px; background:#1a5fb4; color:#fff; z-index:5 }
#banner { position:fixed; top:0; right:0; width:200px; height:40px; background:#c01c28; z-index:9 }
#footer { position:fixed; bottom:0; left:20px; right:0; height:50px; background:#26a269; z-index:9 }
#lazy { position:absolute; top:4900px; left:100px; width:300px; height:300px; background:#888 }
#lazy.seen { background:#ff7800 }
.band { position:absolute; left:50px; color:#333 }
</style></head><body>
<canvas id=ruler width=8 height=${height}></canvas>
<header>sticky header</header><div id=banner></div><div id=footer></div><div id=lazy></div>
<script>
const H = ${height}, c = document.getElementById('ruler').getContext('2d'), img = c.createImageData(8, H);
for (let y = 0; y < H; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; img.data[i] = (y >> 8) & 255; img.data[i+1] = y & 255; img.data[i+2] = 128; img.data[i+3] = 255; }
c.putImageData(img, 0, 0);
for (let y = 500; y < H; y += 500) { const d = document.createElement('div'); d.className = 'band'; d.style.top = y + 'px'; d.textContent = 'Y=' + y; document.body.append(d); }
if (H < 5300) document.getElementById('lazy').remove();
else new IntersectionObserver((es) => es.forEach(e => e.isIntersecting && e.target.classList.add('seen'))).observe(document.getElementById('lazy'));
window.addEventListener('pointerup', () => { window.__up = Date.now(); }, true);
</script></body></html>`;

/** Local server of test pages: GET /p800.html, /p12000.html... (the height is in the name). */
export async function startSite() {
  const server = createServer((req, res) => {
    const height = Number(/^\/p(\d+)\.html$/.exec((req.url ?? '').split('?')[0])?.[1]); // a query is ignored: tests use it for long addresses
    if (!height) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pageHtml(height));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  return { origin, close: () => new Promise((done) => server.close(done)) };
}

/** Chrome limits captureVisibleTab to 2 calls per second: to respect between two captures. */
export const quota = () => sleep(700);

// ---------------------------------------------------------------- service worker

export const resetBadges = (sw) => sw.evaluate(() => { __t.badge.length = 0; });
export const badges = (sw) => sw.evaluate(() => __t.badge.slice());

/** The test tab, as the service worker sees it. */
export const tabOf = (sw) => sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
  return { id: t.id, windowId: t.windowId, url: t.url, title: t.title };
});

export const maxId = (sw) => sw.evaluate(async () => (await __t.db.queryShots({ limit: 1000 })).items.reduce((m, s) => Math.max(m, s.id), 0));

/** Metadata of the last saved shot. */
export const lastShot = (sw) => sw.evaluate(async () => {
  const all = (await __t.db.queryShots({ limit: 1000 })).items.toReversed(); // from the oldest to the most recent
  const s = all.at(-1);
  return { n: all.length, id: s.id, w: s.w, h: s.h, url: s.url, title: s.title };
});

/** Pixel columns (flat RGBA) of the original of the last shot, and a control pixel. */
export const lastShotColumns = (sw, xs, probe) => sw.evaluate(async ({ xs, probe }) => {
  const blob = await __t.db.getOriginal((await __t.db.queryShots({ limit: 1 })).items[0].id); // the most recent
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const columns = xs.map((x) => Array.from(g.getImageData(x, 0, 1, bitmap.height).data));
  const pixel = Array.from(g.getImageData(probe.x, probe.y, 1, 1).data);
  bitmap.close();
  return { columns, pixel };
}, { xs, probe });

/** Waits until the badge `text` has been set (a result badge: the capture is over, whatever its outcome). */
export const waitBadge = (sw, text) => poll(async () => (await badges(sw)).some((b) => b[1] === 'text' && b[2] === text), { what: `the ${text} badge`, timeout: 8000, interval: 50 });

/** [text, color] of the last non-empty badge other than the "n/m" progress, or null. */
export async function finalBadge(sw) {
  const list = await badges(sw);
  const texts = list.map((e, i) => [e, i]).filter(([e]) => e[1] === 'text' && e[2] && !e[2].includes('/'));
  if (!texts.length) return null;
  const i = texts.at(-1)[1];
  const color = list.slice(0, i).reverse().find((e) => e[1] === 'color')?.[2] ?? null;
  return [list[i][2], color];
}

/** Delay between `since` and the appearance of the "OK" badge. */
export function badgeDelay(list, since, text = 'OK') {
  const e = list.find((x) => x[1] === 'text' && x[2] === text);
  return e ? e[0] - since : null;
}

// ---------------------------------------------------------------- page

/** Size of the image the clipboard holds, or the text of the error. */
export const clipSize = (page) => page.evaluate(async () => {
  try {
    const items = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await items[0].getType('image/png'));
    return [bitmap.width, bitmap.height];
  } catch (e) {
    return String(e);
  }
});

/**
 * Checks of a full-page capture of the test page (CSS height `cssTotal`, display scale `dpr`):
 * accuracy of the graduated ruler, header and banner exactly once at the top, footer exactly once at the bottom,
 * lazy content.
 */
export async function verifyFullPage(sw, shot, dpr, cssTotal) {
  const { w: W, h: H } = shot;
  // k < 1: the image was shrunk to fit the canvas ceilings
  const k = H < cssTotal * dpr - 2 ? Math.min(1, H / (cssTotal * dpr)) : 1;
  const s = dpr * k;
  const xs = [2, Math.floor(300 * s), Math.floor(W - 50 * s)];
  const { columns: [ruler, header, banner], pixel } = await lastShotColumns(sw, xs, { x: Math.floor(250 * s), y: Math.floor(5050 * s) });
  const at = (col, i) => col.slice(i * 4, i * 4 + 3);

  let badRows = 0;
  const tolerance = Number.isInteger(dpr) ? 0 : 1; // at a fractional scale, the source row is chosen as the nearest one
  for (let i = 0; i < H; i++) {
    const [r, g] = at(ruler, i);
    if (k === 1) {
      const expected = Math.min(Math.floor((i + 0.5) / dpr), cssTotal - 1);
      if (Math.abs(((r << 8) | g) - expected) > tolerance) badRows++;
    } else if (Math.abs(r - (Math.floor(i / (dpr * k)) >> 8)) > 1) {
      badRows++;
    }
  }
  const runs = (col, color, tol = 40) => {
    let count = 0, inRun = false, first = null, last = null;
    for (let i = 0; i < H; i++) {
      const hit = at(col, i).every((v, c) => Math.abs(v - color[c]) <= tol);
      if (hit && !inRun) { count++; first ??= i; }
      if (hit) last = i;
      inRun = hit;
    }
    return { count, first, last };
  };
  return {
    W, H, k, badRows,
    header: runs(header, [26, 95, 180]),
    footer: runs(header, [38, 162, 105]),
    banner: runs(banner, [192, 28, 40]),
    lazyOrange: cssTotal > 5300 ? pixel.slice(0, 3).every((v, c) => Math.abs(v - [255, 120, 0][c]) <= 40) : null,
  };
}

// ---------------------------------------------------------------- library tab ("capture and edit")

/** The library pages open in the browser, whatever their query or hash. `h` comes from launchExtension. */
export const libraryPages = (h) => h.context.pages().filter((p) => p.url().split(/[?#]/)[0] === h.url('library.html'));

export async function closeLibraries(h) {
  for (const p of libraryPages(h)) await p.close();
}

/** Collects in window.__msgs what a page of the extension receives on BroadcastChannel('obturo'). */
export const listenChannel = (page) => page.evaluate(() => {
  window.__msgs = [];
  const channel = new BroadcastChannel('obturo');
  channel.onmessage = (e) => window.__msgs.push(e.data);
});
export const received = (page) => page.evaluate(() => window.__msgs ?? []);

/** Is the tab that holds the library the active one of its window? (what the service worker sees, no extra permission) */
export const libraryActive = (sw) => sw.evaluate(async () => {
  const lib = chrome.runtime.getURL('library.html');
  const c = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find((x) => x.documentUrl?.split(/[?#]/)[0] === lib);
  return c ? (await chrome.tabs.get(c.tabId)).active : null;
});

// ---------------------------------------------------------------- icon menu

/**
 * Records what the service worker asks of chrome.contextMenus (and the error Chrome answers, if any). To call before
 * triggering a rebuild of the menu; it wraps the two methods, the code under test is untouched.
 */
export const recordMenu = (sw) => sw.evaluate(() => {
  if (globalThis.__menu) return; // the hook of the test worker records from its start (browser.mjs)
  /** @type {any[]} */
  const log = (globalThis.__menu = []);
  const api = /** @type {any} */ (chrome.contextMenus);
  const { create, removeAll } = api;
  // [kind, props, error, time of the answer]
  api.create = (props, cb) => create.call(api, props, () => { log.push(['create', props, chrome.runtime.lastError?.message ?? null, performance.now()]); cb?.(); });
  api.removeAll = (cb) => removeAll.call(api, () => { log.push(['removeAll', null, null, performance.now()]); cb?.(); });
});

/** The menu as the last rebuild left it: its entries, the errors Chrome answered since the start, the rebuilds so far. */
export const menuState = (sw) => sw.evaluate(() => {
  const log = globalThis.__menu;
  const last = log.map((e) => e[0]).lastIndexOf('removeAll');
  return {
    items: log.slice(last + 1).filter((e) => e[0] === 'create').map((e) => e[1]),
    errors: log.filter((e) => e[2]).map((e) => e[2]),
    rebuilds: log.filter((e) => e[0] === 'removeAll').length,
    /** From the answer to removeAll to the answer to the last create, in ms. */
    lastRebuildMs: log.length > 1 && last >= 0 ? log.at(-1)[3] - log[last][3] : null,
  };
});

/** Announces a change of settings the way settings.js does, to a service worker that is awake. */
export const announceSettings = (sw) => sw.evaluate(() => {
  const channel = new BroadcastChannel('obturo');
  channel.postMessage({ type: 'settings-changed' });
  channel.close();
});

/** Waits for a rebuild of the menu after `rebuilds` earlier ones, complete (`count` entries). */
export const menuRebuilt = (sw, rebuilds, count = 12) => until(async () => {
  const s = await menuState(sw);
  return s.rebuilds > rebuilds && s.items.length === count ? s : null;
}, 'menu rebuilt');

// ---------------------------------------------------------------- service worker life

/**
 * Stops the service worker the way the browser does when it has been idle (CDP, no extension API); the next event starts a new
 * one, which loads sw.js again from the top. `page`: any page of the browser context.
 */
export async function stopServiceWorker(h, page) {
  const cdp = await h.context.newCDPSession(page);
  try {
    let versionId = null, status = null;
    cdp.on('ServiceWorker.workerVersionUpdated', (e) => {
      for (const v of e.versions) if (v.scriptURL.endsWith('/sw.js')) { versionId = v.versionId; status = v.runningStatus; }
    });
    await cdp.send('ServiceWorker.enable');
    await until(() => versionId, 'service worker version', 20_000);
    // The browser ignores the request while the worker is busy (it is still starting, or building its menu): asked again until it is down.
    let asked = 0;
    await until(async () => {
      if (status === 'stopped') return true;
      if (Date.now() - asked > 1000) {
        asked = Date.now();
        await cdp.send('ServiceWorker.stopWorker', { versionId }).catch(() => {});
      }
      return false;
    }, 'service worker stopped', 40_000);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// ---------------------------------------------------------------- waiting for a state, never for a delay

/**
 * A full-page capture is under way: its blue "n/m" badge is up, so the tab was captured at least once and the next tile is not yet
 * taken. What a test does "during the capture" (Escape, a second trigger, a zoom...) waits for this, not for a number of
 * milliseconds that a loaded machine stretches or shrinks.
 */
export const captureRunning = (sw, timeout = 30_000) => until(
  async () => (await badges(sw)).some((b) => b[1] === 'text' && /^\d+\/\d+$/.test(b[2])),
  'a full-page capture under way',
  timeout,
);

/** The test tab is the active one of its window, as the service worker sees it (what the full page checks before each tile). */
export const tabActive = (sw, tab, timeout = 15_000) => until(
  () => sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, tab.id),
  'the test tab active in its window',
  timeout,
);

/** The whole record of chrome.contextMenus calls, cut into passes: one per removeAll, with the entries created after it. */
export const menuPasses = (sw) => sw.evaluate(() => {
  const passes = [];
  for (const [kind, props, error] of globalThis.__menu) {
    if (kind === 'removeAll') passes.push({ creates: [], errors: [] });
    else if (passes.length) { passes.at(-1).creates.push(props); if (error) passes.at(-1).errors.push(error); }
  }
  return passes;
});
