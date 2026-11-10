// Helpers for the tests and the benchmark of the history view: a believable history of made-up pages (rows built in Node, no
// randomness that changes from run to run), written straight into the stores with REAL thumbnails (a pool of drawn pages, so
// that a screenshot of the view looks like the product), and shortcuts to drive the sheet.
// The functions given to page.evaluate run in the browser, on an extension page: the same origin as the library.
import { DAY } from './history.mjs';
import { poll } from './wait.mjs';

export { DAY };

// Made-up sites and titles, in English and French (accents on purpose: the search must ignore them). Nothing is a real site.
const SITES = [
  'docs', 'mail', 'wiki', 'tickets', 'billing', 'reports', 'crm', 'status', 'shop', 'planning', 'support', 'design', 'files', 'admin',
  'analytics', 'calendar', 'hr', 'learn', 'deploy', 'metrics', 'orders', 'catalog', 'review', 'notes', 'forms', 'maps', 'inbox', 'boards',
  'wallet', 'travel', 'recipes', 'courses', 'photos', 'music', 'health', 'weather', 'news', 'jobs', 'bank', 'events',
];
const TOPICS = [
  'Quarterly report', 'Invoice 2026', 'Rapport trimestriel', 'Facture d\u00e9cembre', 'Dashboard overview', 'Tableau de bord', 'Ticket 4821',
  'Maquette \u00e9cran d\u2019accueil', 'Release notes', 'Notes de r\u00e9union', 'Planning \u00e9quipe', 'Team calendar', 'Order confirmation',
  'Confirmation de commande', 'Bug report', 'Compte rendu', 'Design review', 'R\u00e9sum\u00e9 annuel', 'Sprint board', 'Budget pr\u00e9visionnel',
];

const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

/**
 * `n` rows for seedRows, from the oldest to the most recent, spread over `spanDays` (dense near now: the way a history grows).
 * About 2% pinned, 4% edited. `thumb`: index in the pool of drawn thumbnails, -1 for none (a thumbnail left to the view).
 * @param {number} n
 * @param {{ now?: number, spanDays?: number, seed?: number, thumbs?: boolean }} [o]
 */
export function makeRows(n, { now = Date.now(), spanDays = 420, seed = 7, thumbs = true } = {}) {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const age = (1 - (i + 1) / (n + 1)) ** 2 * spanDays * DAY; // 0 for the last one
    const topic = TOPICS[Math.floor(rand() * TOPICS.length)];
    const site = SITES[Math.floor(rand() ** 1.6 * SITES.length)];
    return {
      title: `${topic} - ${site}`,
      url: `https://${site}.example.test/${encodeURIComponent(topic.toLowerCase().replaceAll(' ', '-'))}/${i}?ref=${i % 97}`,
      createdAt: Math.round(now - age - rand() * 3_600_000),
      bytes: 90_000 + Math.floor(rand() * 900_000),
      pinned: rand() < 0.02,
      edited: rand() < 0.04,
      thumb: thumbs ? Math.floor(rand() * 24) : -1,
    };
  });
}

/**
 * Writes the rows into the stores in one transaction, without the retention (db.js would need minutes for thousands). The
 * thumbnails are drawn once (24 pages of different looks) and shared. Ids continue after the highest existing one; the
 * catalog is rewritten through the functions of catalog.js. Returns the ids, in the order of the rows.
 * The originals are a 1x1 PNG with padding (thousands of real ones would fill the disk) while `bytes` says what the row claims,
 * except for the `real` most recent rows, whose original is a drawn PNG that the editor can open.
 */
export function seedRows(page, rows, { real = 24 } = {}) {
  return page.evaluate(async ({ rows, real }) => {
    const db = await import(`${location.origin}/db.js`);
    const { entryOf, toBuckets, parseBucket } = await import(`${location.origin}/catalog.js`);
    await db.countShots(); // opens the database, and upgrades it if needed

    // 24 drawn pages: a header, a side bar, lines of text, a block and a button, in a different color each
    const pool = [];
    for (let k = 0; k < 24; k++) {
      const c = new OffscreenCanvas(240, 150);
      const g = c.getContext('2d');
      const hue = (k * 47) % 360;
      g.fillStyle = `hsl(${hue} 30% 97%)`;
      g.fillRect(0, 0, 240, 150);
      g.fillStyle = `hsl(${hue} 60% 42%)`;
      g.fillRect(0, 0, 240, 22);
      g.fillStyle = `hsl(${hue} 25% 90%)`;
      g.fillRect(0, 22, 46, 128);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillRect(8, 7, 56, 8);
      for (let y = 0; y < 7; y++) {
        g.fillStyle = `hsl(${hue} 12% ${62 + ((y + k) % 3) * 9}%)`;
        g.fillRect(58, 34 + y * 14, 40 + ((y * 37 + k * 11) % 120), 6);
      }
      g.fillStyle = `hsl(${(hue + 160) % 360} 55% 60%)`;
      g.fillRect(150 + (k % 3) * 8, 70, 74, 52);
      g.fillStyle = `hsl(${hue} 65% 45%)`;
      g.fillRect(58, 128, 44, 14);
      pool.push(await c.convertToBlob({ type: 'image/webp', quality: 0.8 }));
    }

    // the most recent rows get an original the editor can open (made before the transaction: it ends when nothing is pending)
    const pngs = new Map();
    for (let n = Math.max(0, rows.length - real); n < rows.length; n++) {
      const c = new OffscreenCanvas(1280, 720);
      const g = c.getContext('2d');
      g.scale(1280 / 240, 720 / 150);
      g.drawImage(await createImageBitmap(pool[Math.max(0, rows[n].thumb) % pool.length]), 0, 0);
      pngs.set(n, await c.convertToBlob({ type: 'image/png' }));
    }

    const conn = await new Promise((ok, ko) => {
      const r = indexedDB.open('obturo');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const wait = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const tx = conn.transaction(['shots', 'originals', 'catalog'], 'readwrite');
    const last = await wait(tx.objectStore('shots').openKeyCursor(null, 'prev'));
    let id = last?.key ?? 0;
    const existing = (await wait(tx.objectStore('catalog').getAll())).flatMap(parseBucket);
    // a valid 1x1 PNG followed by padding: small, and the editor can open it (the decoder stops at the end of the image)
    const tiny = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
    const pad = new Uint8Array(2048).fill(9);
    const ids = [];
    const added = [];
    for (const [n, r] of rows.entries()) {
      const original = pngs.get(n) ?? new Blob([tiny, pad], { type: 'image/png' });
      const bytes = pngs.has(n) ? original.size : r.bytes;
      const row = {
        id: ++id, url: r.url, title: r.title, w: r.w ?? 1280, h: r.h ?? 720, createdAt: r.createdAt,
        versions: r.edited ? [{ name: 'V1', crop: null, scale: 1, objects: [] }] : [], active: r.edited ? 0 : -1,
        host: new URL(r.url).host, bytes, pinned: !!r.pinned,
      };
      if (r.thumb >= 0) row.thumb = pool[r.thumb % pool.length];
      tx.objectStore('shots').put(row);
      tx.objectStore('originals').put(original, row.id);
      added.push(entryOf(row));
      ids.push(row.id);
    }
    const catalog = tx.objectStore('catalog');
    catalog.clear();
    for (const [k, text] of toBuckets([...existing, ...added])) catalog.put(text, k);
    await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => ko(tx.error); });
    conn.close();
    return ids;
  }, { rows, real });
}

// --- Driving the sheet ---

/** Opens the history from the app bar and waits for the first cards. */
export async function openHistory(page, { button = '#historyBtn' } = {}) {
  await page.click(button);
  await page.waitForSelector('#history[open]');
  await page.waitForFunction(() => document.querySelectorAll('#hvGrid .hv-card').length > 0 || !document.getElementById('hvState').hidden, null, { timeout: 15_000 });
}

/** What the sheet shows: cards in the DOM, their ids in order, the texts of the count and of the selection. */
export const view = (page) => page.evaluate(() => ({
  cards: document.querySelectorAll('#hvGrid .hv-card').length,
  ids: [...document.querySelectorAll('#hvGrid .hv-card')].map((li) => Number(/** @type {HTMLElement} */ (li).dataset.id)),
  count: document.getElementById('hvCount').textContent,
  selected: document.querySelectorAll('#hvGrid .hv-card.is-selected').length,
  selection: document.getElementById('hvSelCount').textContent,
  bulkHidden: document.getElementById('hvBulk').hidden,
  state: document.getElementById('hvState').hidden ? null : document.getElementById('hvStateTitle').textContent,
  scrollTop: document.getElementById('hvScroll').scrollTop,
  scrollHeight: document.getElementById('hvScroll').scrollHeight,
  cols: getComputedStyle(document.getElementById('hvGrid')).gridTemplateColumns.split(' ').length,
}));

/** Waits for a condition on view(), with the last state in the error. */
export async function viewWhere(page, check, what, timeout = 20_000) {
  let last;
  try {
    return await poll(async () => {
      last = await view(page);
      return check(last) ? last : null;
    }, { what, timeout });
  } catch (e) {
    throw new Error(`${e.message}; last view: ${JSON.stringify({ ...last, ids: last?.ids.slice(0, 5) })}`, { cause: e });
  }
}

/** The title of the card at position `i` among those in the DOM. */
export const cardAt = (page, id) => page.locator(`#hvGrid .hv-card[data-id="${id}"]`);
