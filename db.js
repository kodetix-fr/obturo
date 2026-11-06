import { planPurge, previewPlan } from './retention.js';
import {
  catalogMatches, compileFilter, entryOf, hostCounts, hostOf, isOpen, limitShotText, parseBucket, patchBucket, sameEntry, selectPage,
  serializeBucket, toBuckets, bucketOf,
} from './catalog.js';
import { getSettings, liveOpenShots } from './settings.js';
import { clamp } from './pure.js';
import { versionsKey } from './thumb-pure.js';
import { done, wait } from './idb.js';

/**
 * A shot as read from the database (without its original).
 * @typedef {object} Shot
 * @property {number} id Ids only grow: their order is the order of the captures.
 * @property {string} url Address of the captured page.
 * @property {string} title Title of the captured page.
 * @property {number} w Width of the original, in px.
 * @property {number} h Height of the original, in px.
 * @property {number} createdAt Capture timestamp (ms).
 * @property {import('./versions.js').Version[]} versions
 * @property {number} active Index of the displayed version, -1 = the original.
 * @property {Blob} [thumb] WebP thumbnail of the strip, created on demand.
 * @property {string} host Host of the page address, '' if it has none.
 * @property {number} bytes Size of the original, in bytes.
 * @property {boolean} pinned Kept by the user: the retention never removes it.
 * @property {number} [covered] How many sensitive items the capture covered; absent when it was not asked to cover them.
 */

/**
 * What queryShots and countShots accept. `limit` and `before` only apply to queryShots.
 * @typedef {import('./catalog.js').Filter & { limit?: number, before?: number | null }} Query
 */

// Three stores:
//   shots     metadata, versions, thumbnail: small, rewritten often by the autosave
//   originals the PNG Blob, key = shot id: written once, never rewritten
//   catalog   one light entry per shot, in buckets (see catalog.js): search, filters and retention read this, never the shots
// Measured (Chromium): rewriting a row that holds a 20 MB Blob costs ~20 ms, against ~0 ms when it is separate.
// Version 3 added the catalog, the `host` index, and the `host`, `bytes` and `pinned` fields of a shot.
// ponytail: a database older than version 2 (never published) is dropped and recreated; the day a layout has to be carried over, add its step to `upgrade`.
/** @type {Promise<IDBDatabase> | null | undefined} */
let dbp;
const open = () => dbp ??= new Promise((ok, ko) => {
  const r = indexedDB.open('obturo', 3);
  r.onupgradeneeded = (e) => upgrade(r.result, /** @type {IDBTransaction} */ (r.transaction), e.oldVersion);
  r.onsuccess = () => {
    const db = r.result;
    db.onversionchange = db.onclose = () => { db.close(); dbp = null; }; // never blocks a version upgrade
    ok(db);
  };
  r.onerror = () => { dbp = null; ko(r.error); };
});

/**
 * Runs in the upgrade transaction: only IndexedDB requests, no other asynchronous work (the transaction would end).
 * @param {IDBDatabase} db
 * @param {IDBTransaction} tx
 * @param {number} from Version of the database on disk, 0 if there is none.
 */
function upgrade(db, tx, from) {
  if (from < 2) {
    for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
    db.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('originals');
  }
  if (from < 3) {
    const shots = tx.objectStore('shots');
    const originals = tx.objectStore('originals');
    shots.createIndex('host', 'host');
    const catalog = db.createObjectStore('catalog');
    // Every existing shot keeps all its data and gets the new fields, computed here; then the catalog is built from them.
    const entries = [];
    const walk = shots.openCursor();
    walk.onsuccess = () => {
      const cursor = walk.result;
      if (!cursor) {
        for (const [k, text] of toBuckets(entries)) catalog.put(text, k);
        return;
      }
      const row = cursor.value;
      originals.get(row.id).onsuccess = (e) => {
        const original = /** @type {IDBRequest<Blob | undefined>} */ (e.target).result;
        const next = { ...row, host: hostOf(row.url), bytes: original?.size ?? 0, pinned: false };
        cursor.update(next);
        entries.push(entryOf(next));
        cursor.continue();
      };
    };
  }
}

// --- The catalog (see catalog.js) ---

// ponytail: every search and every retention pass reads the whole catalog (about 7 ms for 5,000 shots, linear); keep it in memory with a revision counter if the history ever reaches tens of thousands of shots.
/** @param {IDBObjectStore} catalog @returns {Promise<import('./catalog.js').Entry[]>} every entry, by increasing id */
async function loadEntries(catalog) {
  return (await wait(catalog.getAll())).flatMap(parseBucket);
}

/**
 * Adds, replaces and removes entries, touching only the buckets they belong to.
 * @param {IDBObjectStore} catalog
 * @param {{ upsert?: import('./catalog.js').Entry[], remove?: number[] }} changes
 * @param {Map<number, unknown>} [known] Buckets the caller has already read in this transaction (as stored), by number: they
 *   are not read again, which saves a round trip to the database.
 * @returns {Promise<import('./catalog.js').Entry[]>} the entries that were taken out
 */
async function patchCatalog(catalog, { upsert = [], remove = [] }, known = new Map()) {
  const keys = [...new Set([...upsert.map((e) => e.id), ...remove].map(bucketOf))];
  /** @type {import('./catalog.js').Entry[]} */
  const removed = [];
  await Promise.all(keys.map(async (k) => {
    const out = patchBucket(
      parseBucket(known.has(k) ? known.get(k) : await wait(catalog.get(k))),
      upsert.filter((e) => bucketOf(e.id) === k),
      remove.filter((id) => bucketOf(id) === k),
    );
    removed.push(...out.removed);
    if (out.list.length) catalog.put(serializeBucket(out.list), k);
    else catalog.delete(k);
  }));
  return removed;
}

// Puts the catalog back in line with the shots, when a repair is needed (it should never be).
/** @param {IDBTransaction} tx @returns {Promise<import('./catalog.js').Entry[]>} */
async function rebuildCatalog(tx) {
  const entries = (await wait(tx.objectStore('shots').getAll())).map(entryOf);
  const catalog = tx.objectStore('catalog');
  catalog.clear();
  for (const [k, text] of toBuckets(entries)) catalog.put(text, k);
  return entries;
}

// --- Writes ---

// ponytail: removing 1,000 shots takes 0.8 to 2 s (measured): Chromium deletes one file per Blob, and a shot holds two (original and thumbnail), whatever the number of requests; keep the thumbnail inline (an ArrayBuffer in the row) to halve it, or delete the originals in a later transaction.
/**
 * Deletes shots and their originals, inside an open transaction over the three stores.
 * @param {IDBTransaction} tx
 * @param {number[]} ids
 * @returns {Promise<{ deleted: number, freedBytes: number }>}
 */
async function removeShots(tx, ids) {
  const shots = tx.objectStore('shots');
  const originals = tx.objectStore('originals');
  for (const id of ids) {
    shots.delete(id);
    originals.delete(id);
  }
  const removed = await patchCatalog(tx.objectStore('catalog'), { remove: ids });
  return { deleted: removed.length, freedBytes: removed.reduce((sum, e) => sum + e.bytes, 0) };
}

// The retention settings, and the shots a live library has open, read while the capture is being written. Settings that cannot
// be read purge nothing: the defaults would delete what the user chose to keep ("Forever", "No limit"). A stored value that is
// corrupted or out of range is another matter: normalizeSettings replaces it by its default.
const policyOf = () => Promise.all([getSettings(), liveOpenShots()]).then(
  ([{ retentionDays, maxBytes }, held]) => ({ retentionDays, maxBytes, held }),
  (e) => {
    console.error('Obturo: settings unreadable, no retention this time', e);
    return { retentionDays: 0, maxBytes: 0, held: /** @type {number[]} */ ([]) };
  },
);

/**
 * What a retention pass did.
 * @typedef {object} Purged
 * @property {number} deleted Shots removed.
 * @property {number} freedBytes Size of the originals removed.
 * @property {boolean} overCap The size cap is still exceeded, by shots that cannot be removed (pinned, new, open in the library).
 */

// Shots removed per transaction. Removing a shot costs 1 to 1.5 ms (Chromium deletes a file per Blob, and a shot holds two), and an
// autosave or a capture queued behind a transaction waits for all of it: 5 s for 3,500 shots in one go. By lots of 50 it waits for
// 50 to 150 ms (measured: worst autosave 130 to 450 ms during a purge of 3,000 shots, the rest is the disk and the antivirus).
// ponytail: each lot reads the whole catalog again and plans over it (7 ms per 5,000 shots); plan once and re-check only the
// buckets of the lot if a history ever holds tens of thousands of shots.
const PURGE_LOT = 50;

/**
 * One retention pass: the policy decides over the catalog, the shots it names are deleted. By lots, one transaction each: the
 * plan is made again at every lot, in the transaction that deletes, so that a shot pinned, edited or opened meanwhile is spared,
 * and shots, originals and catalog agree between any two lots.
 * @param {{ retentionDays: number, maxBytes: number, held?: number[] }} policy `held`: the shots a live library has open, when the
 *   caller has just read them (the first lot uses them, the next ones read them again).
 * @param {number | null} keepId A shot that must stay (the one just added).
 * @param {{ verify?: boolean, lots?: number }} [options] `verify`: check first that the catalog lists the shots that exist, and
 *   rebuild it if not (costs a read of the keys); done even when the policy removes nothing, which is why the library asks for it.
 *   `lots`: how many lots at most, the rest is left to the next pass.
 * @returns {Promise<Purged>}
 */
async function applyPolicy(policy, keepId, { verify = false, lots = Infinity } = {}) {
  const { retentionDays, maxBytes, held } = policy;
  if (!verify && !(retentionDays > 0) && !(maxBytes > 0)) return { deleted: 0, freedBytes: 0, overCap: false };
  const db = await open();
  let deleted = 0;
  let freedBytes = 0;
  let overCap = false;
  for (let lot = 0; lot < lots; lot++) {
    const keep = [...(lot === 0 && held ? held : await liveOpenShots()), ...(keepId == null ? [] : [keepId])];
    const tx = db.transaction(['shots', 'originals', 'catalog'], 'readwrite');
    const [loaded, shotIds] = await Promise.all([loadEntries(tx.objectStore('catalog')), verify && lot === 0 ? wait(tx.objectStore('shots').getAllKeys()) : null]);
    const entries = shotIds && !catalogMatches(loaded, /** @type {number[]} */ (shotIds)) ? await rebuildCatalog(tx) : loaded;
    const plan = planPurge(entries, Date.now(), policy, keep);
    const out = plan.ids.length ? await removeShots(tx, plan.ids.slice(0, PURGE_LOT)) : { deleted: 0, freedBytes: 0 };
    await done(tx);
    deleted += out.deleted;
    freedBytes += out.freedBytes;
    overCap = plan.overCap;
    if (plan.ids.length <= PURGE_LOT || !out.deleted) break;
    await new Promise((ok) => setTimeout(ok)); // what was queued meanwhile (an autosave, a capture) runs before the next lot
  }
  return { deleted, freedBytes, overCap };
}

/**
 * Adds a shot, then applies the retention settings without ever removing the new shot or a shot a live library has open. A
 * retention that fails does not fail the capture: the shot is saved, and the next pass catches up. The pass is one lot at most (a
 * backlog does not keep the capture waiting): the library finishes it when it opens, and every capture takes another lot.
 * @param {{ original: Blob, url: string, title: string, w: number, h: number, thumb?: Blob, covered?: number }} shot
 * @returns {Promise<number>} the id of the new shot
 */
export async function addShot({ original, url, title, w, h, thumb, covered }) {
  const policy = policyOf();
  const db = await open();
  const tx = db.transaction(['shots', 'originals', 'catalog'], 'readwrite');
  const text = limitShotText({ title, url }); // the one place where a title and an address enter the database
  /** @type {Omit<Shot, 'id'>} */
  const row = { url: text.url, title: text.title, w, h, createdAt: Date.now(), versions: [], active: -1, host: hostOf(text.url), bytes: original.size, pinned: false };
  if (thumb) row.thumb = thumb;
  if (Number.isInteger(covered) && covered >= 0) row.covered = covered;
  const id = await wait(tx.objectStore('shots').put(row));
  tx.objectStore('originals').put(original, /** @type {number} */ (id));
  await patchCatalog(tx.objectStore('catalog'), { upsert: [entryOf({ ...row, id: /** @type {number} */ (id) })] });
  await done(tx);
  try {
    await applyPolicy(await policy, /** @type {number} */ (id), { lots: 1 });
  } catch (e) {
    console.error('Obturo: retention failed', e);
  }
  return /** @type {number} */ (id);
}

/**
 * Reads the EXISTING row and lets `change` decide what to merge into it, all in one transaction (a get then a put). A shot that
 * no longer exists (purged or deleted) is never recreated.
 *
 * It is short on purpose: a page that closes or reloads gives it a few milliseconds, and a transaction that is not committed when
 * the page goes is lost. The row and its catalog bucket are read at the same time (one round trip to the database, not two), and
 * the commit is asked for as soon as the last write is issued, without waiting for its answer.
 * @param {number} id
 * @param {(row: Shot) => Partial<Shot> | null} change The patch to merge, null to leave the row alone.
 * @returns {Promise<{ found: boolean, applied: boolean }>}
 */
async function mutate(id, change) {
  const db = await open();
  const tx = db.transaction(['shots', 'catalog'], 'readwrite');
  const store = tx.objectStore('shots');
  const catalog = tx.objectStore('catalog');
  const [cur, bucket] = await Promise.all([wait(store.get(id)), wait(catalog.get(bucketOf(id)))]);
  const patch = cur && change(cur);
  if (cur && patch) {
    const next = { ...cur, ...patch, id };
    store.put(next);
    const entry = entryOf(next);
    // the autosave and the thumbnails change nothing the catalog keeps: no second write
    if (!sameEntry(entryOf(cur), entry)) await patchCatalog(catalog, { upsert: [entry] }, new Map([[bucketOf(id), bucket]]));
  }
  tx.commit();
  await done(tx);
  return { found: !!cur, applied: !!patch };
}

/**
 * Merges `patch` into the EXISTING row (get then put in the same transaction).
 * Returns false if the shot no longer exists (purged or deleted): it is never recreated.
 * @param {number} id
 * @param {Partial<Shot>} patch
 */
export async function updateShot(id, patch) {
  return (await mutate(id, () => patch)).found;
}

/**
 * Stores the thumbnail of a shot, if the shot still has the state it was rendered from (`key`, from versionsKey). A rendering
 * that took longer than an edit is refused, so it never replaces the thumbnail of that edit, which may hide what the older state
 * shows. The versions are written first, by updateShot; this comes after, on its own.
 * @param {number} id
 * @param {Blob} thumb
 * @param {string} key versionsKey of the state the thumbnail shows.
 * @returns {Promise<boolean>} false if the shot is gone or has moved on
 */
export async function storeThumb(id, thumb, key) {
  return (await mutate(id, (row) => (versionsKey(row) === key ? { thumb } : null))).applied;
}

/**
 * Pins or unpins a shot: a pinned shot is never removed by the retention.
 * @param {number} id
 * @param {boolean} pinned
 * @returns {Promise<boolean>} false if the shot no longer exists
 */
export const setPinned = (id, pinned) => updateShot(id, { pinned: !!pinned });

/**
 * Pins or unpins many shots in one transaction.
 * @param {number[]} ids
 * @param {boolean} pinned
 * @returns {Promise<number>} how many shots changed (those that exist and were not in that state already)
 */
export async function setPinnedMany(ids, pinned) {
  const list = [...new Set(ids)].filter(Number.isInteger);
  if (!list.length) return 0;
  const db = await open();
  const tx = db.transaction(['shots', 'catalog'], 'readwrite');
  const store = tx.objectStore('shots');
  /** @type {import('./catalog.js').Entry[]} */
  const upsert = [];
  await Promise.all(list.map(async (id) => {
    const cur = await wait(store.get(id));
    if (!cur || !!cur.pinned === !!pinned) return;
    const next = { ...cur, pinned: !!pinned };
    store.put(next);
    upsert.push(entryOf(next));
  }));
  if (upsert.length) await patchCatalog(tx.objectStore('catalog'), { upsert });
  await done(tx);
  return upsert.length;
}

/**
 * @param {number[]} ids
 * @returns {Promise<{ deleted: number, freedBytes: number }>} the shots that existed and the size of their originals
 */
export async function deleteShots(ids) {
  const list = [...new Set(ids)].filter(Number.isInteger);
  if (!list.length) return { deleted: 0, freedBytes: 0 };
  const db = await open();
  const tx = db.transaction(['shots', 'originals', 'catalog'], 'readwrite');
  const out = await removeShots(tx, list);
  await done(tx);
  return out;
}

/** @param {number} id */
export async function deleteShot(id) {
  await deleteShots([id]);
}

/**
 * A purge asked by the user, with the same rules as the retention: pinned shots stay, an edited shot escapes the age, and a
 * shot a live library has open stays whatever the options say. By lots (see applyPolicy).
 * @param {{ olderThanDays?: number, maxBytes?: number }} [options] 0 or absent: no purge by age, no size cap.
 * @returns {Promise<Purged>}
 */
export const purgeNow = ({ olderThanDays = 0, maxBytes = 0 } = {}) =>
  applyPolicy({ retentionDays: olderThanDays, maxBytes }, null, { verify: true });

/**
 * The retention of the settings, applied now (the library does it when it opens). Also puts the catalog back in line with
 * the shots if they ever differ.
 * @param {number | null} [keepId] A shot that must stay (the one the library has open).
 * @returns {Promise<Purged>}
 */
export async function runRetention(keepId = null) {
  return applyPolicy(await policyOf(), keepId, { verify: true });
}

/**
 * What purgeNow would do with these options, without deleting anything: the shots and the size it would remove, what is left,
 * and how many pinned and edited shots it spares.
 * @param {{ olderThanDays?: number, maxBytes?: number }} [options] same as purgeNow
 */
export async function previewPurge({ olderThanDays = 0, maxBytes = 0 } = {}) {
  const db = await open();
  const [entries, held] = await Promise.all([loadEntries(db.transaction('catalog').objectStore('catalog')), liveOpenShots()]);
  return previewPlan(entries, Date.now(), { retentionDays: olderThanDays, maxBytes }, held);
}

// --- Reads ---

/**
 * The latest shots, most recent first, and nothing else: a cursor over `limit` rows, no count, no catalog. The strip of the
 * library paints from this (the page waits for it); `countShots` gives the total afterwards.
 * @param {number} [limit]
 * @returns {Promise<Shot[]>}
 */
export async function latestShots(limit = 12) {
  const db = await open();
  return new Promise((ok, ko) => {
    /** @type {Shot[]} */
    const found = [];
    const req = db.transaction('shots').objectStore('shots').openCursor(null, 'prev');
    req.onerror = () => ko(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return ok(found);
      found.push(cursor.value);
      if (found.length >= limit) ok(found);
      else cursor.continue();
    };
  });
}

/**
 * One page of the history, from the most recent to the oldest, metadata only (thumbnail included, never the original).
 * `next` is the `before` to pass for the following page, null when there is none. `total` counts every shot that matches.
 * Without a text, date or pinned filter (a host alone is fine) only the page is read; otherwise the catalog is.
 * @param {Query} [options] `query`: words searched in the title and the address, case and accents ignored.
 * @returns {Promise<{ items: Shot[], next: number | null, total: number }>}
 */
export async function queryShots({ limit = 60, before = null, query = '', host = '', from = 0, to = Infinity, onlyPinned = false } = {}) {
  const filter = { query, host, from, to, onlyPinned };
  const size = clamp(Math.floor(Number(limit)) || 60, 1, 1000);
  const after = typeof before === 'number' ? before : null;
  const db = await open();
  const tx = db.transaction(['shots', 'catalog']);
  const shots = tx.objectStore('shots');
  if (isOpen(filter)) return pageOfStore(shots, String(host ?? '').toLowerCase(), size, after);
  const { ids, next, total } = selectPage(await loadEntries(tx.objectStore('catalog')), filter, { limit: size, before: after });
  const items = (await Promise.all(ids.map((id) => wait(shots.get(id))))).filter(Boolean);
  return { items, next, total };
}

// The page read straight from the shots (or from their host index): a cursor from the most recent, `limit` + 1 rows to
// know whether another page follows.
/** @param {IDBObjectStore} store @param {string} host @param {number} limit @param {number | null} before */
async function pageOfStore(store, host, limit, before) {
  const source = host ? store.index('host') : store;
  const only = host ? IDBKeyRange.only(host) : undefined;
  const count = wait(source.count(only));
  const range = host ? only : before == null ? undefined : IDBKeyRange.upperBound(before, true);
  /** @type {Promise<Shot[]>} */
  const page = new Promise((ok, ko) => {
    const found = [];
    const req = source.openCursor(range, 'prev');
    req.onerror = () => ko(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return ok(found);
      if (host && before != null && /** @type {number} */ (cursor.primaryKey) >= before) { // within one host the ids come in order: jump to the page
        cursor.continuePrimaryKey(host, before - 1);
        return;
      }
      found.push(cursor.value);
      if (found.length <= limit) cursor.continue();
      else ok(found);
    };
  });
  const [rows, total] = await Promise.all([page, count]);
  const more = rows.length > limit;
  if (more) rows.pop();
  return { items: rows, next: more ? rows[rows.length - 1].id : null, total };
}

/**
 * How many shots match (the same filters as queryShots).
 * @param {Query} [filter]
 * @returns {Promise<number>}
 */
export async function countShots(filter = {}) {
  const db = await open();
  const tx = db.transaction(['shots', 'catalog']);
  if (isOpen(filter)) {
    const host = String(filter.host ?? '').toLowerCase();
    const shots = tx.objectStore('shots');
    return host ? wait(shots.index('host').count(IDBKeyRange.only(host))) : wait(shots.count());
  }
  return (await loadEntries(tx.objectStore('catalog'))).filter(compileFilter(filter)).length;
}

/** @param {number} id One shot, as queryShots returns it (thumbnail included, never the original). @returns {Promise<Shot | undefined>} undefined if it does not exist */
export async function getShot(id) {
  const db = await open();
  return wait(db.transaction('shots').objectStore('shots').get(id));
}

/**
 * The catalog entries that match, from the most recent to the oldest: id, date, size and flags of EVERY match, not one page (a
 * "select all" and the sums of a confirmation read this). About 7 ms for 5,000 shots.
 * @param {import('./catalog.js').Filter} [filter] same as queryShots
 * @returns {Promise<import('./catalog.js').Entry[]>}
 */
export async function listEntries(filter = {}) {
  const db = await open();
  return (await loadEntries(db.transaction('catalog').objectStore('catalog'))).filter(compileFilter(filter)).reverse();
}

/** The hosts of the history with their number of shots, the most frequent first. @returns {Promise<{ host: string, count: number }[]>} */
export async function listHosts() {
  const db = await open();
  return hostCounts(await loadEntries(db.transaction('catalog').objectStore('catalog')));
}

/**
 * What the history holds and what the browser says about this storage. `usage` and `quota` are what the browser reports
 * for the whole origin (history and settings), 0 when it does not report them.
 * @returns {Promise<{ count: number, bytes: number, usage: number, quota: number }>}
 */
export async function storageUsage() {
  const db = await open();
  const [entries, estimate] = await Promise.all([
    loadEntries(db.transaction('catalog').objectStore('catalog')),
    Promise.resolve(navigator.storage?.estimate?.()).catch(() => undefined),
  ]);
  return { count: entries.length, bytes: entries.reduce((sum, e) => sum + e.bytes, 0), usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
}

/** @param {number} id @returns {Promise<Blob | undefined>} */
export async function getOriginal(id) {
  const db = await open();
  return wait(db.transaction('originals').objectStore('originals').get(id));
}

// export-ui: the rows of the shots to export
/**
 * The rows (metadata and versions, never the originals) of these shots, by increasing id. An id that no longer exists
 * is left out, so the caller compares the lengths. Reads only the rows asked for: the history can hold thousands.
 * @param {number[]} ids
 * @returns {Promise<Shot[]>}
 */
export async function getShots(ids) {
  const list = [...new Set(ids)].filter(Number.isInteger).toSorted((a, b) => a - b);
  const db = await open();
  const store = db.transaction('shots').objectStore('shots');
  return (await Promise.all(list.map((id) => wait(store.get(id))))).filter(Boolean);
}
