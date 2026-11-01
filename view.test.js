import test from 'node:test';
import assert from 'node:assert/strict';
import { fitView, zoomAt, panBy, clampView } from './view.js';

test('fitView: 16:9 image centered and fitted, never enlarged', () => {
  const f = fitView(1400, 800, 3840, 2160);
  assert.ok(f.z < 0.37 && f.z > 0.35);
  assert.ok(Math.abs(f.tx - (1400 - 3840 * f.z) / 2) < 1e-9 || f.tx >= 0);
  assert.equal(fitView(1400, 800, 200, 100).z, 1); // small image: actual size
});

test('fitView: tall full page fitted to the width, at the top', () => {
  const f = fitView(1400, 800, 1920, 16384);
  assert.ok(Math.abs(f.z - (1400 - 32) / 1920) < 1e-9);
  assert.equal(f.ty, 16);
});

test('zoomAt keeps the point under the cursor and stays within bounds', () => {
  const view = { z: 1, tx: -200, ty: -100 };
  const out = zoomAt(view, 2, 300, 200, 1000, 600, 4000, 3000);
  assert.equal(out.z, 2);
  // document point under (300, 200) before and after
  assert.ok(Math.abs((300 - view.tx) / view.z - (300 - out.tx) / out.z) < 1e-9);
  assert.equal(zoomAt(view, 1e9, 0, 0, 1000, 600, 4000, 3000).z, 8);
  assert.equal(zoomAt(view, 1e-9, 0, 0, 1000, 600, 4000, 3000).z, 0.02);
});

test('panBy / clampView: the document is never lost', () => {
  const far = panBy({ z: 1, tx: 0, ty: 0 }, -1e6, -1e6, 1000, 600, 4000, 3000);
  assert.equal(far.tx, 1000 - 4000 - 16);
  assert.equal(far.ty, 600 - 3000 - 16);
  const small = clampView({ z: 1, tx: 999, ty: 999 }, 1000, 600, 200, 100);
  assert.deepEqual([small.tx, small.ty], [400, 250]); // smaller than the canvas: centered
});
