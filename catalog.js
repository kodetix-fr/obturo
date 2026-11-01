// The catalog of the history: one light entry per shot (id, date, size, flags, host, searchable text), kept next to the
// shots by db.js. It answers the questions that need every shot (search, filters, retention, totals) without reading
// the shots themselves. Pure (no chrome.*, IndexedDB or DOM): `node --test` covers it.
//
// Why it exists. The `shots` rows hold a thumbnail Blob and the versions of an edited shot, and a scan of the rows is
// slow: 5,000 rows cost 150 to 400 ms to read (Chromium 143). The catalog is stored as buckets of BUCKET consecutive
// ids, each one a JSON string of its entries: 5,000 entries read back in about 7 ms, against about 50 ms for the same
// entries stored one object each (the cost is per stored object, not per byte).

export const BUCKET = 512;

/** @param {number} id */
export const bucketOf = (id) => Math.floor(id / BUCKET);

/**
 * The light description of a shot.
 * @typedef {object} Entry
 * @property {number} id
 * @property {number} createdAt
 * @property {number} bytes Size of the original.
 * @property {boolean} pinned
 * @property {boolean} edited At least one version.
 * @property {string} host Host of the page address, '' if it has none.
 * @property {string} q Title and address, folded (see fold), for the search.
 */

// Lower case without accents: "cafe" finds "caf" followed by e acute. NFD splits an accented letter into the letter and a mark (\p{M}).
/** @param {unknown} s */
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Host (with its port) of a page address; '' if it is not an address. @param {unknown} url */
export function hostOf(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return '';
  }
}

/**
 * The entry of a row of the `shots` store.
 * @param {{ id: number, createdAt?: number, bytes?: number, pinned?: boolean, versions?: unknown[], host?: string, title?: string, url?: string }} row
 * @returns {Entry}
 */
export function entryOf(row) {
  return {
    id: row.id,
    createdAt: row.createdAt ?? 0,
    bytes: row.bytes > 0 ? row.bytes : 0,
    pinned: !!row.pinned,
    edited: !!row.versions?.length,
    host: row.host ?? hostOf(row.url),
    q: fold(`${row.title ?? ''}\n${row.url ?? ''}`),
  };
}

/** True if both entries say the same thing (an update that changes nothing here needs no write). @param {Entry} a @param {Entry} b */
export const sameEntry = (a, b) => a.id === b.id && a.createdAt === b.createdAt && a.bytes === b.bytes && a.pinned === b.pinned
  && a.edited === b.edited && a.host === b.host && a.q === b.q;

/**
 * True if the catalog lists exactly the shots that exist: the same ids, in the same order. A count is not enough (an entry
 * for a shot that is gone and a shot without an entry cancel out); the ids of the store are cheap to read, its rows are not.
 * @param {Entry[]} entries By increasing id, as read from the buckets.
 * @param {number[]} shotIds The keys of the `shots` store, increasing.
 */
export const catalogMatches = (entries, shotIds) => entries.length === shotIds.length && entries.every((e, i) => e.id === shotIds[i]);

// --- Limits ---

// A page hands the extension any title and address (a data: URL, a query string of megabytes). They are cut where a shot enters
// the database, so that neither a row nor a catalog entry (whose search key holds both) can grow with them.
export const MAX_TITLE = 300;
export const MAX_URL = 2048;

/** @param {unknown} value @param {number} max */
const cut = (value, max) => {
  const text = String(value ?? '');
  return text.length <= max ? text : text.slice(0, max).replace(/[\ud800-\udbff]$/, ''); // never half of a surrogate pair
};

/** @param {{ title?: unknown, url?: unknown }} shot @returns {{ title: string, url: string }} */
export const limitShotText = ({ title, url }) => ({ title: cut(title, MAX_TITLE), url: cut(url, MAX_URL) });

// --- Buckets ---

/** A bucket as stored (JSON text), or nothing, to its entries by increasing id. A damaged bucket reads as empty. @param {unknown} text @returns {Entry[]} */
export function parseBucket(text) {
  if (typeof text !== 'string') return [];
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {Entry[]} list */
export const serializeBucket = (list) => JSON.stringify(list);

/**
 * The bucket with `upserts` added (replacing the entry of the same id) and `removeIds` taken out. A removal wins over an
 * upsert of the same id. The input is not modified.
 * @param {Entry[]} list Entries of one bucket.
 * @param {Entry[]} upserts
 * @param {number[]} removeIds
 * @returns {{ list: Entry[], removed: Entry[] }} the new bucket, by increasing id, and the entries that were taken out
 */
export function patchBucket(list, upserts, removeIds) {
  const drop = new Set(removeIds);
  const replaced = new Set(upserts.map((e) => e.id));
  const removed = list.filter((e) => drop.has(e.id));
  const kept = list.filter((e) => !drop.has(e.id) && !replaced.has(e.id));
  const added = upserts.filter((e) => !drop.has(e.id));
  return { list: [...kept, ...added].sort((a, b) => a.id - b.id), removed };
}

/**
 * Every entry spread over its buckets, as they are stored.
 * @param {Entry[]} entries
 * @returns {Map<number, string>} bucket number -> JSON text
 */
export function toBuckets(entries) {
  /** @type {Map<number, Entry[]>} */
  const groups = new Map();
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    const k = bucketOf(e.id);
    const group = groups.get(k);
    if (group) group.push(e);
    else groups.set(k, [e]);
  }
  return new Map([...groups].map(([k, list]) => [k, serializeBucket(list)]));
}

// --- Queries ---

/**
 * What the history can be narrowed by. Every field is optional.
 * @typedef {object} Filter
 * @property {string} [query] Words, all of which must be in the title or the address (case and accents ignored).
 * @property {string} [host] Exact host.
 * @property {number} [from] Oldest capture date kept (ms, included).
 * @property {number} [to] Latest capture date kept (ms, included).
 * @property {boolean} [onlyPinned]
 */

// A missing or invalid date bound is no bound.
/** @param {unknown} v @param {number} fallback */
const bound = (v, fallback) => (v == null || Number.isNaN(Number(v)) ? fallback : Number(v));

/**
 * True if, apart from the host, the filter keeps every shot: they can then be read straight from the store (or from the
 * host index), without the catalog.
 * @param {Filter} [filter]
 */
export const isOpen = ({ query = '', from = 0, to = Infinity, onlyPinned = false } = {}) =>
  !fold(query).trim() && bound(from, 0) <= 0 && bound(to, Infinity) === Infinity && !onlyPinned;

/**
 * The test of a filter on an entry.
 * @param {Filter} [filter]
 * @returns {(e: Entry) => boolean}
 */
export function compileFilter({ query = '', host = '', from = 0, to = Infinity, onlyPinned = false } = {}) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const wanted = String(host ?? '').toLowerCase();
  const lo = bound(from, 0);
  const hi = bound(to, Infinity);
  return (e) => (!wanted || e.host === wanted) && (!onlyPinned || e.pinned) && e.createdAt >= lo && e.createdAt <= hi
    && terms.every((term) => e.q.includes(term));
}

/**
 * One page of the shots that match, from the most recent to the oldest.
 * @param {Entry[]} entries By increasing id.
 * @param {Filter} filter
 * @param {{ limit: number, before: number | null }} page `before`: only the shots with a smaller id.
 * @returns {{ ids: number[], next: number | null, total: number }} `next`: pass it as `before` for the following page,
 *   null if there is none; `total`: how many shots match, whatever the page.
 */
export function selectPage(entries, filter, { limit, before }) {
  const test = compileFilter(filter);
  /** @type {number[]} */
  const ids = [];
  let total = 0;
  let more = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!test(e)) continue;
    total++;
    if (before != null && e.id >= before) continue;
    if (ids.length < limit) ids.push(e.id);
    else more = true;
  }
  return { ids, next: more ? ids[ids.length - 1] : null, total };
}

/** The hosts in the history with their number of shots, the most frequent first. @param {Entry[]} entries @returns {{ host: string, count: number }[]} */
export function hostCounts(entries) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of entries) if (e.host) counts.set(e.host, (counts.get(e.host) ?? 0) + 1);
  return [...counts].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || (a.host < b.host ? -1 : 1));
}
