import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUCKET, bucketOf, fold, hostOf, entryOf, sameEntry, parseBucket, serializeBucket, patchBucket, toBuckets, isOpen,
  compileFilter, selectPage, hostCounts, catalogMatches, limitShotText, MAX_TITLE, MAX_URL,
} from './catalog.js';

const entry = (id, over = {}) => ({
  id, createdAt: id * 1000, bytes: 10, pinned: false, edited: false, host: 'a.test', q: `shot ${id}\nhttps://a.test/${id}`, ...over,
});
const ids = (list) => list.map((e) => e.id);

test('fold ignores case and accents', () => {
  assert.equal(fold('Caf\u00e9 \u00c9T\u00c9'), 'cafe ete');
  assert.equal(fold('cafe\u0301'), 'cafe'); // decomposed accent
  assert.equal(fold('\u00dcn\u00efc\u00f6d\u00e9 \u00d1and\u00fa'), 'unicode nandu');
  assert.equal(fold(undefined), '');
  assert.equal(fold(null), '');
  assert.equal(fold(42), '42');
});

test('hostOf: host with its port, empty when the address is not valid', () => {
  assert.equal(hostOf('https://Example.TEST/a/b?q=1#x'), 'example.test');
  assert.equal(hostOf('http://localhost:3000/x'), 'localhost:3000');
  assert.equal(hostOf('file:///C:/docs/a.html'), '');
  assert.equal(hostOf('not an address'), '');
  assert.equal(hostOf(''), '');
  assert.equal(hostOf(undefined), '');
  assert.equal(hostOf(null), '');
});

test('entryOf: the light description of a row', () => {
  const row = { id: 7, createdAt: 123, bytes: 456, pinned: true, versions: [{}], host: 'x.test', title: '\u00c9t\u00e9', url: 'https://x.test/\u00dc' };
  assert.deepEqual(entryOf(row), { id: 7, createdAt: 123, bytes: 456, pinned: true, edited: true, host: 'x.test', q: 'ete\nhttps://x.test/u' });
});

test('entryOf: a bare row gets safe defaults', () => {
  assert.deepEqual(entryOf({ id: 1 }), { id: 1, createdAt: 0, bytes: 0, pinned: false, edited: false, host: '', q: '\n' });
  assert.equal(entryOf({ id: 1, versions: [] }).edited, false);
  assert.equal(entryOf({ id: 1, bytes: -3 }).bytes, 0);
  assert.equal(entryOf({ id: 1, url: 'https://y.test/a' }).host, 'y.test', 'host derived from the address when the row has none');
});

test('sameEntry', () => {
  assert.equal(sameEntry(entry(1), entry(1)), true);
  for (const change of [{ createdAt: 1 }, { bytes: 11 }, { pinned: true }, { edited: true }, { host: 'b.test' }, { q: 'other' }]) {
    assert.equal(sameEntry(entry(1), entry(1, change)), false, JSON.stringify(change));
  }
  assert.equal(sameEntry(entry(1), entry(2)), false);
});

test('buckets: BUCKET consecutive ids share a bucket', () => {
  assert.equal(bucketOf(1), 0);
  assert.equal(bucketOf(BUCKET - 1), 0);
  assert.equal(bucketOf(BUCKET), 1);
  assert.equal(bucketOf(3 * BUCKET + 5), 3);
});

test('parseBucket and serializeBucket round-trip; anything damaged reads as empty', () => {
  const list = [entry(1), entry(2, { pinned: true })];
  assert.deepEqual(parseBucket(serializeBucket(list)), list);
  for (const bad of [undefined, null, 42, {}, '', '{not json', '{"a":1}', 'null']) assert.deepEqual(parseBucket(bad), [], String(bad));
});

test('patchBucket: inserts in id order, replaces the entry of the same id, removes', () => {
  const list = [entry(1), entry(3), entry(5)];
  assert.deepEqual(ids(patchBucket(list, [entry(4)], []).list), [1, 3, 4, 5]);
  assert.deepEqual(ids(patchBucket(list, [entry(0)], []).list), [0, 1, 3, 5]);
  const replaced = patchBucket(list, [entry(3, { pinned: true })], []);
  assert.deepEqual(ids(replaced.list), [1, 3, 5]);
  assert.equal(replaced.list[1].pinned, true);
  const gone = patchBucket(list, [], [3, 5, 99]);
  assert.deepEqual(ids(gone.list), [1]);
  assert.deepEqual(ids(gone.removed), [3, 5]);
});

test('patchBucket: a removal wins over an upsert of the same id; the input is not modified', () => {
  const list = Object.freeze([Object.freeze(entry(1)), Object.freeze(entry(2))]);
  const out = patchBucket([...list], [entry(2, { pinned: true }), entry(9)], [2]);
  assert.deepEqual(ids(out.list), [1, 9]);
  assert.deepEqual(ids(out.removed), [2]);
  assert.deepEqual(ids(patchBucket([], [entry(1)], []).list), [1]);
});

test('toBuckets spreads the entries over their buckets, by increasing id', () => {
  const entries = [entry(BUCKET + 1), entry(2), entry(1), entry(2 * BUCKET)];
  const buckets = toBuckets(entries);
  assert.deepEqual([...buckets.keys()].sort(), [0, 1, 2]);
  assert.deepEqual(ids(parseBucket(buckets.get(0))), [1, 2]);
  assert.deepEqual(ids(parseBucket(buckets.get(1))), [BUCKET + 1]);
  assert.deepEqual(ids(parseBucket(buckets.get(2))), [2 * BUCKET]);
  assert.equal(toBuckets([]).size, 0);
});

test('filter: words must all be in the title or the address, case and accents ignored', () => {
  const e = entryOf({ id: 1, title: 'Facture D\u00e9cembre', url: 'https://compta.example.test/R\u00e9sum\u00e9?id=42' });
  const keep = (f) => compileFilter(f)(e);
  assert.equal(keep({ query: 'facture' }), true);
  assert.equal(keep({ query: 'DECEMBRE' }), true);
  assert.equal(keep({ query: 'resume' }), true);
  assert.equal(keep({ query: 'compta.example' }), true);
  assert.equal(keep({ query: 'd\u00e9cembre facture' }), true, 'order of the words does not matter');
  assert.equal(keep({ query: '  facture   id=42 ' }), true, 'extra spaces ignored');
  assert.equal(keep({ query: 'facture janvier' }), false, 'every word is required');
  assert.equal(keep({ query: 'zzz' }), false);
  assert.equal(keep({ query: '' }), true);
  assert.equal(keep({ query: '   ' }), true);
});

test('filter: host is exact, dates are inclusive, onlyPinned keeps the pinned ones', () => {
  const e = entry(5, { host: 'a.test', pinned: true, createdAt: 1000 });
  const keep = (f) => compileFilter(f)(e);
  assert.equal(keep({ host: 'a.test' }), true);
  assert.equal(keep({ host: 'A.TEST' }), true);
  assert.equal(keep({ host: 'b.test' }), false);
  assert.equal(keep({ host: 'a.tes' }), false);
  assert.equal(keep({ from: 1000 }), true);
  assert.equal(keep({ from: 1001 }), false);
  assert.equal(keep({ to: 1000 }), true);
  assert.equal(keep({ to: 999 }), false);
  assert.equal(keep({ from: 500, to: 1500 }), true);
  assert.equal(keep({ onlyPinned: true }), true);
  assert.equal(compileFilter({ onlyPinned: true })(entry(1)), false);
  assert.equal(keep({ query: 'shot 5', host: 'a.test', from: 1, to: 2000, onlyPinned: true }), true);
  assert.equal(keep({ query: 'shot 5', host: 'a.test', from: 1, to: 10, onlyPinned: true }), false, 'one failing condition is enough');
});

test('filter: a missing or invalid bound is no bound', () => {
  const e = entry(1, { createdAt: 5000 });
  for (const f of [{}, { from: null, to: null }, { from: undefined, to: undefined }, { from: NaN, to: NaN }, { from: 0, to: Infinity }, { from: -5 }]) {
    assert.equal(compileFilter(f)(e), true, JSON.stringify(f));
  }
});

test('isOpen: true when only the host (if anything) narrows the history', () => {
  assert.equal(isOpen(), true);
  assert.equal(isOpen({}), true);
  assert.equal(isOpen({ query: '  ', from: 0, to: Infinity, onlyPinned: false }), true);
  assert.equal(isOpen({ from: null, to: null }), true);
  assert.equal(isOpen({ query: 'a' }), false);
  assert.equal(isOpen({ from: 1 }), false);
  assert.equal(isOpen({ to: 10 }), false);
  assert.equal(isOpen({ onlyPinned: true }), false);
  assert.equal(isOpen({ host: 'a.test' }), true);
});

test('selectPage: most recent first, limited, with the next cursor and the total', () => {
  const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1));
  assert.deepEqual(selectPage(entries, {}, { limit: 4, before: null }), { ids: [10, 9, 8, 7], next: 7, total: 10 });
  assert.deepEqual(selectPage(entries, {}, { limit: 4, before: 7 }), { ids: [6, 5, 4, 3], next: 3, total: 10 });
  assert.deepEqual(selectPage(entries, {}, { limit: 4, before: 3 }), { ids: [2, 1], next: null, total: 10 });
});

test('selectPage: no next when the page is exactly the rest, none for an empty history', () => {
  const entries = [entry(1), entry(2), entry(3)];
  assert.deepEqual(selectPage(entries, {}, { limit: 3, before: null }), { ids: [3, 2, 1], next: null, total: 3 });
  assert.deepEqual(selectPage(entries, {}, { limit: 2, before: null }), { ids: [3, 2], next: 2, total: 3 });
  assert.deepEqual(selectPage([], {}, { limit: 5, before: null }), { ids: [], next: null, total: 0 });
  assert.deepEqual(selectPage(entries, {}, { limit: 5, before: 1 }), { ids: [], next: null, total: 3 });
});

test('selectPage: the filter applies before the page, ids with gaps are fine', () => {
  const entries = [entry(2, { host: 'x' }), entry(5, { host: 'y' }), entry(9, { host: 'x' }), entry(20, { host: 'x' }), entry(30, { host: 'y' })];
  assert.deepEqual(selectPage(entries, { host: 'x' }, { limit: 2, before: null }), { ids: [20, 9], next: 9, total: 3 });
  assert.deepEqual(selectPage(entries, { host: 'x' }, { limit: 2, before: 9 }), { ids: [2], next: null, total: 3 });
  assert.deepEqual(selectPage(entries, { host: 'z' }, { limit: 2, before: null }), { ids: [], next: null, total: 0 });
});

test('selectPage: walking the pages gives every match once, whatever the page size', () => {
  const entries = Array.from({ length: 137 }, (_, i) => entry(i * 3 + 1, { pinned: i % 4 === 0, q: i % 5 === 0 ? 'cafe' : 'tea' }));
  for (const limit of [1, 7, 60, 200]) {
    for (const filter of [{}, { onlyPinned: true }, { query: 'CAF\u00c9' }, { query: 'cafe', onlyPinned: true }]) {
      const seen = [];
      let before = null;
      let total = null;
      do {
        const page = selectPage(entries, filter, { limit, before });
        seen.push(...page.ids);
        total ??= page.total;
        assert.equal(page.total, total, 'total does not depend on the page');
        before = page.next;
      } while (before !== null);
      const expected = entries.filter(compileFilter(filter)).map((e) => e.id).reverse();
      assert.deepEqual(seen, expected, `limit ${limit} ${JSON.stringify(filter)}`);
      assert.equal(total, expected.length);
    }
  }
});

test('hostCounts: the most frequent first, ties by name, hosts without a name ignored', () => {
  const entries = [entry(1, { host: 'b.test' }), entry(2, { host: 'a.test' }), entry(3, { host: 'b.test' }), entry(4, { host: '' }), entry(5, { host: 'c.test' })];
  assert.deepEqual(hostCounts(entries), [{ host: 'b.test', count: 2 }, { host: 'a.test', count: 1 }, { host: 'c.test', count: 1 }]);
  assert.deepEqual(hostCounts([]), []);
});

// The repair compares WHICH shots the catalog lists, not only how many.
test('catalogMatches: the same shots, in the same order', () => {
  const list = [entry(1), entry(2), entry(5)];
  assert.equal(catalogMatches(list, [1, 2, 5]), true);
  assert.equal(catalogMatches([], []), true);
  assert.equal(catalogMatches(list, [1, 2]), false, 'a shot the catalog has and the store has not');
  assert.equal(catalogMatches(list, [1, 2, 5, 6]), false, 'a shot the store has and the catalog has not');
  assert.equal(catalogMatches(list, [1, 2, 6]), false, 'the same count, another shot');
  assert.equal(catalogMatches([entry(1), entry(1), entry(5)], [1, 2, 5]), false, 'a duplicate');
  assert.equal(catalogMatches(list.toReversed(), [1, 2, 5]), false, 'out of order');
});

// The title and the address are capped where a shot enters the database.
test('limitShotText: a title is cut at 300 characters and an address at 2048, shorter ones are untouched', () => {
  const out = limitShotText({ title: 't'.repeat(5000), url: `https://a.test/${'u'.repeat(2 * 1024 * 1024)}` });
  assert.equal(out.title.length, MAX_TITLE);
  assert.equal(out.url.length, MAX_URL);
  assert.equal(out.url.startsWith('https://a.test/u'), true);
  assert.equal(hostOf(out.url), 'a.test', 'the host survives the cut');
  assert.deepEqual(limitShotText({ title: 'Short', url: 'https://a.test/x' }), { title: 'Short', url: 'https://a.test/x' });
  assert.deepEqual(limitShotText({ title: 't'.repeat(MAX_TITLE), url: 'u'.repeat(MAX_URL) }), { title: 't'.repeat(MAX_TITLE), url: 'u'.repeat(MAX_URL) }, 'exactly at the limit');
  assert.deepEqual(limitShotText({ title: undefined, url: null }), { title: '', url: '' }, 'a missing text is empty');
  assert.deepEqual(limitShotText({ title: 42, url: 7 }), { title: '42', url: '7' }, 'anything else becomes text');
});

test('limitShotText: a cut never leaves half of a character (surrogate pair)', () => {
  const emoji = '\u{1F600}'; // two UTF-16 units
  assert.equal(limitShotText({ title: `${'a'.repeat(MAX_TITLE - 1)}${emoji}`, url: '' }).title, 'a'.repeat(MAX_TITLE - 1));
  assert.equal(limitShotText({ title: `${'a'.repeat(MAX_TITLE - 2)}${emoji}`, url: '' }).title.length, MAX_TITLE, 'a pair that fits is kept');
});

test('entryOf: the search key is bounded once the text is capped', () => {
  const { title, url } = limitShotText({ title: 'needle '.repeat(1000), url: `https://a.test/${'u'.repeat(1 << 21)}` });
  const e = entryOf({ id: 1, title, url, createdAt: 1, bytes: 1 });
  assert.ok(e.q.length <= MAX_TITLE + 1 + MAX_URL);
  assert.equal(e.host, 'a.test');
});
