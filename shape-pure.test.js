import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHAPE, ROUND_RATIO, SHAPES, cleanShape, freeGeometry, pathLength, shapeOf, shapeRadii, simplify } from './shape-pure.js';

test('shapes: rectangle first (the default), then rounded, ellipse and free', () => {
  assert.deepEqual([...SHAPES], ['rect', 'round', 'ellipse', 'free']);
  assert.equal(DEFAULT_SHAPE, 'rect');
});

test('cleanShape: one of the three, the rectangle for anything else', () => {
  for (const s of SHAPES) assert.equal(cleanShape(s), s);
  for (const junk of ['circle', 'Rect', '', null, undefined, 3, {}, 'constructor']) assert.equal(cleanShape(junk), 'rect', String(junk));
});

test('shapeRadii: none, a quarter of the short side, half the sides', () => {
  assert.deepEqual(shapeRadii('rect', 200, 100), { rx: 0, ry: 0 });
  assert.deepEqual(shapeRadii('round', 200, 100), { rx: 100 * ROUND_RATIO, ry: 100 * ROUND_RATIO });
  assert.deepEqual(shapeRadii('round', 100, 200), { rx: 100 * ROUND_RATIO, ry: 100 * ROUND_RATIO }, 'the short side counts');
  assert.deepEqual(shapeRadii('ellipse', 200, 100), { rx: 100, ry: 50 });
  assert.deepEqual(shapeRadii('whatever', 200, 100), { rx: 0, ry: 0 });
  assert.deepEqual(shapeRadii('round', 0, 0), { rx: 0, ry: 0 }, 'an empty box');
  assert.deepEqual(shapeRadii('round', -5, 10), { rx: 0, ry: 0 }, 'no negative radius');
});

test('shapeOf: the shape that the radii of a box draw, for every shape and every size', () => {
  for (const shape of ['rect', 'round', 'ellipse']) {
    for (const [w, h] of [[200, 100], [100, 200], [64, 64], [30, 12], [1600, 900], [7, 5]]) {
      assert.equal(shapeOf({ width: w, height: h, ...shapeRadii(shape, w, h) }), shape, `${shape} ${w}x${h}`);
    }
  }
  assert.equal(shapeOf({ width: 100, height: 50 }), 'rect', 'an object saved with no radius');
  assert.equal(shapeOf({}), 'rect');
  assert.equal(shapeOf({ width: 100, height: 50, rx: 10, ry: 0 }), 'rect', 'a radius on one axis only draws no corner');
  assert.equal(shapeOf({ width: 100, height: 50, rx: 49.9, ry: 24.9 }), 'ellipse', 'a rounding error of the radii');
});

test('shapeOf: a box with points is free, whatever the radii', () => {
  assert.equal(shapeOf({ width: 100, height: 50, pts: [0, 0, 1, 0, 1, 1] }), 'free');
  assert.equal(shapeOf({ width: 100, height: 50, rx: 10, ry: 10, pts: [0, 0, 1, 1] }), 'free', 'two points make a line: a brush');
  assert.equal(shapeOf({ width: 100, height: 50, pts: [0, 0] }), 'rect', 'one point is no shape');
  assert.equal(shapeOf({ width: 100, height: 50, pts: [] }), 'rect');
});

test('simplify: a straight path keeps its ends, a corner is kept, the tolerance decides', () => {
  const line = Array.from({ length: 50 }, (_, i) => /** @type {[number, number]} */ ([i, i * 2]));
  assert.deepEqual(simplify(line, 0.5), [[0, 0], [49, 98]]);
  const corner = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
  assert.deepEqual(simplify(/** @type {any} */ (corner), 0.1), [[0, 0], [10, 0], [10, 10]]);
  const wobble = [[0, 0], [5, 0.4], [10, 0]];
  assert.equal(simplify(/** @type {any} */ (wobble), 0.5).length, 2, 'inside the tolerance');
  assert.equal(simplify(/** @type {any} */ (wobble), 0.1).length, 3, 'outside it');
  assert.deepEqual(simplify([[1, 1], [2, 2]], 5), [[1, 1], [2, 2]], 'two points stay');
  assert.deepEqual(simplify([], 5), []);
  const closed = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.equal(simplify(/** @type {any} */ (closed), 1).length, 5, 'a closed path does not collapse');
});

test('pathLength: the sum of the segments', () => {
  assert.equal(pathLength([]), 0);
  assert.equal(pathLength([[3, 4]]), 0);
  assert.equal(pathLength([[0, 0], [3, 4], [3, 10]]), 11);
});

test('freeGeometry: the bounds are the box, the points are fractions of it, a pad widens it', () => {
  const g = freeGeometry([[10, 20], [110, 20], [110, 70], [60, 45]]);
  assert.deepEqual([g.left, g.top, g.width, g.height], [10, 20, 100, 50]);
  assert.deepEqual(g.pts, [0, 0, 1, 0, 1, 1, 0.5, 0.5]);
  const p = freeGeometry([[10, 20], [110, 70]], 10);
  assert.deepEqual([p.left, p.top, p.width, p.height], [0, 10, 120, 70]);
  assert.deepEqual(p.pts, [0.0833, 0.1429, 0.9167, 0.8571], 'the path sits inside the padding');
  const flat = freeGeometry([[5, 5], [50, 5]]);
  assert.deepEqual([flat.width, flat.height], [45, 1], 'a straight path still has a box');
  assert.ok(flat.pts.every(Number.isFinite));
  // what comes back is what went in: the points of the box are the points of the path
  const path = [[13.5, 7.25], [200.125, 90], [88, 300.5], [14, 150]];
  const box = freeGeometry(/** @type {any} */ (path));
  for (let i = 0; i < path.length; i++) {
    assert.ok(Math.abs(box.left + box.pts[i * 2] * box.width - path[i][0]) < 0.05, 'x');
    assert.ok(Math.abs(box.top + box.pts[i * 2 + 1] * box.height - path[i][1]) < 0.05, 'y');
  }
});
