// The history in the real extension: the move from database version 2 to 3, pagination, search, pinning, manual purge,
// the retention applied by addShot (age and size), and several contexts writing at once. The database is read back raw
// after each scenario and checked against what db.js promises (assertConsistent).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  DAY, add, assertConsistent, blankPage, breakCatalog, db, madeUp, query, rawDump, seedBulk, seedV2, setPolicy, walk, wipe,
} from './support/history.mjs';
import { entryOf } from '../../catalog.js';
import { planPurge } from '../../retention.js';

const OFF = { retentionDays: 0, maxBytes: 0 };
const ids = (items) => items.map((s) => s.id);
const sum = (list) => list.reduce((a, b) => a + b, 0);

describe('history', () => {
  let h, P;
  const now = Date.now();
  // A row for seedBulk: `days` old, `bytes` big, flags p (pinned) and e (edited).
  const row = (i, days, bytes = 100, flags = '', over = {}) => ({
    ...madeUp(i), createdAt: now - days * DAY + i, bytes, pinned: flags.includes('p'), edited: flags.includes('e'), ...over,
  });
  // An empty database and no retention: each scenario sets up what it needs.
  const fresh = async (policy = OFF) => {
    await wipe(P);
    await setPolicy(P, policy);
    await db(P, 'countShots'); // creates the database at the current version
  };
  const dump = async (what, options) => {
    const d = await rawDump(P, options);
    assertConsistent(d, what);
    return d;
  };

  before(async () => {
    h = await launchExtension({ hook: true });
    P = await blankPage(h);
  });
  after(async () => {
    await setPolicy(P, { retentionDays: 30, maxBytes: 2 * 1024 ** 3 }).catch(() => {});
    await h?.close();
  });

  describe('database versions', () => {
    it('a new install gets version 3 straight away', async () => {
      await wipe(P);
      assert.deepEqual(await db(P, 'countShots'), 0);
      const d = await dump('new install');
      assert.equal(d.autoIncrement, true);
      assert.deepEqual(d.shots, []);
    });

    it('version 2 -> 3 keeps every shot and every original, adds host, bytes, pinned, the host index and the catalog', async () => {
      const rows = [
        { url: 'https://alpha.example.test/a?x=1', title: 'Alpha', w: 800, h: 600, createdAt: 1_700_000_000_000, versions: [], active: -1, originalBytes: 3000, thumbBytes: 500 },
        { url: 'https://beta.example.test:8443/b', title: 'Beta, edited', w: 1920, h: 1080, createdAt: 1_700_000_100_000, versions: [{ name: 'V1', crop: null, scale: 1, objects: [{ type: 'Rect', left: 3 }] }], active: 0, originalBytes: 5000 },
        { url: 'not an address', title: 'Gamma', w: 10, h: 10, createdAt: 1_700_000_200_000, versions: [], active: -1, originalBytes: 1 },
      ];
      await setPolicy(P, OFF);
      await seedV2(P, rows);
      const old = await rawDump(P, { hashes: true });
      assert.equal(old.version, 2);
      assert.deepEqual(old.stores, ['originals', 'shots']);
      assert.deepEqual(old.shotIndexes, []);
      assert.equal(old.shots.length, 3);

      assert.equal(await db(P, 'countShots'), 3, 'the upgrade runs when the database is first used');
      const upgraded = await dump('after the upgrade', { hashes: true });
      const kept = (s) => ({ id: s.id, url: s.url, title: s.title, w: s.w, h: s.h, createdAt: s.createdAt, versions: s.versions, active: s.active, thumb: s.thumb });
      assert.deepEqual(upgraded.shots.map(kept), old.shots.map(kept), 'rows are unchanged');
      assert.deepEqual(upgraded.originals, old.originals, 'originals are unchanged, byte for byte');
      assert.deepEqual(upgraded.shots.map((s) => [s.host, s.bytes, s.pinned]), [['alpha.example.test', 3000, false], ['beta.example.test:8443', 5000, false], ['', 1, false]]);
      assert.deepEqual(Object.values(upgraded.catalog).flat().map((e) => [e.id, e.edited]), [[1, false], [2, true], [3, false]]);

      // the upgraded database works: reads, search, a new shot continues the ids
      assert.deepEqual(ids((await query(P)).items), [3, 2, 1]);
      assert.deepEqual(ids((await query(P, { query: 'BETA' })).items), [2]);
      assert.deepEqual(ids((await query(P, { host: 'alpha.example.test' })).items), [1]);
      assert.equal(await add(P), 4);
      await dump('after a new shot');
    });

    it('an older layout (version 1) is dropped and recreated empty', async () => {
      await seedV2(P, [], 1);
      assert.equal(await db(P, 'countShots'), 0);
      assert.deepEqual((await dump('from version 1')).shots, []);
      assert.equal(await add(P), 1);
    });
  });

  describe('reading', () => {
    it('an empty history', async () => {
      await fresh();
      assert.deepEqual(await query(P), { items: [], next: null, total: 0 });
      assert.deepEqual(await query(P, { query: 'anything' }), { items: [], next: null, total: 0 });
      assert.equal(await db(P, 'countShots', { onlyPinned: true }), 0);
      assert.deepEqual(await db(P, 'listHosts'), []);
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false });
      const usage = await db(P, 'storageUsage');
      assert.deepEqual([usage.count, usage.bytes], [0, 0]);
    });

    it('pages go from the most recent to the oldest, `next` chains them, `total` counts everything', async () => {
      await fresh();
      const all = await seedBulk(P, Array.from({ length: 130 }, (_, i) => row(i, 130 - i)));
      const newestFirst = all.toReversed();

      const first = await query(P, { limit: 50 });
      assert.deepEqual([first.items.length, first.total, first.next], [50, 130, newestFirst[49]]);
      assert.deepEqual(ids(first.items), newestFirst.slice(0, 50));
      assert.ok(first.items.every((s) => s.thumb > 0 && !('original' in s)), 'thumbnails in, originals never');

      const byDefault = await query(P);
      assert.deepEqual([byDefault.items.length, byDefault.next], [60, newestFirst[59]], 'the default page holds 60 shots');

      const { ids: walked, pages } = await walk(P, { limit: 50 });
      assert.deepEqual(walked, newestFirst);
      assert.deepEqual(pages.map((p) => p.items.length), [50, 50, 30]);
      assert.ok(pages.every((p) => p.total === 130));
      assert.equal(pages.at(-1).next, null);

      // the same pages come out of the catalog (a date bound that keeps everything forces that path)
      const viaCatalog = await walk(P, { limit: 50, from: 1 });
      assert.deepEqual(viaCatalog.ids, newestFirst);
      assert.deepEqual(viaCatalog.pages.map((p) => [p.next, p.total]), pages.map((p) => [p.next, p.total]));

      assert.deepEqual((await query(P, { before: all[0] })).items, [], 'nothing older than the oldest');
      assert.deepEqual((await query(P, { before: 1e9, limit: 3 })).items.map((s) => s.id), newestFirst.slice(0, 3));
      assert.equal((await query(P, { limit: 100000 })).items.length, 130, 'an oversized page is capped, not refused');
      assert.equal((await query(P, { limit: 0 })).items.length, 60, 'an invalid size falls back to the default');
      assert.equal(await db(P, 'countShots'), 130);
      await dump('130 shots');
    });

    it('a host alone is read through its index, page after page, like the catalog does', async () => {
      await fresh();
      const all = await seedBulk(P, Array.from({ length: 300 }, (_, i) => row(i, 300 - i, 50, '', { title: `t${i}`, url: `https://h${i % 3}.example.test/${i}` })));
      const mine = all.filter((_, i) => i % 3 === 1).toReversed();
      const direct = await walk(P, { host: 'h1.example.test', limit: 7 });
      assert.deepEqual(direct.ids, mine);
      assert.deepEqual(direct.pages.map((p) => p.items.length), [...Array(14).fill(7), 2]);
      assert.ok(direct.pages.every((p) => p.total === 100));
      const viaCatalog = await walk(P, { host: 'h1.example.test', limit: 7, from: 1 });
      assert.deepEqual(viaCatalog.ids, mine);
      assert.deepEqual(viaCatalog.pages.map((p) => p.next), direct.pages.map((p) => p.next));
      assert.deepEqual((await query(P, { host: 'H1.Example.TEST', limit: 2 })).items.map((s) => s.id), mine.slice(0, 2), 'host is not case sensitive');
      assert.deepEqual(await query(P, { host: 'h9.example.test' }), { items: [], next: null, total: 0 });
      assert.equal(await db(P, 'countShots', { host: 'h2.example.test' }), 100);
      assert.deepEqual(await db(P, 'listHosts'), [{ host: 'h0.example.test', count: 100 }, { host: 'h1.example.test', count: 100 }, { host: 'h2.example.test', count: 100 }]);
    });

    it('search ignores case and accents, looks in the title and the address, and combines with the other filters', async () => {
      await fresh();
      const at = (days) => now - days * DAY;
      const [dec, jan, cafe, resume, ticket] = await seedBulk(P, [
        { title: 'Facture d\u00e9cembre', url: 'https://compta.example.test/invoices?id=1', createdAt: at(5), bytes: 10 },
        { title: 'FACTURE Janvier', url: 'https://compta.example.test/invoices?id=2', createdAt: at(4), bytes: 10 },
        { title: 'Caf\u00e9 du coin', url: 'https://carte.example.test/menu', createdAt: at(3), bytes: 10, pinned: true },
        { title: 'R\u00e9sum\u00e9 annuel', url: 'https://wiki.example.test/R%C3%A9sum%C3%A9', createdAt: at(2), bytes: 10 },
        { title: 'Ticket 42', url: 'https://tickets.example.test/browse/42', createdAt: at(1), bytes: 10 },
      ]);
      const found = async (q) => ids((await query(P, q)).items);
      assert.deepEqual(await found({ query: 'facture' }), [jan, dec]);
      assert.deepEqual(await found({ query: 'D\u00c9CEMBRE' }), [dec]);
      assert.deepEqual(await found({ query: 'decembre' }), [dec]);
      assert.deepEqual(await found({ query: 'cafe' }), [cafe]);
      assert.deepEqual(await found({ query: 'CAF\u00c9' }), [cafe]);
      assert.deepEqual(await found({ query: 'resume' }), [resume]);
      assert.deepEqual(await found({ query: 'invoices' }), [jan, dec], 'the address is searched');
      assert.deepEqual(await found({ query: 'facture janvier' }), [jan]);
      assert.deepEqual(await found({ query: 'janvier   facture' }), [jan], 'order and spaces do not matter');
      assert.deepEqual(await found({ query: 'compta decembre' }), [dec], 'words may come from the title and the address');
      assert.deepEqual(await found({ query: 'zzz' }), []);
      assert.deepEqual(await found({ query: '   ' }), [ticket, resume, cafe, jan, dec], 'a blank search is no search');

      assert.deepEqual(await found({ query: 'facture', host: 'compta.example.test' }), [jan, dec]);
      assert.deepEqual(await found({ query: 'facture', host: 'carte.example.test' }), []);
      assert.deepEqual(await found({ from: at(4), to: at(2) }), [resume, cafe, jan], 'both bounds included');
      assert.deepEqual(await found({ from: at(4) + 1, to: at(2) - 1 }), [cafe]);
      assert.deepEqual(await found({ to: at(4) }), [jan, dec]);
      assert.deepEqual(await found({ onlyPinned: true }), [cafe]);
      assert.deepEqual(await found({ onlyPinned: true, query: 'facture' }), []);

      const one = await query(P, { query: 'facture', limit: 1 });
      assert.deepEqual([ids(one.items), one.next, one.total], [[jan], jan, 2]);
      const two = await query(P, { query: 'facture', limit: 1, before: one.next });
      assert.deepEqual([ids(two.items), two.next, two.total], [[dec], null, 2]);

      for (const filter of [{ query: 'facture' }, { host: 'compta.example.test' }, { onlyPinned: true }, { from: at(4) }, { query: 'nothing' }, {}]) {
        assert.equal(await db(P, 'countShots', filter), (await query(P, filter)).total, JSON.stringify(filter));
      }
      assert.deepEqual(await db(P, 'listHosts'), [{ host: 'compta.example.test', count: 2 }, { host: 'carte.example.test', count: 1 }, { host: 'tickets.example.test', count: 1 }, { host: 'wiki.example.test', count: 1 }]);
    });

    it('storageUsage: what the history holds and what the browser reports', async () => {
      await fresh();
      await seedBulk(P, Array.from({ length: 10 }, (_, i) => row(i, i, 1000 + i)));
      const usage = await db(P, 'storageUsage');
      assert.deepEqual([usage.count, usage.bytes], [10, 10045]);
      assert.ok(usage.quota > 10045 && usage.usage >= 0, JSON.stringify(usage));
    });
  });

  describe('writing', () => {
    it('pinning is saved, filtered on, and reversible; a missing shot is reported', async () => {
      await fresh();
      const [a, b] = await seedBulk(P, [row(0, 3), row(1, 2), row(2, 1)]);
      assert.equal(await db(P, 'setPinned', b, true), true);
      assert.deepEqual(ids((await query(P, { onlyPinned: true })).items), [b]);
      assert.equal((await dump('pinned')).shots.find((s) => s.id === b).pinned, true);
      assert.equal(await db(P, 'setPinned', a, true), true);
      assert.deepEqual(ids((await query(P, { onlyPinned: true })).items), [b, a]);
      assert.equal(await db(P, 'setPinned', b, false), true);
      assert.deepEqual(ids((await query(P, { onlyPinned: true })).items), [a]);
      assert.equal(await db(P, 'setPinned', 999, true), false);
      assert.equal(await db(P, 'countShots'), 3);
      await dump('after pinning');
    });

    it('updateShot keeps the catalog in line, and never brings back a deleted shot', async () => {
      await fresh();
      const [a, b] = await seedBulk(P, [row(0, 2), row(1, 1)]);
      const version = [{ name: 'V1', crop: null, scale: 1, objects: [] }];
      assert.equal(await db(P, 'updateShot', a, { versions: version, active: 0 }), true);
      const d = await dump('edited');
      assert.equal(Object.values(d.catalog).flat().find((e) => e.id === a).edited, true);
      assert.equal(await db(P, 'updateShot', a, { versions: [], active: -1 }), true);
      assert.equal(Object.values((await dump('unedited')).catalog).flat().find((e) => e.id === a).edited, false);

      await db(P, 'deleteShot', b);
      assert.equal(await db(P, 'updateShot', b, { versions: version, active: 0, title: 'back' }), false);
      assert.deepEqual(ids((await query(P)).items), [a], 'the deleted shot did not come back');
      assert.equal(await db(P, 'setPinned', b, true), false);
      await dump('after a late update');
    });

    it('deleteShots removes shots and originals together and counts what existed', async () => {
      await fresh();
      const all = await seedBulk(P, Array.from({ length: 12 }, (_, i) => row(i, 12 - i, 100 * (i + 1))));
      assert.deepEqual(await db(P, 'deleteShots', [all[0], all[1], all[1], 424242, 'x', 1.5]), { deleted: 2, freedBytes: 300 });
      assert.deepEqual(await db(P, 'deleteShots', []), { deleted: 0, freedBytes: 0 });
      await db(P, 'deleteShot', all[2]);
      const d = await dump('after deleting');
      assert.deepEqual(d.shots.map((s) => s.id), all.slice(3));
      assert.equal(await db(P, 'countShots'), 9);
      // a bucket that empties is removed, not left behind
      await db(P, 'deleteShots', all.slice(3));
      assert.deepEqual((await dump('emptied')).catalog, {});
    });

    it('buckets: a history that spans several of them stays in line through adds, edits and deletes', async () => {
      await fresh();
      const all = await seedBulk(P, Array.from({ length: 1300 }, (_, i) => row(i, 1300 - i, 20)));
      assert.equal(Object.keys((await dump('1300 shots')).catalog).length, 3);
      await db(P, 'setPinned', all[600], true);
      await db(P, 'updateShot', all[1100], { versions: [{ name: 'V1', crop: null, scale: 1, objects: [] }], active: 0 });
      await db(P, 'deleteShots', all.slice(500, 520));
      const id = await add(P);
      assert.equal(id, all.at(-1) + 1);
      const d = await dump('after changes in several buckets');
      assert.equal(d.shots.length, 1281);
    });
  });

  describe('manual purge', () => {
    it('removes the old shots, spares pinned and edited ones, reports what it freed', async () => {
      await fresh();
      const [, o2, o3, o4, , n1] = await seedBulk(P, [
        row(1, 100, 100), row(2, 100, 200, 'p'), row(3, 100, 400, 'e'), row(4, 100, 800, 'pe'), row(5, 40, 1600), row(6, 5, 3200),
      ]);
      assert.deepEqual(await db(P, 'purgeNow', { olderThanDays: 30 }), { deleted: 2, freedBytes: 1700, overCap: false });
      const d = await dump('after the purge');
      assert.deepEqual(d.shots.map((s) => s.id), [o2, o3, o4, n1]);

      // unpinned, the old shot goes at the next purge; the edited one stays whatever its age
      await db(P, 'setPinned', o2, false);
      assert.deepEqual(await db(P, 'purgeNow', { olderThanDays: 30 }), { deleted: 1, freedBytes: 200, overCap: false });
      assert.deepEqual((await dump('second purge')).shots.map((s) => s.id), [o3, o4, n1]);
    });

    it('with no argument, or with 0, it removes nothing', async () => {
      await fresh();
      await seedBulk(P, [row(1, 400, 100), row(2, 1, 100)]);
      assert.deepEqual(await db(P, 'purgeNow'), { deleted: 0, freedBytes: 0, overCap: false });
      assert.deepEqual(await db(P, 'purgeNow', { olderThanDays: 0, maxBytes: 0 }), { deleted: 0, freedBytes: 0, overCap: false });
      assert.equal(await db(P, 'countShots'), 2);
    });

    it('purges to a size, oldest first, and says when pinned shots keep it above', async () => {
      await fresh();
      const [a, , c] = await seedBulk(P, [row(1, 4, 1000, 'e'), row(2, 3, 1000), row(3, 2, 1000, 'p'), row(4, 1, 1000)]);
      // 4000 bytes, 2500 allowed: the two plain shots go, oldest first, and the edited one and the pinned one stay
      assert.deepEqual(await db(P, 'purgeNow', { maxBytes: 2500 }), { deleted: 2, freedBytes: 2000, overCap: false });
      assert.deepEqual((await dump('first cap')).shots.map((s) => s.id), [a, c]);
      // 500 allowed: the edited shot goes too, the pinned one cannot
      assert.deepEqual(await db(P, 'purgeNow', { maxBytes: 500 }), { deleted: 1, freedBytes: 1000, overCap: true });
      assert.deepEqual((await dump('second cap')).shots.map((s) => s.id), [c]);
    });

    it('does what the policy computes, on random histories (differential check against retention.js)', async () => {
      let seed = 987654;
      const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      for (let run = 0; run < 6; run++) {
        await fresh();
        // ages are whole days plus half a day, so none sits on the 30 or 45 day edge
        const rows = Array.from({ length: 60 }, (_, i) => row(i, Math.floor(rand() * 120) + 0.5, 100 + Math.floor(rand() * 800), `${rand() < 0.2 ? 'p' : ''}${rand() < 0.25 ? 'e' : ''}`));
        await seedBulk(P, rows);
        const policy = { olderThanDays: [0, 30, 45][run % 3], maxBytes: [0, 15000, 25000, 40000][Math.floor(rand() * 4)] };
        const entries = Object.values((await rawDump(P)).catalog).flat();
        const plan = planPurge(entries, Date.now(), { retentionDays: policy.olderThanDays, maxBytes: policy.maxBytes }, null);
        const result = await db(P, 'purgeNow', policy);
        assert.deepEqual(result, { deleted: plan.ids.length, freedBytes: plan.freedBytes, overCap: plan.overCap }, `run ${run} ${JSON.stringify(policy)}`);
        const left = (await dump(`run ${run}`)).shots.map((s) => s.id);
        assert.deepEqual(left, entries.map((e) => e.id).filter((id) => !plan.ids.includes(id)), `run ${run} ${JSON.stringify(policy)}`);
      }
    });
  });

  describe('retention applied by addShot', () => {
    it('removes what is too old, spares pinned and edited shots, and never the new one', async () => {
      await fresh({ retentionDays: 30, maxBytes: 0 });
      const seeded = await seedBulk(P, [row(1, 60), row(2, 45), row(3, 60, 100, 'e'), row(4, 60, 100, 'p'), row(5, 2), row(6, 1)]);
      const id = await add(P);
      assert.equal(typeof id, 'number');
      assert.equal(id, seeded.at(-1) + 1);
      assert.deepEqual((await dump('after the add')).shots.map((s) => s.id), [seeded[2], seeded[3], seeded[4], seeded[5], id]);
    });

    it('keeps the history under the size cap by removing the oldest unedited shots first', async () => {
      await fresh({ retentionDays: 0, maxBytes: 5000 });
      const [edited, pinned, , , , last] = await seedBulk(P, [row(1, 6, 1000, 'e'), row(2, 5, 1000, 'p'), row(3, 4, 1000), row(4, 3, 1000), row(5, 2, 1000), row(6, 1, 1000)]);
      const id = await add(P, { bytes: 2000 });
      const d = await dump('after the add');
      assert.deepEqual(d.shots.map((s) => s.id), [edited, pinned, last, id]);
      assert.equal(sum(d.shots.map((s) => s.bytes)), 5000);
    });

    it('takes the edited shots too once nothing else can go', async () => {
      await fresh({ retentionDays: 0, maxBytes: 3000 });
      const [, e2, p] = await seedBulk(P, [row(1, 3, 1000, 'e'), row(2, 2, 1000, 'e'), row(3, 1, 1000, 'p')]);
      const id = await add(P, { bytes: 1000 });
      assert.deepEqual((await dump('after the add')).shots.map((s) => s.id), [e2, p, id]);
    });

    it('never removes the new shot, even when it alone is over the cap', async () => {
      await fresh({ retentionDays: 1, maxBytes: 1000 });
      const [, pinned] = await seedBulk(P, [row(1, 3, 1000), row(2, 3, 1000, 'p'), row(3, 2, 1000, 'e')]);
      const id = await add(P, { bytes: 4000 });
      assert.deepEqual((await dump('after the add')).shots.map((s) => s.id), [pinned, id]);
    });

    it('with only pinned shots over the cap, nothing is removed but the new shot stays', async () => {
      await fresh({ retentionDays: 0, maxBytes: 1000 });
      const [pinned] = await seedBulk(P, [row(1, 400, 5000, 'p')]);
      const id = await add(P, { bytes: 500 });
      assert.deepEqual((await dump('after the add')).shots.map((s) => s.id), [pinned, id]);
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 1, freedBytes: 500, overCap: true }, 'the library pass has no new shot to protect');
      assert.deepEqual((await dump('after the pass')).shots.map((s) => s.id), [pinned]);
    });

    it('does nothing with both limits off', async () => {
      await fresh(OFF);
      await seedBulk(P, [row(1, 900, 1e6), row(2, 800, 1e6)]);
      await add(P);
      assert.equal((await dump('no limits')).shots.length, 3);
    });

    it('a shot added with a thumbnail keeps it', async () => {
      await fresh();
      const id = await add(P, { thumb: true });
      assert.equal((await query(P)).items.find((s) => s.id === id).thumb, 200);
    });

    it('runRetention: the same policy, applied on demand', async () => {
      await fresh({ retentionDays: 30, maxBytes: 0 });
      await seedBulk(P, [row(1, 60, 100), row(2, 60, 200, 'p'), row(3, 1, 400)]);
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 1, freedBytes: 100, overCap: false });
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false });
      await dump('after the pass');
    });
  });

  describe('repair', () => {
    for (const how of ['clear', 'garbage', 'drop']) {
      it(`a catalog damaged (${how}) is rebuilt from the shots by the library pass`, async () => {
        await fresh({ retentionDays: 0, maxBytes: 0 });
        await seedBulk(P, Array.from({ length: 40 }, (_, i) => row(i, 40 - i, 50 + i, i % 9 === 0 ? 'p' : i % 7 === 0 ? 'e' : '')));
        await breakCatalog(P, how);
        const broken = await rawDump(P);
        assert.throws(() => assertConsistent(broken, 'damaged'), 'the check does see the damage');
        assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false });
        const d = await dump(`after ${how}`);
        const expected = d.shots.filter((s) => entryOf(s).q.includes('n7')).map((s) => s.id);
        assert.equal(expected.length, 1);
        assert.deepEqual(ids((await query(P, { query: 'n7' })).items), expected);
        assert.equal(await db(P, 'countShots', { onlyPinned: true }), 5);
      });
    }
  });

  describe('several contexts', () => {
    it('a page, a second page and the service worker write at once: nothing is lost, nothing is torn', async () => {
      await fresh({ retentionDays: 0, maxBytes: 0 });
      const Q = await blankPage(h);
      const per = 25;
      const swAdd = (n, tag) => h.sw.evaluate(async ({ n, tag }) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          out.push(await __t.db.addShot({ original: new Blob([new Uint8Array(1000)], { type: 'image/png' }), url: `https://sw.example.test/${tag}/${i}`, title: `sw ${i}`, w: 10, h: 10 }));
        }
        return out;
      }, { n, tag });
      const pageAdd = async (page, n, tag) => {
        const out = [];
        for (let i = 0; i < n; i++) out.push(await add(page, { url: `https://${tag}.example.test/${i}`, title: `${tag} ${i}` }));
        return out;
      };
      const [fromP, fromQ, fromSw] = await Promise.all([pageAdd(P, per, 'p'), pageAdd(Q, per, 'q'), swAdd(per, 'sw')]);
      const all = [...fromP, ...fromQ, ...fromSw];
      assert.equal(new Set(all).size, 3 * per, 'every shot got its own id');
      for (const list of [fromP, fromQ, fromSw]) assert.deepEqual(list, list.toSorted((a, b) => a - b), 'ids grow within a context');
      const d = await dump('after the concurrent adds');
      assert.deepEqual(d.shots.map((s) => s.id), all.toSorted((a, b) => a - b));
      assert.equal(await db(Q, 'countShots'), 3 * per);
      await Q.close();
    });

    it('with a size cap, the contexts still end under it', async () => {
      await fresh({ retentionDays: 0, maxBytes: 20_000 });
      const Q = await blankPage(h);
      const pageAdd = async (page, tag) => {
        for (let i = 0; i < 20; i++) await add(page, { url: `https://${tag}.example.test/${i}`, title: `${tag} ${i}`, bytes: 1000 });
      };
      const swAdd = h.sw.evaluate(async () => {
        for (let i = 0; i < 20; i++) await __t.db.addShot({ original: new Blob([new Uint8Array(1000)], { type: 'image/png' }), url: `https://sw.example.test/${i}`, title: `sw ${i}`, w: 10, h: 10 });
      });
      await Promise.all([pageAdd(P, 'p'), pageAdd(Q, 'q'), swAdd, db(P, 'runRetention'), db(Q, 'runRetention')]);
      const d = await dump('after the concurrent adds under a cap');
      assert.ok(sum(d.shots.map((s) => s.bytes)) <= 20_000, 'under the cap');
      assert.equal(d.shots.length, 20);
      // a final pass changes nothing: the contexts left the history in the state the policy asks for
      assert.deepEqual(await db(P, 'runRetention'), { deleted: 0, freedBytes: 0, overCap: false });
      await Q.close();
    });

    it('deleting and pinning in one context while another adds', async () => {
      await fresh();
      const Q = await blankPage(h);
      const seeded = await seedBulk(P, Array.from({ length: 30 }, (_, i) => row(i, 30 - i)));
      await Promise.all([
        (async () => { for (let i = 0; i < 15; i++) await add(Q, { title: `late ${i}` }); })(),
        (async () => { for (const id of seeded.slice(0, 10)) await db(P, 'deleteShot', id); })(),
        (async () => { for (const id of seeded.slice(10, 20)) await db(P, 'setPinned', id, true); })(),
      ]);
      const d = await dump('after mixed writes');
      assert.equal(d.shots.length, 30 - 10 + 15);
      assert.equal(d.shots.filter((s) => s.pinned).length, 10);
      await Q.close();
    });
  });

  it('no console error in any page of the session', () => {
    assert.deepEqual(h.errors, []);
  });
});
