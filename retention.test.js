import test from 'node:test';
import assert from 'node:assert/strict';
import { planPurge, previewPlan } from './retention.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const MB = 1024 * 1024;

// A shot `days` old, of `mb` MB. Flags: p = pinned, e = edited.
const shot = (id, days, mb = 1, flags = '') => ({
  id, createdAt: NOW - days * DAY, bytes: mb * MB, pinned: flags.includes('p'), edited: flags.includes('e'),
});
const plan = (shots, policy, keepId) => planPurge(shots, NOW, { retentionDays: 0, maxBytes: 0, ...policy }, keepId);

test('no policy, nothing to remove', () => {
  const shots = [shot(1, 400), shot(2, 1), shot(3, 900, 5000)];
  assert.deepEqual(plan(shots, {}), { ids: [], freedBytes: 0, overCap: false });
  assert.deepEqual(plan([], { retentionDays: 30, maxBytes: MB }), { ids: [], freedBytes: 0, overCap: false });
});

test('age: removes the unpinned unedited shots older than retentionDays', () => {
  const shots = [shot(1, 40), shot(2, 31), shot(3, 29), shot(4, 0)];
  assert.deepEqual(plan(shots, { retentionDays: 30 }), { ids: [1, 2], freedBytes: 2 * MB, overCap: false });
});

test('age: a shot exactly retentionDays old stays, one millisecond older goes', () => {
  const edge = { id: 1, createdAt: NOW - 30 * DAY, bytes: 10, pinned: false, edited: false };
  assert.deepEqual(plan([edge], { retentionDays: 30 }).ids, []);
  assert.deepEqual(plan([{ ...edge, createdAt: edge.createdAt - 1 }], { retentionDays: 30 }).ids, [1]);
});

test('age: retentionDays 0 means never', () => {
  assert.deepEqual(plan([shot(1, 3650)], { retentionDays: 0 }).ids, []);
});

test('age: a pinned shot is never removed', () => {
  assert.deepEqual(plan([shot(1, 400, 1, 'p'), shot(2, 400)], { retentionDays: 30 }).ids, [2]);
});

test('age: an edited shot escapes the age purge, even unpinned and very old', () => {
  assert.deepEqual(plan([shot(1, 400, 1, 'e'), shot(2, 400, 1, 'pe'), shot(3, 400)], { retentionDays: 30 }).ids, [3]);
});

test('age: keepId is never removed', () => {
  // can only happen with a wrong clock, but the rule has no exception
  assert.deepEqual(plan([shot(1, 400), shot(2, 400)], { retentionDays: 30 }, 2).ids, [1]);
});

test('age: follows `now`, not the real clock', () => {
  const s = [shot(1, 10)];
  assert.deepEqual(planPurge(s, NOW, { retentionDays: 30, maxBytes: 0 }).ids, []);
  assert.deepEqual(planPurge(s, NOW + 25 * DAY, { retentionDays: 30, maxBytes: 0 }).ids, [1]);
});

test('cap: removes the oldest first and stops as soon as the total is under the cap', () => {
  const shots = [shot(1, 5, 4), shot(2, 4, 4), shot(3, 3, 4), shot(4, 2, 4)]; // 16 MB
  assert.deepEqual(plan(shots, { maxBytes: 9 * MB }), { ids: [1, 2], freedBytes: 8 * MB, overCap: false });
});

test('cap: a total equal to the cap is fine, one byte above is not', () => {
  const shots = [shot(1, 5, 4), shot(2, 4, 4)];
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB }).ids, []);
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB - 1 }).ids, [1]);
});

test('cap: maxBytes 0 means no cap', () => {
  assert.deepEqual(plan([shot(1, 1, 1e6), shot(2, 1, 1e6)], { maxBytes: 0 }), { ids: [], freedBytes: 0, overCap: false });
});

test('cap: unedited shots go before edited ones, even when the edited one is older', () => {
  const shots = [shot(1, 9, 4, 'e'), shot(2, 5, 4), shot(3, 4, 4)];
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB }).ids, [2]);
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB }).ids, [2, 3]);
});

test('cap: edited shots go once no unedited removable one is left, oldest first', () => {
  const shots = [shot(1, 9, 4, 'e'), shot(2, 8, 4, 'e'), shot(3, 7, 4, 'p'), shot(4, 1, 4)];
  assert.deepEqual(plan(shots, { maxBytes: 9 * MB }).ids, [4, 1]);
  assert.deepEqual(plan(shots, { maxBytes: 5 * MB }), { ids: [4, 1, 2], freedBytes: 12 * MB, overCap: false });
});

test('cap: the order is by date, then by id, not by input order or id', () => {
  const shots = [shot(10, 1, 3), shot(11, 9, 3), shot(12, 5, 3)]; // oldest = 11, then 12, then 10
  assert.deepEqual(plan(shots, { maxBytes: 3 * MB }).ids, [11, 12]);
  const tie = [{ ...shot(7, 2, 3) }, { ...shot(5, 2, 3) }, { ...shot(6, 2, 3) }];
  assert.deepEqual(plan(tie, { maxBytes: 3 * MB }).ids, [5, 6]);
});

test('cap: a pinned shot is never removed, the others go instead', () => {
  const shots = [shot(1, 9, 4, 'p'), shot(2, 5, 4), shot(3, 1, 4)];
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB }).ids, [2]);
});

test('cap: keepId is never removed, it is counted in the total', () => {
  const shots = [shot(1, 9, 4), shot(2, 5, 4), shot(3, 1, 4)];
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB }, 1).ids, [2]);
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB }, 1), { ids: [2, 3], freedBytes: 8 * MB, overCap: false });
});

test('cap: only pinned shots above the cap, nothing to remove and overCap says so', () => {
  const shots = [shot(1, 9, 6, 'p'), shot(2, 5, 6, 'p')];
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB }), { ids: [], freedBytes: 0, overCap: true });
});

test('cap: pinned shots above the cap, every removable shot goes and overCap is set', () => {
  const shots = [shot(1, 9, 6, 'p'), shot(2, 5, 4), shot(3, 4, 4, 'e'), shot(4, 1, 6, 'p')];
  assert.deepEqual(plan(shots, { maxBytes: 8 * MB }), { ids: [2, 3], freedBytes: 8 * MB, overCap: true });
});

test('cap: the new shot alone above the cap, the older ones go and overCap is set', () => {
  const shots = [shot(1, 9), shot(2, 5), shot(3, 0, 50)];
  assert.deepEqual(plan(shots, { maxBytes: 10 * MB }, 3), { ids: [1, 2], freedBytes: 2 * MB, overCap: true });
});

test('cap: overCap stays false when the cap is met by the removals', () => {
  assert.equal(plan([shot(1, 5, 4), shot(2, 4, 4)], { maxBytes: 5 * MB }).overCap, false);
  assert.equal(plan([shot(1, 5, 4)], { maxBytes: 5 * MB }).overCap, false);
});

test('age then cap: the shots removed by age count before the cap is looked at', () => {
  const shots = [shot(1, 60, 4), shot(2, 40, 4), shot(3, 3, 4), shot(4, 2, 4)];
  // age frees 1 and 2 (8 MB), 8 MB remain: under the 9 MB cap, so the cap removes nothing more
  assert.deepEqual(plan(shots, { retentionDays: 30, maxBytes: 9 * MB }), { ids: [1, 2], freedBytes: 8 * MB, overCap: false });
  // 4 MB cap: after age, 3 goes too
  assert.deepEqual(plan(shots, { retentionDays: 30, maxBytes: 4 * MB }).ids, [1, 2, 3]);
});

test('age then cap: an old edited shot kept by the age purge can still go for the cap, last', () => {
  const shots = [shot(1, 400, 4, 'e'), shot(2, 3, 4), shot(3, 2, 4)];
  assert.deepEqual(plan(shots, { retentionDays: 30, maxBytes: 8 * MB }).ids, [2]);
  assert.deepEqual(plan(shots, { retentionDays: 30, maxBytes: 4 * MB }).ids, [2, 3]);
});

test('a missing or invalid size counts as 0', () => {
  const shots = [
    { id: 1, createdAt: NOW - 3 * DAY, pinned: false, edited: false },
    { id: 2, createdAt: NOW - 2 * DAY, bytes: NaN, pinned: false, edited: false },
    { id: 3, createdAt: NOW - 1 * DAY, bytes: -5, pinned: false, edited: false },
    shot(4, 0, 4),
  ];
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB }), { ids: [], freedBytes: 0, overCap: false });
  // removing them would free nothing, so the cap leaves them alone and takes the only shot that has a size
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB - 1 }), { ids: [4], freedBytes: 4 * MB, overCap: false });
});

test('an invalid retentionDays or maxBytes disables that rule', () => {
  const shots = [shot(1, 900, 100)];
  for (const bad of [undefined, NaN, -3, null]) {
    assert.deepEqual(plan(shots, { retentionDays: bad, maxBytes: bad }).ids, [], String(bad));
  }
});

test('the input is not modified', () => {
  const shots = Object.freeze([Object.freeze(shot(1, 90)), Object.freeze(shot(2, 80, 4)), Object.freeze(shot(3, 1, 4))]);
  assert.deepEqual(plan(shots, { retentionDays: 30, maxBytes: 4 * MB }).ids, [1, 2]);
});

test('invariants hold on 2000 random histories', () => {
  let seed = 12345; // small deterministic generator, so a failure can be replayed
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let run = 0; run < 2000; run++) {
    const n = Math.floor(rand() * 25);
    const shots = Array.from({ length: n }, (_, i) => ({
      id: i + 1, createdAt: NOW - Math.floor(rand() * 120) * DAY, bytes: Math.floor(rand() * 9) * MB,
      pinned: rand() < 0.2, edited: rand() < 0.3,
    }));
    const retentionDays = rand() < 0.3 ? 0 : 1 + Math.floor(rand() * 90);
    const maxBytes = rand() < 0.3 ? 0 : Math.floor(rand() * 60) * MB;
    const keepId = rand() < 0.5 && n ? 1 + Math.floor(rand() * n) : null;
    const out = planPurge(shots, NOW, { retentionDays, maxBytes }, keepId);
    const ctx = JSON.stringify({ shots, retentionDays, maxBytes, keepId, out });

    assert.equal(new Set(out.ids).size, out.ids.length, `unique ids ${ctx}`);
    const byId = new Map(shots.map((s) => [s.id, s]));
    for (const id of out.ids) {
      const s = byId.get(id);
      assert.ok(s, `known id ${ctx}`);
      assert.ok(!s.pinned && id !== keepId, `pinned or kept shot removed ${ctx}`);
    }
    assert.equal(out.freedBytes, out.ids.reduce((sum, id) => sum + byId.get(id).bytes, 0), `freedBytes ${ctx}`);

    const left = shots.filter((s) => !out.ids.includes(s.id));
    const total = left.reduce((sum, s) => sum + s.bytes, 0);
    if (retentionDays > 0) {
      const old = left.filter((s) => !s.pinned && !s.edited && s.id !== keepId && s.createdAt < NOW - retentionDays * DAY);
      assert.deepEqual(old, [], `an expired shot is left ${ctx}`);
    }
    const removable = left.filter((s) => !s.pinned && s.id !== keepId && s.bytes > 0);
    if (maxBytes > 0 && total > maxBytes) {
      assert.deepEqual(removable, [], `over the cap with a removable shot left ${ctx}`);
      assert.equal(out.overCap, true, `overCap ${ctx}`);
    } else {
      assert.equal(out.overCap, false, `overCap ${ctx}`);
    }
  }
});

test('previewPlan: the plan, what is left, and what the pins and edits spare', () => {
  const policy = { retentionDays: 30, maxBytes: 0 };
  // 1 and 2 are old and plain, 3 old and pinned, 4 old and edited, 5 old, pinned and edited, 6 recent
  const shots = [shot(1, 60, 1), shot(2, 50, 2), shot(3, 90, 4, 'p'), shot(4, 80, 8, 'e'), shot(5, 70, 16, 'pe'), shot(6, 1, 32)];
  assert.deepEqual(previewPlan(shots, NOW, policy), {
    deleted: 2, freedBytes: 3 * MB, overCap: false, keptPinned: 2, keptEdited: 1, remaining: { count: 4, bytes: 60 * MB },
  });
  assert.deepEqual(previewPlan(shots, NOW, { retentionDays: 0, maxBytes: 0 }), {
    deleted: 0, freedBytes: 0, overCap: false, keptPinned: 0, keptEdited: 0, remaining: { count: 6, bytes: 63 * MB },
  });
  assert.deepEqual(previewPlan([], NOW, policy), { deleted: 0, freedBytes: 0, overCap: false, keptPinned: 0, keptEdited: 0, remaining: { count: 0, bytes: 0 } });
});

test('previewPlan: it agrees with planPurge, and a size cap spares the pinned shots it cannot take', () => {
  const shots = [shot(1, 5, 10, 'p'), shot(2, 4, 10), shot(3, 3, 10, 'e'), shot(4, 2, 10)];
  const policy = { retentionDays: 0, maxBytes: 15 * MB };
  const real = planPurge(shots, NOW, policy, null);
  const preview = previewPlan(shots, NOW, policy);
  assert.equal(preview.deleted, real.ids.length);
  assert.equal(preview.freedBytes, real.freedBytes);
  assert.equal(preview.overCap, real.overCap);
  // without protection the oldest shots 1 and 2 would go: 1 is pinned and stays
  assert.deepEqual([preview.keptPinned, preview.keptEdited], [1, 0]);
  assert.equal(preview.remaining.bytes, 40 * MB - real.freedBytes);
});

// The shots open in the library: a list of ids that no pass may remove, whatever their age, size or edits.
test('keep: a list (or a set) of shots is spared by the age rule and the cap, and counted in the total', () => {
  const old = [shot(1, 400), shot(2, 400), shot(3, 400)];
  assert.deepEqual(plan(old, { retentionDays: 30 }, [1, 3]).ids, [2]);
  assert.deepEqual(plan(old, { retentionDays: 30 }, new Set([2])).ids, [1, 3]);
  assert.deepEqual(plan(old, { retentionDays: 30 }, []).ids, [1, 2, 3]);
  assert.deepEqual(plan(old, { retentionDays: 30 }, null).ids, [1, 2, 3]);
  assert.deepEqual(plan(old, { retentionDays: 30 }, 2).ids, [1, 3], 'one id still works');
  // an edited shot is not spared by the cap, unless it is kept
  const shots = [shot(1, 9, 4, 'e'), shot(2, 5, 4), shot(3, 1, 4)];
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB }).ids, [2, 3]);
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB }, [3]).ids, [2, 1], 'the edited shot goes once the plain one is gone');
  assert.deepEqual(plan(shots, { maxBytes: 4 * MB }, [1, 3]), { ids: [2], freedBytes: 4 * MB, overCap: true });
  assert.deepEqual(plan(shots, { maxBytes: 12 * MB }, [1, 2, 3]), { ids: [], freedBytes: 0, overCap: false });
});

test('previewPlan: the shots to keep are left out of what it counts, like in the real pass', () => {
  const shots = [shot(1, 60, 1), shot(2, 50, 2), shot(3, 1, 4)];
  const policy = { retentionDays: 30, maxBytes: 0 };
  assert.equal(previewPlan(shots, NOW, policy).deleted, 2);
  const kept = previewPlan(shots, NOW, policy, [2]);
  assert.deepEqual([kept.deleted, kept.freedBytes, kept.remaining], [1, MB, { count: 2, bytes: 6 * MB }]);
  assert.equal(kept.deleted, planPurge(shots, NOW, policy, [2]).ids.length, 'it agrees with planPurge');
});
