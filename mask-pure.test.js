import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_RANGE, DEFAULT_FILL, PALETTE, blockAverages, regionBox, solidColor, tilePlan } from './mask-pure.js';

// A w x h RGBA image from a function (x, y) -> [r, g, b].
function image(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set([...pixel(x, y), 255], (y * w + x) * 4);
  }
  return data;
}

// Deterministic noise, so that the tests need no random generator.
const noise = (x, y, k) => ((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0;

test('blockAverages: the exact mean of every block, per channel', () => {
  // 4 x 2 image cut into 2 x 1 blocks: the left block holds 1, 2, 5, 6 and the right one 3, 4, 7, 8 (red channel)
  const rgba = new Uint8ClampedArray(4 * 2 * 4);
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((v, i) => rgba.set([v, 10 * v, 100 + v, 255], i * 4));
  const out = blockAverages(rgba, 4, 2, 2, 1);
  assert.deepEqual([...out], [Math.round(14 / 4), Math.round(140 / 4), 100 + Math.round(14 / 4), 255, Math.round(22 / 4), Math.round(220 / 4), 100 + Math.round(22 / 4), 255]);
  // a single block is the mean of the whole image
  const flat = image(7, 5, (x, y) => [x * 10, y * 20, 33]);
  const one = blockAverages(flat, 7, 5, 1, 1);
  let r = 0, g = 0;
  for (let i = 0; i < flat.length; i += 4) { r += flat[i]; g += flat[i + 1]; }
  assert.deepEqual([...one], [Math.round(r / 35), Math.round(g / 35), 33, 255]);
  // blocks of a width that does not divide: edges at round(i * w / cols), every pixel counted once
  const uneven = blockAverages(image(10, 1, (x) => [x * 10, 0, 0]), 10, 1, 3, 1); // edges 0, 3, 7, 10
  assert.deepEqual([...uneven].filter((_, i) => i % 4 === 0), [Math.round((0 + 10 + 20) / 3), Math.round((30 + 40 + 50 + 60) / 4), Math.round((70 + 80 + 90) / 3)]);
});

test('blockAverages: IRREVERSIBLE - two images that differ inside the blocks but have the same block means give the same output', () => {
  const W = 160, H = 96, K = 32; // 5 x 3 blocks
  const { cols, rows } = tilePlan(W, H, K);
  assert.deepEqual([cols, rows], [5, 3]);
  // A: every block is one flat color
  const flatBlocks = image(W, H, (x, y) => {
    const c = Math.floor(x / K) + 5 * Math.floor(y / K);
    return [(c * 37) % 256, (c * 91) % 256, (c * 53) % 256];
  });
  // B: the same means, but with a strong detail inside each block: pairs of pixels move apart by +d / -d (a "text" in the block)
  const detailed = Uint8ClampedArray.from(flatBlocks);
  let touched = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      const d = 1 + (noise(x, y, 1) % 40);
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const room = Math.min(detailed[i + k], 255 - detailed[i + k], detailed[i + 4 + k], 255 - detailed[i + 4 + k]);
        const move = Math.min(d, room);
        detailed[i + k] -= move; // the pair keeps its sum, so the block keeps its sum
        detailed[i + 4 + k] += move;
        touched += move > 0 ? 1 : 0;
      }
    }
  }
  assert.ok(touched > W * H, 'the detail must really differ inside the blocks');
  assert.notDeepEqual([...flatBlocks], [...detailed]);
  assert.deepEqual([...blockAverages(detailed, W, H, cols, rows)], [...blockAverages(flatBlocks, W, H, cols, rows)], 'same means, same output');
  // and a change that moves a mean is seen: the output depends on the means, and on nothing else
  const moved = Uint8ClampedArray.from(detailed);
  for (let x = 0; x < K; x++) moved[x * 4] = 255; // one row of the first block turned red: its mean moves by several levels
  assert.notDeepEqual([...blockAverages(moved, W, H, cols, rows)], [...blockAverages(detailed, W, H, cols, rows)]);
});

test('tilePlan: whole blocks of at least the block size, at least one', () => {
  assert.deepEqual(tilePlan(800, 400, 40), { cols: 20, rows: 10 });
  assert.deepEqual(tilePlan(100, 30, 40), { cols: 2, rows: 1 });
  assert.deepEqual(tilePlan(10, 10, 120), { cols: 1, rows: 1 });
  for (const [w, h, k] of [[801, 399, 16], [1920, 1080, 120], [333, 777, 50]]) {
    const { cols, rows } = tilePlan(w, h, k);
    assert.ok(w / cols >= k && h / rows >= k, `${w}x${h} at ${k}: no block smaller than the block size`);
  }
  assert.deepEqual([BLOCK_RANGE.min, BLOCK_RANGE.max], [16, 120], 'the same bounds as the pixelation');
});

test('regionBox: whole pixels rounded outward, clipped to the image, null when it misses', () => {
  assert.deepEqual(regionBox({ x: 10.2, y: 5.7, w: 100.3, h: 40 }, 500, 300), { x: 10, y: 5, w: 101, h: 41 });
  assert.deepEqual(regionBox({ x: 10, y: 5, w: 100, h: 40 }, 500, 300), { x: 10, y: 5, w: 100, h: 40 }, 'already whole: untouched');
  assert.deepEqual(regionBox({ x: -30, y: -8, w: 100, h: 50 }, 500, 300), { x: 0, y: 0, w: 70, h: 42 });
  assert.deepEqual(regionBox({ x: 450, y: 280, w: 100, h: 100 }, 500, 300), { x: 450, y: 280, w: 50, h: 20 });
  assert.equal(regionBox({ x: 600, y: 0, w: 50, h: 50 }, 500, 300), null);
  assert.equal(regionBox({ x: 10, y: 10, w: 0, h: 10 }, 500, 300), null);
  // the floating point residue of a computed edge does not add a pixel
  assert.deepEqual(regionBox({ x: 0.1 + 0.2, y: 0, w: 99.7 - 0.0000000001, h: 10 }, 500, 300), { x: 0, y: 0, w: 100, h: 10 });
});

test('solidColor: an opaque color as #rrggbb, anything with transparency or unknown is refused', () => {
  assert.equal(solidColor('#000000'), '#000000');
  assert.equal(solidColor('#2563EB'), '#2563eb', 'lower case');
  assert.equal(solidColor('#000'), '#000000', 'short form');
  assert.equal(solidColor('#fff'), '#ffffff');
  assert.equal(solidColor(' #ff8800 '), '#ff8800');
  assert.equal(solidColor('#112233ff'), '#112233', 'an alpha of 100 % is opaque');
  assert.equal(solidColor('#123f'), '#112233');
  for (const see of ['#11223380', '#11223300', '#1238', '#fff0', 'rgba(0,0,0,.5)', 'rgba(0,0,0,1)', 'rgb(0,0,0)', 'transparent', 'black', 'hsla(0,0%,0%,.2)', '', '#12', '#12345', '#gggggg', null, undefined, 42, {}]) {
    assert.equal(solidColor(see), null, `${String(see)} is refused`);
  }
});

test('the palette: black first, opaque unique colors, named in both languages', async () => {
  assert.equal(PALETTE[0].hex, DEFAULT_FILL);
  assert.equal(DEFAULT_FILL, '#000000');
  assert.ok(PALETTE.length >= 6 && PALETTE.length <= 10);
  assert.equal(new Set(PALETTE.map((p) => p.hex)).size, PALETTE.length, 'unique colors');
  for (const { hex, key } of PALETTE) {
    assert.equal(solidColor(hex), hex, `${hex} is an opaque lower case #rrggbb`);
    assert.match(key, /^prop\.color\.[a-z]+$/);
  }
  const en = (await import('./locales/en.js')).default, fr = (await import('./locales/fr.js')).default;
  for (const { key } of PALETTE) assert.ok(en[key] && fr[key], `${key} is translated`);
  // an accent and the neutrals: white and gray are there for the backgrounds of dark and light pages
  assert.ok(PALETTE.some((p) => p.hex === '#ffffff') && PALETTE.some((p) => p.hex === '#808080'));
});
