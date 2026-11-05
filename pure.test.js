import test from 'node:test';
import assert from 'node:assert/strict';
import { base64Bytes, cleanArea, cropRect, decodeDataUrl, pngSize } from './pure.js';

// PNG signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4)
const png = (w, h) => {
  const b = new DataView(new ArrayBuffer(24));
  b.setUint32(16, w);
  b.setUint32(20, h);
  return new Blob([b.buffer]);
};

// --- Data URL of the capture ---

const bytesOf = (...rows) => Uint8Array.from(rows.flat());
// every length modulo 3 (padding), every byte value
const samples = [bytesOf([]), bytesOf([0]), bytesOf([255, 0]), bytesOf([137, 80, 78]), bytesOf([137, 80, 78, 71]), Uint8Array.from({ length: 256 }, (_, i) => i), Uint8Array.from({ length: 100_003 }, (_, i) => (i * 31) % 256)];
const nativeLike = (b64) => new Uint8Array(Buffer.from(b64, 'base64')); // what Uint8Array.fromBase64 gives

test('pngSize reads width and height from the header', async () => {
  assert.deepEqual(await pngSize(png(3840, 2160)), { w: 3840, h: 2160 });
});

test('cropRect applies the image/viewport factor', () => {
  const r = { x: 10, y: 20, w: 100, h: 50 };
  assert.deepEqual(cropRect(r, 1000, 500, 2000, 1000), { x: 20, y: 40, w: 200, h: 100 });
});

test('cropRect clamps to the image on the right and at the bottom', () => {
  const r = { x: 950, y: 480, w: 100, h: 50 };
  assert.deepEqual(cropRect(r, 1000, 500, 1000, 500), { x: 950, y: 480, w: 50, h: 20 });
});

test('cropRect crops a rect that overflows on the left and top (no shift)', () => {
  assert.deepEqual(cropRect({ x: -100, y: -50, w: 300, h: 200 }, 1000, 500, 1000, 500), { x: 0, y: 0, w: 200, h: 150 });
});

test('cropRect at DPR 2: overflows clamped in image space', () => {
  // CSS viewport 1000 x 500, image 2000 x 1000
  assert.deepEqual(cropRect({ x: -10, y: -10, w: 60, h: 60 }, 1000, 500, 2000, 1000), { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(cropRect({ x: 980, y: 480, w: 100, h: 100 }, 1000, 500, 2000, 1000), { x: 1960, y: 960, w: 40, h: 40 });
});

test('cropRect outside the image: zero size, never negative', () => {
  assert.deepEqual(cropRect({ x: 1200, y: 10, w: 50, h: 50 }, 1000, 500, 1000, 500), { x: 1200, y: 10, w: 0, h: 50 });
  assert.deepEqual(cropRect({ x: -300, y: 10, w: 50, h: 50 }, 1000, 500, 1000, 500), { x: 0, y: 10, w: 0, h: 50 });
});

test('cleanArea accepts a valid message and keeps only the useful fields', () => {
  const m = { type: 'area', rect: { x: 0, y: 10.5, w: 300, h: 200, extra: 1 }, vw: 1280, vh: 700, url: 'x', t: 5 };
  assert.deepEqual(cleanArea(m), { rect: { x: 0, y: 10.5, w: 300, h: 200 }, vw: 1280, vh: 700 });
});

test('cleanArea rejects anything that is not a finite number > 0 (size) or finite (position)', () => {
  const ok = { rect: { x: 1, y: 1, w: 10, h: 10 }, vw: 100, vh: 100 };
  assert.ok(cleanArea(ok));
  for (const bad of [
    null, undefined, {}, { ...ok, rect: null }, { ...ok, rect: { ...ok.rect, w: 0 } }, { ...ok, rect: { ...ok.rect, h: -5 } },
    { ...ok, rect: { ...ok.rect, w: NaN } }, { ...ok, rect: { ...ok.rect, x: Infinity } }, { ...ok, rect: { ...ok.rect, y: '3' } },
    { ...ok, vw: 0 }, { ...ok, vh: -1 }, { ...ok, vw: '1280' }, { ...ok, vh: NaN }, { rect: ok.rect },
  ]) assert.equal(cleanArea(bad), null, JSON.stringify(bad));
});

test('base64Bytes: the fallback (atob and a loop) and a native decoder give the bytes back', () => {
  for (const bytes of samples) {
    const b64 = Buffer.from(bytes).toString('base64');
    assert.deepEqual(base64Bytes(b64, null), bytes, `fallback, ${bytes.length} bytes`);
    assert.deepEqual(base64Bytes(b64, nativeLike), bytes, `native, ${bytes.length} bytes`);
  }
});

test('base64Bytes: the native decoder is the one used when there is one, the fallback when there is none', () => {
  const calls = [];
  const spy = (b64) => { calls.push(b64); return new Uint8Array([1, 2, 3]); };
  assert.deepEqual(base64Bytes('AQID', spy), new Uint8Array([1, 2, 3]));
  assert.deepEqual(calls, ['AQID']);
  assert.deepEqual(base64Bytes('AQID', null), new Uint8Array([1, 2, 3]), 'null: atob');
  assert.deepEqual(base64Bytes('AQID'), new Uint8Array([1, 2, 3]), 'the default is whatever this runtime offers');
});

test('decodeDataUrl: the base64 text after the comma, as it is, and the bytes it stands for', () => {
  const png = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
  const b64 = Buffer.from(png).toString('base64');
  for (const native of [null, nativeLike, undefined]) {
    const out = decodeDataUrl(`data:image/png;base64,${b64}`, native);
    assert.equal(out.b64, b64);
    assert.deepEqual(out.bytes, png);
  }
});

test('decodeDataUrl: what is not a base64 data URL is an error, not garbage', () => {
  for (const bad of ['', 'AAAA', 'data:image/png;base64', 'data:text/plain,hello', 'data:image/png,AAAA', 'http://example.test/a,b']) {
    assert.throws(() => decodeDataUrl(bad), /not a base64 data URL/, bad);
  }
  assert.throws(() => decodeDataUrl('data:image/png;base64,@@@@', null), /./, 'invalid base64 text');
});
