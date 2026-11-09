// Data integrity in the real extension, one scenario per defect found by review (each was proved by running it):
//  - the capture open in the library is never removed, by any path (the service worker, the library pass, "Purge now", the size cap);
//  - a read-only tab changes nothing: no purge, no deletion, no pin, no change of the retention settings;
//  - a change followed at once by a reload or a close is saved; a late thumbnail never replaces the thumbnail of a hidden version;
//  - settings that cannot be read purge nothing, and a setting that cannot be saved says so;
//  - a large purge runs in short transactions, the catalog repair sees a swapped entry, titles and addresses are capped;
//  - the object URL of a thumbnail is revoked when another replaces it.
// Seeds are made-up pages written straight into the stores (support/history.mjs, support/history-ui.mjs).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { DAY, add, assertConsistent, blankPage, breakCatalog, db, madeUp, query, rawDump, seedBulk, setPolicy, wipe } from './support/history.mjs';
import { seedRows } from './support/history-ui.mjs';
import { drag, mapper, poll, ready, seed, seedSettings, sleep, spec, tool, waitOut } from './support/editor.mjs';

const OFF = { retentionDays: 0, maxBytes: 0 };
// A tab that goes less than 100 ms after a change can only hope that the write under way fits. Measured on an idle machine: 0 lost of 200 tries
// (0 to 50 ms, reload and close); 16 of 40 is the loss this test accepts (11 at worst on a shared CI runner), far from the 40 that a save which no longer
// flushes when the tab goes would lose.
const LOST_UNDER_100_MS = 16;
const NOW = Date.now();
const ids = (items) => items.map((s) => s.id);

// A made-up row for seedRows, `days` old.
const row = (i, days, over = {}) => ({
  title: `Shot ${i}`, url: `https://site${i}.example.test/p/${i}`, createdAt: NOW - days * DAY, bytes: 1000, pinned: false, edited: false, thumb: i % 24, ...over,
});
// Old plain rows for seedBulk: whatever the retention is, they are the first to go.
const oldRows = (n, bytes = 100) => Array.from({ length: n }, (_, i) => ({ ...madeUp(i), createdAt: NOW - (200 + i) * DAY, bytes }));
const swAdd = (h, title = 'from the service worker') => h.sw.evaluate(async (title) => __t.db.addShot({
  original: new Blob([new Uint8Array(100)], { type: 'image/png' }), url: 'https://sw.example.test/', title, w: 10, h: 10,
}), title);

/** Average brightness (0 to 255) of the thumbnail stored for a shot, null if there is none. */
const thumbLuminance = (page, id) => page.evaluate(async (id) => {
  const { getShot } = await import(`${location.origin}/db.js`);
  const s = await getShot(id);
  if (!s?.thumb) return null;
  const bitmap = await createImageBitmap(s.thumb);
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const d = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return sum / (d.length / 4);
}, id);

/** Makes the encoding of WebP thumbnails by the library (OffscreenCanvas) take `ms` more, on this page, from its next load. */
const slowThumbs = (page, ms) => page.addInitScript((ms) => {
  const original = OffscreenCanvas.prototype.convertToBlob;
  OffscreenCanvas.prototype.convertToBlob = async function (...args) {
    const blob = await original.apply(this, args);
    if (args[0]?.type === 'image/webp') {
      await new Promise((done) => setTimeout(done, ms));
      /** @type {any} */ (window).__slowDone = true;
    }
    return blob;
  };
}, ms);

/** Makes every transaction on the settings database fail (as a profile that misbehaves could), `only` = just the writes. */
const breakSettings = (target, only = false) => target.evaluate((only) => {
  const w = /** @type {any} */ (globalThis);
  w.__txBefore ??= IDBDatabase.prototype.transaction;
  const before = w.__txBefore;
  IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (stores === 'kv' && (!only || mode === 'readwrite')) throw new DOMException('simulated failure', 'UnknownError');
    return before.call(this, stores, mode, ...rest);
  };
}, only);
const fixSettings = (target) => target.evaluate(() => {
  const w = /** @type {any} */ (globalThis);
  if (w.__txBefore) IDBDatabase.prototype.transaction = w.__txBefore;
});

describe('integrity', () => {
  let h, P, L;

  before(async () => {
    h = await launchExtension({ hook: true, size: { width: 1280, height: 800 } });
    await h.context.addInitScript(() => { try { localStorage.setItem('obturo-strip', 'open'); } catch { /* a page with no storage */ } }); // this window is shorter than 900 px: the strip starts folded without it
    P = await blankPage(h);
    L = await h.context.newPage();
    L.on('dialog', (d) => d.accept());
  });
  after(async () => {
    await setPolicy(P, { retentionDays: 30, maxBytes: 2 * 1024 ** 3 }).catch(() => {});
    await h?.close();
  });

  const present = async () => ids((await query(P, { limit: 1000 })).items);
  // An empty database and the given rows (the last one is a real picture), then the library opened on it: it opens the
  // highest id, whatever its date.
  async function openLibraryOn(rows, { policy = OFF, page = L } = {}) {
    await page.goto(h.url('manifest.json'));
    await wipe(P);
    await setPolicy(P, policy);
    await seedSettings(P, { language: 'en', theme: 'light' });
    const made = await seedRows(P, rows, { real: 1 });
    await page.goto(h.url());
    await ready(page);
    await waitOut(page, 1280, 720);
    return made;
  }

  describe('the capture open in the library is never removed (D1, D2)', () => {
    it('not by a capture from the service worker, the library pass, "Purge now" or the size cap', async () => {
      const [open] = (await openLibraryOn([row(99, 100)])).slice(-1);
      assert.equal(Number(await L.locator('#strip li[aria-current]').getAttribute('data-id')), open);

      // 1. the retention that the service worker applies after a capture
      await setPolicy(P, { retentionDays: 30, maxBytes: 0 });
      await seedBulk(P, oldRows(2));
      const added = await swAdd(h);
      assert.deepEqual(await present(), [added, open], 'the old plain shots went, the open one stayed');

      // 2. the pass of another context (no shot is named: the library is not asked)
      await seedBulk(P, oldRows(2));
      await db(P, 'runRetention'); // (the pass the library runs by itself when it opens may take them first: what counts is what is left)
      assert.deepEqual(await present(), [added, open]);

      // 3. "Purge now"
      await seedBulk(P, oldRows(2));
      await db(P, 'purgeNow', { olderThanDays: 30 });
      assert.deepEqual(await present(), [added, open]);

      // 4. the size cap: it would take everything, the open capture stays
      await setPolicy(P, { retentionDays: 0, maxBytes: 1 });
      const result = await db(P, 'runRetention');
      assert.deepEqual(await present(), [open], 'the cap took the others');
      assert.equal(result.overCap, true, 'the open capture alone is over the cap');
      await swAdd(h, 'one more');
      assert.ok((await present()).includes(open), 'a capture under the cap does not take the open one either');

      // the editor was never told the shot was gone, and still saves into it
      assert.equal(await L.locator('#banner').isHidden(), true, 'no "removed from the history" banner');
      const m = await mapper(L, 1280, 720);
      await tool(L, 'rect');
      await drag(L, m, 100, 100, 300, 200);
      await poll(async () => (await db(P, 'getShot', open))?.versions.length === 1, { what: 'the change is saved into the open shot' });
      await setPolicy(P, OFF);
    });

    it('a library tab that is gone protects nothing: its shot goes with the next pass', async () => {
      const [open] = (await openLibraryOn([row(1, 100), row(99, 100)])).slice(-1);
      await setPolicy(P, { retentionDays: 30, maxBytes: 0 });
      await db(P, 'runRetention'); // (or the pass of the library itself, when it opens)
      assert.deepEqual(await present(), [open], 'the other old shot goes, the open one stays');
      // the tab goes away without clearing what it published (a crash would not either; the pages of an extension share one
      // process, so one of them cannot be crashed alone): the browser releases its lock, and that is what the retention looks at
      await L.close();
      L = await h.context.newPage();
      L.on('dialog', (d) => d.accept());
      await poll(() => P.evaluate(async () => !(await navigator.locks.query()).held?.some((l) => l.name === 'obturo-lib')), { what: 'the lock of the dead tab is released' });
      assert.equal((await db(P, 'runRetention')).deleted, 1, 'nobody holds it open any more');
      assert.deepEqual(await present(), []);
    });

    it('"Purge now" in the dialog counts without the open capture, and keeps it', async () => {
      const made = await openLibraryOn([row(1, 100), row(2, 100), row(3, 1), row(99, 100)]);
      const open = made.at(-1);
      await L.click('#settingsBtn');
      await L.waitForSelector('#settings[open]');
      await L.click('#purgeBtn');
      await L.waitForSelector('#purgeDlg[open]');
      await poll(async () => /To delete: 2 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'the preview leaves the open capture out' });
      await L.click('#pgRun');
      await poll(async () => /Deleted: 2 captures/.test(await L.locator('#pgPreview').innerText()), { what: 'purged' });
      await L.click('#pgClose');
      assert.deepEqual(await present(), [open, made[2]]);
      assert.equal(await L.locator('#banner').isHidden(), true, 'the editor was not left holding a capture that is gone');
      await L.keyboard.press('Escape');
    });
  });

  describe('a read-only tab changes nothing (D3)', () => {
    it('purge, delete everything, pin, delete and the retention settings are disabled, and refuse when forced', async () => {
      const made = await openLibraryOn(Array.from({ length: 6 }, (_, i) => row(i + 1, 100)));
      const R = await h.context.newPage();
      R.on('dialog', (d) => d.accept());
      try {
        await R.goto(h.url());
        await R.waitForSelector('#strip li.shot');
        await R.waitForFunction(() => document.getElementById('banner') && !document.getElementById('banner').hidden);
        const settingsOf = () => P.evaluate(async () => (await import(`${location.origin}/settings.js`)).getSettings());

        // the settings dialog
        await R.click('#settingsBtn');
        await R.waitForSelector('#settings[open]');
        for (const id of ['purgeBtn', 'wipeBtn', 'retentionDays', 'maxBytes']) assert.equal(await R.locator(`#${id}`).isDisabled(), true, `${id} is disabled`);
        assert.equal(await R.locator('#histReadonly').isVisible(), true, 'the dialog says why');
        assert.equal(await R.locator('#settingsForm select[name="language"]:not(:disabled)').count() > 0, true, 'the other settings stay usable');
        await R.evaluate(() => { for (const id of ['purgeBtn', 'wipeBtn', 'retentionDays', 'maxBytes']) /** @type {HTMLButtonElement} */ (document.getElementById(id)).disabled = false; });
        await R.click('#purgeBtn');
        await R.click('#wipeBtn');
        await R.selectOption('#retentionDays', '7');
        await sleep(400);
        assert.equal(await R.evaluate(() => !!document.querySelector('#purgeDlg[open], #confirmDlg[open]')), false, 'no dialog opens');
        assert.equal((await settingsOf()).retentionDays, 0, 'the retention is unchanged');
        assert.equal(await db(P, 'countShots'), 6);
        await R.keyboard.press('Escape');
        await R.waitForFunction(() => !document.querySelector('#settings[open]'));

        // the strip and the header
        assert.equal(await R.locator('#strip .del:not(:disabled)').count(), 0, 'the delete buttons of the strip are disabled');
        assert.equal(await R.locator('#pin').isDisabled(), true);

        // the history sheet
        await R.click('#historyBtn');
        await R.waitForSelector('#hvGrid .hv-card');
        assert.equal(await R.locator('#hvGrid .hv-card .pin:not(:disabled)').count(), 0, 'the pin of a card is disabled');
        await R.click('#hvGrid .hv-card:first-child input[type=checkbox]', { force: true });
        await R.waitForSelector('#hvBulk:not([hidden])');
        for (const id of ['hvPin', 'hvUnpin', 'hvDelete']) assert.equal(await R.locator(`#${id}`).isDisabled(), true, `${id} is disabled`);
        await R.evaluate(() => { for (const id of ['hvPin', 'hvUnpin', 'hvDelete']) /** @type {HTMLButtonElement} */ (document.getElementById(id)).disabled = false; });
        await R.click('#hvDelete');
        await R.click('#hvPin');
        await sleep(300);
        assert.equal(await R.evaluate(() => !!document.querySelector('#confirmDlg[open]')), false, 'no confirmation opens');
        assert.equal(await db(P, 'countShots', { onlyPinned: true }), 0);
        assert.equal(await db(P, 'countShots'), 6);
        assert.deepEqual(await present(), made.toReversed());
      } finally {
        await R.close();
      }
    });
  });

  describe('a change followed by a reload or a close of the tab is saved (D4)', () => {
    // `count` shots that nobody has edited, oldest first.
    async function freshShots(count) {
      await L.goto(h.url('manifest.json')); // the other tab lets go of the editing lock
      await wipe(P);
      await setPolicy(P, OFF);
      await seedSettings(P, { language: 'en' });
      for (let i = 0; i < count; i++) await seed(P, spec(`D4 ${i}`, 800, 600, false));
      return ids((await query(P, { limit: 1000 })).items).toReversed();
    }
    const edit = async (page) => { // the first change of a shot: a black flat, which creates V1
      const m = await mapper(page, 800, 600);
      await tool(page, 'flat');
      await drag(page, m, 100, 100, 300, 200, 3);
    };
    const opened = async (page, id) => {
      await page.goto(h.url(`library.html#shot=${id}`));
      await ready(page);
      await waitOut(page, 800, 600);
    };
    const saved = async (id) => {
      try {
        await poll(async () => (await db(P, 'getShot', id))?.versions.length === 1, { timeout: 1500, what: 'saved' });
        return true;
      } catch {
        return false;
      }
    };
    // One try per delay: edits a shot, waits `delay` ms, reloads the tab or closes it, and looks in the database. A reload goes
    // to the next shot, which is the next try. Returns what was lost, like ['reload after 10 ms'].
    async function lossRun(mode, delays) {
      const shots = await freshShots(delays.length + 1);
      const lost = [];
      let page = await h.context.newPage();
      page.on('dialog', (d) => d.accept());
      try {
        if (mode === 'reload') await opened(page, shots[0]);
        for (const [i, delay] of delays.entries()) {
          if (mode === 'close') {
            page = await h.context.newPage();
            page.on('dialog', (d) => d.accept());
            await opened(page, shots[i]);
          }
          await edit(page);
          await sleep(delay);
          if (mode === 'reload') {
            await page.evaluate((next) => history.replaceState(null, '', `#shot=${next}`), shots[i + 1]);
            await page.reload();
            await ready(page);
            await waitOut(page, 800, 600);
          } else {
            await page.close();
          }
          if (!(await saved(shots[i]))) lost.push(`${mode} after ${delay} ms`);
        }
      } finally {
        await page.close().catch(() => {});
      }
      return lost;
    }

    it('the versions are written first, a moment after the change, and a slow thumbnail never delays them', async () => {
      await freshShots(1);
      const [id] = ids((await query(P)).items);
      const T = await h.context.newPage();
      T.on('dialog', (d) => d.accept());
      await T.addInitScript(() => { // the thumbnail of the editor takes 3 s to encode
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          if (type === 'image/webp') setTimeout(() => original.call(this, callback, type, quality), 3000);
          else original.call(this, callback, type, quality);
        };
      });
      try {
        await opened(T, id);
        const m = await mapper(T, 800, 600);
        await tool(T, 'flat');
        await drag(T, m, -8, -8, 808, 608, 3); // the whole image
        // the order of the writes, observed: the versions are in the database long before the thumbnail can be
        await poll(async () => (await db(P, 'getShot', id)).versions.length === 1, { timeout: 1500, what: 'the versions are written within a moment of the change' });
        const early = await thumbLuminance(P, id);
        assert.ok(early === null || early > 150, 'the black thumbnail cannot be there yet: it takes 3 s to encode');
        await poll(async () => ((await thumbLuminance(P, id)) ?? 255) < 10, { timeout: 12_000, what: 'the thumbnail of the hidden version follows' });
      } finally {
        await T.close();
      }
    });

    it('20 tries each of a reload and a close, from 100 ms after the change: none is lost', async (t) => {
      const delays = Array.from({ length: 20 }, (_, i) => [100, 250, 450][i % 3]);
      const lost = [...await lossRun('reload', delays), ...await lossRun('close', delays)];
      t.diagnostic(`saved ${40 - lost.length} of 40${lost.length ? `; lost: ${lost.join(', ')}` : ''}`);
      assert.deepEqual(lost, [], 'a change older than 100 ms is in the database before the tab goes');
    });

    it('under 100 ms, best effort: the write under way when the tab goes usually fits (measured, a few lost at worst)', async (t) => {
      const delays = Array.from({ length: 20 }, (_, i) => [0, 10, 25, 50][i % 4]);
      const lost = [...await lossRun('reload', delays), ...await lossRun('close', delays)];
      t.diagnostic(`saved ${40 - lost.length} of 40${lost.length ? `; lost: ${lost.join(', ')}` : ''}`);
      assert.ok(lost.length <= LOST_UNDER_100_MS, `${lost.length} of 40 lost: ${lost.join(', ')}`);
    });
  });

  describe('a late thumbnail never replaces the thumbnail of a hidden version (D5)', () => {
    it('the original is rendered slowly, the user hides the whole image meanwhile: the thumbnail stays black', async () => {
      await wipe(P);
      await setPolicy(P, OFF);
      await seedSettings(P, { language: 'en' });
      const [id] = await seedRows(P, [row(1, 1, { thumb: -1 })], { real: 1 }); // no thumbnail yet: the library makes it from the original
      await L.goto(h.url('manifest.json')); // the other tab lets go of the editing lock
      const T = await h.context.newPage();
      try {
        await slowThumbs(T, 4000);
        await T.goto(h.url());
        await ready(T);
        await waitOut(T, 1280, 720);
        const m = await mapper(T, 1280, 720);
        await tool(T, 'flat');
        await drag(T, m, -8, -8, 1288, 728);
        await poll(async () => ((await thumbLuminance(P, id)) ?? 255) < 10 && (await db(P, 'getShot', id)).versions.length === 1, { what: 'the black thumbnail of V1 is stored', timeout: 8000 });
        assert.equal(await T.evaluate(() => !!(/** @type {any} */ (window).__slowDone)), false, 'the slow thumbnail has not landed yet');
        await T.waitForFunction(() => (/** @type {any} */ (window).__slowDone) === true, null, { timeout: 15_000 });
        await sleep(800); // its write
        assert.ok((await thumbLuminance(P, id)) < 10, 'the original (light) replaced the thumbnail of the hidden version');
        assert.equal((await db(P, 'getShot', id)).versions.length, 1);
      } finally {
        await T.close();
      }
    });
  });

  describe('settings that cannot be read or saved (D6)', () => {
    it('unreadable settings purge nothing, in a page and in the service worker', async () => {
      await wipe(P);
      await setPolicy(P, OFF); // the user chose "Forever" and "No limit"
      const old = await seedBulk(P, oldRows(3));
      await breakSettings(P);
      try {
        assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false }, 'the page pass');
      } finally {
        await fixSettings(P);
      }
      await breakSettings(h.sw);
      let added;
      try {
        added = await swAdd(h);
      } finally {
        await fixSettings(h.sw);
      }
      assert.deepEqual(await present(), [added, ...old.toReversed()], 'the capture of the service worker removed nothing');
      // readable again: the user's choice still holds
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false });
    });

    it('values out of range still fall back to the defaults (30 days, 2 GB)', async () => {
      await wipe(P);
      await P.evaluate(async () => {
        await new Promise((ok, ko) => {
          const r = indexedDB.open('obturo-settings', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({ retentionDays: -5, maxBytes: 1.5 }, 'settings');
            tx.oncomplete = () => { r.result.close(); ok(undefined); };
            tx.onerror = () => ko(tx.error);
          };
          r.onerror = () => ko(r.error);
        });
      });
      await seedBulk(P, oldRows(2));
      assert.equal((await db(P, 'runRetention')).deleted, 2, 'a corrupted value is replaced by the default, which removes what is older than 30 days');
      await setPolicy(P, OFF);
    });

    it('a setting that cannot be saved says so in the dialog; saving again clears it', async () => {
      await openLibraryOn([row(1, 1)]);
      await L.click('#settingsBtn');
      await L.waitForSelector('#settings[open]');
      assert.equal(await L.locator('#settingsError').isHidden(), true);
      await breakSettings(L, true);
      await L.selectOption('#retentionDays', '90');
      await L.waitForSelector('#settingsError:not([hidden])');
      assert.match(await L.locator('#settingsError').innerText(), /couldn't be saved/i);
      await fixSettings(L);
      await L.selectOption('#retentionDays', '7');
      await L.waitForSelector('#settingsError', { state: 'hidden' });
      assert.equal((await P.evaluate(async () => (await import(`${location.origin}/settings.js`)).getSettings())).retentionDays, 7);
      await L.keyboard.press('Escape');
      await setPolicy(P, OFF);
    });
  });

  describe('a large purge (D7, D8)', () => {
    it('runs in short transactions: an autosave no longer waits for all of it, and the database stays consistent between them', async (t) => {
      await L.goto(h.url('manifest.json')); // no library holds a shot open (the ids below start again at 1)
      await wipe(P);
      await setPolicy(P, OFF);
      const N = 3480;
      const keepers = 480;
      const rows = Array.from({ length: N }, (_, i) => ({ ...madeUp(i), createdAt: NOW - (i < N - keepers ? 100 : 1) * DAY + i, bytes: 3000, pinned: i === 5 }));
      const made = await seedBulk(P, rows);
      const target = made.at(-1);
      const Q = await blankPage(h);
      const S = await blankPage(h);
      try {
        // an autosave every ~15 ms, from another page, with the time each write took
        const writes = Q.evaluate(async (id) => {
          const { updateShot } = await import(`${location.origin}/db.js`);
          const out = [];
          while (!(/** @type {any} */ (window).__stop)) {
            const start = performance.now();
            await updateShot(id, { active: -1, versions: [] });
            out.push(performance.now() - start);
            await new Promise((done) => setTimeout(done, 15));
          }
          return out;
        }, target);
        // a reader that checks, between the lots, that shots, originals and catalog list the same captures
        const checks = S.evaluate(async () => {
          const conn = await new Promise((ok, ko) => { const r = indexedDB.open('obturo'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
          const wait = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
          const { parseBucket } = await import(`${location.origin}/catalog.js`);
          const seen = [];
          while (!(/** @type {any} */ (window).__stop)) {
            const tx = conn.transaction(['shots', 'originals', 'catalog']);
            const [a, b, c] = await Promise.all([wait(tx.objectStore('shots').getAllKeys()), wait(tx.objectStore('originals').getAllKeys()), wait(tx.objectStore('catalog').getAll())]);
            const fromCatalog = c.flatMap(parseBucket).map((e) => e.id);
            seen.push({ shots: a.length, same: JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(fromCatalog) });
            await new Promise((done) => setTimeout(done, 40));
          }
          conn.close();
          return seen;
        });
        await sleep(200);
        const started = Date.now();
        const capture = (async () => { // a capture arrives in the middle of the purge
          await sleep(1000);
          const s = Date.now();
          const id = await swAdd(h);
          return { id, ms: Date.now() - s };
        })();
        const purged = await db(P, 'purgeNow', { olderThanDays: 30 });
        const purgeMs = Date.now() - started;
        const arrived = await capture;
        await Q.evaluate(() => { /** @type {any} */ (window).__stop = true; });
        await S.evaluate(() => { /** @type {any} */ (window).__stop = true; });
        const latencies = await writes;
        const seen = await checks;
        const worst = Math.max(...latencies);
        t.diagnostic(`purge of ${purged.deleted} shots: ${purgeMs} ms; worst autosave ${Math.round(worst)} ms over ${latencies.length}; capture during the purge ${arrived.ms} ms; ${seen.length} consistency checks`);
        assert.equal(purged.deleted, N - keepers - 1, 'every old shot but the pinned one');
        // In one transaction the purge made every write wait for all of it (8 writes in 5 s, the worst as long as the purge itself).
        // By lots they go through in between: the absolute wait depends on the disk and the antivirus (130 ms to 3 s measured on
        // this machine, 300 ms is the budget of the bench), so the test checks the shape: many writes, none that waited for most of the purge (a disk spike of a second is allowed for).
        assert.ok(latencies.length >= 25, `only ${latencies.length} autosaves went through during the purge`);
        assert.ok(worst < purgeMs * 0.6, `an autosave waited ${Math.round(worst)} ms of the ${purgeMs} ms of the purge`);
        assert.ok(arrived.ms < purgeMs * 0.6, `a capture waited ${arrived.ms} ms of the ${purgeMs} ms of the purge`);
        assert.ok(seen.every((x) => x.same), 'between two lots the three stores list the same captures');
        assert.ok(seen.some((x) => x.shots > keepers + 2 && x.shots < N), 'the purge was seen half done: it runs in lots');
        const dump = await rawDump(P);
        assertConsistent(dump, 'after the large purge');
        assert.ok(dump.shots.some((s) => s.id === made[5] && s.pinned), 'the pinned shot stayed');
        assert.ok(dump.shots.some((s) => s.id === arrived.id), 'the new capture stayed');
      } finally {
        await Q.close();
        await S.close();
      }
    });

    it('the repair sees a catalog that holds the right number of entries but not the right ones', async () => {
      await wipe(P);
      await setPolicy(P, OFF);
      await seedBulk(P, Array.from({ length: 40 }, (_, i) => ({ ...madeUp(i), createdAt: NOW - (40 - i) * DAY, bytes: 50 + i })));
      await breakCatalog(P, 'swap');
      const broken = await rawDump(P);
      assert.equal(Object.values(broken.catalog).flat().length, 40, 'the count is right');
      assert.throws(() => assertConsistent(broken, 'swapped'), 'the check does see the damage');
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false });
      assertConsistent(await rawDump(P), 'after the pass');
    });
  });

  describe('titles and addresses are capped where a shot is added (D9)', () => {
    it('a 2 MB address and a 5,000-character title are cut; ordinary ones are not touched', async () => {
      await wipe(P);
      await setPolicy(P, OFF);
      const big = await P.evaluate(async () => {
        const { addShot } = await import(`${location.origin}/db.js`);
        return addShot({
          original: new Blob([new Uint8Array(10)], { type: 'image/png' }), w: 10, h: 10,
          url: `https://big.example.test/${'a'.repeat(2 * 1024 * 1024)}`, title: `needle ${'t'.repeat(5000)}`,
        });
      });
      const small = await add(P, { title: 'Short title', url: 'https://ok.example.test/x?y=1' });
      const dump = await rawDump(P);
      const [a, b] = dump.shots;
      assert.deepEqual([a.id, a.title.length, a.url.length, a.host], [big, 300, 2048, 'big.example.test']);
      assert.deepEqual([b.id, b.title, b.url], [small, 'Short title', 'https://ok.example.test/x?y=1']);
      const entry = Object.values(dump.catalog).flat().find((e) => e.id === big);
      assert.ok(entry.q.length <= 300 + 1 + 2048, `the search key is ${entry.q.length} characters`);
      assert.deepEqual(ids((await query(P, { query: 'needle' })).items), [big], 'the part that is kept is still searchable');
      assertConsistent(dump, 'capped');
    });
  });

  describe('thumbnail object URLs (D10)', () => {
    it('a thumbnail that lands on a card that already shows one revokes the old URL', async () => {
      await wipe(P);
      await setPolicy(P, OFF);
      await seedSettings(P, { language: 'en' });
      const made = await seedRows(P, Array.from({ length: 4 }, (_, i) => row(i + 1, 1, { thumb: -1 })), { real: 4 });
      await L.goto(h.url('manifest.json')); // the other tab lets go of the editing lock
      const T = await h.context.newPage();
      try {
        await slowThumbs(T, 1500);
        await T.goto(h.url());
        await ready(T);
        await T.click('#historyBtn');
        await T.waitForSelector('#hvGrid .hv-card');
        // while the cards wait for their thumbnails, another way brings them to the database, and the sheet reads again
        await P.evaluate(async (ids) => {
          const { updateShot } = await import(`${location.origin}/db.js`);
          const thumb = new Blob([new Uint8Array(200).fill(2)], { type: 'image/webp' });
          for (const id of ids) await updateShot(id, { thumb });
        }, made);
        await T.evaluate(() => document.dispatchEvent(new CustomEvent('obturo:history-changed', { detail: { reason: 'purged' } })));
        await sleep(4500); // the slow renderings land
        await T.click('#hvClose');
        await T.waitForFunction(() => !document.querySelector('#history[open]'));
        // the cards give their URLs back in the 'close' event, a task after the dialog is closed: wait for it; a leaked URL never goes
        const count = () => T.evaluate(() => ({ live: window.__c.urlLive.size, strip: document.querySelectorAll('#strip img[src^="blob:"]').length }));
        await poll(async () => { const u = await count(); return u.live === u.strip; }, { timeout: 3000, what: 'every object URL of the sheet revoked' }).catch(() => {});
        const urls = await count();
        assert.equal(urls.live, urls.strip, 'object URLs left alive by the sheet');
      } finally {
        await T.close();
      }
    });
  });

  it('no unexpected console error in any page of the session', () => {
    // the failures above are the point of their tests, and the library logs them on purpose
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), []);
  });
});
