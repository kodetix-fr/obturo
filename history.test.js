import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, HISTORY_MAX } from './history.js';

test('empty history: nothing to undo or redo', () => {
  const h = createHistory();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.step(-1), null);
  assert.equal(h.step(1), null);
});

test('reset: a single snapshot, nothing to undo', () => {
  const h = createHistory();
  h.reset('a');
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.step(-1), null);
  h.reset();
  assert.equal(h.step(-1), null);
});

test('push, undo, redo', () => {
  const h = createHistory();
  h.reset('a');
  assert.equal(h.push('b'), true);
  assert.equal(h.push('c'), true);
  assert.equal(h.canUndo, true);
  assert.equal(h.canRedo, false);
  assert.equal(h.step(-1), 'b');
  assert.equal(h.step(-1), 'a');
  assert.equal(h.step(-1), null, 'at the start of the stack');
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  assert.equal(h.step(1), 'b');
  assert.equal(h.step(1), 'c');
  assert.equal(h.step(1), null, 'at the end of the stack');
});

test('push of a snapshot identical to the current one: ignored', () => {
  const h = createHistory();
  h.reset('a');
  assert.equal(h.push('a'), false);
  assert.equal(h.canUndo, false);
});

test('push after undoing: what had been undone is lost', () => {
  const h = createHistory();
  h.reset('a');
  h.push('b');
  h.push('c');
  h.step(-1); // on b
  h.push('d');
  assert.equal(h.canRedo, false);
  assert.equal(h.step(-1), 'b');
  assert.equal(h.step(-1), 'a');
});

test('the oldest snapshots are dropped beyond the maximum', () => {
  const h = createHistory(3);
  h.reset('a');
  for (const s of ['b', 'c', 'd']) h.push(s);
  assert.equal(h.step(-1), 'c');
  assert.equal(h.step(-1), 'b');
  assert.equal(h.step(-1), null, 'a is dropped');
});

test('50 levels by default', () => {
  assert.equal(HISTORY_MAX, 50);
  const h = createHistory();
  h.reset('0');
  for (let i = 1; i <= 100; i++) h.push(String(i));
  let back = 0;
  while (h.step(-1) !== null) back++;
  assert.equal(back, HISTORY_MAX - 1);
});
