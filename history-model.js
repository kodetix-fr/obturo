// Pure logic of the history view (no chrome.*, IndexedDB or DOM): `node --test` covers it. The view (history-view.js) and the
// settings block (history-settings.js) hold the DOM and the I/O, this file holds every calculation they need: the date
// ranges of the period filter, the geometry of the windowed grid, the keyboard moves, the selection ranges, the purge
// options. Sizes and plurals as texts are i18n.js (fmtBytes, plural).
import { clamp } from './pure.js';

export const DAY = 24 * 60 * 60 * 1000;

/** Shots read per page of the history view. */
export const PAGE = 72;
/** Hosts offered by the host filter, the most frequent first. */
// ponytail: the host menu lists the 300 most frequent hosts (a native <select>); the search box finds the others, a typeahead would list them all.
const MAX_HOSTS = 300;

// --- Filters ---

export const PERIODS = /** @type {const} */ (['all', 'today', 'week', 'month']);

/**
 * Oldest capture date kept by a period, as a timestamp (ms). 0 = no bound. "Today" starts at local midnight; the others
 * are rolling windows.
 * @param {string} period one of PERIODS (anything else = no bound)
 * @param {number} [now]
 */
export function periodFrom(period, now = Date.now()) {
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === 'week') return now - 7 * DAY;
  if (period === 'month') return now - 30 * DAY;
  return 0;
}

/**
 * What the user typed and picked, as the filter of db.queryShots. The date is fixed at the time of the call: the pages of one
 * search all use the same bound.
 * @param {{ query?: string, host?: string, period?: string, onlyPinned?: boolean }} state
 * @param {number} [now]
 * @returns {{ query: string, host: string, from: number, onlyPinned: boolean }}
 */
export function filterOf({ query = '', host = '', period = 'all', onlyPinned = false } = {}, now = Date.now()) {
  return { query: String(query).trim(), host, from: periodFrom(period, now), onlyPinned: !!onlyPinned };
}

/** True when the state narrows the history at all (it tells "no capture yet" from "nothing matches"). @param {Parameters<typeof filterOf>[0]} state */
export const isFiltered = (state = {}) => !!(String(state.query ?? '').trim() || state.host || (state.period && state.period !== 'all') || state.onlyPinned);

/**
 * The hosts to offer: at most `max`, and always the selected one (it may be rare).
 * @param {{ host: string, count: number }[]} hosts most frequent first
 * @param {string} selected
 * @param {number} [max]
 */
export function hostChoices(hosts, selected = '', max = MAX_HOSTS) {
  const top = hosts.slice(0, max);
  if (selected && !top.some((h) => h.host === selected)) top.push(hosts.find((h) => h.host === selected) ?? { host: selected, count: 0 });
  return top;
}

// --- Windowed grid ---

/** Geometry of a card, in px: minimum width, gap, height. library.css reads the same numbers through custom properties. */
export const GRID = Object.freeze({ minW: 208, gap: 14, cardH: 184 });
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 2;

/**
 * Columns and row pitch for a grid `width` px wide. Cards share the width equally.
 * @param {number} width
 * @param {{ minW: number, gap: number, cardH: number }} [g]
 * @returns {{ cols: number, rowH: number }}
 */
export function gridLayout(width, g = GRID) {
  const cols = Math.max(1, Math.floor((Math.max(0, width) + g.gap) / (g.minW + g.gap)));
  return { cols, rowH: g.cardH + g.gap };
}

/**
 * The rows to keep in the DOM: the visible ones and `overscan` more on each side. { first: 0, last: -1 } when there is no row.
 * @param {{ scrollTop: number, viewH: number, rowH: number, rows: number, overscan?: number }} o
 * @returns {{ first: number, last: number }}
 */
export function windowRows({ scrollTop, viewH, rowH, rows, overscan = OVERSCAN }) {
  if (rows <= 0) return { first: 0, last: -1 };
  const top = Math.floor(Math.max(0, scrollTop) / rowH);
  const bottom = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewH)) / rowH) - 1;
  const first = clamp(top - overscan, 0, rows - 1);
  const last = clamp(bottom + overscan, first, rows - 1);
  return { first, last };
}

/** Number of rows of `count` cards in `cols` columns. @param {number} count @param {number} cols */
export const rowsOf = (count, cols) => Math.ceil(count / Math.max(1, cols));

/**
 * Scroll position that shows card `index` entirely, or the current one if it is already visible.
 * @param {{ index: number, cols: number, rowH: number, gap: number, scrollTop: number, viewH: number }} o
 */
export function scrollToShow({ index, cols, rowH, gap, scrollTop, viewH }) {
  const row = Math.floor(index / Math.max(1, cols));
  const top = row * rowH;
  const bottom = top + rowH - gap;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewH) return Math.max(0, bottom - viewH);
  return scrollTop;
}

// --- Keyboard ---

/**
 * Where an arrow key (or Home, End, PageUp, PageDown) takes the focus in a grid of `count` cards in `cols` columns. Returns the
 * same index when the key does not move, and null for a key that is not a move.
 * @param {string} key
 * @param {number} index current card
 * @param {{ cols: number, count: number, pageRows?: number, ctrl?: boolean }} o `ctrl`: Home and End go to the first and last card
 * @returns {number | null}
 */
export function moveIndex(key, index, { cols, count, pageRows = 3, ctrl = false }) {
  if (count <= 0) return null;
  const last = count - 1;
  const inRange = (n) => clamp(n, 0, last);
  switch (key) {
    case 'ArrowLeft': return inRange(index - 1);
    case 'ArrowRight': return inRange(index + 1);
    case 'ArrowUp': return index - cols >= 0 ? index - cols : index;
    case 'ArrowDown':
      if (index + cols <= last) return index + cols;
      return Math.floor(index / cols) < Math.floor(last / cols) ? last : index; // a shorter last row: its last card
    case 'PageUp': return inRange(index - pageRows * cols);
    case 'PageDown': return inRange(index + pageRows * cols);
    case 'Home': return ctrl ? 0 : index - (index % cols);
    case 'End': return ctrl ? last : inRange(index - (index % cols) + cols - 1);
    default: return null;
  }
}

// --- Selection ---

/**
 * The ids from position `a` to position `b` (both included, in either order) of the displayed list. Out-of-range positions are cut.
 * @param {number[]} ids
 * @param {number} a
 * @param {number} b
 */
export function rangeIds(ids, a, b) {
  if (!ids.length) return [];
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(ids.length - 1, Math.max(a, b));
  return ids.slice(lo, hi + 1);
}

/**
 * A new selection with the range from `anchor` to `index` added (`on`) or taken out.
 * @param {Set<number>} selected
 * @param {number[]} ids displayed list
 * @param {number} anchor
 * @param {number} index
 * @param {boolean} [on]
 */
export function withRange(selected, ids, anchor, index, on = true) {
  const next = new Set(selected);
  for (const id of rangeIds(ids, anchor < 0 ? index : anchor, index)) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * What the selection holds, from the catalog entries of the selected shots.
 * @param {{ id: number, bytes: number, pinned: boolean, edited: boolean }[]} entries every entry of the history
 * @param {Set<number>} selected
 * @returns {{ count: number, bytes: number, pinned: number, edited: number }}
 */
export function summarizeSelection(entries, selected) {
  const out = { count: 0, bytes: 0, pinned: 0, edited: 0 };
  for (const e of entries) {
    if (!selected.has(e.id)) continue;
    out.count++;
    out.bytes += e.bytes > 0 ? e.bytes : 0;
    if (e.pinned) out.pinned++;
    if (e.edited) out.edited++;
  }
  return out;
}

// --- Sizes and texts ---

const FACTOR = { MB: 1024 ** 2, GB: 1024 ** 3 };

/**
 * A size typed as a number and a unit, in bytes. 0 for anything that is not a positive number.
 * @param {unknown} value a number or a string ("1,5" and "1.5" both read)
 * @param {'MB' | 'GB'} unit
 */
export function bytesFrom(value, unit) {
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  const bytes = Math.round(n * (FACTOR[unit] ?? 0));
  return Number.isFinite(bytes) && bytes > 0 ? Math.min(bytes, 2 ** 40) : 0;
}

/**
 * The options of db.purgeNow from the purge dialog. A switched-off or invalid criterion is 0 (= not applied).
 * @param {{ ageOn: boolean, days: unknown, capOn: boolean, size: unknown, unit: 'MB' | 'GB' }} form
 * @returns {{ olderThanDays: number, maxBytes: number }}
 */
export function purgeOptions({ ageOn, days, capOn, size, unit }) {
  const d = Math.floor(Number(days));
  return {
    olderThanDays: ageOn && Number.isFinite(d) && d >= 1 ? Math.min(d, 3650) : 0,
    maxBytes: capOn ? bytesFrom(size, unit) : 0,
  };
}

/**
 * Fill of the storage gauge. `level` is 'full' once the cap is reached, 'warn' from 85%. No cap, no fill.
 * @param {number} bytes
 * @param {number} cap 0 = no cap
 * @returns {{ ratio: number, level: 'none' | 'ok' | 'warn' | 'full' }}
 */
export function meterState(bytes, cap) {
  if (!(cap > 0)) return { ratio: 0, level: 'none' };
  const ratio = clamp(bytes / cap, 0, 1);
  return { ratio, level: ratio >= 1 ? 'full' : ratio >= 0.85 ? 'warn' : 'ok' };
}

/**
 * The word typed to confirm the deletion of everything matches (case, accents and spaces around do not matter).
 * @param {string} typed
 * @param {string} word
 */
export const sameWord = (typed, word) => {
  const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  return fold(word) !== '' && fold(typed) === fold(word);
};

/**
 * Splits a list in chunks of `size` (the bulk deletion works one chunk per transaction so that it can report progress).
 * @template T
 * @param {T[]} list
 * @param {number} size
 * @returns {T[][]}
 */
export function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
