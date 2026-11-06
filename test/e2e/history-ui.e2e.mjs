// The history view in the real extension: the strip as a shortcut, the sheet with thousands of shots (windowing, pages, no
// leak), search, filters, pinning, selection (click, range, keyboard), bulk actions, the history block of the settings (retention,
// gauge, purge with its preview, delete everything), the language changing live, the error and read-only states.
// Seeds are made-up pages written straight into the stores (support/history-ui.mjs); the database is read back to check
// what the interface did.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { DAY, blankPage, db, query, rawDump, seedV2, setPolicy, wipe } from './support/history.mjs';
import { makeRows, openHistory, seedRows, view, viewWhere, cardAt } from './support/history-ui.mjs';
import { poll as pollFor, seedSettings, sleep, waitOut } from './support/editor.mjs';
import { splitBytes } from '../../i18n.js';

const OFF = { retentionDays: 0, maxBytes: 0 };
// A loaded machine (the antivirus scans the many blob files of the seeds) can stall IndexedDB for seconds: wait longer than the default.
const poll = (fn, options = {}) => pollFor(fn, { timeout: 20_000, ...options });
const E1 = String.fromCharCode(233); // e with an acute accent: the sources stay ASCII
const NOW = Date.now();
const ids = (items) => items.map((s) => s.id);

// A size as the English interface writes it ("9.8 KB", "1.2 GB").
const fmtEn = (bytes) => {
  const { value, unit } = splitBytes(bytes);
  return `${new Intl.NumberFormat('en').format(value)}\u00a0${unit}`;
};

// A made-up row, `i` minutes after the origin: the most recent has the highest i.
const row = (i, over = {}) => ({
  title: `Page ${i}`, url: `https://site${i % 5}.example.test/p/${i}`, createdAt: NOW - (1000 - i) * 60_000, bytes: 1000, pinned: false, edited: false, thumb: i % 24, ...over,
});

describe('history view', () => {
  let h, P, L;

  // An empty database, the retention off, the given shots, and the library opened on them.
  async function fresh(rows, { lang = 'en', real = 3, policy = OFF, open = true } = {}) {
    await L.goto(h.url('manifest.json'));
    await wipe(P);
    await setPolicy(P, policy);
    await seedSettings(P, { language: lang, theme: 'light' });
    const made = rows.length ? await seedRows(P, rows, { real }) : [];
    if (open) {
      await L.goto(h.url());
      await (rows.length ? L.waitForSelector('#strip li.shot') : L.waitForSelector('#stageMsg .state-title'));
    }
    return made;
  }
  const sheetOpen = () => L.evaluate(() => /** @type {HTMLDialogElement} */ (document.getElementById('history')).open);
  const ready = () => L.waitForSelector('#ui:not([disabled])', { state: 'attached', timeout: 20_000 });
  const closeSheet = async () => { if (await sheetOpen()) { await L.click('#hvClose'); await L.waitForFunction(() => !document.querySelector('#history[open]')); } };
  // the total on the shortcut of the strip is read after the first paint
  const shortcutCount = (text) => poll(async () => (await L.locator('#historyAllCount').textContent()) === text, { what: `${text} on the shortcut of the strip` });
  const focusedIndex = () => L.evaluate(() => /** @type {HTMLElement} */ (document.activeElement.closest('.hv-card')).dataset.index);
  const settingsOf = () => P.evaluate(async () => (await import(`${location.origin}/settings.js`)).getSettings());
  const openSettings = async () => { await L.click('#settingsBtn'); await L.waitForSelector('#settings[open]'); };
  const closeSettings = async () => { await L.keyboard.press('Escape'); await L.waitForFunction(() => !document.querySelector('#settings[open]')); };

  before(async () => {
    h = await launchExtension({ hook: true, size: { width: 1280, height: 800 } });
    P = await blankPage(h);
    L = await h.context.newPage();
    L.on('dialog', (d) => d.accept());
  });
  after(async () => {
    await setPolicy(P, { retentionDays: 30, maxBytes: 2e9 }).catch(() => {});
    await h?.close();
  });
  // a failing test must not leave a dialog open on top of the next one
  afterEach(async () => {
    await L.evaluate(() => { for (const id of ['confirmDlg', 'purgeDlg', 'settings']) /** @type {HTMLDialogElement | null} */ (document.getElementById(id))?.close(); }).catch(() => {});
  });

  describe('what db.js adds', () => {
    it('getShot, listEntries, setPinnedMany, previewPurge, runRetention(keepId)', async () => {
      await fresh([], { open: false });
      const rows = [
        row(1, { createdAt: NOW - 100 * DAY, bytes: 100 }), row(2, { createdAt: NOW - 100 * DAY, bytes: 200, pinned: true }),
        row(3, { createdAt: NOW - 100 * DAY, bytes: 400, edited: true }), row(4, { createdAt: NOW - 90 * DAY, bytes: 800 }),
        row(5, { createdAt: NOW - DAY, bytes: 1600, title: `Facture d${E1}cembre` }),
      ];
      const [a, b, c, d, e] = await seedRows(P, rows, { real: 0 });

      const one = await P.evaluate(async (id) => {
        const { getShot } = await import(`${location.origin}/db.js`);
        const s = await getShot(id);
        return { id: s.id, title: s.title, hasThumb: !!s.thumb, pinned: s.pinned };
      }, e);
      assert.deepEqual(one, { id: e, title: `Facture d${E1}cembre`, hasThumb: true, pinned: false });
      assert.equal(await P.evaluate(async () => (await import(`${location.origin}/db.js`).then((m) => m.getShot(424242)))), undefined);

      const entries = await db(P, 'listEntries', {});
      assert.deepEqual(ids(entries), [e, d, c, b, a], 'most recent first');
      assert.deepEqual(entries.map((x) => [x.pinned, x.edited, x.bytes]), [[false, false, 1600], [false, false, 800], [false, true, 400], [true, false, 200], [false, false, 100]]);
      assert.deepEqual(ids(await db(P, 'listEntries', { query: 'decembre' })), [e], 'same filters as queryShots, accents ignored');
      assert.deepEqual(ids(await db(P, 'listEntries', { onlyPinned: true })), [b]);

      const before = await db(P, 'previewPurge', { olderThanDays: 30 });
      assert.deepEqual(before, { deleted: 2, freedBytes: 900, overCap: false, keptPinned: 1, keptEdited: 1, remaining: { count: 3, bytes: 2200 } });
      assert.equal(await db(P, 'countShots'), 5, 'a preview deletes nothing');
      assert.deepEqual(await db(P, 'previewPurge'), { deleted: 0, freedBytes: 0, overCap: false, keptPinned: 0, keptEdited: 0, remaining: { count: 5, bytes: 3100 } });
      const real = await db(P, 'purgeNow', { olderThanDays: 30 });
      assert.deepEqual([real.deleted, real.freedBytes], [before.deleted, before.freedBytes], 'the purge does what the preview said');

      assert.equal(await db(P, 'setPinnedMany', [c, e, 424242, c], true), 2, 'two exist and change; the unknown one and the repeat do not count');
      assert.equal(await db(P, 'setPinnedMany', [c, e], true), 0, 'nothing changes the second time');
      assert.deepEqual(ids((await query(P, { onlyPinned: true })).items), [e, c, b]);
      assert.equal(await db(P, 'setPinnedMany', [], true), 0);
      const latest = await P.evaluate(async () => (await import(`${location.origin}/db.js`).then((m) => m.latestShots(2))).map((s) => s.id));
      assert.deepEqual(latest, [e, c], 'latestShots: the most recent rows, no more than asked');
      assert.equal((await P.evaluate(async () => (await import(`${location.origin}/db.js`).then((m) => m.latestShots(50))).length)), 3);
      assert.equal(await db(P, 'setPinnedMany', [b, c, e], false), 3);
      assert.equal(await db(P, 'countShots', { onlyPinned: true }), 0);

      // the library pass spares the shot it is given: b is old and plain now, but it is the one the library has open
      await setPolicy(P, { retentionDays: 30, maxBytes: 0 });
      assert.deepEqual(await db(P, 'runRetention', b), { deleted: 0, freedBytes: 0, overCap: false });
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 1, freedBytes: 200, overCap: false });
      assert.deepEqual(ids((await query(P)).items), [e, c], 'c is edited: it escapes the age');
      await setPolicy(P, OFF);
    });
  });

  describe('db-warm.js', () => {
    it('opens the database to read only: it creates nothing, and a version 2 database still upgrades under the library', async () => {
      await L.goto(h.url('manifest.json'));
      await wipe(P);
      await L.addScriptTag({ url: h.url('db-warm.js') });
      await sleep(300);
      const names = await L.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
      assert.ok(!names.includes('obturo'), `the warm-up created the database: ${names}`);

      await seedV2(P, [{ url: 'https://old.example.test/', title: 'Old shot', w: 100, h: 100, createdAt: NOW, versions: [], active: -1, originalBytes: 500 }]);
      assert.equal((await rawDump(P)).version, 2);
      await setPolicy(P, OFF);
      await L.goto(h.url()); // the page opens the database (warm-up) while db.js upgrades it (version 3)
      await L.waitForSelector('#strip li.shot');
      assert.equal((await rawDump(P)).version, 3);
      await poll(async () => (await L.locator('#historyAllCount').textContent()) === '1', { what: 'the total of the shortcut' });
      h.errors.length = 0; // the padding of that old original is not an image: the editor says so, as it should
    });
  });

  describe('the strip and the sheet', () => {
    it('the strip holds the latest 12 shots, the shortcut says how many there are, and opens the sheet', async () => {
      await fresh(Array.from({ length: 30 }, (_, i) => row(i + 1)));
      await ready();
      assert.equal(await L.locator('#strip li.shot').count(), 12);
      assert.deepEqual(await L.locator('#strip li.shot').evaluateAll((lis) => lis.map((li) => li.dataset.title ?? li.querySelector('button.open').title.split('\n')[0])), Array.from({ length: 12 }, (_, i) => `Page ${30 - i}`));
      await shortcutCount('30');
      assert.match(await L.locator('#historyAll').getAttribute('aria-label'), /^Open the whole history\. Captures: 30$/);
      await L.click('#historyAll');
      await L.waitForSelector('#history[open]');
      const v = await viewWhere(L, (x) => x.cards > 0, 'cards');
      assert.equal(v.count, '30 captures');
      assert.equal(v.cards, 30, 'a short history is entirely in the DOM');
      assert.deepEqual(await L.evaluate(() => document.activeElement.id), 'hvQuery', 'the search field has the focus');
      assert.equal(await L.locator('#history').getAttribute('aria-labelledby'), 'historyTitle');
      assert.equal(await L.locator('#hvGrid').getAttribute('role'), 'list');
      assert.equal(await L.locator('#hvGrid > li').first().getAttribute('aria-posinset'), '1');
      assert.equal(await L.locator('#hvGrid > li').first().getAttribute('aria-setsize'), '30');
      await closeSheet();
      assert.equal(await L.evaluate(() => document.activeElement.id), 'historyAll', 'the focus goes back to what opened the sheet');
    });

    it('a click on a card closes the sheet and opens that capture in the editor, an older one than the strip shows', async () => {
      const made = await fresh(Array.from({ length: 30 }, (_, i) => row(i + 1)), { real: 30 });
      await ready();
      await openHistory(L);
      await cardAt(L, made[2]).locator('button.open').click(); // Page 3: not in the strip
      await L.waitForFunction(() => !document.querySelector('#history[open]'));
      await waitOut(L, 1280, 720);
      await poll(async () => (await L.evaluate(() => document.getElementById('editor-title')?.textContent ?? 'x')) !== null, { what: 'editor' });
      assert.equal(await L.locator('#strip li[aria-current]').count(), 0, 'it is not in the strip: nothing is marked there');
      await ready();
      // the pin of the header follows the open capture, also for one that the strip does not hold
      await L.click('#pin');
      await poll(async () => (await db(P, 'listEntries', { onlyPinned: true })).length === 1, { what: 'pinned in the database' });
      assert.equal((await db(P, 'listEntries', { onlyPinned: true }))[0].id, made[2]);
      assert.equal(await L.locator('#pin').getAttribute('aria-pressed'), 'true');
    });

    it('an empty history: no strip, the library says so, and so does the sheet', async () => {
      await fresh([]);
      assert.equal(await L.locator('.filmstrip').isVisible(), false);
      await openHistory(L);
      await poll(async () => (await view(L)).state === 'No captures yet', { what: 'the sheet says that the history is empty (it says "Loading" until its first read)' });
      const v = await view(L);
      assert.equal(v.cards, 0);
      assert.equal(v.count, '');
      assert.equal(await L.locator('#hvState').getAttribute('data-state'), 'empty');
      await closeSheet();
    });

    it('thumbnails missing from the database are made once, for the cards in view, and stored', async () => {
      const made = await fresh(Array.from({ length: 6 }, (_, i) => row(i + 1, { thumb: -1 })), { real: 6 });
      await ready();
      await openHistory(L);
      await L.waitForFunction(() => document.querySelectorAll('#hvGrid .hv-card img[src]').length === 6, null, { timeout: 20_000 });
      await poll(async () => (await query(P)).items.every((s) => s.thumb > 0), { what: 'thumbnails stored' });
      assert.deepEqual(ids((await query(P)).items), made.toReversed());
      // the strip and the sheet asked for the same six: one decode each
      const decodes = await L.evaluate(() => window.__c.calls.filter((c) => c.resize).length);
      assert.equal(decodes, 6, 'one resized decode per shot');
      await closeSheet();
    });
  });

  describe('at scale (5,000 shots)', () => {
    const N = 5000;
    let all;

    before(async () => {
      all = await fresh(makeRows(N, { now: NOW }), { real: 12 });
      await ready();
    });

    it('the strip stays small and paints before the sheet exists: no page of 5,000 is read for it', async () => {
      assert.equal(await L.locator('#strip li.shot').count(), 12);
      await shortcutCount('5,000');
      const marks = await L.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, m.startTime])));
      assert.ok(marks['obturo:strip-painted'] < marks['obturo:editor-loaded'], 'the strip is painted before Fabric loads');
      assert.ok(marks['obturo:strip-painted'] < 1000, `strip painted at ${marks['obturo:strip-painted']} ms`);
    });

    it('the first page paints fast and never more than a couple of hundred cards are in the DOM, however far one scrolls', async () => {
      await openHistory(L);
      const marks = await L.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, m.startTime])));
      const opening = marks['obturo:history-painted'] - marks['obturo:history-open'];
      assert.ok(opening < 400, `opening to paint: ${opening} ms (the benchmark holds the real budget)`);
      const first = await view(L);
      assert.equal(first.count, '5,000 captures');
      assert.deepEqual(first.ids.slice(0, 3), [all.at(-1), all.at(-2), all.at(-3)], 'the most recent first');
      assert.ok(first.cards > 0 && first.cards <= 200, `${first.cards} cards`);

      // down to the oldest shot: each step is a new page, the DOM stays bounded
      let max = first.cards;
      let height = first.scrollHeight;
      let last = first;
      for (let step = 0; step < 400; step++) {
        await L.evaluate(() => { const s = document.getElementById('hvScroll'); s.scrollTop = s.scrollHeight; });
        await sleep(30);
        last = await view(L);
        max = Math.max(max, last.cards);
        assert.ok(last.scrollHeight >= height, 'the list only grows');
        height = last.scrollHeight;
        if (last.ids.includes(all[0])) break;
      }
      assert.ok(last.ids.includes(all[0]), 'the oldest shot was reached');
      assert.ok(max <= 200, `at most ${max} cards at once`);
      // the whole list is as high as 5,000 cards in `cols` columns
      const rowH = await L.evaluate(() => parseFloat(getComputedStyle(document.getElementById('history')).getPropertyValue('--hv-card-h')) + parseFloat(getComputedStyle(document.getElementById('history')).getPropertyValue('--hv-gap')));
      assert.ok(Math.abs(last.scrollHeight - (Math.ceil(N / last.cols) * rowH + 16 + 20)) < rowH, `height ${last.scrollHeight} for ${last.cols} columns`);
      // in order, without a gap, all the way
      for (let i = 1; i < last.ids.length; i++) assert.equal(last.ids[i], last.ids[i - 1] - 1, 'consecutive ids, most recent first');
    });

    it('object URLs are revoked as cards leave the window', async () => {
      // back to the top, then a long scroll through the list: only the cards in view hold a URL
      for (const to of [0, 0.5, 0.25, 0.9, 0.1]) {
        await L.evaluate((to) => { const s = document.getElementById('hvScroll'); s.scrollTop = (s.scrollHeight - s.clientHeight) * to; }, to);
        await sleep(120);
      }
      const live = await L.evaluate(() => ({ urls: window.__c.urlLive.size, cards: document.querySelectorAll('#hvGrid .hv-card').length, strip: document.querySelectorAll('#strip img[src]').length }));
      assert.ok(live.urls <= live.cards + live.strip + 2, `live URLs ${live.urls} for ${live.cards} cards and ${live.strip} in the strip`);
      assert.ok(live.cards <= 200);
    });

    it('a jump in the list shows the right shots at the right place', async () => {
      await L.evaluate(() => { document.getElementById('hvScroll').scrollTop = 0; });
      await viewWhere(L, (v) => v.scrollTop === 0 && v.ids[0] === all.at(-1), 'back at the top');
      await L.evaluate(() => { const s = document.getElementById('hvScroll'); s.scrollTop = s.scrollHeight * 0.4; });
      const v = await viewWhere(L, (x) => x.scrollTop > 0 && x.ids[0] !== all.at(-1), 'moved');
      // the card at the top of the screen is the one the scroll position says
      const probe = await L.evaluate(() => {
        const s = document.getElementById('hvScroll');
        const first = /** @type {HTMLElement} */ (document.querySelector('#hvGrid .hv-card'));
        return { index: Number(first.dataset.index), id: Number(first.dataset.id), top: first.getBoundingClientRect().top - s.getBoundingClientRect().top };
      });
      assert.equal(probe.id, all.at(-1) - probe.index, 'position and id agree');
      assert.ok(probe.top < 400, 'the rendered cards reach the top of the view');
      assert.ok(v.cards <= 200);
    });

    it('select all selects the 5,000 results, and the selection does not cost cards', async () => {
      await L.evaluate(() => { document.getElementById('hvScroll').scrollTop = 0; });
      await L.evaluate(() => { window.__sel = []; document.addEventListener('selection-changed', (e) => window.__sel.push(/** @type {CustomEvent} */ (e).detail.count)); });
      await L.locator('#hvGrid .hv-card').first().hover();
      await L.locator('#hvGrid .hv-card').first().locator('input[type=checkbox]').click();
      await viewWhere(L, (v) => v.selection === '1 selected' && !v.bulkHidden, 'bar shown');
      assert.equal(await L.locator('#hvSelectAll').textContent(), 'Select all 5,000 results');
      assert.equal(await L.locator('#hvFilters').isHidden(), true, 'the bar replaces the filters');
      await L.click('#hvSelectAll');
      await viewWhere(L, (v) => v.selection === '5000 selected' || v.selection === '5,000 selected', 'all selected');
      assert.equal(await L.locator('#hvSelectAll').isHidden(), true);
      const selected = await L.evaluate(async () => (await import(`${location.origin}/history-view.js`)).getSelectedIds());
      assert.equal(selected.length, N);
      assert.deepEqual(selected.slice(0, 3), [all.at(-1), all.at(-2), all.at(-3)], 'most recent first');
      assert.deepEqual(await L.evaluate(() => window.__sel), [1, N], 'one event per change, with the count');
      await L.keyboard.press('Escape');
      await viewWhere(L, (v) => v.bulkHidden && v.selected === 0, 'selection cleared');
      assert.equal(await sheetOpen(), true, 'the first Escape cleared the selection only');
      await closeSheet();
    });

    it('the sheet frees its cards and its URLs when it closes', async () => {
      await sleep(100);
      const left = await L.evaluate(() => ({ cards: document.querySelectorAll('#hvGrid .hv-card').length, urls: window.__c.urlLive.size, strip: document.querySelectorAll('#strip img[src]').length }));
      assert.equal(left.cards, 0);
      assert.ok(left.urls <= left.strip + 1, `${left.urls} URLs for ${left.strip} thumbnails in the strip`);
    });
  });

  describe('keyboard jumps in a list longer than one window (220 shots)', () => {
    const N = 220;

    before(async () => {
      await fresh(makeRows(N, { now: NOW }), { real: 3 });
      await ready();
      await openHistory(L);
    });
    after(closeSheet);

    it('Ctrl+End pressed again and again keeps the focus on a card and reaches the oldest shot', async () => {
      await L.locator('#hvGrid .hv-card button.open').first().focus();
      let index = -1;
      for (let press = 0; press < 8 && index !== N - 1; press++) {
        await L.keyboard.press('Control+End');
        await sleep(400);
        index = await L.evaluate(() => Number(/** @type {HTMLElement | null} */ (document.activeElement?.closest('.hv-card'))?.dataset.index ?? -1));
        assert.notEqual(index, -1, `the focus is still on a card after press ${press + 1}`);
      }
      assert.equal(index, N - 1, 'the last card holds the focus');
      const inView = await L.evaluate(() => {
        const card = document.activeElement?.closest('.hv-card');
        const list = document.getElementById('hvScroll');
        return !!card && !!list && card.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1;
      });
      assert.equal(inView, true, 'and it is in view');
    });
  });

  describe('search and filters', () => {
    // 60 shots: titles with accents, five sites, three ages, some pinned. Page i is the i-th (the most recent has i = 60).
    const rows = Array.from({ length: 60 }, (_, i) => {
      const n = i + 1;
      return row(n, {
        title: n % 6 === 0 ? `Facture d${E1}cembre n${n}` : n % 6 === 1 ? `Caf${E1} du coin n${n}` : `Rapport n${n}`,
        createdAt: n > 50 ? NOW - (60 - n) * 1000 : n > 25 ? NOW - 3 * DAY - n * 1000 : NOW - 45 * DAY - n * 1000,
        pinned: n % 10 === 0,
      });
    });

    before(async () => {
      await fresh(rows, { real: 3 });
      await ready();
      await openHistory(L);
    });
    after(() => closeSheet());

    const typeQuery = async (text) => { await L.fill('#hvQuery', text); };
    const titles = () => L.locator('#hvGrid .hv-title').allTextContents();

    it('search ignores case and accents, looks in the address too, and shows how many results', async () => {
      await typeQuery('FACTURE DECEMBRE');
      const v = await viewWhere(L, (x) => x.count === '10 results', 'ten results');
      assert.equal(v.cards, 10);
      assert.ok((await titles()).every((x) => x.startsWith(`Facture d${E1}cembre`)));
      assert.equal(v.count, `${(await query(P, { query: 'facture decembre' })).total} results`);

      await typeQuery(`cafe`);
      await viewWhere(L, (x) => x.count === '10 results', 'cafe');
      await typeQuery('site3.example.test');
      await viewWhere(L, (x) => x.count === '12 results', 'the address is searched');
      await typeQuery('site3 rapport');
      const both = await viewWhere(L, (x) => /results?$/.test(x.count) && x.count !== '12 results', 'both words');
      assert.equal(both.count, `${(await query(P, { query: 'site3 rapport' })).total} results`);
      await typeQuery('');
      await viewWhere(L, (x) => x.count === '60 captures', 'back to everything');
    });

    it('the search waits for the end of the typing (about 150 ms), not a request per key', async () => {
      await L.evaluate(() => { window.__q = 0; const orig = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function (...a) { window.__q++; return orig.apply(this, a); }; });
      await L.locator('#hvQuery').pressSequentially('rapport n5', { delay: 15 });
      await viewWhere(L, (x) => /result/.test(x.count), 'results');
      await sleep(300);
      const reads = await L.evaluate(() => window.__q);
      assert.ok(reads <= 3, `${reads} catalog reads for 10 keystrokes`); // one search = one read of the catalog (+ the hosts)
      await typeQuery('');
      await viewWhere(L, (x) => x.count === '60 captures', 'cleared');
    });

    it('no result: a message and a way back', async () => {
      await typeQuery('zzzzzz');
      const v = await viewWhere(L, (x) => x.state === 'No matching captures', 'no match');
      assert.equal(v.cards, 0);
      assert.equal(v.count, '0 results');
      assert.equal(await L.locator('#hvState').getAttribute('data-state'), 'empty');
      await L.click('#hvStateAction');
      const back = await viewWhere(L, (x) => x.count === '60 captures' && x.state === null, 'filters cleared');
      assert.ok(back.cards > 0);
      assert.equal(await L.inputValue('#hvQuery'), '');
      assert.equal(await L.evaluate(() => document.activeElement.id), 'hvQuery');
    });

    it('Escape clears the search first, then closes the sheet', async () => {
      await typeQuery('rapport');
      await viewWhere(L, (x) => /results$/.test(x.count), 'searched');
      await L.press('#hvQuery', 'Escape');
      await viewWhere(L, (x) => x.count === '60 captures', 'search cleared by Escape');
      assert.equal(await sheetOpen(), true);
      await L.press('#hvQuery', 'Escape');
      await L.waitForFunction(() => !document.querySelector('#history[open]'));
      await openHistory(L);
    });

    it('filters: site, period, pinned only, and their combinations', async () => {
      const hostOptions = await L.locator('#hvHost option').allTextContents();
      assert.equal(hostOptions[0], 'All sites');
      assert.equal(hostOptions.length, 6, 'five sites');
      assert.match(hostOptions[1], /^site\d\.example\.test \(12\)$/);
      const results = (n) => (n === 1 ? '1 result' : `${n} results`);
      await L.selectOption('#hvHost', 'site2.example.test');
      await viewWhere(L, (x) => x.count === '12 results', 'one site');
      assert.equal((await query(P, { host: 'site2.example.test' })).total, 12);

      await L.check('#hvPeriod input[value="today"]', { force: true });
      const startOfToday = await L.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); });
      const todayOfSite = (await query(P, { host: 'site2.example.test', from: startOfToday })).total;
      assert.ok(todayOfSite > 0 && todayOfSite < 12);
      await viewWhere(L, (x) => x.count === results(todayOfSite), 'the site, today');

      await L.selectOption('#hvHost', '');
      await L.check('#hvPeriod input[value="month"]', { force: true });
      await viewWhere(L, (x) => x.count === '35 results', 'a month: 35 of the 60 are less than 30 days old');
      assert.equal((await query(P, { from: NOW - 30 * DAY })).total, 35);

      await L.check('#hvPeriod input[value="all"]', { force: true });
      await L.click('#hvPinned');
      assert.equal(await L.locator('#hvPinned').getAttribute('aria-pressed'), 'true');
      const pinned = await viewWhere(L, (x) => x.count === '6 results', 'pinned only');
      assert.equal(pinned.cards, 6);
      assert.equal(await L.locator('#hvGrid .pin[aria-pressed="true"]').count(), 6);

      await L.check('#hvPeriod input[value="week"]', { force: true });
      await viewWhere(L, (x) => x.count === '4 results', 'pinned, this week');
      assert.equal((await query(P, { onlyPinned: true, from: NOW - 7 * DAY })).total, 4);

      await L.click('#hvPinned');
      await L.check('#hvPeriod input[value="all"]', { force: true });
      await viewWhere(L, (x) => x.count === '60 captures', 'everything again');
    });
  });

  describe('pinning', () => {
    let made;
    before(async () => {
      made = await fresh(Array.from({ length: 20 }, (_, i) => row(i + 1)), { real: 20 });
      await ready();
    });

    it('the pin of a card is saved, shown on the card and in the strip, and explained', async () => {
      await openHistory(L);
      const card = cardAt(L, made[19]);
      assert.equal(await card.locator('.pin').getAttribute('title'), 'Pinned captures are never removed automatically.');
      await card.hover();
      await card.locator('.pin').click();
      await poll(async () => (await db(P, 'listEntries', { onlyPinned: true })).length === 1, { what: 'pinned' });
      assert.equal((await db(P, 'listEntries', { onlyPinned: true }))[0].id, made[19]);
      assert.equal(await card.locator('.pin').getAttribute('aria-pressed'), 'true');
      await closeSheet();
      assert.equal(await L.locator('#strip li.shot').first().locator('.pin-mark').isVisible(), true, 'the strip shows it');
      assert.equal(await L.locator('#pin').getAttribute('aria-pressed'), 'true', 'it is the open capture: the header agrees');
    });

    it('the header pin pins and unpins the open capture; the sheet sees it', async () => {
      await L.click('#pin'); // unpin
      await poll(async () => (await db(P, 'countShots', { onlyPinned: true })) === 0, { what: 'unpinned' });
      assert.equal(await L.locator('#pin').getAttribute('aria-pressed'), 'false');
      assert.equal(await L.locator('#strip li.shot').first().locator('.pin-mark').isVisible(), false);
      await L.click('#pin');
      await poll(async () => (await db(P, 'countShots', { onlyPinned: true })) === 1, { what: 'pinned again' });
      await openHistory(L);
      assert.equal(await cardAt(L, made[19]).locator('.pin').getAttribute('aria-pressed'), 'true');
    });

    it('unpinning in "pinned only" takes the card out of the list; P pins from the keyboard', async () => {
      await L.click('#hvPinned');
      await viewWhere(L, (x) => x.count === '1 result', 'pinned only');
      await cardAt(L, made[19]).locator('button.open').focus();
      await L.keyboard.press('p'); // unpin
      const v = await viewWhere(L, (x) => x.cards === 0, 'the card left');
      assert.equal(v.state, 'No matching captures');
      assert.equal(v.count, '0 results');
      assert.equal(await db(P, 'countShots', { onlyPinned: true }), 0);
      await L.click('#hvStateAction');
      await viewWhere(L, (x) => x.count === '20 captures', 'all again');
      await cardAt(L, made[10]).locator('button.open').focus();
      await L.keyboard.press('p');
      await poll(async () => (await db(P, 'listEntries', { onlyPinned: true })).length === 1, { what: 'pinned by P' });
      assert.equal((await db(P, 'listEntries', { onlyPinned: true }))[0].id, made[10]);
    });
  });

  describe('selection and bulk actions', () => {
    let made;
    before(async () => {
      made = await fresh(Array.from({ length: 40 }, (_, i) => row(i + 1)), { real: 5 });
      await ready();
      await openHistory(L);
    });
    after(() => closeSheet());
    const box = (id) => cardAt(L, id).locator('input[type=checkbox]');

    it('a click on the box selects, shift-click selects the range, the bar shows, and exposes the contract for the export', async () => {
      await L.evaluate(() => { window.__sel = []; document.addEventListener('selection-changed', (e) => window.__sel.push(/** @type {CustomEvent} */ (e).detail.ids)); });
      assert.equal(await L.locator('#bulkExtra').count(), 1, 'the slot of the export, between Unpin and Delete');
      const newest = made.toReversed();
      await cardAt(L, newest[2]).hover();
      await box(newest[2]).click();
      await cardAt(L, newest[6]).hover();
      await box(newest[6]).click({ modifiers: ['Shift'] });
      const v = await viewWhere(L, (x) => x.selected === 5, 'five selected');
      assert.equal(v.selection, '5 selected');
      assert.equal(v.bulkHidden, false);
      const got = await L.evaluate(async () => (await import(`${location.origin}/history-view.js`)).getSelectedIds());
      assert.deepEqual(got, newest.slice(2, 7), 'the range, most recent first');
      assert.deepEqual(await L.evaluate(() => window.__sel.at(-1)), got, 'the event carries the same ids');
      for (const id of newest.slice(2, 7)) assert.equal(await cardAt(L, id).evaluate((li) => li.classList.contains('is-selected')), true);
      // shift-click on a selected card's box with the box unchecked takes the range out: click the same end again
      await box(newest[4]).click(); // unchecks one in the middle
      await viewWhere(L, (x) => x.selected === 4, 'four');
      await L.click('#hvClear');
      await viewWhere(L, (x) => x.selected === 0 && x.bulkHidden, 'cleared');
    });

    it('Ctrl+click on a card selects it without opening it; Shift+click on a card selects the range', async () => {
      const newest = made.toReversed();
      await cardAt(L, newest[0]).locator('button.open').click({ modifiers: ['ControlOrMeta'] });
      await cardAt(L, newest[3]).locator('button.open').click({ modifiers: ['Shift'] });
      const v = await viewWhere(L, (x) => x.selected === 4, 'a range from the cards');
      assert.equal(v.selection, '4 selected');
      assert.equal(await sheetOpen(), true, 'nothing opened');
      await L.click('#hvClear');
    });

    it('the keyboard: arrows move the focus in the grid, Space selects, Shift+arrows extend, Enter opens', async () => {
      const newest = made.toReversed();
      await cardAt(L, newest[0]).locator('button.open').focus();
      const cols = (await view(L)).cols;
      assert.ok(cols >= 3);
      await L.keyboard.press('ArrowRight');
      assert.equal(await focusedIndex(), '1');
      await L.keyboard.press('ArrowDown');
      assert.equal(await focusedIndex(), String(1 + cols));
      await L.keyboard.press('ArrowLeft');
      await L.keyboard.press('ArrowUp');
      assert.equal(await focusedIndex(), '0', 'back where it started');
      await L.keyboard.press(' ');
      await viewWhere(L, (x) => x.selected === 1, 'Space selects');
      assert.equal(await sheetOpen(), true, 'Space does not open');
      await L.keyboard.press('Shift+ArrowRight');
      await L.keyboard.press('Shift+ArrowRight');
      await viewWhere(L, (x) => x.selected === 3, 'Shift+arrows extend');
      assert.deepEqual((await L.evaluate(async () => (await import(`${location.origin}/history-view.js`)).getSelectedIds())), newest.slice(0, 3));
      await L.keyboard.press('End');
      assert.equal(await focusedIndex(), String(cols - 1), 'End: last card of the row');
      await L.keyboard.press('Control+Home');
      assert.equal(await focusedIndex(), '0');
      assert.equal(await L.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).tabIndex), 0, 'the card that holds the keyboard is the one in the tab order');
      await L.keyboard.press('Escape');
      await viewWhere(L, (x) => x.selected === 0, 'Escape clears');
      await L.keyboard.press('ArrowRight');
      await L.keyboard.press('Enter');
      await L.waitForFunction(() => !document.querySelector('#history[open]') && document.querySelectorAll('#hvGrid .hv-card').length === 0);
      await poll(async () => (await L.locator('#strip li[aria-current]').getAttribute('data-id')) === String(newest[1]), { what: 'the second most recent capture opened' });
      await openHistory(L);
    });

    it('Ctrl+A selects every result', async () => {
      await L.locator('#hvGrid .hv-card button.open').first().focus();
      await L.keyboard.press('Control+a');
      await viewWhere(L, (x) => x.selection === '40 selected', 'all 40');
      await L.click('#hvClear');
    });

    it('bulk pin and unpin, in one operation', async () => {
      const newest = made.toReversed();
      for (const id of newest.slice(0, 4)) { await cardAt(L, id).hover(); await box(id).click(); }
      await L.click('#hvPin');
      await poll(async () => (await db(P, 'countShots', { onlyPinned: true })) === 4, { what: 'four pinned' });
      assert.deepEqual(ids((await query(P, { onlyPinned: true })).items), newest.slice(0, 4));
      assert.match(await L.locator('#hvStatus').textContent(), /^4 captures pinned$/);
      assert.equal(await L.locator('#hvGrid .pin[aria-pressed="true"]').count(), 4);
      await L.click('#hvUnpin');
      await poll(async () => (await db(P, 'countShots', { onlyPinned: true })) === 0, { what: 'unpinned' });
      assert.match(await L.locator('#hvStatus').textContent(), /^4 captures unpinned$/);
      await L.click('#hvClear');
    });

    it('bulk delete asks first, with the count, and says what it includes; cancel changes nothing', async () => {
      const newest = made.toReversed();
      await db(P, 'setPinnedMany', [newest[5]], true);
      await db(P, 'updateShot', newest[6], { versions: [{ name: 'V1', crop: null, scale: 1, objects: [] }], active: 0 });
      for (const id of newest.slice(4, 8)) { await cardAt(L, id).hover(); await box(id).click(); }
      await L.click('#hvDelete');
      await L.waitForSelector('#confirmDlg[open]');
      assert.equal(await L.locator('#cfTitle').textContent(), 'Delete 4 captures?');
      const body = await L.locator('#cfBody').innerText();
      assert.match(body, /erased from this browser, with their versions/);
      assert.match(body, /Includes 1 pinned and 1 edited\./);
      const freed = (await db(P, 'listEntries', {})).filter((e) => newest.slice(4, 8).includes(e.id)).reduce((sum, e) => sum + e.bytes, 0);
      assert.ok(body.includes(`This frees ${fmtEn(freed)}.`), `${body} / ${fmtEn(freed)}`);
      assert.equal(await L.locator('#cfTypeRow').isHidden(), true, 'no word to type for a selection');
      assert.equal(await L.evaluate(() => document.activeElement.id), 'cfCancel', 'the focus is never on the red button');
      await L.click('#cfCancel');
      await L.waitForFunction(() => !document.querySelector('#confirmDlg[open]'));
      assert.equal(await db(P, 'countShots'), 40);
      assert.equal((await view(L)).selected, 4, 'the selection is kept');
    });

    it('bulk delete removes the shots and their cards, updates the counts and the strip', async () => {
      const newest = made.toReversed();
      await L.click('#hvDelete');
      await L.waitForSelector('#confirmDlg[open]');
      await L.click('#cfOk');
      await L.waitForFunction(() => !document.querySelector('#confirmDlg[open]'));
      const v = await viewWhere(L, (x) => x.count === '36 captures', 'count updated');
      assert.equal(v.bulkHidden, true);
      assert.ok(!v.ids.some((id) => newest.slice(4, 8).includes(id)));
      assert.match(await L.locator('#hvStatus').textContent(), /^4 captures deleted$/);
      assert.equal(await db(P, 'countShots'), 36);
      assert.deepEqual((await db(P, 'listEntries', {})).map((e) => e.id).filter((id) => newest.slice(4, 8).includes(id)), []);
      assert.equal(await L.locator('#historyAllCount').textContent(), '36', 'the shortcut of the strip follows');
      assert.match(await L.locator('#hvStorageText').textContent(), /^36 captures/);
    });

    it('deleting the capture that is open lets the editor go, and another one opens', async () => {
      await closeSheet();
      await ready();
      const open = Number(await L.locator('#strip li[aria-current]').getAttribute('data-id')); // the capture opened by the keyboard test
      const left = (await db(P, 'countShots')) - 1;
      await openHistory(L);
      await cardAt(L, open).hover();
      await box(open).click();
      await L.click('#hvDelete');
      await L.waitForSelector('#confirmDlg[open]');
      await L.click('#cfOk');
      await L.waitForFunction(() => !document.querySelector('#confirmDlg[open]'));
      await viewWhere(L, (x) => x.count === `${left} captures`, 'one less');
      await closeSheet();
      await poll(async () => (await L.locator('#strip li[aria-current]').count()) === 1, { what: 'another capture opened' });
      assert.notEqual(await L.locator('#strip li[aria-current]').getAttribute('data-id'), String(open));
      await ready();
      assert.equal(await L.locator('#banner').isHidden(), true, 'no "removed from the history" warning: the user deleted it');
    });
  });

  describe('retention when the library opens', () => {
    const day = (n) => NOW - n * DAY;
    const POLICY = { retentionDays: 30, maxBytes: 0 };

    it('applies the retention of the settings after the strip is painted: old plain shots go, pinned and edited ones stay', async () => {
      const made = await fresh([
        ...Array.from({ length: 5 }, (_, i) => row(i + 1, { createdAt: day(60) })), // old and plain
        row(6, { createdAt: day(60), pinned: true }), row(7, { createdAt: day(60), edited: true }),
        ...Array.from({ length: 3 }, (_, i) => row(8 + i, { createdAt: day(1) })),
      ], { policy: POLICY, open: false });
      await L.goto(h.url());
      await L.waitForSelector('#strip li.shot');
      await poll(async () => (await db(P, 'countShots')) === 5, { what: 'the old plain shots were removed' });
      assert.deepEqual(ids((await query(P)).items), [made[9], made[8], made[7], made[6], made[5]]);
      await poll(async () => (await L.locator('#strip li.shot').count()) === 5, { what: 'the strip follows' });
      await shortcutCount('5');
      const marks = await L.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, m.startTime])));
      assert.ok(marks['obturo:strip-painted'] > 0 && marks['obturo:strip-read'] < marks['obturo:strip-painted']);
    });

    it('never removes the capture the library opens, even an old one; the next pass takes it', async () => {
      const made = await fresh(Array.from({ length: 4 }, (_, i) => row(i + 1, { createdAt: day(60 - i) })), { policy: POLICY, open: false });
      await L.goto(h.url());
      await L.waitForSelector('#strip li.shot');
      await poll(async () => (await db(P, 'countShots')) === 1, { what: 'only the open one is left' });
      assert.deepEqual(ids((await query(P)).items), [made[3]]);
      await ready();
      assert.equal(await L.locator('#banner').isHidden(), true, 'the open capture did not vanish under the editor');
    });

    it('a library with the retention off removes nothing', async () => {
      await fresh(Array.from({ length: 4 }, (_, i) => row(i + 1, { createdAt: day(400 - i) })), { policy: OFF });
      await ready();
      await sleep(600);
      assert.equal(await db(P, 'countShots'), 4);
    });
  });

  describe('settings', () => {
    before(async () => {
      await fresh([], { open: false });
    });

    it('the footer of the sheet has Purge now: the dialog opens on top of it, and the sheet follows the purge', async () => {
      await fresh([...Array.from({ length: 10 }, (_, i) => row(i + 1, { createdAt: NOW - 100 * DAY })), ...Array.from({ length: 20 }, (_, i) => row(11 + i))]);
      await ready();
      await openHistory(L);
      await viewWhere(L, (x) => x.count === '30 captures', 'thirty');
      await L.click('#hvPurge');
      await L.waitForSelector('#purgeDlg[open]');
      assert.equal(await sheetOpen(), true, 'the sheet stays under the dialog');
      assert.equal(await L.isChecked('#pgAgeOn'), true, 'it starts on the age of the retention');
      await poll(async () => /To delete: 10 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'preview' });
      await L.click('#pgRun');
      await poll(async () => /Deleted: 10 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'purged' });
      await L.click('#pgClose');
      await viewWhere(L, (x) => x.count === '20 captures' && x.cards === 20, 'the sheet read the history again');
      await closeSheet();
    });

    it('the storage figures of the sheet open the settings on top of it; a purge there is seen by the sheet', async () => {
      await fresh([...Array.from({ length: 10 }, (_, i) => row(i + 1, { createdAt: NOW - 100 * DAY })), ...Array.from({ length: 20 }, (_, i) => row(11 + i))]);
      await ready();
      await openHistory(L);
      await viewWhere(L, (x) => x.count === '30 captures', 'thirty');
      await poll(async () => /^30 captures/.test(await L.locator('#hvStorageText').textContent()), { what: 'storage figures' });
      await L.click('#hvStorage');
      await L.waitForSelector('#settings[open]');
      assert.equal(await sheetOpen(), true, 'the sheet stays under the settings');
      await L.click('#purgeBtn');
      await L.waitForSelector('#purgeDlg[open]');
      await poll(async () => /To delete: 10 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'preview' });
      await L.click('#pgRun');
      await poll(async () => /Deleted: 10 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'purged' });
      await L.click('#pgClose');
      await L.keyboard.press('Escape'); // closes the settings, not the sheet underneath
      await L.waitForFunction(() => !document.querySelector('#settings[open]'));
      assert.equal(await sheetOpen(), true);
      await viewWhere(L, (x) => x.count === '20 captures' && x.cards === 20, 'the sheet read the history again');
      await poll(async () => /^20 captures/.test(await L.locator('#hvStorageText').textContent()), { what: 'storage figures follow' });
      await closeSheet();
    });
    after(async () => {
      await setPolicy(P, OFF);
    });

    it('retention and size cap are choices of the dialog, saved, and shown again; an odd stored value is kept as an option', async () => {
      await fresh(Array.from({ length: 5 }, (_, i) => row(i + 1)));
      await ready();
      await openSettings();
      assert.equal(await L.inputValue('#retentionDays'), '0', 'the retention was turned off for the tests');
      assert.equal(await L.inputValue('#maxBytes'), '0');
      assert.deepEqual(await L.locator('#retentionDays option').allTextContents(), ['7 days', '30 days', '90 days', '1 year', 'Forever']);
      assert.deepEqual(await L.locator('#maxBytes option').allTextContents(), ['500 MB', '1 GB', '2 GB', '5 GB', '10 GB', 'No limit']);
      await L.selectOption('#retentionDays', '90');
      await L.selectOption('#maxBytes', '5000000000');
      await poll(async () => { const s = await settingsOf(); return s.retentionDays === 90 && s.maxBytes === 5e9; }, { what: 'settings saved' });
      await closeSettings();
      await openSettings();
      assert.equal(await L.inputValue('#retentionDays'), '90');
      assert.equal(await L.inputValue('#maxBytes'), '5000000000');
      await closeSettings();

      await setPolicy(P, { retentionDays: 14, maxBytes: 700e6 }); // not in the menus
      await openSettings();
      assert.equal(await L.inputValue('#retentionDays'), '14');
      assert.equal(await L.locator('#retentionDays option:checked').textContent(), '14 d');
      assert.equal(await L.locator('#maxBytes option:checked').textContent(), `700\u00a0MB`);
      await L.selectOption('#retentionDays', '7');
      await poll(async () => (await settingsOf()).retentionDays === 7, { what: 'saved' });
      assert.equal(await L.locator('#retentionDays option[data-custom]').count(), 0, 'the odd option goes once it is not the value');
      await closeSettings();
      await setPolicy(P, OFF);
    });

    it('the gauge says how many captures, how much space, against which limit; and warns near the cap', async () => {
      await fresh(Array.from({ length: 10 }, (_, i) => row(i + 1, { bytes: 90e6 })), { real: 0 });
      await setPolicy(P, { retentionDays: 0, maxBytes: 2e9 });
      await ready();
      await openSettings();
      await poll(async () => /10 captures/.test(await L.locator('#storageText').textContent()), { what: 'gauge text' });
      assert.equal(await L.locator('#storageText').textContent(), `10 captures, ${fmtEn(900e6)} of ${fmtEn(2e9)}`);
      assert.equal(await L.locator('#storageMeter').isVisible(), true);
      assert.equal(await L.locator('#storageMeter').getAttribute('data-level'), 'ok');
      assert.equal(await L.locator('#storageMeter').getAttribute('role'), 'meter');
      assert.equal(await L.locator('#storageMeter').getAttribute('aria-valuenow'), String(900e6));
      assert.equal(await L.locator('#storageMeter').getAttribute('aria-valuemax'), '2000000000');
      assert.match(await L.locator('.dlg-body .note[data-i18n="hist.set.note"]').textContent(), /never removed automatically.*Edited captures are not removed by the age limit/);

      await L.selectOption('#maxBytes', '1000000000'); // 900 MB of 1 GB: 90%
      await poll(async () => (await L.locator('#storageMeter').getAttribute('data-level')) === 'warn', { what: 'warn level' });
      await L.selectOption('#maxBytes', '500000000');
      await poll(async () => (await L.locator('#storageMeter').getAttribute('data-level')) === 'full', { what: 'full level' });
      assert.match(await L.locator('#storagePending').textContent(), /At the next cleanup .*: 5 captures \(450.MB\) to remove\./);
      await L.selectOption('#maxBytes', '0');
      await poll(async () => (await L.locator('#storageMeter').isHidden()), { what: 'no meter without a cap' });
      assert.equal(await L.locator('#storageText').textContent(), `10 captures, ${fmtEn(900e6)}, no size limit`);
      await closeSettings();
      await setPolicy(P, OFF);
    });

    it('Purge now: a preview with numbers before anything is deleted, then the purge', async () => {
      const day = (n) => NOW - n * DAY;
      const rows = [
        ...Array.from({ length: 10 }, (_, i) => row(i + 1, { createdAt: day(100), bytes: 1000 })), // old and plain
        row(11, { createdAt: day(100), bytes: 5000, pinned: true }), row(12, { createdAt: day(100), bytes: 5000, pinned: true }),
        row(13, { createdAt: day(100), bytes: 7000, edited: true }), row(14, { createdAt: day(100), bytes: 7000, edited: true }),
        ...Array.from({ length: 5 }, (_, i) => row(15 + i, { createdAt: day(1), bytes: 2000 })),
      ];
      await fresh(rows, { real: 0 });
      await ready();
      await openSettings();
      await L.click('#purgeBtn');
      await L.waitForSelector('#purgeDlg[open]');
      assert.equal(await L.inputValue('#pgDays'), '30', 'proposes the retention (30 when it is off)');
      await poll(async () => /To delete/.test(await L.locator('#pgPreview').innerText()), { what: 'preview' });
      const text = await L.locator('#pgPreview').innerText();
      assert.match(text, new RegExp(`To delete: 10 captures, freeing ${fmtEn(10_000).replace('.', '\\.')}\\.`));
      assert.match(text, /Kept: 2 pinned, 2 edited\./);
      assert.match(text, new RegExp(`Remaining: 9 captures \\(${fmtEn(34_000).replace('.', '\\.')}\\)\\.`));
      assert.equal(await L.locator('#pgRun').isDisabled(), false);
      assert.equal(await db(P, 'countShots'), 19, 'nothing was deleted by looking');
      assert.deepEqual(await db(P, 'previewPurge', { olderThanDays: 30 }), { deleted: 10, freedBytes: 10_000, overCap: false, keptPinned: 2, keptEdited: 2, remaining: { count: 9, bytes: 34_000 } });

      await L.fill('#pgDays', '200'); // nothing is that old
      await poll(async () => /Nothing to delete/.test(await L.locator('#pgPreview').innerText()), { what: 'nothing' });
      assert.equal(await L.locator('#pgRun').isDisabled(), true);
      await L.fill('#pgDays', '30');
      await L.check('#pgCapOn'); // plus a cap: 1 MB (everything fits)
      await poll(async () => /To delete: 10 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'preview with both' });
      await L.uncheck('#pgAgeOn');
      await poll(async () => /Nothing to delete/.test(await L.locator('#pgPreview').innerText()), { what: 'cap only: all fits' });
      await L.check('#pgAgeOn');

      await L.click('#pgRun');
      await poll(async () => /Deleted: 10 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'purged' });
      assert.match(await L.locator('#pgPreview').innerText(), new RegExp(`Deleted: 10 captures, ${fmtEn(10_000).replace('.', '\\.')} freed\\.`));
      assert.equal(await db(P, 'countShots'), 9);
      assert.equal(await L.locator('#pgRun').isHidden(), true);
      await L.click('#pgClose');
      await L.waitForFunction(() => !document.querySelector('#purgeDlg[open]'));
      await poll(async () => /^9 captures/.test(await L.locator('#storageText').textContent()), { what: 'the gauge reads again' });
      await closeSettings();
      await poll(async () => (await L.locator('#historyAllCount').textContent()) === '9', { what: 'the strip reads again' });
    });

    it('Delete everything: a word to type, a progress, and the library ends up empty', async () => {
      await fresh(Array.from({ length: 620 }, (_, i) => row(i + 1, { pinned: i % 50 === 0 })), { real: 2 });
      await ready();
      await openSettings();
      await L.click('#wipeBtn');
      await L.waitForSelector('#confirmDlg[open]');
      assert.equal(await L.locator('#cfTitle').textContent(), 'Delete the whole history?');
      assert.match(await L.locator('#cfBody').innerText(), /^Everything will be erased from this browser: 620 captures \(.+\), pinned and edited captures included\./);
      assert.equal(await L.locator('#cfTypeLabel').textContent(), 'Type DELETE to confirm');
      assert.equal(await L.locator('#cfOk').isDisabled(), true);
      assert.equal(await L.evaluate(() => document.activeElement.id), 'cfType');
      await L.fill('#cfType', 'delet');
      assert.equal(await L.locator('#cfOk').isDisabled(), true);
      await L.press('#cfType', 'Enter');
      assert.equal(await L.locator('#confirmDlg').evaluate((d) => d.open), true, 'Enter does nothing while the word is wrong');
      assert.equal(await db(P, 'countShots'), 620);
      await L.fill('#cfType', ' Delete ');
      assert.equal(await L.locator('#cfOk').isDisabled(), false);
      await L.click('#cfOk');
      // busy: a progress bar, no way out
      await poll(async () => (await L.locator('#cfProgress').isVisible()) || !(await L.evaluate(() => !!document.querySelector('#confirmDlg[open]'))), { what: 'progress or done' });
      await L.waitForFunction(() => !document.querySelector('#confirmDlg[open]'), null, { timeout: 30_000 });
      assert.equal(await db(P, 'countShots'), 0);
      assert.deepEqual((await db(P, 'listEntries', {})), []);
      await poll(async () => /^0 captures/.test(await L.locator('#storageText').textContent()), { what: 'gauge' });
      await closeSettings();
      await L.waitForSelector('#stageMsg .state-title');
      await poll(async () => (await L.locator('#stageTitle').textContent()) === 'No captures yet', { what: 'empty library' });
      assert.equal(await L.locator('.filmstrip').isVisible(), false);
    });
  });

  describe('language, errors, read-only', () => {
    it('a language change reaches the open sheet at once: texts, dates, counts', async () => {
      await fresh(Array.from({ length: 30 }, (_, i) => row(i + 1)));
      await ready();
      await openHistory(L);
      const en = await L.locator('#hvGrid .hv-sub').first().textContent();
      assert.equal(await L.locator('#historyTitle').textContent(), 'History');
      assert.equal((await view(L)).count, '30 captures');
      assert.equal(await L.getAttribute('#hvQuery', 'placeholder'), 'Search by title or address');
      await seedSettings(P, { language: 'fr' }); // the settings change reaches the library through the BroadcastChannel
      await poll(async () => (await L.locator('#historyTitle').textContent()) === 'Historique', { what: 'French' });
      assert.equal((await view(L)).count, '30 captures');
      await L.fill('#hvQuery', 'page');
      await viewWhere(L, (x) => /r\u00e9sultats$/.test(x.count), 'French results');
      assert.equal(await L.getAttribute('#hvQuery', 'placeholder'), 'Rechercher un titre ou une adresse');
      assert.notEqual(await L.locator('#hvGrid .hv-sub').first().textContent(), en, 'the dates are written in French');
      assert.match(await L.locator('#hvGrid .hv-sub').first().textContent(), /^\d+\s+(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)/);
      assert.equal(await L.getAttribute('#hvGrid .hv-card:first-child .pin', 'aria-label').then((x) => x.startsWith('\u00c9pingler la capture du')), true);
      assert.equal(await L.locator('#hvPinned span').textContent(), `\u00c9pingl${E1}es seulement`);
      await L.click('#hvGrid .hv-card:first-child input[type=checkbox]', { force: true });
      await viewWhere(L, (x) => x.selection === '1 s\u00e9lectionn\u00e9e', 'French selection');
      await L.click('#hvClear');
      await closeSheet();
      await seedSettings(P, { language: 'en' });
      await poll(async () => (await L.locator('#historyAll .more-label').textContent()) === 'All history', { what: 'English again' });
    });

    it('a database that cannot be read: an error with a way to try again', async () => {
      await fresh(Array.from({ length: 15 }, (_, i) => row(i + 1)));
      await ready();
      await L.evaluate(() => { window.__failDb = true; });
      await L.click('#historyBtn');
      await L.waitForSelector('#history[open]');
      const v = await viewWhere(L, (x) => x.state === "Can't read the history", 'error state');
      assert.equal(v.cards, 0);
      assert.equal(await L.locator('#hvState').getAttribute('data-state'), 'error');
      assert.equal(await L.locator('#hvStateAction').textContent(), 'Try again');
      await L.evaluate(() => { window.__failDb = false; });
      await L.click('#hvStateAction');
      const ok = await viewWhere(L, (x) => x.cards === 15 && x.state === null, 'recovered');
      assert.equal(ok.count, '15 captures');
      await closeSheet();
      h.errors.length = 0; // the failure above is the point of the test, and it was logged on purpose
    });

    it('a read-only tab can look and search, but opens, pins and deletes nothing', async () => {
      const made = await fresh(Array.from({ length: 10 }, (_, i) => row(i + 1)));
      await ready(); // L holds the editing lock
      const R = await h.context.newPage();
      try {
        await R.goto(h.url());
        await R.waitForSelector('#strip li.shot');
        await R.waitForFunction(() => document.getElementById('banner') && !document.getElementById('banner').hidden);
        await R.click('#historyBtn');
        await R.waitForSelector('#hvGrid .hv-card');
        assert.match(await R.locator('#hvStatus').textContent(), /read-only/);
        await R.fill('#hvQuery', 'page 7');
        await R.waitForFunction(() => document.getElementById('hvCount').textContent === '1 result');
        await R.fill('#hvQuery', '');
        await R.waitForFunction(() => document.getElementById('hvCount').textContent === '10 captures');
        const card = R.locator(`#hvGrid .hv-card[data-id="${made[9]}"]`);
        await card.hover();
        assert.equal(await card.locator('.pin').isDisabled(), true, 'the pin of a card is disabled (integrity.e2e.mjs forces it)');
        await card.locator('button.open').click();
        await sleep(200);
        assert.equal(await R.evaluate(() => !!document.querySelector('#history[open]')), true, 'a click opens nothing');
        assert.equal(await db(P, 'countShots', { onlyPinned: true }), 0);
        await R.keyboard.press('Escape');
      } finally {
        await R.close();
      }
    });
  });

  it('no console error in any page of the session', () => {
    assert.deepEqual(h.errors, []);
  });
});
