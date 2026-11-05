import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_MAX_BYTES, IMPORT_MAX_PIXELS, IMPORT_MAX_SIDE, declaredSize, importFits, importTitle, isPng, looksLikeImage } from './import-pure.js';

// Headers as the formats write them: only what declaredSize reads is meaningful, the rest is padding.
const u8 = (...parts) => Uint8Array.from(parts.flat(Infinity));
const asc = (s) => [...s].map((c) => c.charCodeAt(0));
const be16 = (n) => [n >> 8, n & 255];
const be32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, n >> 8];
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];

test('importFits: up to 16,384 px a side, 32 million pixels and 64 MB, nothing empty', () => {
  const ok = { w: 1920, h: 1080, bytes: 2e6 };
  assert.equal(importFits(ok), true);
  assert.equal(importFits({ ...ok, w: IMPORT_MAX_SIDE, h: 1000 }), true, 'the side of a canvas');
  assert.equal(importFits({ ...ok, w: IMPORT_MAX_SIDE + 1, h: 10 }), false);
  assert.equal(importFits({ ...ok, h: IMPORT_MAX_SIDE + 1, w: 10 }), false);
  assert.equal(importFits({ ...ok, w: 8000, h: IMPORT_MAX_PIXELS / 8000 }), true, 'exactly the pixel limit');
  assert.equal(importFits({ ...ok, w: 8000, h: IMPORT_MAX_PIXELS / 8000 + 1 }), false);
  assert.equal(importFits({ ...ok, bytes: IMPORT_MAX_BYTES }), true);
  assert.equal(importFits({ ...ok, bytes: IMPORT_MAX_BYTES + 1 }), false);
  assert.equal(importFits({ ...ok, w: 0 }), false);
  assert.equal(importFits({ ...ok, h: NaN }), false);
});

test('looksLikeImage: the type says, or the name when a drop comes with no type', () => {
  assert.equal(looksLikeImage({ type: 'image/png', name: 'a' }), true);
  assert.equal(looksLikeImage({ type: 'image/svg+xml', name: 'a.svg' }), true, 'the decoder will have the last word');
  assert.equal(looksLikeImage({ type: '', name: 'shot.JPG' }), true);
  assert.equal(looksLikeImage({ type: '', name: 'photo.avif' }), true);
  assert.equal(looksLikeImage({ type: 'application/pdf', name: 'a.pdf' }), false);
  assert.equal(looksLikeImage({ type: '', name: 'notes.txt' }), false);
  assert.equal(looksLikeImage({ type: '', name: 'png' }), false, 'no extension');
  assert.equal(looksLikeImage({}), false);
});

test('isPng: the 8 bytes of the signature, nothing else', () => {
  assert.equal(isPng([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), true);
  assert.equal(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(isPng([0xff, 0xd8, 0xff, 0xe0]), false, 'a JPEG');
  assert.equal(isPng([0x89, 0x50, 0x4e, 0x47]), false, 'cut short');
  assert.equal(isPng([]), false);
});

test('declaredSize: the size a PNG, a GIF, a BMP, a JPEG or a WebP declares in its header', () => {
  const png = (w, h) => u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), asc('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0]);
  assert.deepEqual(declaredSize(png(1920, 1080)), { w: 1920, h: 1080 });
  assert.deepEqual(declaredSize(png(40000, 40000)), { w: 40000, h: 40000 }, 'what a small file can declare');
  assert.deepEqual(declaredSize(png(4294967295, 1)), { w: 4294967295, h: 1 }, 'the top bit of a 32-bit size is not a sign');
  assert.deepEqual(declaredSize(u8(asc('GIF89a'), le16(640), le16(480), [0, 0, 0])), { w: 640, h: 480 });
  const bmp = (w, h) => u8(asc('BM'), new Array(12).fill(0), le32(40), le32(w), le32(h), new Array(8).fill(0));
  assert.deepEqual(declaredSize(bmp(300, 200)), { w: 300, h: 200 });
  assert.deepEqual(declaredSize(bmp(300, 2 ** 32 - 200)), { w: 300, h: 200 }, 'a negative height: a bitmap stored top-down');
  // JPEG: an APP0 segment first (the frame is not at a fixed place), then the start of frame
  const jpeg = (w, h, sof = 0xc0) => u8([0xff, 0xd8], [0xff, 0xe0], be16(16), new Array(14).fill(0), [0xff, 0xff], [0xff, sof], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  assert.deepEqual(declaredSize(jpeg(1600, 900)), { w: 1600, h: 900 });
  assert.deepEqual(declaredSize(jpeg(65535, 65535, 0xc2)), { w: 65535, h: 65535 }, 'progressive');
  assert.equal(declaredSize(u8([0xff, 0xd8], [0xff, 0xe0], be16(16), new Array(14).fill(0))), null, 'no frame in what was read');
  assert.equal(declaredSize(u8([0xff, 0xd8], [0xff, 0xc4], be16(2), new Array(20).fill(0))), null, 'a table is not a frame');
  // WebP: the three ways of writing the size
  const riff = (chunk, rest) => u8(asc('RIFF'), le32(100), asc('WEBP'), asc(chunk), le32(30), rest, new Array(8).fill(0));
  assert.deepEqual(declaredSize(riff('VP8X', [[0, 0, 0, 0], le24(1919), le24(1079)])), { w: 1920, h: 1080 }, 'extended');
  assert.deepEqual(declaredSize(riff('VP8L', [[0x2f], le32((499) | (299 << 14))])), { w: 500, h: 300 }, 'lossless');
  assert.deepEqual(declaredSize(riff('VP8 ', [[0, 0, 0], [0x9d, 0x01, 0x2a], le16(640), le16(360)])), { w: 640, h: 360 }, 'lossy');
});

test('declaredSize: another format, a header cut short, or nothing at all: null', () => {
  assert.equal(declaredSize(u8(asc('....ftypavif'), new Array(40).fill(0))), null, 'AVIF: left to the decoder');
  assert.equal(declaredSize(u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Array(8).fill(0))), null, 'a PNG cut before the size');
  assert.equal(declaredSize(u8(asc('GIF89a'))), null);
  assert.equal(declaredSize(u8(asc('RIFF'), le32(10), asc('WEBP'))), null);
  assert.equal(declaredSize(u8()), null);
  assert.equal(declaredSize(u8(asc('just some text, not an image at all'))), null);
});

test('importTitle: the file name without its extension, the fallback for a generic or empty name', () => {
  assert.equal(importTitle('Quarterly report.png', 'Pasted image'), 'Quarterly report');
  assert.equal(importTitle('a.b.c.jpeg', 'x'), 'a.b.c');
  assert.equal(importTitle('  spaced  .webp', 'x'), 'spaced');
  assert.equal(importTitle('image.png', 'Pasted image'), 'Pasted image', 'what a browser names a pasted image');
  assert.equal(importTitle('IMAGE.PNG', 'Pasted image'), 'Pasted image');
  assert.equal(importTitle('image-2.png', 'Pasted image'), 'image-2', 'a name of its own');
  assert.equal(importTitle('.png', 'Pasted image'), 'Pasted image', 'nothing left');
  assert.equal(importTitle('', 'Pasted image'), 'Pasted image');
  assert.equal(importTitle(undefined, 'Pasted image'), 'Pasted image');
  assert.equal(importTitle('noext', 'x'), 'noext');
});
