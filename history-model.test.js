import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, GRID, PERIODS, bytesFrom, chunks, filterOf, gridLayout, hostChoices, isFiltered, meterState, moveIndex, periodFrom,
  purgeOptions, rangeIds, rowsOf, sameWord, scrollToShow, summarizeSelection, windowRows, withRange,
} from './history-model.js';

const E = String.fromCharCode(233); // e with an acute accent: the sources stay ASCII

// --- period and filter ---

test('periodFrom: today starts at local midnight, the others are rolling windows, "all" has no bound', () => {
  const now = new Date(2026, 9, 2, 15, 30, 12).getTime(); // local time
  assert.equal(periodFrom('today', now), new Date(2026, 9, 2).getTime());
  assert.equal(periodFrom('week', now), now - 7 * DAY);
  assert.equal(periodFrom('month', now), now - 30 * DAY);
  assert.equal(periodFrom('all', now), 0);
  assert.equal(periodFrom('nonsense', now), 0);
  assert.equal(periodFrom('today', new Date(2026, 9, 2, 0, 0, 0).getTime()), new Date(2026, 9, 2).getTime(), 'midnight sharp is today');
  assert.deepEqual([...PERIODS], ['all', 'today', 'week', 'month']);
});

test('filterOf: trims the text, fixes the date once, maps the period', () => {
  const now = Date.UTC(2026, 5, 15, 12);
  assert.deepEqual(filterOf({}, now), { query: '', host: '', from: 0, onlyPinned: false });
  assert.deepEqual(filterOf({ query: '  caf' + E + ' ', host: 'a.test', period: 'week', onlyPinned: true }, now), {
    query: 'caf' + E, host: 'a.test', from: now - 7 * DAY, onlyPinned: true,
  });
  assert.deepEqual(filterOf(undefined, now), filterOf({}, now));
});

test('isFiltered: only a real narrowing counts', () => {
  assert.equal(isFiltered({}), false);
  assert.equal(isFiltered({ query: '   ', host: '', period: 'all', onlyPinned: false }), false);
  assert.equal(isFiltered({ query: 'a' }), true);
  assert.equal(isFiltered({ host: 'a.test' }), true);
  assert.equal(isFiltered({ period: 'today' }), true);
  assert.equal(isFiltered({ onlyPinned: true }), true);
});

test('hostChoices: capped, but the selected host is always there', () => {
  const hosts = Array.from({ length: 10 }, (_, i) => ({ host: `h${i}.test`, count: 10 - i }));
  assert.equal(hostChoices(hosts, '', 4).length, 4);
  assert.deepEqual(hostChoices(hosts, 'h8.test', 4).map((h) => h.host), ['h0.test', 'h1.test', 'h2.test', 'h3.test', 'h8.test']);
  assert.deepEqual(hostChoices(hosts, 'h1.test', 4).map((h) => h.host), ['h0.test', 'h1.test', 'h2.test', 'h3.test']);
  assert.deepEqual(hostChoices(hosts, 'gone.test', 2), [hosts[0], hosts[1], { host: 'gone.test', count: 0 }]);
  assert.deepEqual(hostChoices([], '', 5), []);
});

// --- grid ---

test('gridLayout: as many columns as fit, at least one, rows have a fixed pitch', () => {
  const { minW, gap, cardH } = GRID;
  assert.deepEqual(gridLayout(0), { cols: 1, rowH: cardH + gap });
  assert.equal(gridLayout(minW).cols, 1);
  assert.equal(gridLayout(2 * minW + gap - 1).cols, 1);
  assert.equal(gridLayout(2 * minW + gap).cols, 2);
  assert.equal(gridLayout(1240).cols, Math.floor((1240 + gap) / (minW + gap)));
  assert.equal(gridLayout(-50).cols, 1);
  assert.deepEqual(gridLayout(500, { minW: 100, gap: 10, cardH: 50 }), { cols: 4, rowH: 60 });
});

test('windowRows: the visible rows plus the overscan, cut to the existing rows', () => {
  const o = { rowH: 100, rows: 50, overscan: 2 };
  assert.deepEqual(windowRows({ ...o, scrollTop: 0, viewH: 300 }), { first: 0, last: 4 }); // rows 0-2 visible, 3-4 overscan
  assert.deepEqual(windowRows({ ...o, scrollTop: 1000, viewH: 300 }), { first: 8, last: 14 });
  assert.deepEqual(windowRows({ ...o, scrollTop: 1050, viewH: 300 }), { first: 8, last: 15 }); // rows 10-13 touched
  assert.deepEqual(windowRows({ ...o, scrollTop: 99999, viewH: 300 }), { first: 49, last: 49 });
  assert.deepEqual(windowRows({ ...o, scrollTop: -40, viewH: 300 }), { first: 0, last: 4 });
  assert.deepEqual(windowRows({ ...o, rows: 0, scrollTop: 0, viewH: 300 }), { first: 0, last: -1 });
  assert.deepEqual(windowRows({ ...o, rows: 2, scrollTop: 0, viewH: 5000 }), { first: 0, last: 1 });
});

test('windowRows: the number of rows kept never grows with the number of shots', () => {
  for (const rows of [10, 1000, 100_000]) {
    for (const scrollTop of [0, 777, 1_234_567]) {
      const { first, last } = windowRows({ scrollTop, viewH: 800, rowH: 198, rows });
      assert.ok(last - first + 1 <= Math.ceil(800 / 198) + 1 + 2 * 2 + 1, `rows ${rows} scroll ${scrollTop}`);
    }
  }
});

test('rowsOf and scrollToShow', () => {
  assert.equal(rowsOf(0, 5), 0);
  assert.equal(rowsOf(1, 5), 1);
  assert.equal(rowsOf(10, 5), 2);
  assert.equal(rowsOf(11, 5), 3);
  assert.equal(rowsOf(11, 0), 11, 'no column count behaves as one');
  const o = { cols: 4, rowH: 100, gap: 10, viewH: 300 };
  assert.equal(scrollToShow({ ...o, index: 0, scrollTop: 0 }), 0, 'already visible');
  assert.equal(scrollToShow({ ...o, index: 4, scrollTop: 0 }), 0, 'second row, visible');
  assert.equal(scrollToShow({ ...o, index: 12, scrollTop: 0 }), 90, 'row 3 spans 300-390: scroll down by 90');
  assert.equal(scrollToShow({ ...o, index: 0, scrollTop: 500 }), 0, 'above: its top');
  assert.equal(scrollToShow({ ...o, index: 20, scrollTop: 500 }), 500, 'row 5 spans 500-590: visible');
});

// --- keyboard ---

test('moveIndex: arrows move by one card or one row, never out of the list', () => {
  const o = { cols: 4, count: 10 };
  assert.equal(moveIndex('ArrowRight', 0, o), 1);
  assert.equal(moveIndex('ArrowRight', 9, o), 9);
  assert.equal(moveIndex('ArrowLeft', 0, o), 0);
  assert.equal(moveIndex('ArrowLeft', 5, o), 4);
  assert.equal(moveIndex('ArrowDown', 1, o), 5);
  assert.equal(moveIndex('ArrowDown', 5, o), 9);
  assert.equal(moveIndex('ArrowDown', 6, o), 9, 'the last row is shorter: its last card');
  assert.equal(moveIndex('ArrowDown', 9, o), 9, 'already on the last row');
  assert.equal(moveIndex('ArrowUp', 5, o), 1);
  assert.equal(moveIndex('ArrowUp', 2, o), 2, 'already on the first row');
});

test('moveIndex: Home, End, PageUp, PageDown, and keys that are not moves', () => {
  const o = { cols: 4, count: 10, pageRows: 2 };
  assert.equal(moveIndex('Home', 6, o), 4);
  assert.equal(moveIndex('End', 6, o), 7);
  assert.equal(moveIndex('End', 9, o), 9);
  assert.equal(moveIndex('End', 8, o), 9, 'a short last row ends at the last card');
  assert.equal(moveIndex('Home', 6, { ...o, ctrl: true }), 0);
  assert.equal(moveIndex('End', 1, { ...o, ctrl: true }), 9);
  assert.equal(moveIndex('PageDown', 1, o), 9);
  assert.equal(moveIndex('PageDown', 3, o), 9);
  assert.equal(moveIndex('PageUp', 9, o), 1);
  assert.equal(moveIndex('PageUp', 3, o), 0);
  assert.equal(moveIndex('a', 3, o), null);
  assert.equal(moveIndex('ArrowDown', 0, { cols: 4, count: 0 }), null);
  assert.equal(moveIndex('ArrowDown', 0, { cols: 1, count: 1 }), 0);
});

// --- selection ---

test('rangeIds: both ends included, either order, cut to the list', () => {
  const ids = [50, 40, 30, 20, 10];
  assert.deepEqual(rangeIds(ids, 1, 3), [40, 30, 20]);
  assert.deepEqual(rangeIds(ids, 3, 1), [40, 30, 20]);
  assert.deepEqual(rangeIds(ids, 2, 2), [30]);
  assert.deepEqual(rangeIds(ids, -5, 1), [50, 40]);
  assert.deepEqual(rangeIds(ids, 3, 99), [20, 10]);
  assert.deepEqual(rangeIds([], 0, 3), []);
});

test('withRange: adds or removes a range without touching the input or the rest of the selection', () => {
  const ids = [9, 8, 7, 6, 5, 4];
  const start = new Set([4, 100]);
  const next = withRange(start, ids, 1, 3);
  assert.deepEqual([...next].sort((a, b) => a - b), [4, 6, 7, 8, 100]);
  assert.deepEqual([...start].sort((a, b) => a - b), [4, 100], 'the input is not modified');
  assert.deepEqual([...withRange(next, ids, 3, 1, false)].sort((a, b) => a - b), [4, 100]);
  assert.deepEqual([...withRange(new Set(), ids, -1, 2)].sort((a, b) => a - b), [7], 'no anchor: just the clicked card');
  assert.deepEqual([...withRange(new Set(), ids, 5, 4)].sort((a, b) => a - b), [4, 5]);
});

test('summarizeSelection: counts, size, pinned and edited among the selected entries', () => {
  const entries = [
    { id: 1, bytes: 100, pinned: true, edited: false },
    { id: 2, bytes: 200, pinned: false, edited: true },
    { id: 3, bytes: 400, pinned: true, edited: true },
    { id: 4, bytes: 800, pinned: false, edited: false },
    { id: 5, bytes: -5, pinned: false, edited: false },
  ];
  assert.deepEqual(summarizeSelection(entries, new Set([1, 3, 4, 5, 99])), { count: 4, bytes: 1300, pinned: 2, edited: 1 });
  assert.deepEqual(summarizeSelection(entries, new Set()), { count: 0, bytes: 0, pinned: 0, edited: 0 });
});

// --- sizes ---

test('bytesFrom: a number and a unit, with a comma or a point, 0 for anything invalid', () => {
  assert.equal(bytesFrom(500, 'MB'), 500 * 1000 ** 2);
  assert.equal(bytesFrom('1.5', 'GB'), 1.5 * 1000 ** 3);
  assert.equal(bytesFrom('1,5', 'GB'), 1.5 * 1000 ** 3);
  assert.equal(bytesFrom(' 2 ', 'GB'), 2 * 1000 ** 3);
  assert.equal(bytesFrom('', 'GB'), 0);
  assert.equal(bytesFrom('abc', 'GB'), 0);
  assert.equal(bytesFrom(0, 'GB'), 0);
  assert.equal(bytesFrom(-3, 'GB'), 0);
  assert.equal(bytesFrom(Infinity, 'GB'), 0);
  assert.equal(bytesFrom(1e9, 'GB'), 2 ** 40, 'capped at what settings.js accepts');
});

test('purgeOptions: a switched-off or invalid criterion is not applied', () => {
  const on = { ageOn: true, days: '30', capOn: true, size: '1', unit: /** @type {'MB' | 'GB'} */ ('GB') };
  assert.deepEqual(purgeOptions(on), { olderThanDays: 30, maxBytes: 1000 ** 3 });
  assert.deepEqual(purgeOptions({ ...on, ageOn: false }), { olderThanDays: 0, maxBytes: 1000 ** 3 });
  assert.deepEqual(purgeOptions({ ...on, capOn: false }), { olderThanDays: 30, maxBytes: 0 });
  assert.deepEqual(purgeOptions({ ...on, days: '0', size: '0' }), { olderThanDays: 0, maxBytes: 0 });
  assert.deepEqual(purgeOptions({ ...on, days: 'x', size: 'x' }), { olderThanDays: 0, maxBytes: 0 });
  assert.deepEqual(purgeOptions({ ...on, days: '2.9' }), { olderThanDays: 2, maxBytes: 1000 ** 3 });
  assert.deepEqual(purgeOptions({ ...on, days: '99999' }).olderThanDays, 3650);
  assert.deepEqual(purgeOptions({ ...on, unit: 'MB', size: '250' }).maxBytes, 250 * 1000 ** 2);
});

test('meterState: no cap, no fill; warning from 85%, full at the cap, never above 1', () => {
  assert.deepEqual(meterState(100, 0), { ratio: 0, level: 'none' });
  assert.deepEqual(meterState(100, -1), { ratio: 0, level: 'none' });
  assert.deepEqual(meterState(50, 100), { ratio: 0.5, level: 'ok' });
  assert.deepEqual(meterState(85, 100), { ratio: 0.85, level: 'warn' });
  assert.deepEqual(meterState(100, 100), { ratio: 1, level: 'full' });
  assert.deepEqual(meterState(250, 100), { ratio: 1, level: 'full' });
  assert.deepEqual(meterState(-5, 100), { ratio: 0, level: 'ok' });
});

test('sameWord: case, accents and spaces around are ignored; an empty word never matches', () => {
  assert.equal(sameWord('delete', 'DELETE'), true);
  assert.equal(sameWord('  Delete ', 'delete'), true);
  assert.equal(sameWord('supprimer', 'SUPPRIMER'), true);
  assert.equal(sameWord('d' + E + 'truire', 'DETRUIRE'), true);
  assert.equal(sameWord('delet', 'delete'), false);
  assert.equal(sameWord('', ''), false);
  assert.equal(sameWord('anything', ''), false);
});

test('chunks: pieces of at most `size`, in order, nothing lost', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 3), []);
  assert.deepEqual(chunks([1, 2], 5), [[1, 2]]);
  const big = Array.from({ length: 1001 }, (_, i) => i);
  assert.deepEqual(chunks(big, 250).map((c) => c.length), [250, 250, 250, 250, 1]);
  assert.deepEqual(chunks(big, 250).flat(), big);
});
