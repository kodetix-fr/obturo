// Helpers to drive the library and the editor: IndexedDB seeds, mouse, export, PNG decoding.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fitView } from '../../../view.js';

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Retries `fn` until it returns a truthy value; fails with `what` after `timeout` ms. */
export async function poll(fn, { timeout = 10_000, interval = 40, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(interval);
  }
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- database

/** Draws a recognizable image in the page and adds it as the service worker would. */
export function seed(page, { w, h, title, url, stripes = false }) {
  return page.evaluate(async ({ w, h, title, url, stripes }) => {
    const { addShot } = await import(`${location.origin}/db.js`);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 400) { // repeated colored bands, so the image is not trivial
      g.fillStyle = `hsl(${(y / 7) % 360} 55% 88%)`;
      g.fillRect(0, y, w, 120);
    }
    if (stripes) { // tight stripes (pixelation shows), a green square and a title
      for (let x = 200; x < 600; x += 4) {
        g.fillStyle = '#d00';
        g.fillRect(x, 200, 2, 200);
        g.fillStyle = '#00d';
        g.fillRect(x + 2, 200, 2, 200);
      }
      g.fillStyle = '#0a0';
      g.fillRect(1000, 300, 200, 200);
      g.fillStyle = '#222';
      g.font = 'bold 64px sans-serif';
      g.fillText('Obturo', 40, 90);
    }
    const original = await new Promise((done) => c.toBlob(done, 'image/png'));
    c.width = c.height = 1;
    await addShot({ original, url, title, w, h });
  }, { w, h, title, url, stripes });
}

export const spec = (title, w = 1600, h = 900, stripes = true) => ({ w, h, title, url: `https://example.test/${encodeURIComponent(title)}`, stripes });

/** The shots in the database (metadata), from the oldest to the most recent. */
export const dbDump = (page) => page.evaluate(async () => {
  const { queryShots } = await import(`${location.origin}/db.js`);
  return (await queryShots({ limit: 1000 })).items.toReversed().map((s) => ({ id: s.id, w: s.w, h: s.h, title: s.title, active: s.active, hasThumb: !!s.thumb, versions: s.versions }));
});

/**
 * Waits (autosave fires 500 ms after the last change) until shot `id` in the database satisfies `check`, and returns
 * it. On timeout, the error shows the last state read.
 */
export async function shotWhere(page, id, check, what) {
  let last;
  try {
    return await poll(async () => {
      last = (await dbDump(page)).find((s) => s.id === id);
      return last && check(last) ? last : null;
    }, { what });
  } catch (e) {
    throw new Error(`${e.message}; last state: ${JSON.stringify(last)?.slice(0, 800)}`, { cause: e });
  }
}

/** SHA-256 fingerprint of the original of a shot, read from the database. */
export const originalHash = (page, id) => page.evaluate(async (id) => {
  const { getOriginal } = await import(`${location.origin}/db.js`);
  const bytes = await (await getOriginal(id)).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, id);

/**
 * Stores user settings (language, theme...) as the settings dialog would. Call it from a page of the extension.
 * @param {import('playwright-core').Page} page
 * @param {Record<string, unknown>} patch
 */
export const seedSettings = (page, patch) => page.evaluate(async (patch) => {
  const { setSettings } = await import(`${location.origin}/settings.js`);
  await setSettings(patch);
}, patch);

/**
 * Starts from an empty database containing `specs`, then opens the library. We write from a page without an editor
 * (manifest.json) so that the editor of the previous page does not react. The language is forced to English unless
 * `settings` says otherwise: the tests do not depend on the language of the machine.
 */
export async function resetLibrary(page, h, specs, extra, settings = { language: 'en', theme: 'auto' }) {
  await page.goto(h.url('manifest.json'));
  await page.evaluate(async () => {
    const { queryShots, deleteShots } = await import(`${location.origin}/db.js`);
    await deleteShots((await queryShots({ limit: 1000 })).items.map((s) => s.id));
  });
  await seedSettings(page, settings);
  for (const s of specs) await seed(page, s);
  if (extra) await extra();
  await page.goto(h.url());
}

// ---------------------------------------------------------------- waits on the UI

/** The editor is loaded and enabled. */
export const ready = (page) => page.waitForSelector('#ui:not([disabled])', { state: 'attached', timeout: 20_000 });

/** The output area ("Sortie : w x h px") shows these dimensions (so the expected shot is open). */
export const waitOut = (page, w, h) => page.waitForFunction(
  (text) => document.getElementById('out').textContent === text,
  `Output: ${w} × ${h} px`,
  { timeout: 20_000 },
);

export const outText = (page) => page.locator('#out').innerText();
export const titled = (page, title) => page.locator(`#strip button.open[title^="${title}"]`);
export const tool = (page, name) => page.click(`[data-tool="${name}"]`);

// ---------------------------------------------------------------- mouse

/** Mapping between document coordinates (image px) and screen coordinates, for the fitted view. */
export async function mapper(page, docW, docH) {
  const [cw, ch] = await page.evaluate(() => {
    const stage = document.getElementById('stage');
    return [stage.clientWidth, stage.clientHeight];
  });
  const box = await page.locator('#stage').boundingBox();
  const v = fitView(cw, ch, docW, docH);
  return { v, pt: (x, y) => [box.x + v.tx + x * v.z, box.y + v.ty + y * v.z] };
}

/** Mouse drag between two document points. */
export async function drag(page, m, x1, y1, x2, y2, steps = 10) {
  const [sx, sy] = m.pt(x1, y1);
  const [ex, ey] = m.pt(x2, y2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(ex, ey, { steps });
  await page.mouse.up();
}

// ---------------------------------------------------------------- PNG export

/** Clicks the download button and returns the file. */
export async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.click('#download')]);
  return { buf: readFileSync(await dl.path()), name: dl.suggestedFilename() };
}

/** Width and height read from the IHDR header of a PNG (without decoding it). */
export const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

/** Decodes a PNG in the browser (no dependency on the Node side): { width, height, data } with data = RGBA. */
export async function decodePng(page, buf) {
  const out = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { width: bmp.width, height: bmp.height, data: btoa(bin) };
  }, buf.toString('base64'));
  return { width: out.width, height: out.height, data: Buffer.from(out.data, 'base64') };
}

/** Pixel [r, g, b, a] of a decoded image. */
export const px = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

/** Number of pixels that differ between two images and their bounding box, to understand a failure. */
export function diffInfo(a, b) {
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue;
      n++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return `${n} px, box x ${x0}..${x1} y ${y0}..${y1}`;
}
