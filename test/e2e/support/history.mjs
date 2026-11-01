// Helpers for the history tests and the history benchmark: raw access to the databases (a seed in the layout of version 2,
// bulk seeds of thousands of shots, a dump of the three stores) and a consistency check of what db.js keeps.
// The functions given to page.evaluate run in the browser, on an extension page: the same origin as the library.
import assert from 'node:assert/strict';
import { bucketOf, entryOf } from '../../../catalog.js';

export const DAY = 24 * 60 * 60 * 1000;

/** An extension page that loads nothing of the extension (a manifest): a place to run code on the extension's origin. */
export async function blankPage(h) {
  const page = await h.context.newPage();
  await page.goto(h.url('manifest.json'));
  return page;
}

/** Deletes the history database. The connections of db.js (here, in the service worker...) close on their own. */
export const wipe = (page) => page.evaluate(() => new Promise((ok, ko) => {
  const r = indexedDB.deleteDatabase('obturo');
  r.onsuccess = () => ok(undefined);
  r.onerror = () => ko(r.error);
}));

/** Sets the retention settings (and whatever else is given). 0 and 0 turn the retention off. */
export const setPolicy = (page, patch) => page.evaluate(async (patch) => {
  const { setSettings } = await import(`${location.origin}/settings.js`);
  await setSettings(patch);
}, patch);

// Made-up pages for the seeds: titles with accents, addresses on 40 hosts. Nothing here is a real site or a real person.
const WORDS = ['Facture', 'Caf\u00e9', 'Rapport', '\u00c9t\u00e9', 'Invoice', 'Dashboard', 'R\u00e9sum\u00e9', 'Ticket', 'Plan', 'Maquette', '\u00c9cran', 'Notes'];
export const madeUp = (i, over = {}) => ({
  title: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} n${i}`,
  url: `https://site${i % 40}.example.test/${WORDS[i % WORDS.length].toLowerCase()}/${i}?ref=${i % 97}`,
  w: 1280, h: 720, ...over,
});

/** Calls a function of db.js that returns plain data (anything with a Blob in it has its own helper below). */
export const db = (page, method, ...args) => page.evaluate(async ({ method, args }) => {
  const module = await import(`${location.origin}/db.js`);
  return module[method](...args);
}, { method, args });

/** addShot with an original of `bytes` made-up bytes. Returns the id. */
export const add = (page, { title = 'Added', url = 'https://added.example.test/', bytes = 1000, thumb = false } = {}) => page.evaluate(async (o) => {
  const { addShot } = await import(`${location.origin}/db.js`);
  return addShot({
    original: new Blob([new Uint8Array(o.bytes).fill(1)], { type: 'image/png' }), url: o.url, title: o.title, w: 100, h: 50,
    ...(o.thumb && { thumb: new Blob([new Uint8Array(200).fill(2)], { type: 'image/webp' }) }),
  });
}, { title, url, bytes, thumb });

/** queryShots, with the thumbnails of the items replaced by their size (a Blob does not cross the wire). */
export const query = (page, options = {}) => page.evaluate(async (options) => {
  const { queryShots } = await import(`${location.origin}/db.js`);
  const page = await queryShots(options);
  return { ...page, items: page.items.map(({ thumb, ...shot }) => ({ ...shot, thumb: thumb ? thumb.size : null })) };
}, options);

/** Follows `next` from the first page; returns the ids in the order they come, and the pages. */
export async function walk(page, options = {}) {
  const ids = [];
  const pages = [];
  let before = null;
  do {
    const result = await query(page, { ...options, before });
    pages.push(result);
    ids.push(...result.items.map((s) => s.id));
    before = result.next;
  } while (before !== null && pages.length < 1000);
  return { ids, pages };
}

/**
 * Creates the database exactly as version 2 of the extension left it: the two stores, no index, no `host`, `bytes` or
 * `pinned`. Each row: { url, title, w, h, createdAt, versions, active, originalBytes, thumbBytes? }. The original is made
 * of a repeating byte pattern, so a test can tell that it came through unchanged.
 */
export function seedV2(page, rows, version = 2) {
  return page.evaluate(async ({ rows, version }) => {
    await new Promise((ok, ko) => {
      const r = indexedDB.deleteDatabase('obturo');
      r.onsuccess = () => ok(undefined);
      r.onerror = () => ko(r.error);
    });
    const db = await new Promise((ok, ko) => {
      const r = indexedDB.open('obturo', version);
      r.onupgradeneeded = () => {
        if (version === 2) {
          r.result.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
          r.result.createObjectStore('originals');
        } else {
          r.result.createObjectStore('junk'); // an older, unknown layout
        }
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    if (version === 2) {
      const tx = db.transaction(['shots', 'originals'], 'readwrite');
      for (const { originalBytes, thumbBytes, ...meta } of rows) {
        const row = { ...meta };
        if (thumbBytes) row.thumb = new Blob([new Uint8Array(thumbBytes).fill(7)], { type: 'image/webp' });
        const id = await new Promise((ok, ko) => {
          const r = tx.objectStore('shots').put(row);
          r.onsuccess = () => ok(r.result);
          r.onerror = () => ko(r.error);
        });
        tx.objectStore('originals').put(new Blob([Uint8Array.from({ length: originalBytes }, (_, i) => (i * 31 + id) % 251)], { type: 'image/png' }), id);
      }
      await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); });
    }
    db.close();
  }, { rows, version });
}

/**
 * Adds many shots straight into the stores, in one transaction and without the retention (what db.js would do one shot at
 * a time takes minutes for thousands). Each row: { title, url, createdAt, bytes (size of the original), pinned?,
 * edited?, w?, h?, thumbBytes? }. Ids continue after the highest existing one. The catalog is rewritten with the new
 * entries added, through the same functions as db.js.
 * @returns {Promise<number[]>} the ids, in the order of the rows
 */
export function seedBulk(page, rows) {
  return page.evaluate(async (rows) => {
    const db = await import(`${location.origin}/db.js`);
    const { entryOf, toBuckets, parseBucket } = await import(`${location.origin}/catalog.js`);
    await db.countShots(); // opens the database, and upgrades it if needed
    const conn = await new Promise((ok, ko) => {
      const r = indexedDB.open('obturo');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const wait = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const tx = conn.transaction(['shots', 'originals', 'catalog'], 'readwrite');
    const last = await wait(tx.objectStore('shots').openKeyCursor(null, 'prev'));
    let id = (last?.key ?? 0);
    const existing = (await wait(tx.objectStore('catalog').getAll())).flatMap(parseBucket);
    const thumb = new Blob([new Uint8Array(1200).fill(7)], { type: 'image/webp' });
    const pad = new Uint8Array(Math.max(1, ...rows.map((r) => r.bytes))).fill(9);
    const ids = [];
    const added = [];
    for (const r of rows) {
      const row = {
        id: ++id, url: r.url, title: r.title, w: r.w ?? 1280, h: r.h ?? 720, createdAt: r.createdAt,
        versions: r.edited ? [{ name: 'V1', crop: null, scale: 1, objects: [] }] : [], active: r.edited ? 0 : -1,
        host: new URL(r.url).host, bytes: r.bytes, pinned: !!r.pinned,
      };
      if (r.thumbBytes !== 0) row.thumb = thumb;
      tx.objectStore('shots').put(row);
      tx.objectStore('originals').put(new Blob([pad.subarray(0, r.bytes)], { type: 'image/png' }), row.id);
      added.push(entryOf(row));
      ids.push(row.id);
    }
    const catalog = tx.objectStore('catalog');
    catalog.clear();
    for (const [k, text] of toBuckets([...existing, ...added])) catalog.put(text, k);
    await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => ko(tx.error); });
    conn.close();
    return ids;
  }, rows);
}

/**
 * Damages the catalog the way a bug or a crash could: 'clear' empties it, 'garbage' makes a bucket unreadable, 'drop' loses an
 * entry, 'swap' replaces an entry by one for a shot that does not exist (the count of entries stays right).
 */
export function breakCatalog(page, how) {
  return page.evaluate(async (how) => {
    const conn = await new Promise((ok, ko) => {
      const r = indexedDB.open('obturo');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const tx = conn.transaction('catalog', 'readwrite');
    const store = tx.objectStore('catalog');
    if (how === 'clear') store.clear();
    else if (how === 'garbage') store.put('{broken', 0);
    else if (how === 'swap') {
      const bucket = await new Promise((ok, ko) => { const r = store.get(0); r.onsuccess = () => ok(JSON.parse(r.result)); r.onerror = () => ko(r.error); });
      bucket[0] = { ...bucket[0], id: bucket.at(-1).id + 1 }; // same bucket, same count, another shot
      store.put(JSON.stringify(bucket), 0);
    } else {
      const bucket = await new Promise((ok, ko) => { const r = store.get(0); r.onsuccess = () => ok(JSON.parse(r.result)); r.onerror = () => ko(r.error); });
      store.put(JSON.stringify(bucket.slice(1)), 0);
    }
    await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => ko(tx.error); });
    conn.close();
  }, how);
}

/**
 * Everything in the three stores, as plain data: version, stores, indexes, the shots (the thumbnail replaced by its size),
 * the size and fingerprint of each original (`hashes`: SHA-256 of each one, for small data sets), and the catalog
 * (bucket number -> entries, null when the bucket is not valid JSON).
 */
export function rawDump(page, { hashes = false } = {}) {
  return page.evaluate(async ({ hashes }) => {
    const conn = await new Promise((ok, ko) => {
      const r = indexedDB.open('obturo');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const wait = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    try {
      const tx = conn.transaction([...conn.objectStoreNames]);
      const store = (name) => tx.objectStore(name);
      const shotIndexes = [...store('shots').indexNames];
      const autoIncrement = store('shots').autoIncrement;
      const hasCatalog = conn.objectStoreNames.contains('catalog');
      // every read first: the transaction ends as soon as nothing is pending, which the hashing below would let happen
      const [shots, originalKeys, originalValues, catalogKeys, catalogValues] = await Promise.all([
        wait(store('shots').getAll()), wait(store('originals').getAllKeys()), wait(store('originals').getAll()),
        hasCatalog ? wait(store('catalog').getAllKeys()) : [], hasCatalog ? wait(store('catalog').getAll()) : [],
      ]);
      const originals = {};
      for (const [i, key] of originalKeys.entries()) {
        originals[key] = { size: originalValues[i].size };
        if (hashes) {
          const digest = await crypto.subtle.digest('SHA-256', await originalValues[i].arrayBuffer());
          originals[key].hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        }
      }
      const catalog = {};
      for (const [i, key] of catalogKeys.entries()) {
        try {
          catalog[key] = JSON.parse(catalogValues[i]);
        } catch {
          catalog[key] = null;
        }
      }
      return {
        version: conn.version,
        stores: [...conn.objectStoreNames].sort(),
        shotIndexes,
        autoIncrement,
        shots: shots.map((s) => ({ ...s, thumb: s.thumb ? s.thumb.size : null })),
        originals,
        catalog,
      };
    } finally {
      conn.close();
    }
  }, { hashes });
}

/**
 * The invariants db.js keeps after any sequence of operations: every shot has its original and the fields of version 3,
 * the size recorded is the size of the original, and the catalog holds exactly one up-to-date entry per shot, each in the
 * bucket of its id.
 */
export function assertConsistent(dump, what = 'database') {
  assert.equal(dump.version, 3, `${what}: version`);
  assert.deepEqual(dump.stores, ['catalog', 'originals', 'shots'], `${what}: stores`);
  assert.deepEqual(dump.shotIndexes, ['host'], `${what}: indexes`);
  const ids = dump.shots.map((s) => s.id);
  assert.deepEqual(Object.keys(dump.originals).map(Number).sort((a, b) => a - b), ids, `${what}: originals match the shots`);
  for (const s of dump.shots) {
    assert.equal(s.bytes, dump.originals[s.id].size, `${what}: bytes of shot ${s.id}`);
    assert.equal(typeof s.host, 'string', `${what}: host of shot ${s.id}`);
    assert.equal(typeof s.pinned, 'boolean', `${what}: pinned of shot ${s.id}`);
  }
  const expected = new Map();
  for (const s of dump.shots) expected.set(s.id, entryOf(s));
  const seen = new Map();
  for (const [key, list] of Object.entries(dump.catalog)) {
    assert.ok(Array.isArray(list) && list.length, `${what}: bucket ${key} is valid and not empty`);
    for (const e of list) {
      assert.equal(bucketOf(e.id), Number(key), `${what}: entry ${e.id} is in bucket ${key}`);
      assert.ok(!seen.has(e.id), `${what}: entry ${e.id} appears once`);
      seen.set(e.id, e);
    }
    assert.deepEqual(list.map((e) => e.id), list.map((e) => e.id).toSorted((a, b) => a - b), `${what}: bucket ${key} is sorted`);
  }
  assert.deepEqual([...seen.keys()].sort((a, b) => a - b), ids, `${what}: one entry per shot`);
  for (const [id, e] of seen) assert.deepEqual(e, expected.get(id), `${what}: entry ${id}`);
}
