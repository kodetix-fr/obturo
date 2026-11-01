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

// A box is a part of the document: the same math as a document of that size whose origin is the corner of the box.
const BOX = { x: -48, y: -84, w: 1376, h: 852 }; // a 1280 x 720 capture with 48 px of padding and a bar of 36
const plain = (v, box) => ({ z: v.z, tx: v.tx + box.x * v.z, ty: v.ty + box.y * v.z });

test('fitView with a box: the box is fitted and centered, the document around it is not', () => {
  const f = fitView(1400, 800, 1280, 720, BOX);
  const g = fitView(1400, 800, BOX.w, BOX.h);
  assert.equal(f.z, g.z);
  assert.ok(f.z < 1 && Math.abs(f.z - (800 - 32) / 852) < 1e-9, 'the height decides, the whole look is in sight');
  assert.deepEqual(plain(f, BOX), g, 'the corner of the box lands where the fitted box starts');
  assert.ok(f.tx + BOX.x * f.z >= 0 && f.tx + (BOX.x + BOX.w) * f.z <= 1400, 'the box is inside the canvas');
  assert.equal(fitView(1400, 800, 1280, 720, undefined).z, fitView(1400, 800, 1280, 720).z, 'no box, the document');
});

test('zoomAt with a box keeps the point under the cursor, and the box is never lost', () => {
  const view = { z: 1, tx: -100, ty: -50 };
  const out = zoomAt(view, 2, 300, 200, 1000, 600, 4000, 3000, { x: -48, y: -84, w: 4096, h: 3168 });
  assert.equal(out.z, 2);
  assert.ok(Math.abs((300 - view.tx) / view.z - (300 - out.tx) / out.z) < 1e-9);
  const far = panBy({ z: 1, tx: 0, ty: 0 }, -1e6, -1e6, 1000, 600, 4000, 3000, { x: -48, y: -84, w: 4096, h: 3168 });
  assert.equal(far.tx, 1000 - 4096 - 16 + 48, 'the right edge of the box (it starts 48 px left of the document), with the margin');
  assert.equal(far.ty, 600 - 3168 - 16 + 84);
});

test('clampView with a box smaller than the canvas centers the box', () => {
  const c = clampView({ z: 1, tx: 999, ty: 999 }, 1000, 600, 200, 100, { x: -10, y: -20, w: 220, h: 140 });
  assert.deepEqual(plain(c, { x: -10, y: -20 }), { z: 1, tx: 390, ty: 230 }); // (1000 - 220) / 2, (600 - 140) / 2
});
