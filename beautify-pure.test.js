import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_HEIGHT, DEFAULT_BEAUTIFY, GRADIENTS, PADDING, RADIUS, extraOf, framedSize, layout, normalizeBeautify, styleOf } from './beautify-pure.js';

const style = (extra = {}) => ({ ...DEFAULT_BEAUTIFY, ...extra });

test('normalizeBeautify: anything that is not an object is no style', () => {
  for (const v of [null, undefined, 0, 'soft', true]) assert.equal(normalizeBeautify(v), null, String(v));
});

test('normalizeBeautify: an empty object gives the default, a valid style is kept as it is', () => {
  assert.deepEqual(normalizeBeautify({}), DEFAULT_BEAUTIFY);
  const s = { bg: { type: 'color', color: '#2563eb' }, padding: 64, radius: 20, shadow: 'strong', frame: 'window' };
  assert.deepEqual(normalizeBeautify(s), s);
  assert.deepEqual(normalizeBeautify({ bg: { type: 'none' } }).bg, { type: 'none' });
});

test('normalizeBeautify: each field falls back alone, numbers are clamped to their step', () => {
  const n = normalizeBeautify({ bg: { type: 'color', color: 'red' }, padding: 1000, radius: -5, shadow: 'toString', frame: 'dialog' });
  assert.deepEqual(n, { bg: DEFAULT_BEAUTIFY.bg, padding: PADDING.max, radius: RADIUS.min, shadow: DEFAULT_BEAUTIFY.shadow, frame: 'none' });
  assert.equal(normalizeBeautify({ padding: 50 }).padding, 52, 'rounded to a step of 4');
  assert.equal(normalizeBeautify({ padding: NaN }).padding, DEFAULT_BEAUTIFY.padding);
  assert.equal(normalizeBeautify({ padding: '48' }).padding, DEFAULT_BEAUTIFY.padding, 'a string is not a number');
  assert.deepEqual(normalizeBeautify({ bg: { type: 'gradient', index: GRADIENTS.length } }).bg, DEFAULT_BEAUTIFY.bg);
  assert.deepEqual(normalizeBeautify({ bg: { type: 'gradient', index: 2 } }).bg, { type: 'gradient', index: 2 });
  assert.deepEqual(normalizeBeautify({ bg: { type: 'color', color: '#ABCDEF' } }).bg, { type: 'color', color: '#abcdef' }, 'lower case');
});

test('normalizeBeautify never hands out the default object itself', () => {
  const a = normalizeBeautify({});
  a.bg = { type: 'gradient', index: 5 };
  assert.deepEqual(DEFAULT_BEAUTIFY.bg, { type: 'gradient', index: 0 });
  assert.deepEqual(normalizeBeautify({}).bg, { type: 'gradient', index: 0 });
  const b = normalizeBeautify({});
  const c = normalizeBeautify({});
  assert.notEqual(b.bg, c.bg);
});

test('styleOf reads the style of a version, null when it has none', () => {
  assert.equal(styleOf(undefined), null);
  assert.equal(styleOf({ beautify: null }), null);
  assert.equal(styleOf({}), null);
  assert.equal(styleOf({ beautify: { padding: 8 } }).padding, 8);
});

test('extraOf: padding on each side, the window bar on top, nothing without a style', () => {
  assert.deepEqual(extraOf(null), { x: 0, y: 0, pad: 0, bar: 0 });
  assert.deepEqual(extraOf(style({ padding: 48 })), { x: 96, y: 96, pad: 48, bar: 0 });
  assert.deepEqual(extraOf(style({ padding: 48, frame: 'window' })), { x: 96, y: 96 + BAR_HEIGHT, pad: 48, bar: BAR_HEIGHT });
  assert.deepEqual(extraOf(style({ padding: 0 })), { x: 0, y: 0, pad: 0, bar: 0 });
});

test('extraOf: a reduced drawing scales the padding and the bar, the bar never vanishes', () => {
  assert.deepEqual(extraOf(style({ padding: 48, frame: 'window' }), 0.5), { x: 48, y: 48 + 18, pad: 24, bar: 18 });
  assert.equal(extraOf(style({ frame: 'window' }), 0.001).bar, 1);
});

test('framedSize adds the extra to the capture', () => {
  assert.deepEqual(framedSize(1000, 600, null), { w: 1000, h: 600 });
  assert.deepEqual(framedSize(1000, 600, style({ padding: 40 })), { w: 1080, h: 680 });
  assert.deepEqual(framedSize(1000, 600, style({ padding: 40, frame: 'window' })), { w: 1080, h: 680 + BAR_HEIGHT });
});

test('layout: the capture sits under the bar, inside the padding, and the window holds both', () => {
  const l = layout(1000, 600, style({ padding: 40, frame: 'window', radius: 12, shadow: 'soft' }));
  assert.deepEqual([l.w, l.h], [1080, 680 + BAR_HEIGHT]);
  assert.deepEqual(l.win, { x: 40, y: 40, w: 1000, h: 600 + BAR_HEIGHT });
  assert.deepEqual(l.bar, { x: 40, y: 40, w: 1000, h: BAR_HEIGHT });
  assert.deepEqual(l.shot, { x: 40, y: 40 + BAR_HEIGHT, w: 1000, h: 600 });
  assert.equal(l.radius, 12);
  assert.deepEqual(l.shadow, { blur: 24, dy: 8, alpha: 0.25 });
});

test('layout: no frame, no bar; no shadow, no shadow; the capture fills the window', () => {
  const l = layout(300, 200, style({ padding: 0, frame: 'none', shadow: 'none' }));
  assert.equal(l.bar, null);
  assert.equal(l.shadow, null);
  assert.deepEqual(l.shot, l.win);
  assert.deepEqual([l.w, l.h], [300, 200]);
});

test('layout: the shadow shrinks to fit the padding and keeps its strength', () => {
  const room = (shadow, padding) => layout(1000, 600, style({ padding, shadow })).shadow;
  assert.deepEqual(room('strong', 96), { blur: 40, dy: 16, alpha: 0.45 });
  assert.deepEqual(room('strong', 20), { blur: 14, dy: 5, alpha: 0.45 });
  assert.deepEqual(room('soft', 20), { blur: 15, dy: 5, alpha: 0.25 });
  for (const shadow of ['soft', 'strong']) {
    for (let padding = 0; padding <= PADDING.max; padding++) {
      for (const k of [1, 0.5, 0.25]) {
        const s = layout(1000, 600, style({ padding, shadow }), k).shadow;
        assert.ok(s.blur + s.dy <= Math.round(padding * k), `${shadow} ${padding} ${k}`);
      }
    }
  }
});

test('layout: the radius never exceeds half of the shortest side of the window', () => {
  assert.equal(layout(40, 30, style({ radius: 48 })).radius, 15);
  assert.equal(layout(1000, 600, style({ radius: 48 })).radius, 48);
});

test('layout at scale k: the same look, smaller, and everything stays inside the image', () => {
  const full = layout(1000, 600, style({ padding: 48, frame: 'window', shadow: 'strong' }));
  const small = layout(250, 150, style({ padding: 48, frame: 'window', shadow: 'strong' }), 0.25);
  assert.deepEqual([small.w, small.h], [250 + 24, 150 + 24 + 9]);
  assert.deepEqual(small.shadow, { blur: 8, dy: 3, alpha: 0.45 });
  for (const l of [full, small]) {
    assert.ok(l.shot.x + l.shot.w <= l.w && l.shot.y + l.shot.h <= l.h);
    assert.ok(l.win.x + l.win.w <= l.w && l.win.y + l.win.h <= l.h);
  }
});
