import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaver } from './saver.js';

// ---- saver: regression of the blocking defect (writes that stop without an error) ----

const realTick = (ms) => new Promise((r) => setTimeout(r, ms));
// The clock is the test's: the timers of the saver are advanced by hand, so no run depends on the speed of the machine.
const fakeClock = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return async (ms) => {
    t.mock.timers.tick(ms);
    await new Promise((done) => setImmediate(done)); // the promises that the timers released
  };
};
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

// The old implementation (IIFE + ??=): kept here to prove that the scenario detects the defect.
function legacySaver({ write, delay }) {
  let timer, dirty = false, saving = null;
  const save = () => (saving ??= (async () => {
    try { while (dirty) { dirty = false; await write(); } } finally { saving = null; }
  })());
  return { schedule() { dirty = true; clearTimeout(timer); timer = setTimeout(save, delay); }, flush: async () => { clearTimeout(timer); await save(); } };
}

// Write held back, 2nd change DURING the write, stale timer that fires on nothing, 3rd change. In real time: it is the order in which timers and
// promises settle that exposes the defect, and a fake clock does not reproduce it; the margins are wide so that a slow machine keeps the order.
async function scenario(make) {
  const tick = realTick;
  const gates = [];
  let writes = 0;
  const s = make({ delay: 50, write: () => { writes++; const d = deferred(); gates.push(d); return d.p; } });
  s.schedule();               // change 1
  await tick(250);            // the timer fires: write 1 is in flight
  s.schedule();               // change 2, during the write
  gates[0].resolve(true);
  await tick(25);             // change 2 is picked up right away
  gates[1]?.resolve(true);
  await tick(250);            // the stale timer of change 2 fires on nothing
  s.schedule();               // change 3
  await tick(250);
  const n = writes;
  gates.forEach((g) => g.resolve(true));
  await s.flush();
  return n;
}

test('saver: a write that ends without waiting no longer blocks the next ones', async () => {
  assert.equal(await scenario(createSaver), 3, 'the 3 changes must be written');
});

test('saver: the same scenario does expose the old defect (guard for the test)', async () => {
  assert.equal(await scenario(legacySaver), 2, 'the old version loses the 3rd write without an error');
});

test('saver: a failing write keeps the change, notifies, and the next one retries', async (t) => {
  const tick = fakeClock(t);
  let fail = true, tried = 0, written = 0, errors = 0;
  const s = createSaver({ delay: 5, write: async () => { tried++; if (fail) throw new Error('quota'); written++; return true; }, onError: () => errors++ });
  s.schedule();
  await tick(30);
  assert.deepEqual([tried, errors, written], [1, 1, 0]);
  await s.flush();                       // retries, does not reject, does not loop
  assert.ok(tried <= 3, `flush insisted ${tried} times`);
  fail = false;
  s.schedule();
  await tick(30);
  assert.equal(written, 1);
});

test('saver: shot gone -> onGone once, no loop', async (t) => {
  const tick = fakeClock(t);
  let writes = 0, gone = 0;
  const s = createSaver({ delay: 5, write: async () => { writes++; return false; }, onGone: () => gone++ });
  s.schedule();
  await tick(30);
  await s.flush();
  assert.deepEqual([writes, gone], [1, 1]);
});

test('saver: flush waits for the write in flight then writes what changed in the meantime', async (t) => {
  const tick = fakeClock(t);
  const gates = [];
  let writes = 0;
  const s = createSaver({ delay: 10, write: () => { writes++; const d = deferred(); gates.push(d); return d.p; } });
  s.schedule();
  await tick(30);                        // write 1 in flight
  s.schedule();                          // changed meanwhile
  let done = false;
  const f = s.flush().then(() => { done = true; });
  await tick(10);
  assert.equal(done, false, 'flush must not finish before the write in flight');
  gates[0].resolve(true);
  await tick(10);
  gates[1].resolve(true);
  await f;
  assert.equal(writes, 2);
  await s.flush();                       // nothing pending: returns right away
});
