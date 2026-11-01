import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cropRect, cleanArea, pngSize, planTiles, maxTiles, canvasSize, tileDest, thumbPlan, base64Bytes, decodeDataUrl, versionsKey, MAX_TILES, MAX_DIM, MAX_PIXELS,
  clipBox, pickScroller, growPlan, MIN_SCROLL, MIN_SHARE, isCut, unscrolledKey, failureKey, FRAME_SHARE,
  IMPORT_MAX_BYTES, IMPORT_MAX_PIXELS, IMPORT_MAX_SIDE, declaredSize, importFits, importTitle, isPng, looksLikeImage,
} from './pure.js';

// PNG signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4)
const png = (w, h) => {
  const b = new DataView(new ArrayBuffer(24));
  b.setUint32(16, w);
  b.setUint32(20, h);
  return new Blob([b.buffer]);
};

test('pngSize reads width and height from the header', async () => {
  assert.deepEqual(await pngSize(png(3840, 2160)), { w: 3840, h: 2160 });
});

test('planTiles: page = 1 viewport -> a single tile', () => {
  assert.deepEqual(planTiles(800, 800), { covered: 800, ys: [0] });
  assert.deepEqual(planTiles(500, 800), { covered: 500, ys: [0] }); // shorter than the viewport
});

test('planTiles: exact multiple, no duplicate', () => {
  assert.deepEqual(planTiles(2400, 800).ys, [0, 800, 1600]);
});

test('planTiles: remainder -> last tile stuck to the bottom (overlap)', () => {
  assert.deepEqual(planTiles(2000, 800).ys, [0, 800, 1200]);
});

test('planTiles: no uncovered area, for many sizes and DPRs', () => {
  for (const dpr of [1, 1.25, 2]) {
    for (const [total, view] of [[801, 800], [1599, 800], [1600, 800], [12345, 937], [100000, 641]]) {
      const { covered, ys } = planTiles(total, view, dpr);
      assert.equal(ys[0], 0);
      for (let i = 1; i < ys.length; i++) {
        assert.ok(ys[i] > ys[i - 1], 'strictly increasing');
        assert.ok(ys[i] <= ys[i - 1] + view, 'no gap between two tiles');
      }
      assert.ok(ys.at(-1) + view >= covered, 'the last one reaches the bottom');
    }
  }
});

test('maxTiles: FHD (900 px tile) ~36 tiles at DPR 1 and ~18 at DPR 2', () => {
  assert.equal(maxTiles(900, 1), 36);
  assert.equal(maxTiles(900, 2), 18);
  assert.equal(planTiles(1e6, 900, 1).ys.length, 36);
  assert.equal(planTiles(1e6, 900, 2).ys.length, 18);
});

test('maxTiles: clamped to [1, MAX_TILES]', () => {
  assert.equal(maxTiles(50, 1), MAX_TILES);       // small tile: fixed ceiling
  assert.equal(maxTiles(20000, 3), 1);             // huge tile: at least 1
  assert.equal(maxTiles(900, 0), 36);              // invalid DPR treated as 1
  assert.equal(maxTiles(900, NaN), 36);
});

test('planTiles: giant page cut, the top is kept', () => {
  const { covered, ys } = planTiles(1e6, 900, 1);
  assert.equal(covered, 900 * 36);
  assert.equal(ys.at(-1), covered - 900);
});

test('planTiles: a zero viewport does not loop', () => {
  assert.deepEqual(planTiles(5000, 0), { covered: 5000, ys: [0] });
});

test('canvasSize: no fallback when it fits', () => {
  assert.deepEqual(canvasSize(5400, 1920, 1), { k: 1, w: 1920, h: 5400 });
});

test('canvasSize: uniform fallback under 16384 px and MAX_PIXELS', () => {
  const tall = canvasSize(30000, 3840, 2); // 3840 x 60000
  assert.ok(tall.k < 1 && tall.h <= MAX_DIM && tall.w * tall.h <= MAX_PIXELS);
  assert.ok(Math.abs(tall.w / tall.h - 3840 / 60000) < 0.001, 'proportions kept');
  const wide = canvasSize(6000, 7680, 2); // 7680 x 12000 = 92 Mpx, each side < 16384
  assert.ok(wide.k < 1 && wide.w * wide.h <= MAX_PIXELS);
  const mid = canvasSize(12000, 1904, 1); // 22.8 Mpx: fits under 32 Mpx
  assert.equal(mid.k, 1);
  const big = canvasSize(12000, 2800, 1); // 33.6 Mpx: just above the ceiling
  assert.ok(big.k < 1 && big.w * big.h <= MAX_PIXELS);
});

test('tileDest: integer positions, height without resampling at k = 1', () => {
  assert.deepEqual(tileDest(800, 2, 1601, 1), { dy: 1600, dh: 1601 });
  assert.deepEqual(tileDest(800, 2, 1601, 0.5), { dy: 800, dh: 801 });
});

test('tileDest: a tile that stops 1 or 2 rows short of the canvas bottom is stretched down to it', () => {
  assert.deepEqual(tileDest(3968.5, 1.5, 1548, 1, 7000, 7502), { dy: 5953, dh: 1549 }, 'ends at 7501: one row short');
  assert.deepEqual(tileDest(3968.5, 1.5, 1548, 1, 7000, 7503), { dy: 5953, dh: 1550 }, 'two rows');
  assert.deepEqual(tileDest(3968.5, 1.5, 1548, 1, 7000, 7504), { dy: 5953, dh: 1548 }, 'three rows: not rounding, left alone');
  assert.deepEqual(tileDest(3968.5, 1.5, 1548, 1, 7000, 7501), { dy: 5953, dh: 1548 }, 'exactly at the bottom');
  assert.deepEqual(tileDest(3968.5, 1.5, 1548, 1, 7000, 7400), { dy: 5953, dh: 1548 }, 'past the bottom: left alone');
});

test('tileDest: an empty row between two tiles is filled by stretching the tile upward', () => {
  // the previous tile stops before row 749, this one would start at 750: a one-row gap
  assert.deepEqual(tileDest(1000, 1.5, 1050, 0.5, 749), { dy: 749, dh: 526 });
  // exact join or overlap: the tile keeps its place and its height
  assert.deepEqual(tileDest(1000, 1.5, 1050, 0.5, 750), { dy: 750, dh: 525 });
  assert.deepEqual(tileDest(1000, 1.5, 1050, 0.5, 900), { dy: 750, dh: 525 });
  // first tile: nothing is pasted yet
  assert.deepEqual(tileDest(0, 1.5, 1050, 0.5), { dy: 0, dh: 525 });
});

// --- Full page: which element scrolls ---

const [VW, VH] = [1920, 1080];
const WIN = VW * VH;
const scroller = (x, y, w, h, max) => ({ x, y, w, h, max });
const still = { user: true, max: 0 }; // a document that does not scroll
const pick = (cands, doc) => pickScroller(cands, doc, VW, VH);
const SHELL = scroller(120, 48, 1800, 1032, 3968); // the panel of an application shell: 90% of the window, 5,000 px of content

test('clipBox: the part of a box inside the window', () => {
  assert.deepEqual(clipBox({ x: 10, y: 20, w: 100, h: 50 }, VW, VH), { x: 10, y: 20, w: 100, h: 50 });
  assert.deepEqual(clipBox({ x: -100, y: -50, w: 300, h: 200 }, VW, VH), { x: 0, y: 0, w: 200, h: 150 });
  assert.deepEqual(clipBox({ x: 1900, y: 1000, w: 100, h: 200 }, VW, VH), { x: 1900, y: 1000, w: 20, h: 80 });
  assert.deepEqual(clipBox({ x: 2000, y: 10, w: 50, h: 50 }, VW, VH), { x: 2000, y: 10, w: 0, h: 50 }, 'outside: no width, never negative');
  assert.equal(clipBox({ x: 0, y: 1200, w: 50, h: 50 }, VW, VH).h, 0);
});

test('pickScroller: a document that scrolls, with nothing else that scrolls much, stays the document', () => {
  assert.equal(pick([], { user: true, max: 12000 }), -1);
  assert.equal(pick([scroller(0, 0, 300, 200, 900)], { user: true, max: 12000 }), -1, 'a code block that scrolls: 3% of the window');
  assert.equal(pick([scroller(0, 0, 1920, 400, 5000)], { user: true, max: 12000 }), -1, 'a panel of 37% of the window: not a candidate at all');
  assert.equal(pick([SHELL], { user: true, max: 12000 }), -1, 'the document has more to scroll than the panel');
});

test('pickScroller: an application shell (the document is still) picks its panel; a still page picks nothing', () => {
  assert.equal(pick([SHELL], still), 0);
  assert.equal(pick([scroller(0, 0, 400, 1080, 9000), SHELL], still), 1, 'a sidebar of 20% is not a candidate, the main panel is');
  assert.equal(pick([], still), -1);
  assert.equal(pick([], { user: true, max: MIN_SCROLL }), -1);
});

test('pickScroller: horizontal scrolling alone, a rounding error of range, an input are not scrollers', () => {
  assert.equal(pick([scroller(0, 0, 1920, 1080, 0)], still), -1, 'wide content, same height: nothing to scroll vertically');
  assert.equal(pick([{ ...SHELL, max: MIN_SCROLL }], still), -1, 'exactly the threshold');
  assert.equal(pick([{ ...SHELL, max: MIN_SCROLL + 1 }], still), 0);
  assert.equal(pick([{ ...SHELL, max: NaN }, { ...SHELL, w: NaN }, { ...SHELL, max: undefined }], still), -1, 'garbage never wins');
});

test('pickScroller: a scroller must show 40% of the window', () => {
  const share = (p) => scroller(0, 0, VW, (p * WIN) / VW, 5000);
  assert.equal(pick([share(0.39)], still), -1);
  assert.equal(pick([share(0.41)], still), 0);
  assert.equal(pick([share(0.4)], still), 0, 'the limit itself is in');
});

test('pickScroller: nested scrollers, the one with the most scrollable content on screen wins, not the outermost', () => {
  const outer = scroller(120, 48, 1800, 1032, 268); // the whole panel, 1,300 px of content
  const inner = scroller(200, 148, 1400, 700, 5300); // a list in it, 6,000 px of content
  assert.equal(pick([outer, inner], still), 1);
  assert.equal(pick([inner, outer], still), 0, 'whatever the order');
  const small = scroller(200, 148, 1000, 600, 1500); // a smaller list with little to scroll
  assert.equal(pick([{ ...outer, max: 4000 }, small], still), 0, 'the outer one has more to show');
});

test('pickScroller: the document against a panel: whoever has the most to show; a tie goes to the document', () => {
  const half = scroller(0, 0, VW, VH / 2, 10000); // 50% of the window
  assert.equal(pick([half], { user: true, max: 3000 }), 0, '0.5 x 10,000 against 1 x 3,000');
  assert.equal(pick([half], { user: true, max: 12000 }), -1);
  assert.equal(pick([half], { user: true, max: 5000 }), -1, 'a tie');
  assert.equal(pick([half], { user: true, max: 4999 }), 0);
});

test('pickScroller: a document the user cannot scroll (overflow hidden) gives way to a panel, and stays the fallback', () => {
  assert.equal(pick([SHELL], { user: false, max: 20000 }), 0);
  assert.equal(pick([], { user: false, max: 20000 }), -1, 'no panel: the document, as before');
});

test('pickScroller: a box partly outside the window counts for the part that shows', () => {
  const cut = scroller(0, -800, VW, 1200, 5000); // 400 px of it in the window: 37%
  assert.equal(pick([cut], still), -1);
  assert.equal(pick([{ ...cut, y: -700 }], still), 0, '500 px: 46%');
});

test('pickScroller: between two panels with the same content, the first', () => {
  const a = scroller(0, 0, 960, 1080, 3000);
  const b = scroller(960, 0, 960, 1080, 3000);
  assert.equal(pick([a, b], still), 0);
  assert.equal(pick([b, a], still), 0);
  assert.equal(pick([a, { ...b, max: 3001 }], still), 1);
});

test('MIN_SHARE: the 9 probe points of fullpage.js find every box that shows that share of the window', () => {
  assert.ok(MIN_SHARE > 1 / 3, 'above the gap between two probes');
  const probes = [1 / 6, 1 / 2, 5 / 6];
  const hit = (x0, y0, w, h) => probes.some((px) => probes.some((py) => px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h));
  for (let w = 0.4; w <= 1.0001; w += 0.02) {
    for (let h = MIN_SHARE / w; h <= 1.0001; h += 0.02) {
      for (let x0 = 0; x0 + w <= 1.0001; x0 += 0.01) {
        for (let y0 = 0; y0 + h <= 1.0001; y0 += 0.01) assert.ok(hit(x0, y0, w, h), `${x0} ${y0} ${w} ${h}`);
      }
    }
  }
});

// --- Full page: a height that grows ---

test('isCut: the page is longer than the plan by MIN_SCROLL or more', () => {
  assert.equal(isCut(3000, 3000), false);
  assert.equal(isCut(3000, 3000 + MIN_SCROLL - 1), false, 'a rounding error is not a cut page');
  assert.equal(isCut(3000, 3000 + MIN_SCROLL), true);
  assert.equal(isCut(3000, 2000), false, 'a page that got shorter');
  const plan = planTiles(500000, 1000, 1);
  assert.equal(isCut(plan.covered, 500000), true, 'the limits of the capture cut a very long page');
  assert.equal(isCut(planTiles(8000, 1000, 1).covered, 8000), false, 'a long page that fits is not cut');
});

test('unscrolledKey: a big frame is said, a small one (a video, a widget) and a page that fits are not', () => {
  assert.equal(unscrolledKey({ frame: 0.9 }), 'sw.full.frame');
  assert.equal(unscrolledKey({ frame: FRAME_SHARE }), 'sw.full.frame');
  assert.equal(unscrolledKey({ frame: FRAME_SHARE - 0.01 }), null);
  assert.equal(unscrolledKey({ frame: 0 }), null);
});

test('failureKey: what stopped a full page, in words the user can act on', () => {
  const key = (m) => failureKey(new Error(m));
  assert.equal(key('window resized or zoom changed during the capture'), 'sw.full.fail.resized');
  assert.equal(key('window size changed during the capture'), 'sw.full.fail.resized');
  assert.equal(key('scrolled area moved during the capture'), 'sw.full.fail.moved');
  assert.equal(key('scroller gone'), 'sw.full.fail.moved');
  assert.equal(key('tab changed during the capture'), 'sw.full.fail.tab');
  for (const m of ['page did not answer (go)', 'restored', 'No tab with id: 12.', 'Frame with ID 0 was removed.', 'The tab was closed.', 'Cannot access contents of the page.']) {
    assert.equal(key(m), 'sw.full.fail.page', m);
  }
  assert.equal(key('2D context unavailable'), 'sw.full.fail.other');
  assert.equal(failureKey('boom'), 'sw.full.fail.other', 'not an Error');
  assert.equal(failureKey(undefined), 'sw.full.fail.other');
});

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

// Headers as the formats write them: only what declaredSize reads is meaningful, the rest is padding.
const u8 = (...parts) => Uint8Array.from(parts.flat(Infinity));
const asc = (s) => [...s].map((c) => c.charCodeAt(0));
const be16 = (n) => [n >> 8, n & 255];
const be32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, n >> 8];
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];

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

test('growPlan: nothing grew, or less than MIN_SCROLL px: no new plan', () => {
  const plan = planTiles(2000, 800);
  assert.equal(growPlan(plan, 2000, 800, 1, 1200), null);
  assert.equal(growPlan(plan, 2000 + MIN_SCROLL - 1, 800, 1, 1200), null);
  assert.equal(growPlan(plan, 1500, 800, 1, 0), null, 'a shrunk page keeps its plan');
  assert.ok(growPlan(plan, 2000 + MIN_SCROLL, 800, 1, 1200));
});

test('growPlan: the capture goes on from the first position past the tile just taken', () => {
  const plan = planTiles(2000, 800); // 0, 800, 1200 (the last one stuck to the bottom)
  const g = growPlan(plan, 3000, 800, 1, 1200);
  assert.deepEqual(g.ys, [0, 800, 1600, 2200]);
  assert.equal(g.next, 2, 'the tile at 1200 was taken: 1600 is next, and it starts inside what the tile at 1200 covered (up to 2000)');
  assert.equal(g.covered, 3000);
  const mid = growPlan(planTiles(2400, 800), 5000, 800, 1, 800); // a middle tile
  assert.equal(mid.ys[mid.next], 1600);
});

test('growPlan: whatever the tile where the growth shows, the tiles taken and the new ones leave no gap', () => {
  for (const [total, grown, view] of [[2000, 3000, 800], [2400, 2500, 800], [3000, 9000, 641], [1000, 1010, 400], [5000, 30000, 937]]) {
    const first = planTiles(total, view, 1);
    for (const [i, doneY] of first.ys.entries()) {
      const g = growPlan(first, grown, view, 1, doneY);
      if (!g) continue;
      assert.ok(g.ys[g.next] > doneY && g.ys[g.next] <= doneY + view, `from ${doneY}: next ${g.ys[g.next]}`);
      if (g.next > 0) assert.ok(g.ys[g.next - 1] <= doneY, 'nothing is skipped');
      assert.ok(g.ys.at(-1) + view >= g.covered, `tile ${i}: the last one reaches the new bottom`);
    }
  }
});

test('canvasSize: the scale of a page that grows stays 1 while it fits, and changes past the limits (sw.js then stops following)', () => {
  const [w, sy] = [1784, 1];
  for (const covered of [3000, 9000, 15000, 16384]) assert.equal(canvasSize(covered, w, sy).k, 1, String(covered));
  assert.ok(canvasSize(21000, w, sy).k < 1, 'over 16,384 rows');
  assert.ok(canvasSize(18000, 2000, 1).k < 1, 'over 32 Mpx');
  assert.equal(canvasSize(5000, w, sy).w, canvasSize(9000, w, sy).w, 'the width does not change with the height');
});

test('growPlan: the limits still apply (MAX_TILES): a plan already at the cap does not grow', () => {
  const capped = planTiles(1e6, 900, 1);
  assert.equal(growPlan(capped, 2e6, 900, 1, capped.ys.at(-1)), null);
  const almost = planTiles(30000, 900, 1);
  const g = growPlan(almost, 1e6, 900, 1, almost.ys.at(-1));
  assert.equal(g.covered, 900 * 36, 'it grows up to the cap');
});

// The tiles of a scroller, pasted the way sw.js does (clipBox, planTiles, cropRect, tileDest): every row of the canvas must
// be painted, by the tile that really shows it.
function stitchRows({ vw, vh, dpr, box, contentH, snap = false }) {
  const [iw, ih] = [Math.round(vw * dpr), Math.round(vh * dpr)];
  const vis = clipBox(box, vw, vh);
  const max = contentH - box.h;
  const plan = planTiles(max + vis.h, vis.h, dpr);
  const crop = cropRect(vis, vw, vh, iw, ih);
  const sy = ih / vh;
  const size = canvasSize(plan.covered, crop.w, sy);
  const painted = new Int32Array(size.h).fill(-1); // canvas row -> number of the tile that painted it last
  let end = Infinity;
  const taken = [];
  plan.ys.forEach((y, n) => {
    const actual = Math.min(y, max);
    const real = snap ? Math.floor(actual * dpr) / dpr : actual; // fractional display scale: the browser snaps to a device pixel
    const srcRows = Math.min(ih - crop.y, crop.h); // no extra row for a scroller: it would be a row outside its box
    const d = tileDest(real, sy, srcRows, size.k, end, size.h);
    for (let r = d.dy; r < Math.min(d.dy + d.dh, size.h); r++) painted[r] = n;
    taken.push({ y: real, ...d });
    end = d.dy + d.dh;
  });
  return { plan, crop, size, painted, taken, vis };
}

test('a scroller in tiles: the box is cropped from each tile, every row is painted, the last tile overlaps the one before', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const contentH of [5000, 5001, 1033, 2064, 2065, 7777]) {
      const box = { x: 120, y: 48, w: 1000, h: 1032 }; // narrow enough to stay under MAX_PIXELS at every scale
      const s = stitchRows({ vw: VW, vh: VH, dpr, box, contentH, snap: true });
      const tag = `dpr ${dpr}, content ${contentH}`;
      assert.deepEqual(s.crop, { x: Math.round(120 * dpr), y: Math.round(48 * dpr), w: Math.round(1000 * dpr), h: Math.round(1032 * dpr) }, tag);
      assert.equal(s.size.k, 1, tag);
      assert.equal(s.size.w, s.crop.w, `output as wide as the box, ${tag}`);
      assert.ok(Math.abs(s.size.h - contentH * dpr) <= 1, `output as high as the content, ${tag}: ${s.size.h}`);
      assert.ok(!s.painted.includes(-1), `no hole, ${tag}`);
      assert.equal(s.painted.at(-1), s.plan.ys.length - 1, `the last tile paints the bottom, ${tag}`);
      if (s.taken.length > 1) {
        const [prev, last] = s.taken.slice(-2);
        assert.ok(last.dy <= prev.dy + prev.dh, `the last tile starts inside the previous one, ${tag}`);
        if (contentH % 1032) assert.ok(last.dy < prev.dy + prev.dh - 1, `and overlaps it when the content is not a multiple of the tile, ${tag}`);
      }
    }
  }
});

test('a scroller taller than the canvas limits is scaled down as a page is, without holes', () => {
  const s = stitchRows({ vw: VW, vh: VH, dpr: 1, box: { x: 120, y: 48, w: 1800, h: 1032 }, contentH: 20000 }); // 36 Mpx
  assert.ok(s.size.k < 1 && s.size.w * s.size.h <= MAX_PIXELS);
  assert.ok(!s.painted.includes(-1));
});

test('a scroller partly outside the window is cropped to what shows; the output is as high as what can be scrolled to show', () => {
  // top 100 px above the window: 900 px of its 1,000 show, and the content row at the top of the window is the 100th
  const box = { x: 200, y: -100, w: 1000, h: 1000 };
  const s = stitchRows({ vw: VW, vh: VH, dpr: 1, box, contentH: 4000 });
  assert.deepEqual(s.vis, { x: 200, y: 0, w: 1000, h: 900 });
  assert.deepEqual(s.crop, { x: 200, y: 0, w: 1000, h: 900 });
  assert.ok(!s.painted.includes(-1));
  assert.equal(s.size.h, 4000 - 1000 + 900);
  // bottom 300 px below the window: 700 px of 1,000 show
  const low = stitchRows({ vw: VW, vh: VH, dpr: 2, box: { x: 0, y: 380, w: 800, h: 1000 }, contentH: 3000 });
  assert.deepEqual(low.vis, { x: 0, y: 380, w: 800, h: 700 });
  assert.deepEqual(low.crop, { x: 0, y: 760, w: 1600, h: 1400 });
  assert.ok(!low.painted.includes(-1));
  assert.equal(low.size.h, (3000 - 1000 + 700) * 2);
});

test('thumbPlan: 240 px wide, never enlarged, only the top for a very tall image', () => {
  assert.deepEqual(thumbPlan(1920, 1080), { keepH: 1080, k: 0.125 });
  assert.deepEqual(thumbPlan(1920, 16384), { keepH: 1280, k: 0.125 });
  assert.deepEqual(thumbPlan(100, 50), { keepH: 50, k: 1 });
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

// A thumbnail is written only if the shot still has the versions it was rendered from.
test('versionsKey: the same state gives the same key, a clone included, and any change gives another', () => {
  const state = { versions: [{ name: 'V1', crop: null, scale: 1, objects: [{ type: 'Rect', left: 1, top: 2, fill: '#000' }] }], active: 0 };
  assert.equal(versionsKey(state), versionsKey(structuredClone(state)), 'what the database hands back is the same');
  assert.equal(versionsKey({ versions: [], active: -1 }), versionsKey({ versions: [], active: -1 }));
  assert.notEqual(versionsKey(state), versionsKey({ ...state, active: -1 }), 'the displayed version counts');
  assert.notEqual(versionsKey(state), versionsKey({ versions: [], active: -1 }), 'a version added');
  const moved = structuredClone(state);
  moved.versions[0].objects[0].left = 2;
  assert.notEqual(versionsKey(state), versionsKey(moved), 'an object moved');
  const cropped = structuredClone(state);
  cropped.versions[0].crop = { x: 0, y: 0, w: 10, h: 10 };
  assert.notEqual(versionsKey(state), versionsKey(cropped), 'a crop');
  assert.equal(versionsKey({ versions: undefined, active: undefined }), versionsKey({ versions: [], active: -1 }), 'a row without versions is the original');
});

// --- Data URL of the capture ---

const bytesOf = (...rows) => Uint8Array.from(rows.flat());
// every length modulo 3 (padding), every byte value
const samples = [bytesOf([]), bytesOf([0]), bytesOf([255, 0]), bytesOf([137, 80, 78]), bytesOf([137, 80, 78, 71]), Uint8Array.from({ length: 256 }, (_, i) => i), Uint8Array.from({ length: 100_003 }, (_, i) => (i * 31) % 256)];
const nativeLike = (b64) => new Uint8Array(Buffer.from(b64, 'base64')); // what Uint8Array.fromBase64 gives

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
