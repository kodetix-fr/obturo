import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NAME, blankVersion, cleanVersionName, createVersion, deleteVersion, isChosenName, renameVersion, pickVersion, clampCrop, innerSize, outputSize, scaleForWidth, maxScale, capScale } from './versions.js';
import { DEFAULT_BEAUTIFY, extraOf } from './beautify-pure.js';

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

test('createVersion: the beautify look is not copied, a new version starts without it', () => {
  const base = { versions: [v('V1', { beautify: { ...DEFAULT_BEAUTIFY } })], active: 0 };
  assert.equal(createVersion(base).versions[1].beautify, null);
  assert.deepEqual(base.versions[0].beautify, DEFAULT_BEAUTIFY, 'the displayed version keeps its own');
  assert.equal(blankVersion().beautify, null);
});

test('outputSize adds the padding and the bar to the capture, innerSize does not', () => {
  const beautify = { ...DEFAULT_BEAUTIFY, padding: 40, frame: 'window' };
  const version = v('V1', { crop: { x: 0, y: 0, w: 1000, h: 500 }, scale: 0.5, beautify });
  assert.deepEqual(innerSize(2000, 1000, version), { w: 500, h: 250 });
  assert.deepEqual(outputSize(2000, 1000, version), { w: 580, h: 250 + 80 + 36 });
  assert.deepEqual(outputSize(2000, 1000, v('V2', { beautify: null })), { w: 2000, h: 1000 });
  assert.deepEqual(outputSize(2000, 1000, v('V3', { beautify: 'junk' })), { w: 2000, h: 1000 }, 'a damaged style is no style');
});

test('maxScale with the beautify extra: the padding counts in both ceilings', () => {
  const extra = extraOf({ ...DEFAULT_BEAUTIFY, padding: 128, frame: 'window' });
  const side = maxScale(1000, 500, extra);
  assert.ok(1000 * side + extra.x <= 16384 && 500 * side + extra.y <= 16384);
  const wide = maxScale(10000, 10000, extra); // the area ceiling decides
  assert.ok((10000 * wide + extra.x) * (10000 * wide + extra.y) <= 100e6);
  assert.ok((10000 * (wide + 2e-4) + extra.x) * (10000 * (wide + 2e-4) + extra.y) > 100e6, 'and it is the largest one, to the fourth decimal');
  assert.equal(maxScale(1000, 500, { x: 0, y: 0 }), maxScale(1000, 500), 'no extra, the plain ceiling');
  assert.ok(maxScale(1000, 500, extra) < maxScale(1000, 500));
});

test('capScale brings the scale down for the frame too', () => {
  const style = { ...DEFAULT_BEAUTIFY, padding: 128 };
  const without = capScale(10000, 5000, 1.5);
  const framed = capScale(10000, 5000, 1.5, style);
  assert.equal(without.capped, true);
  assert.equal(framed.capped, true);
  assert.ok(framed.scale < without.scale);
  assert.deepEqual(capScale(100, 100, 2, style), { scale: 2, capped: false });
});


test('cleanVersionName: one line, spaces collapsed, at most MAX_NAME characters, nothing for what is not text', () => {
  assert.equal(cleanVersionName('  Before   the fix \n'), 'Before the fix');
  assert.equal(cleanVersionName('x'.repeat(100)).length, MAX_NAME);
  assert.equal(cleanVersionName(null), '');
  assert.equal(cleanVersionName(undefined), '');
  assert.equal(cleanVersionName(42), '42');
});

test('isChosenName: V1 and V2 are given by Obturo, anything else was chosen', () => {
  for (const name of ['V1', 'V12']) assert.equal(isChosenName(name), false, name);
  for (const name of ['Before', 'V1 fixed', 'v1', 'Version 1']) assert.equal(isChosenName(name), true, name);
  for (const name of ['', null, undefined, 3]) assert.equal(isChosenName(name), false, String(name));
});

test('renameVersion: the version gets the cleaned name, the others and the active one are untouched', () => {
  const state = { versions: [{ ...blankVersion(), name: 'V1' }, { ...blankVersion(), name: 'V2' }], active: 1 };
  const out = renameVersion(state, 0, '  Before ');
  assert.deepEqual(out.versions.map((v) => v.name), ['Before', 'V2']);
  assert.equal(out.active, 1);
  assert.deepEqual(state.versions.map((v) => v.name), ['V1', 'V2'], 'the state is not changed');
});

test('renameVersion: an empty name gives back the smallest free Vn, a version that is not there changes nothing', () => {
  const state = { versions: [{ ...blankVersion(), name: 'Before' }, { ...blankVersion(), name: 'V1' }], active: 0 };
  assert.deepEqual(renameVersion(state, 0, '   ').versions.map((v) => v.name), ['V2', 'V1']);
  assert.deepEqual(renameVersion(state, 5, 'x'), state);
});
