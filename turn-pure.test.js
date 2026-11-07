import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTurn, turnMatrix, turnPoint, turnPts, turnRect, turnedSize } from './turn-pure.js';

const apply = ([a, b, c, d, e, f], x, y) => ({ x: a * x + c * y + e, y: b * x + d * y + f });

test('cleanTurn keeps 0 to 3 and gives 0 for anything else', () => {
  assert.deepEqual([0, 1, 2, 3, 4, -1, 7].map(cleanTurn), [0, 1, 2, 3, 0, 3, 3]);
  assert.deepEqual([undefined, null, '1', 1.5, NaN].map(cleanTurn), [0, 0, 0, 0, 0]);
});

test('turnedSize swaps the sides for an odd number of turns', () => {
  assert.deepEqual(turnedSize(1600, 900, 0), { w: 1600, h: 900 });
  assert.deepEqual(turnedSize(1600, 900, 1), { w: 900, h: 1600 });
  assert.deepEqual(turnedSize(1600, 900, 2), { w: 1600, h: 900 });
  assert.deepEqual(turnedSize(1600, 900, 3), { w: 900, h: 1600 });
});

test('a quarter turn clockwise takes the top left corner to the top right one', () => {
  assert.deepEqual(turnPoint(0, 0, 900), { x: 900, y: 0 });
  assert.deepEqual(turnPoint(0, 900, 900), { x: 0, y: 0 });
  assert.deepEqual(turnPoint(1600, 900, 900), { x: 0, y: 1600 });
});

test('four quarter turns bring a point and a rectangle back', () => {
  let p = { x: 120, y: 340 }, r = { x: 10, y: 20, w: 300, h: 100 }, w = 1600, h = 900;
  for (let i = 0; i < 4; i++) {
    p = turnPoint(p.x, p.y, h);
    r = /** @type {typeof r} */ (turnRect(r, h));
    [w, h] = [h, w];
  }
  assert.deepEqual(p, { x: 120, y: 340 });
  assert.deepEqual(r, { x: 10, y: 20, w: 300, h: 100 });
});

test('a rectangle is turned with the image under it, and null stays null', () => {
  assert.deepEqual(turnRect({ x: 100, y: 50, w: 300, h: 200 }, 900), { x: 650, y: 100, w: 200, h: 300 });
  assert.equal(turnRect(null, 900), null);
});

test('the points of a free shape turn with their box', () => {
  assert.deepEqual(turnPts([0, 0, 1, 0, 1, 1]), [1, 0, 1, 1, 0, 1]);
  assert.deepEqual(turnPts([0.25, 0.5]), [0.5, 0.25]);
  assert.deepEqual(turnPts([]), []);
});

test('the matrix of each turn lands on the image of that many turns, with whole numbers', () => {
  const w = 1600, h = 900;
  assert.deepEqual(apply(turnMatrix(1, w, h), 0, 0), { x: h, y: 0 });
  assert.deepEqual(apply(turnMatrix(1, w, h), w, h), { x: 0, y: w });
  assert.deepEqual(apply(turnMatrix(2, w, h), 0, 0), { x: w, y: h });
  assert.deepEqual(apply(turnMatrix(3, w, h), 0, 0), { x: 0, y: w });
  assert.deepEqual(apply(turnMatrix(3, w, h), w, 0), { x: 0, y: 0 });
  assert.deepEqual(apply(turnMatrix(0, w, h), 12, 34), { x: 12, y: 34 });
  for (const t of [1, 2, 3]) assert.ok(turnMatrix(t, w, h).every(Number.isInteger));
});

test('the matrix of one turn is the move of the points', () => {
  const m = turnMatrix(1, 1600, 900);
  for (const [x, y] of [[0, 0], [10, 20], [1600, 900], [800, 450]]) assert.deepEqual(apply(m, x, y), turnPoint(x, y, 900));
});
