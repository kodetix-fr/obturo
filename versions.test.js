import test from 'node:test';
import assert from 'node:assert/strict';
import { blankVersion, createVersion, deleteVersion, pickVersion, clampCrop, outputSize, scaleForWidth, maxScale, capScale } from './versions.js';

const v = (name, extra = {}) => ({ ...blankVersion(), name, ...extra });

test('createVersion from the original: blank version, becomes active', () => {
  const s = createVersion({ versions: [], active: -1 });
  assert.equal(s.active, 0);
  assert.equal(s.versions[0].name, 'V1');
  assert.deepEqual(s.versions[0].objects, []);
});

test('createVersion duplicates the displayed version without sharing objects', () => {
  const base = { versions: [v('V1', { objects: [{ type: 'Rect' }], scale: 0.5 })], active: 0 };
  const s = createVersion(base);
  assert.equal(s.active, 1);
  assert.equal(s.versions[1].name, 'V2');
  assert.equal(s.versions[1].scale, 0.5);
  s.versions[1].objects.push({ type: 'Arrow' });
  assert.equal(base.versions[0].objects.length, 1); // the source did not change
});

test('createVersion from the original while versions exist: starts from a blank page', () => {
  const s = createVersion({ versions: [v('V1', { objects: [{ type: 'Rect' }] })], active: -1 });
  assert.deepEqual(s.versions[1].objects, []);
  assert.equal(s.active, 1);
});

test('createVersion reuses the smallest free name', () => {
  const s = createVersion({ versions: [v('V1'), v('V3')], active: 0 });
  assert.equal(s.versions[2].name, 'V2');
});

test('deleteVersion: the displayed version disappears -> previous, else next, else original', () => {
  const three = { versions: [v('V1'), v('V2'), v('V3')], active: 1 };
  assert.deepEqual(deleteVersion(three, 1).active, 0);
  assert.equal(deleteVersion({ ...three, active: 0 }, 0).active, 0); // the next one takes index 0
  assert.equal(deleteVersion({ versions: [v('V1')], active: 0 }, 0).active, -1);
  assert.equal(deleteVersion({ versions: [v('V1')], active: 0 }, 0).versions.length, 0);
});

test('deleteVersion of another version keeps the same displayed version', () => {
  const s = { versions: [v('V1'), v('V2'), v('V3')], active: 2 };
  assert.equal(deleteVersion(s, 0).active, 1); // index shift
  assert.equal(deleteVersion(s, 0).versions[1].name, 'V3');
  assert.equal(deleteVersion({ ...s, active: 0 }, 2).active, 0);
});

test('deleteVersion out of range changes nothing', () => {
  const s = { versions: [v('V1')], active: 0 };
  assert.deepEqual(deleteVersion(s, 5), s);
});

test('pickVersion clamps the index', () => {
  const s = { versions: [v('V1'), v('V2')], active: 0 };
  assert.equal(pickVersion(s, -1).active, -1);
  assert.equal(pickVersion(s, 1).active, 1);
  assert.equal(pickVersion(s, 2).active, 0);
  assert.equal(pickVersion(s, -2).active, 0);
  assert.equal(pickVersion(s, 0.5).active, 0);
});

test('outputSize: original, scale, crop, both', () => {
  assert.deepEqual(outputSize(1920, 1080), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize(1920, 1080, v('V1', { scale: 0.5 })), { w: 960, h: 540 });
  assert.deepEqual(outputSize(1920, 1080, v('V1', { crop: { x: 10, y: 20, w: 400, h: 300 } })), { w: 400, h: 300 });
  assert.deepEqual(outputSize(10, 10, v('V1', { scale: 0.01 })), { w: 1, h: 1 }); // never 0
});

test('outputSize rounds down: the output never exceeds the covered area', () => {
  // 801 x 601 at 50%: round gave 401 x 301, i.e. a semi-transparent last column / row
  assert.deepEqual(outputSize(801, 601, v('V1', { scale: 0.5 })), { w: 400, h: 300 });
  assert.deepEqual(outputSize(1920, 1080, v('V1', { crop: { x: 0, y: 0, w: 333, h: 111 }, scale: 0.5 })), { w: 166, h: 55 });
  // floating-point error: 1600 * (1000 / 1600) is 1000 within an epsilon, not 999
  assert.equal(outputSize(1600, 900, v('V1', { scale: scaleForWidth(1600, 1000) })).w, 1000);
  for (let w = 1; w < 400; w += 7) for (const s of [0.33, 0.37, 0.5, 0.61, 1.7, 2]) {
    if (w * s < 1) continue; // below 1 px the output is 1 px (never 0)
    assert.ok(outputSize(w, w, v('V1', { scale: s })).w <= w * s + 1e-9, `${w} x ${s}`);
  }
});

test('maxScale / capScale: ceiling of 16384 px per side and 100 million pixels', () => {
  assert.equal(maxScale(1920, 16384), 1);                        // full page: already at the side ceiling
  assert.equal(capScale(1000, 1000, 2).capped, false);
  assert.deepEqual(capScale(1000, 1000, 2), { scale: 2, capped: false });
  const c = capScale(3840, 2160, 10);                            // 4K x 10: toBlob used to return null
  assert.equal(c.capped, true);
  for (const [w, h] of [[3840, 2160], [1920, 16384], [100, 20000], [16384, 16384], [7, 5], [20000, 30]]) {
    const o = outputSize(w, h, v('V1', { scale: maxScale(w, h) }));
    assert.ok(o.w <= 16384 && o.h <= 16384 && o.w * o.h <= 100e6, `${w}x${h} -> ${o.w}x${o.h}`);
  }
});

test('clampCrop: bounds, integers, null if the whole image', () => {
  assert.deepEqual(clampCrop({ x: -5, y: 10.4, w: 100.6, h: 50 }, 200, 100), { x: 0, y: 10, w: 101, h: 50 });
  assert.deepEqual(clampCrop({ x: 150, y: 0, w: 100, h: 100 }, 200, 100), { x: 150, y: 0, w: 50, h: 100 });
  assert.deepEqual(clampCrop({ x: 500, y: 500, w: 10, h: 10 }, 200, 100), { x: 199, y: 99, w: 1, h: 1 });
  assert.equal(clampCrop({ x: 0, y: 0, w: 200, h: 100 }, 200, 100), null);
  assert.equal(clampCrop({ x: -10, y: -10, w: 999, h: 999 }, 200, 100), null);
});

test('scaleForWidth', () => {
  assert.equal(scaleForWidth(1000, 500), 0.5);
  assert.equal(scaleForWidth(1000, 0), 0.01);
  assert.equal(scaleForWidth(10, 1e6), 10);
});

