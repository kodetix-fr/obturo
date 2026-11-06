// The history view: the whole history in a large modal sheet (library.html, #history), as a grid of cards.
// Loaded on first use by library.js (a dynamic import, warmed up when the page is idle), so it costs nothing at startup.
//
// How it stays fast with thousands of shots (measured by `npm run bench`):
//  - the shots arrive by pages of PAGE (db.queryShots, from the most recent), the next page when a sentinel at the end of the
//    list nears the viewport (IntersectionObserver);
//  - only the rows in view, plus two on each side, are in the DOM (never more than a couple of hundred cards): the rest of the
//    height is the padding of the grid. Card elements are recycled, and so are their thumbnail object URLs (revoked as soon as
//    a card leaves the window);
//  - a thumbnail that does not exist yet is made on demand, for the visible cards only, two at a time (library.js makeThumb).
//
// What the rest of the page can rely on (the export hooks into it):
//  - getSelectedIds(): the ids of the selected captures, most recent first;
//  - a 'selection-changed' event on `document` each time the selection changes, with detail { ids, count };
//  - <div id="bulkExtra"> in the selection bar: empty, whatever is put in it shows between Unpin and Delete.
import { getShot, listEntries, listHosts, queryShots, setPinnedMany, storageUsage } from './db.js';
import {
  GRID, PAGE, filterOf, gridLayout, hostChoices, isFiltered, moveIndex, rowsOf, scrollToShow, windowRows, withRange,
} from './history-model.js';
import { confirmDialog, countText, deleteWithProgress, deleteWords, guardWith, notify, askPurge } from './history-dialogs.js';
import { fmtBytes, formatDate, formatNumber, plural, t } from './i18n.js';
import { icon, setI18n } from './dom-i18n.js';
import { clamp } from './pure.js';

/** @typedef {import('./db.js').Shot} Shot */
/**
 * What the library gives the view.
 * @typedef {object} Deps
 * @property {() => boolean} readOnly Another tab holds the editing lock: nothing may be opened, pinned or deleted.
 * @property {(shot: Shot) => void} openShot Opens a capture in the editor (the sheet is already closed).
 * @property {(shot: Shot) => Promise<Blob | null>} makeThumb Makes and stores the missing thumbnail of a shot.
 * @property {(ids: number[], pinned: boolean) => void} pinned Tells the library that these shots were pinned or unpinned here.
 * @property {() => Promise<unknown>} flush Writes what the editor still holds, so that the list is up to date.
 * @property {() => void} openSettings Opens the settings (from the storage figures in the footer).
 */
/**
 * One card of the window, with the parts that change from one shot to the next.
 * @typedef {object} Card
 * @property {HTMLLIElement} li
 * @property {HTMLButtonElement} open
 * @property {HTMLElement} thumb
 * @property {HTMLImageElement} img
 * @property {HTMLElement} title
 * @property {HTMLElement} sub
 * @property {HTMLInputElement} check
 * @property {HTMLButtonElement} pin
 * @property {HTMLElement} badge
 * @property {number} id Shot shown, 0 when the card is in the pool.
 * @property {string} url Object URL of the thumbnail shown, '' if none.
 */

const OVERSCAN_MARGIN = '0px 0px 900px 0px'; // the next page is asked for when the end is this close
const SEARCH_DELAY_MS = 150;
const STATUS_MS = 5000;
const THUMBS_AT_ONCE = 2;
const DOT = ` ${String.fromCharCode(183)} `;

/** @type {Deps} */
let deps;
/** @type {Record<string, any>} */
const ui = {};
let wired = false;

// What is asked for, what was read
const state = { query: '', host: '', period: 'all', onlyPinned: false };
let filter = filterOf(state);
/** @type {Shot[]} */
let items = [];
/** @type {number | null} */
let next = null;
let total = 0;
let loaded = false;
let gen = 0; // each new search or reload; an answer from an older one is dropped
let loadingMore = false;
let selection = new Set();
let anchor = -1; // position of the last card clicked, where a range starts
let active = 0; // position of the card that holds the keyboard
let selfChange = false; // this view caused the 'obturo:history-changed' it is receiving
/** @type {IntersectionObserver | null} */
let endWatcher = null;

// Geometry of the grid, and what is in the DOM
let cols = 1;
let rowH = GRID.cardH + GRID.gap;
let gap = /** @type {number} */ (GRID.gap);
let padTop = 0;
const shown = { first: 0, last: -1, cols: 0 }; // positions of the cards in the DOM
/** @type {Map<number, Card>} */
const cards = new Map();
/** @type {Card[]} */
const pool = [];
/** @type {Map<number, Card>} */
const byId = new Map();

// --- Setup ---

/**
 * Gives the view what it needs from the library. Cheap: called once, when the module is loaded.
 * @param {Deps} d
 */
export function setup(d) {
  deps = d;
  guardWith(d.readOnly);
  if (!wired) wire();
}

const isOpen = () => !!ui.dialog?.open;

/** The ids of the selected captures, most recent first. */
export const getSelectedIds = () => [...selection].sort((a, b) => b - a);

function wire() {
  wired = true;
  for (const [key, id] of Object.entries({
    dialog: 'history', count: 'hvCount', query: 'hvQuery', close: 'hvClose', filters: 'hvFilters', host: 'hvHost', period: 'hvPeriod',
    pinned: 'hvPinned', bulk: 'hvBulk', selCount: 'hvSelCount', selectAll: 'hvSelectAll', clear: 'hvClear', pin: 'hvPin', unpin: 'hvUnpin',
    del: 'hvDelete', scroll: 'hvScroll', grid: 'hvGrid', sentinel: 'hvSentinel', more: 'hvMore', state: 'hvState', stateTitle: 'hvStateTitle',
    stateHint: 'hvStateHint', stateAction: 'hvStateAction', status: 'hvStatus', purge: 'hvPurge', storage: 'hvStorage', storageText: 'hvStorageText',
  })) ui[key] = document.getElementById(id);

  ui.query.placeholder = t('hist.search.placeholder');
  ui.close.addEventListener('click', closeHistory);
  ui.dialog.addEventListener('close', onClosed);
  document.addEventListener('keydown', onDialogKeydown); // not on the sheet: the focus may be nowhere (a button that went away)

  // search and filters
  let timer = 0;
  ui.query.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(applyFilters, SEARCH_DELAY_MS);
  });
  ui.query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); applyFilters(); } });
  ui.host.addEventListener('change', applyFilters);
  ui.period.addEventListener('change', applyFilters);
  ui.pinned.addEventListener('click', () => {
    ui.pinned.setAttribute('aria-pressed', String(ui.pinned.getAttribute('aria-pressed') !== 'true'));
    applyFilters();
  });
  ui.stateAction.addEventListener('click', () => (ui.state.dataset.state === 'error' ? load() : clearFilters()));

  // selection bar
  ui.clear.addEventListener('click', () => { clearSelection(); focusActive(); });
  ui.selectAll.addEventListener('click', selectAllResults);
  ui.pin.addEventListener('click', () => setPins(getSelectedIds(), true));
  ui.unpin.addEventListener('click', () => setPins(getSelectedIds(), false));
  ui.del.addEventListener('click', () => deleteShotsAsk(getSelectedIds()));
  ui.storage.addEventListener('click', () => deps.openSettings());
  ui.purge.addEventListener('click', () => { if (!deps.readOnly()) askPurge().catch((e) => console.error('Obturo: purge', e)); });

  // the grid: one listener each, for every card
  ui.grid.addEventListener('click', onGridClick);
  ui.grid.addEventListener('keydown', onGridKeydown);
  ui.grid.addEventListener('keyup', (e) => { if (e.key === ' ' && e.target.closest?.('.open')) e.preventDefault(); }); // Space selects, it does not click
  let scheduled = false;
  ui.scroll.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; renderWindow(); });
  }, { passive: true });
  new ResizeObserver(onResize).observe(ui.scroll);
  endWatcher = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { root: ui.scroll, rootMargin: OVERSCAN_MARGIN });
  endWatcher.observe(ui.sentinel);

  // the history changed elsewhere (a purge, a capture from another tab...)
  document.addEventListener('obturo:history-changed', () => {
    if (selfChange || !isOpen()) return;
    load({ keepScroll: true });
    fillHosts();
    fillStorage();
  });
  addEventListener('focus', softRefresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) softRefresh(); });
}

// --- Open, close ---

// ponytail: the sheet reads the history again, from the top, each time it opens (only the filters are kept); remember the scroll position and the pages read if coming back to the same place matters.
/** Opens the sheet on the history (the filters of the last visit are kept) and reads the first page. */
export async function openHistory() {
  performance.mark('obturo:history-open');
  if (!ui.dialog.open) ui.dialog.showModal();
  ui.query.focus();
  await Promise.resolve(deps.flush()).catch(() => {}); // the editor writes its last change first: the list is up to date
  await load();
  requestAnimationFrame(() => performance.mark('obturo:history-painted'));
  setTimeout(() => { fillHosts(); fillStorage(); }, 0); // after the first paint
  status(deps.readOnly() ? t('hist.readonly') : '', true);
}

export function closeHistory() {
  if (ui.dialog?.open) ui.dialog.close();
}

function onClosed() {
  gen++; // answers still on their way are dropped
  for (const card of cards.values()) release(card);
  cards.clear();
  shown.first = 0; shown.last = -1; shown.cols = 0;
  ui.grid.replaceChildren();
  items = [];
  next = null;
  loaded = false;
  if (selection.size) {
    selection = new Set();
    emitSelection();
  }
  updateBulk();
  anchor = -1;
  active = 0;
  clearTimeout(statusTimer);
  ui.status.textContent = '';
  wantThumb.clear();
}

/** Re-labels what is on screen after a language change (the static texts follow on their own: dom-i18n.js). */
export function relocalize() {
  if (!wired) return;
  ui.query.placeholder = t('hist.search.placeholder');
  if (!isOpen()) return;
  renderWindow(true);
  updateCount();
  updateBulk();
  fillStorage();
}

// --- Reading ---

function readControls() {
  state.query = ui.query.value;
  state.host = ui.host.value;
  state.period = ui.period.querySelector('input:checked')?.value ?? 'all';
  state.onlyPinned = ui.pinned.getAttribute('aria-pressed') === 'true';
}

function applyFilters() {
  readControls();
  load();
}

function clearFilters() {
  ui.query.value = '';
  ui.host.value = '';
  ui.pinned.setAttribute('aria-pressed', 'false');
  const all = ui.period.querySelector('input[value="all"]');
  if (all) all.checked = true;
  applyFilters();
  ui.query.focus();
}

/**
 * Reads the first page for the current search and shows it.
 * @param {{ keepScroll?: boolean, keepSelection?: boolean }} [o]
 */
async function load({ keepScroll = false, keepSelection = false } = {}) {
  const mine = ++gen;
  filter = filterOf(state);
  const slow = window.setTimeout(() => { if (mine === gen && !items.length) showState('loading'); }, 200);
  // a reload that keeps the scroll position reads as many shots as were on screen's way, so the position still exists
  const limit = keepScroll ? clamp(items.length, PAGE, 1000) : PAGE;
  /** @type {Awaited<ReturnType<typeof queryShots>>} */
  let page;
  try {
    page = await queryShots({ ...filter, limit });
  } catch (e) {
    clearTimeout(slow);
    if (mine !== gen) return;
    console.error('Obturo: history read failed', e);
    items = [];
    next = null;
    total = 0;
    loaded = false;
    clearWindow();
    showState('error');
    updateCount();
    return;
  }
  clearTimeout(slow);
  if (mine !== gen) return;
  const top = keepScroll ? ui.scroll.scrollTop : 0;
  items = page.items;
  next = page.next;
  total = page.total;
  loaded = true;
  loadingMore = false;
  ui.more.hidden = true;
  if (!keepSelection && selection.size) {
    selection = new Set();
    emitSelection();
  }
  anchor = -1;
  active = keepScroll ? Math.min(active, Math.max(0, items.length - 1)) : 0;
  showStateForList();
  layout();
  ui.scroll.scrollTop = top;
  renderWindow(true);
  updateCount();
  updateBulk();
  watchEnd();
  performance.mark('obturo:history-rendered');
}

async function loadMore() {
  if (!next || loadingMore || !loaded) return;
  loadingMore = true;
  ui.more.hidden = false;
  const mine = gen;
  try {
    const page = await queryShots({ ...filter, limit: PAGE, before: next });
    if (mine !== gen) return;
    items = items.concat(page.items);
    next = page.next;
    total = page.total;
    renderWindow(true);
    updateCount();
  } catch (e) {
    console.error('Obturo: history page failed', e);
    if (mine === gen) status(t('hist.error.title'));
    return;
  } finally {
    if (mine === gen) {
      loadingMore = false;
      ui.more.hidden = true;
      watchEnd();
    }
  }
}

// The observer reports a change of state only: after a page arrives, or the list shrinks, the end may still be near. Observing
// the sentinel again makes it report where it stands.
function watchEnd() {
  endWatcher?.unobserve(ui.sentinel);
  endWatcher?.observe(ui.sentinel);
}

// A capture may have been added from another tab while this one was in the background.
async function softRefresh() {
  if (!isOpen() || !loaded) return;
  try {
    const page = await queryShots({ ...filter, limit: 1 });
    if (isOpen() && (page.total !== total || page.items[0]?.id !== items[0]?.id)) load({ keepScroll: true, keepSelection: true });
  } catch (e) {
    console.error('Obturo: history refresh failed', e);
  }
}

async function fillHosts() {
  try {
    const hosts = hostChoices(await listHosts(), state.host);
    const first = ui.host.options[0];
    ui.host.replaceChildren(first, ...hosts.map(({ host, count }) => {
      const option = document.createElement('option');
      option.value = host;
      option.textContent = `${host} (${formatNumber(count)})`;
      return option;
    }));
    ui.host.value = state.host;
  } catch (e) {
    console.error('Obturo: hosts unavailable', e);
  }
}

async function fillStorage() {
  try {
    const usage = await storageUsage();
    ui.storageText.textContent = `${countText(usage.count)}${DOT}${fmtBytes(usage.bytes)}`;
  } catch {
    ui.storageText.textContent = '';
  }
}

// --- States and texts ---

/** @param {'loading' | 'empty' | 'none' | 'error' | null} kind */
function showState(kind) {
  ui.state.hidden = !kind;
  ui.scroll.hidden = !!kind && kind !== 'loading';
  if (!kind) return;
  const set = {
    loading: ['loading', 'state.loading', '', ''],
    empty: ['empty', 'state.empty', 'state.empty.hint', ''],
    none: ['empty', 'hist.none.title', 'hist.none.hint', 'hist.none.clear'],
    error: ['error', 'hist.error.title', 'hist.error.hint', 'hist.error.retry'],
  }[kind];
  ui.state.dataset.state = set[0];
  setI18n(ui.stateTitle, set[1]);
  setI18n(ui.stateHint, set[2] || undefined);
  ui.stateHint.hidden = !set[2];
  setI18n(ui.stateAction, set[3] || undefined);
  ui.stateAction.hidden = !set[3];
}

function showStateForList() {
  showState(items.length ? null : isFiltered(state) ? 'none' : 'empty');
}

function updateCount() {
  const filtered = isFiltered(state);
  ui.count.textContent = !loaded || (!total && !filtered) ? ''
    : filtered ? plural(total, 'hist.found.one', 'hist.found.other') : plural(total, 'hist.count.one', 'hist.count.other');
}

let statusTimer = 0;
/** A short message in the footer (it fades after a few seconds unless `sticky`). @param {string} text @param {boolean} [sticky] */
function status(text, sticky = false) {
  clearTimeout(statusTimer);
  ui.status.textContent = text;
  if (text && !sticky) statusTimer = window.setTimeout(() => { ui.status.textContent = ''; }, STATUS_MS);
}

// --- The window of cards ---

// The geometry of the grid: the columns that fit, the pitch of a row. The card height and the gap are those of library.css.
function layout() {
  const css = getComputedStyle(ui.dialog);
  const cardH = parseFloat(css.getPropertyValue('--hv-card-h')) || GRID.cardH;
  gap = parseFloat(css.getPropertyValue('--hv-gap')) || GRID.gap;
  padTop = parseFloat(getComputedStyle(ui.scroll).paddingTop) || 0;
  ({ cols, rowH } = gridLayout(ui.grid.clientWidth, { minW: GRID.minW, gap, cardH }));
  ui.grid.style.setProperty('--cols', String(cols));
}

function onResize() {
  if (!isOpen() || !loaded) return;
  const topItem = Math.floor(Math.max(0, ui.scroll.scrollTop - padTop) / rowH) * cols; // the first card in view stays in view
  const before = cols;
  layout();
  if (cols !== before) ui.scroll.scrollTop = topItem ? padTop + Math.floor(topItem / cols) * rowH : 0;
  renderWindow();
}

/** Brings the DOM in line with the scroll position: the cards of the visible rows and the overscan, no more. @param {boolean} [force] rebind every card shown */
function renderWindow(force = false) {
  if (!isOpen()) return;
  const rows = rowsOf(items.length, cols);
  const top = ui.scroll.scrollTop;
  const w = windowRows({ scrollTop: top - padTop, viewH: ui.scroll.clientHeight, rowH, rows });
  const firstIdx = w.first * cols;
  const lastIdx = rows ? Math.min(items.length - 1, (w.last + 1) * cols - 1) : -1;
  if (!force && firstIdx === shown.first && lastIdx === shown.last && cols === shown.cols) return;

  const keepFrom = Math.max(firstIdx, shown.first);
  const keepTo = Math.min(lastIdx, shown.last);
  const overlap = cols === shown.cols && shown.last >= shown.first && keepFrom <= keepTo;
  if (overlap) {
    for (const [i, card] of cards) {
      if (i >= firstIdx && i <= lastIdx) continue;
      release(card);
      cards.delete(i);
      card.li.remove();
    }
  } else {
    for (const card of cards.values()) release(card);
    cards.clear();
    ui.grid.replaceChildren();
  }
  /** @type {HTMLElement[]} */ const head = [];
  /** @type {HTMLElement[]} */ const tail = [];
  for (let i = firstIdx; i <= lastIdx; i++) {
    const have = cards.get(i);
    if (have) {
      if (force) fill(have, i);
      continue;
    }
    const card = acquire();
    fill(card, i);
    cards.set(i, card);
    (!overlap || i > keepTo ? tail : head).push(card.li);
  }
  if (head.length) ui.grid.prepend(...head);
  if (tail.length) ui.grid.append(...tail);
  ui.grid.style.paddingTop = `${w.first * rowH}px`;
  ui.grid.style.paddingBottom = `${Math.max(0, rows - 1 - w.last) * rowH}px`;
  if (ui.scroll.scrollTop !== top) ui.scroll.scrollTop = top; // the browser clamps the position while the cards are replaced
  shown.first = firstIdx;
  shown.last = lastIdx;
  shown.cols = cols;
  if (!cards.has(active)) { // someone must stay reachable by Tab
    const any = cards.get(firstIdx);
    if (any) any.open.tabIndex = 0;
  }
}

function clearWindow() {
  for (const card of cards.values()) release(card);
  cards.clear();
  ui.grid.replaceChildren();
  ui.grid.style.paddingTop = ui.grid.style.paddingBottom = '0';
  shown.first = 0; shown.last = -1; shown.cols = 0;
}

// --- Cards ---

// ponytail: the thumbnails are 240 px wide (thumb-pure.js THUMB_WIDTH) and a card up to about 300 px: a little soft on a dense screen; make them wider (and regenerate) if it shows.
/** @returns {Card} */
function acquire() {
  const reused = pool.pop();
  if (reused) return reused;
  const li = document.createElement('li');
  li.className = 'hv-card';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'open';
  const thumb = document.createElement('span');
  thumb.className = 'hv-thumb';
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  const ph = icon('photo');
  ph.classList.add('ph');
  const badge = document.createElement('span'); // inside the button: it is part of what a screen reader says
  badge.className = 'badge';
  thumb.append(img, ph, badge);
  const meta = document.createElement('span');
  meta.className = 'hv-meta';
  const title = document.createElement('span');
  title.className = 'hv-title';
  const sub = document.createElement('span');
  sub.className = 'hv-sub';
  meta.append(title, sub);
  open.append(thumb, meta);

  const label = document.createElement('span');
  label.className = 'hv-check';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.tabIndex = -1; // the card holds the keyboard: Space selects
  const box = document.createElement('span');
  box.className = 'box';
  box.append(icon('check'));
  label.append(check, box);

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'pin';
  pin.tabIndex = -1;
  pin.title = t('hist.pin.tip');
  pin.append(icon('pin'));

  li.append(open, label, pin);
  return { li, open, thumb, img, title, sub, check, pin, badge, id: 0, url: '' };
}

/** Puts the card in the pool: its thumbnail's object URL is revoked. @param {Card} card */
function release(card) {
  if (card.url) URL.revokeObjectURL(card.url);
  card.url = '';
  card.img.removeAttribute('src');
  wantThumb.delete(card.id);
  if (byId.get(card.id) === card) byId.delete(card.id);
  card.id = 0;
  pool.push(card);
}

/** Shows shot number `i` of the list in the card. @param {Card} card @param {number} i */
function fill(card, i) {
  const s = items[i];
  const when = formatDate(s.createdAt);
  const host = s.host || '';
  if (card.id !== s.id) {
    if (byId.get(card.id) === card) byId.delete(card.id);
    wantThumb.delete(card.id);
    if (card.url) URL.revokeObjectURL(card.url);
    card.url = '';
    card.img.removeAttribute('src');
    card.id = s.id;
  }
  byId.set(s.id, card);
  card.li.dataset.index = String(i);
  card.li.dataset.id = String(s.id);
  card.li.setAttribute('aria-posinset', String(i + 1));
  card.li.setAttribute('aria-setsize', String(total));
  card.open.title = `${s.title || ''}\n${s.url || ''}`.trim(); // an attribute: never read as HTML
  card.open.tabIndex = i === active ? 0 : -1;
  card.title.textContent = s.title || host || ''; // textContent: the title and the address come from the captured page
  card.sub.textContent = host ? `${host}${DOT}${when}` : when;
  card.check.setAttribute('aria-label', t('hist.card.select', { when }));
  card.pin.setAttribute('aria-label', t('hist.pin.card', { when }));
  card.badge.textContent = t('strip.edited');
  paintState(card, s);
  if (s.thumb) {
    if (!card.url) {
      card.url = URL.createObjectURL(s.thumb);
      card.img.src = card.url;
    }
    card.thumb.classList.remove('no-thumb');
  } else {
    card.thumb.classList.add('no-thumb');
    if (!s.versions?.length) wantThumb.set(s.id, s); // an edited shot gets its thumbnail from the editor
  }
  pumpThumbs();
}

/** What changes when a shot is selected, pinned or edited. @param {Card} card @param {Shot} s */
function paintState(card, s) {
  const on = selection.has(s.id);
  card.li.classList.toggle('is-selected', on);
  card.check.checked = on;
  card.pin.setAttribute('aria-pressed', String(!!s.pinned));
  card.pin.disabled = deps.readOnly();
  card.badge.hidden = !s.versions?.length;
}

function repaintCards() {
  for (const [i, card] of cards) paintState(card, items[i]);
}

// Missing thumbnails: made one after the other (two at a time), the most recently shown first, for the cards in view only.
/** @type {Map<number, Shot>} */
const wantThumb = new Map();
let thumbsRunning = 0;
function pumpThumbs() {
  while (thumbsRunning < THUMBS_AT_ONCE && wantThumb.size) {
    const [id, s] = [...wantThumb].at(-1);
    wantThumb.delete(id);
    thumbsRunning++;
    deps.makeThumb(s).then((blob) => {
      if (!blob) return;
      s.thumb = blob;
      const card = byId.get(id);
      if (card && card.id === id) {
        if (card.url) URL.revokeObjectURL(card.url); // the card may already show this thumbnail (the list was read again meanwhile)
        card.url = URL.createObjectURL(blob);
        card.img.src = card.url;
        card.thumb.classList.remove('no-thumb');
      }
    }).catch((e) => console.error('Obturo: thumbnail', e)).finally(() => {
      thumbsRunning--;
      pumpThumbs();
    });
  }
}

// --- Selection ---

function emitSelection() {
  const ids = getSelectedIds();
  notify('selection-changed', { ids, count: ids.length });
}

function updateBulk() {
  const n = selection.size;
  ui.bulk.hidden = n === 0;
  ui.filters.hidden = n > 0;
  ui.pin.disabled = ui.unpin.disabled = ui.del.disabled = deps.readOnly(); // a read-only tab selects and exports, it changes nothing
  ui.grid.toggleAttribute('data-selecting', n > 0);
  if (!n) return;
  ui.selCount.textContent = plural(n, 'hist.sel.one', 'hist.sel.other');
  ui.selectAll.hidden = n >= total;
  if (n < total) ui.selectAll.textContent = t('hist.sel.all', { n: formatNumber(total) });
}

function selectionChanged() {
  repaintCards();
  updateBulk();
  emitSelection();
}

function clearSelection() {
  if (!selection.size) return;
  selection = new Set();
  anchor = -1;
  selectionChanged();
}

/** Selects or deselects card `i`, or the whole range from the last card clicked. @param {number} i @param {boolean} on @param {boolean} [range] */
function select(i, on, range = false) {
  if (range && anchor >= 0) {
    selection = withRange(selection, items.map((s) => s.id), anchor, i, on);
  } else {
    selection = new Set(selection);
    if (on) selection.add(items[i].id);
    else selection.delete(items[i].id);
  }
  anchor = i;
  active = i;
  selectionChanged();
}

async function selectAllResults() {
  try {
    selection = new Set((await listEntries(filter)).map((e) => e.id));
  } catch (e) {
    console.error('Obturo: select all failed', e);
    return;
  }
  if (document.activeElement === ui.selectAll) ui.pin.focus(); // the button goes away: the focus must not be lost
  selectionChanged();
}

// --- Actions ---

function openCard(i) {
  const s = items[i];
  if (!s) return;
  if (deps.readOnly()) { status(t('hist.readonly')); return; }
  closeHistory();
  deps.openShot(s);
}

/** Pins or unpins shots of the list. @param {number[]} ids @param {boolean} on */
async function setPins(ids, on) {
  if (!ids.length) return;
  if (deps.readOnly()) { status(t('hist.readonly')); return; }
  try {
    await setPinnedMany(ids, on);
  } catch (e) {
    console.error('Obturo: pin failed', e);
    status(t('hist.pin.failed'));
    return;
  }
  const set = new Set(ids);
  for (const s of items) if (set.has(s.id)) s.pinned = on;
  deps.pinned(ids, on);
  if (!on && state.onlyPinned) removeFromList(ids);
  else repaintCards();
  if (ids.length > 1) status(on ? plural(ids.length, 'hist.status.pinned.one', 'hist.status.pinned.other') : plural(ids.length, 'hist.status.unpinned.one', 'hist.status.unpinned.other'));
}

/** Takes shots out of the list (they were deleted, or no longer match). Every id was in the result: the total follows. @param {number[]} ids */
function removeFromList(ids) {
  const gone = new Set(ids);
  items = items.filter((s) => !gone.has(s.id));
  total = Math.max(0, total - ids.length);
  let changed = false;
  for (const id of ids) changed = selection.delete(id) || changed;
  anchor = -1;
  active = Math.min(active, Math.max(0, items.length - 1));
  showStateForList();
  if (items.length) { layout(); renderWindow(true); } else clearWindow();
  updateCount();
  if (changed) { updateBulk(); emitSelection(); }
  watchEnd();
}

/** Asks, then deletes. @param {number[]} ids */
async function deleteShotsAsk(ids) {
  if (!ids.length) return;
  if (deps.readOnly()) { status(t('hist.readonly')); return; }
  let words;
  try {
    words = await deleteWords(ids, ids.length === 1 ? await getShot(ids[0]) : null);
  } catch (e) {
    console.error('Obturo: delete failed', e);
    status(t('hist.del.failed'));
    return;
  }
  const { sum } = words;
  if (!sum.count) { removeFromList(ids); return; } // already gone
  const ok = await confirmDialog({
    ...words,
    run: async (progress) => {
      selfChange = true;
      try {
        await deleteWithProgress(ids, (done, all) => progress(t('hist.del.progress', { done: formatNumber(done), total: formatNumber(all) }), done / all));
      } finally {
        selfChange = false;
      }
    },
    error: t('hist.del.failed'),
  });
  if (!ok) { focusActive(); return; }
  removeFromList(ids);
  status(plural(sum.count, 'hist.status.deleted.one', 'hist.status.deleted.other'));
  fillStorage();
  focusActive();
}

// --- Keyboard and pointer ---

function onGridClick(e) {
  const target = /** @type {Element} */ (e.target);
  const li = /** @type {HTMLElement | null} */ (target.closest('.hv-card'));
  if (!li) return;
  const i = Number(li.dataset.index);
  const s = items[i];
  if (!s) return;
  if (target.closest('.pin')) {
    active = i;
    setPins([s.id], !s.pinned);
  } else if (target.closest('.hv-check')) {
    if (target instanceof HTMLInputElement) select(i, target.checked, e.shiftKey);
  } else if (target.closest('.open')) {
    active = i;
    if (e.shiftKey) select(i, true, true);
    else if (e.ctrlKey || e.metaKey) select(i, !selection.has(s.id));
    else openCard(i);
  }
}

function focusActive() {
  const card = cards.get(active);
  if (card) card.open.focus({ preventScroll: true });
  else ui.query.focus();
}

/** Moves the keyboard to card `i`, scrolling it into view. @param {number} i */
function focusIndex(i) {
  if (!items.length) return;
  const before = cards.get(active);
  if (before) before.open.tabIndex = -1;
  active = clamp(i, 0, items.length - 1);
  const view = ui.scroll.scrollTop - padTop;
  const to = scrollToShow({ index: active, cols, rowH, gap, scrollTop: view, viewH: ui.scroll.clientHeight });
  if (to !== view) ui.scroll.scrollTop = to === 0 ? 0 : to + padTop;
  renderWindow();
  const card = cards.get(active);
  if (card) {
    card.open.tabIndex = 0;
    card.open.focus({ preventScroll: true });
  }
}

function onGridKeydown(e) {
  const target = /** @type {Element} */ (e.target);
  const li = /** @type {HTMLElement | null} */ (target.closest('.hv-card'));
  if (!li || e.altKey) return;
  const i = Number(li.dataset.index);
  const s = items[i];
  if (!s) return;
  const to = moveIndex(e.key, i, {
    cols, count: items.length, pageRows: Math.max(1, Math.floor(ui.scroll.clientHeight / rowH) - 1), ctrl: e.ctrlKey || e.metaKey,
  });
  if (to !== null) {
    e.preventDefault();
    if (e.shiftKey) { // the range from the anchor to the new card
      if (anchor < 0) anchor = i;
      selection = withRange(selection, items.map((x) => x.id), anchor, to, true);
      selectionChanged();
    }
    focusIndex(to);
    return;
  }
  const mine = target.closest('.open');
  if (e.key === ' ' && mine) { // Space selects (the browser would click)
    e.preventDefault();
    select(i, !selection.has(s.id), e.shiftKey);
  } else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const ids = selection.has(s.id) ? getSelectedIds() : [s.id];
    setPins(ids, !s.pinned);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteShotsAsk(selection.has(s.id) ? getSelectedIds() : [s.id]);
  }
}

function onDialogKeydown(e) {
  if (!isOpen() || document.querySelector('dialog[open]:not(#history)')) return; // another dialog is on top
  if (e.key === 'Escape') {
    if (e.target === ui.query && ui.query.value) { // first the search, then the selection, then the sheet
      e.preventDefault();
      ui.query.value = '';
      applyFilters();
    } else if (selection.size) {
      e.preventDefault();
      clearSelection();
      focusActive();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !/** @type {Element} */ (e.target).closest?.('input, select, textarea')) {
    e.preventDefault();
    selectAllResults();
  }
}
