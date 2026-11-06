// The two ways to hide an area, in the real extension: the solid fill (any opaque color, exact to the pixel) and the soft blur
// (smooth, and as irreversible as a mosaic of the same block size). Every file that is exported is read back.
//
// The unit tests of the maths (exact block means, the irreversibility of the output, the colors) are in mask-pure.test.js; here
// the whole path is proven: the tool, the style bar, the saved version, the editor, every export, the strip thumbnail.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  dbDump, decodePng, download, drag, mapper, originalHash, poll, px, ready, resetLibrary, shotWhere, sleep, spec, titled, tool, waitOut,
} from './support/editor.mjs';
import { MIME, batchDone, closeBatch, decodeImage, downloadAfter, openBatch, readPdf, readZip, setDefaultFormat } from './support/export.mjs';
import { thumbPlan } from '../../thumb-pure.js';

const BLUE = [37, 99, 235, 255]; // #2563eb

/** Draws a test image in the page and adds it to the library: 'checker' (40 px squares), 'disc', or the 'blocks' / 'detailed' pair. */
const plant = (page, options) => page.evaluate(async ({ kind, w, h, title, region, block }) => {
  const { addShot } = await import(`${location.origin}/db.js`);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  if (kind === 'checker') {
    for (let y = 0; y < h; y += 40) for (let x = 0; x < w; x += 40) if ((x + y) / 40 % 2 === 0) { g.fillStyle = '#000'; g.fillRect(x, y, 40, 40); }
  } else if (kind === 'disc') {
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(600, 400, 100, 0, 7);
    g.fill();
    g.fillStyle = '#c00';
    g.fillRect(100, 100, 200, 60);
  } else { // 'blocks': one flat color per block of the grid the blur will use; 'detailed': the same block means, a strong detail inside
    const cols = Math.max(1, Math.floor(region.w / block)), rows = Math.max(1, Math.floor(region.h / block));
    const edge = (i, n, size) => Math.round((i * size) / n);
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        g.fillStyle = `rgb(${(q * 37 + r * 11) % 256},${(q * 91 + r * 5) % 256},${(q * 53 + r * 29) % 256})`;
        g.fillRect(region.x + edge(q, cols, region.w), region.y + edge(r, rows, region.h), edge(q + 1, cols, region.w) - edge(q, cols, region.w), edge(r + 1, rows, region.h) - edge(r, rows, region.h));
      }
    }
    if (kind === 'detailed') {
      const img = g.getImageData(region.x, region.y, region.w, region.h);
      const d = img.data;
      for (let y = 0; y < region.h; y++) {
        for (let x = 0; x < region.w; x += 2) { // pairs inside a block (blocks are 40 px wide): the sum of the pair, so of the block, is kept
          const i = (y * region.w + x) * 4, amount = 1 + (((x * 73856093) ^ (y * 19349663)) >>> 0) % 40;
          for (let k = 0; k < 3; k++) {
            const move = Math.min(amount, d[i + k], 255 - d[i + k], d[i + 4 + k], 255 - d[i + 4 + k]);
            d[i + k] -= move;
            d[i + 4 + k] += move;
          }
        }
      }
      g.putImageData(img, region.x, region.y);
    }
  }
  const original = await new Promise((done) => c.toBlob(done, 'image/png'));
  c.width = c.height = 1;
  await addShot({ original, url: `https://example.test/${encodeURIComponent(title)}`, title, w, h });
}, options);

/** Writes versions straight into a shot of the database (what the editor would have saved). */
const setVersions = (page, id, versions, active = 0) => page.evaluate(async ({ id, versions, active }) => {
  await (await import(`${location.origin}/db.js`)).updateShot(id, { versions, active });
}, { id, versions, active });

const version = (objects, extra = {}) => ({ name: 'V1', crop: null, scale: 1, objects, ...extra });
const blurObject = (left, top, width, height, block) => ({ type: 'BlurRegion', left, top, width, height, block });
const pixelObject = (left, top, width, height, block) => ({ type: 'PixelRegion', left, top, width, height, block });

/** The largest difference between two neighbouring pixels (right or below) inside a box, over the three color channels. */
function maxStep(img, box) {
  let max = 0;
  for (let y = box.y; y < box.y + box.h - 1; y++) {
    for (let x = box.x; x < box.x + box.w - 1; x++) {
      const a = px(img, x, y);
      for (const b of [px(img, x + 1, y), px(img, x, y + 1)]) max = Math.max(max, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    }
  }
  return max;
}

/** How many pixels of a box satisfy `test`. */
function countIn(img, box, test) {
  let n = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (test(px(img, x, y))) n++;
  return n;
}

describe('hiding: solid fill and soft blur', () => {
  let h, page;
  const csp = [];
  const grabCsp = async () => { csp.push(...(await page.evaluate(() => window.__csp).catch(() => []))); };
  const library = async (specs = [], extra) => {
    await grabCsp();
    await resetLibrary(page, h, specs, extra);
  };
  const lastShot = async () => (await dbDump(page)).at(-1); // the most recent, the one on screen
  const objects = async (id, v = 0) => (await dbDump(page)).find((s) => s.id === id).versions[v]?.objects ?? [];
  const swatch = (color) => page.locator(`#swatches .sw:has(input[value="${color}"])`);
  const setInput = (selector, value) => page.evaluate(({ selector, value }) => {
    const el = /** @type {HTMLInputElement} */ (document.querySelector(selector));
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
  const fillScale = async (percent) => {
    await page.fill('#scalePct', String(percent));
    await page.press('#scalePct', 'Tab');
  };
  const visible = (selector) => page.locator(selector).isVisible();

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  it('solid fill: the style bar follows the tool; black by default; swatches, free color and memory for the next fills', async () => {
    await library([spec('Fill', 1600, 900)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    const m = await mapper(page, 1600, 900);
    assert.equal(await visible('#lineProps'), true, 'line color and stroke with nothing chosen');
    assert.equal(await visible('#flatProps'), false);
    await tool(page, 'flat');
    assert.equal(await visible('#flatProps'), true, 'the fill bar');
    assert.equal(await visible('#lineProps'), false, 'no line color for a fill');
    assert.equal(await page.locator('#flatColor').inputValue(), '#000000', 'black by default');
    assert.equal(await page.isChecked('#swatches input[value="#000000"]'), true);
    assert.equal(await page.locator('#swatches input').count(), 9, 'black, white, gray and six accents');
    assert.equal(await page.getAttribute('#swatches input[value="#2563eb"]', 'aria-label'), 'Blue', 'the swatches are named');

    await swatch('#2563eb').click();
    assert.equal(await page.locator('#flatColor').inputValue(), '#2563eb');
    assert.equal(await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('[data-tool="flat"]')).style.getPropertyValue('--fill')), '#2563eb', 'the icon of the tool shows the color');
    await drag(page, m, 240, 220, 560, 380);
    let list = (await shotWhere(page, id, (s) => s.versions[0]?.objects.length === 1, 'first fill saved')).versions[0].objects;
    assert.deepEqual([list[0].type, list[0].fill, list[0].opacity ?? 1], ['Rect', '#2563eb', 1]);

    // the tool stays armed; select the fill to recolor it from the swatches (an undoable change of that fill only)
    await tool(page, 'select');
    await page.mouse.click(...m.pt(400, 300));
    assert.equal(await visible('#flatProps'), true, 'the bar stays on the fill while it is selected');
    assert.equal(await page.isChecked('#swatches input[value="#2563eb"]'), true, 'the bar shows the color of the selected fill');
    await swatch('#e53935').click();
    list = (await shotWhere(page, id, (s) => s.versions[0]?.objects[0]?.fill === '#e53935', 'selected fill recolored')).versions[0].objects;
    assert.equal(list.length, 1, 'recolored, not duplicated');
    await page.keyboard.press('Control+z');
    await shotWhere(page, id, (s) => s.versions[0]?.objects[0]?.fill === '#2563eb', 'undo restores the color');
    await page.keyboard.press('Control+y');
    await shotWhere(page, id, (s) => s.versions[0]?.objects[0]?.fill === '#e53935', 'redo');

    // the last color is remembered for the next fills; the free color works too
    await tool(page, 'flat');
    assert.equal(await page.locator('#flatColor').inputValue(), '#e53935', 'remembered');
    await drag(page, m, 700, 220, 900, 380);
    await tool(page, 'flat'); // (the new fill is selected: a color picked now would recolor it, and the tool leaves the selection)
    await setInput('#flatColor', '#12ab34');
    assert.equal(await page.locator('#swatches input:checked').count(), 0, 'a free color matches no swatch');
    await drag(page, m, 1000, 220, 1200, 380);
    list = (await shotWhere(page, id, (s) => s.versions[0]?.objects.length === 3, 'three fills')).versions[0].objects;
    assert.deepEqual(list.map((o) => o.fill), ['#e53935', '#e53935', '#12ab34']);
    assert.ok(list.every((o) => /^#[0-9a-f]{6}$/.test(o.fill) && (o.opacity ?? 1) === 1 && o.objectCaching === false), 'always an opaque #rrggbb, no object cache');
    assert.ok(!JSON.stringify(list).includes('data:'), 'no pixels in the version');

    // by keyboard: arrows move between the swatches of the radio group
    await tool(page, 'flat');
    await swatch('#000000').locator('input').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#flatColor').inputValue(), '#ffffff', 'ArrowRight chooses the next swatch');
    assert.equal(await page.isChecked('#swatches input[value="#ffffff"]'), true);

    // the color survives a reload of the page
    await page.reload();
    await ready(page);
    await tool(page, 'flat');
    assert.equal(await page.locator('#flatColor').inputValue(), '#ffffff', 'remembered across sessions');
    await swatch('#000000').click(); // back to black for the next tests
  });

  it('solid fill: every pixel under it is exactly its color, edges included, at 33 / 50 / 100 / 200 %, cropped and moved', async () => {
    await library([spec('Exact', 1600, 900)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    const m = await mapper(page, 1600, 900);
    await tool(page, 'flat');
    await swatch('#2563eb').click();
    await drag(page, m, 230, 215, 570, 385); // on the red and blue stripes
    await tool(page, 'select');
    await drag(page, m, 400, 300, 413.7, 307.3); // to a position that is not a whole number of pixels
    await page.click('#crop');
    await drag(page, m, 0, 0, 150, 100);
    await drag(page, m, 1600, 900, 1000, 600);
    await page.click('#cropOk');
    const bad = [];
    for (const percent of [33, 50, 100, 200]) {
      await fillScale(percent);
      const shot = await shotWhere(page, id, (s) => s.versions[0]?.scale === percent / 100 && s.versions[0].crop, `scale ${percent} % saved`);
      const png = await decodePng(page, (await download(page)).buf);
      const v = shot.versions[0];
      const fill = v.objects.find((o) => o.type === 'Rect');
      assert.equal(fill.fill, '#2563eb');
      const x0 = (fill.left - v.crop.x) * v.scale, y0 = (fill.top - v.crop.y) * v.scale;
      const x1 = x0 + fill.width * fill.scaleX * v.scale, y1 = y0 + fill.height * fill.scaleY * v.scale;
      let wrong = 0, total = 0;
      for (let y = Math.ceil(y0); y <= Math.floor(y1) - 1; y++) { // pixels 100 % covered, with no margin
        for (let x = Math.ceil(x0); x <= Math.floor(x1) - 1; x++) {
          total++;
          if (px(png, x, y).some((c, i) => c !== BLUE[i])) wrong++;
        }
      }
      if (wrong || !total) bad.push(`${percent} % : ${wrong}/${total}`);
    }
    assert.deepEqual(bad, [], 'pixels under the fill that are not exactly its color');
  });

  it('a fill saved before the colors existed stays black, untouched, and can be recolored', async () => {
    await library([spec('Legacy', 1600, 900)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    // The object as the previous version saved it: a plain Rect with fill '#000', no object cache.
    const legacy = { type: 'Rect', version: '6.9.1', left: 1000, top: 300, width: 200, height: 200, fill: '#000', strokeWidth: 0, objectCaching: false };
    await setVersions(page, id, [version([legacy])]);
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    const png = await decodePng(page, (await download(page)).buf);
    assert.deepEqual(px(png, 1100, 400), [0, 0, 0, 255], 'still black');
    const m = await mapper(page, 1600, 900);
    await tool(page, 'select');
    const [sx, sy] = m.pt(1100, 400);
    await page.mouse.click(sx, sy);
    assert.equal(await visible('#flatProps'), true, 'selected: the fill bar');
    assert.equal(await page.locator('#flatColor').inputValue(), '#000000');
    assert.equal(await page.isChecked('#swatches input[value="#000000"]'), true, 'no color recorded = black');
    await sleep(700); // absence to prove: selecting does not migrate the object
    assert.equal((await objects(id))[0].fill, '#000', 'the saved object is untouched');
    await swatch('#ffffff').click();
    await shotWhere(page, id, (s) => s.versions[0].objects[0].fill === '#ffffff', 'recolored white');
    assert.deepEqual(px(await decodePng(page, (await download(page)).buf), 1100, 400), [255, 255, 255, 255], 'white fill');
  });

  it('blur: its own tool and strength, a version without any pixel, smooth in the export', async () => {
    await library([spec('Blur', 1600, 900)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    const m = await mapper(page, 1600, 900);
    await tool(page, 'blur');
    assert.equal(await visible('#blurProps'), true);
    assert.equal(await visible('#pixelProps') || await visible('#flatProps') || await visible('#lineProps'), false, 'only the blur bar');
    assert.equal(await page.getAttribute('[data-tool="blur"]', 'aria-pressed'), 'true');
    const proposed = Number(await page.locator('#blur').inputValue());
    assert.ok(proposed >= 16 && proposed <= 120, `proposed strength ${proposed}`);
    await setInput('#blur', 40);
    await drag(page, m, 240, 220, 560, 380); // on the stripes: a 2 px red / blue pattern
    const list = (await shotWhere(page, id, (s) => s.versions[0]?.objects.length === 1, 'blur saved')).versions[0].objects;
    assert.equal(list[0].type, 'BlurRegion');
    assert.equal(list[0].block, 40);
    assert.ok(!JSON.stringify(list).includes('data:') && !('live' in list[0]), 'neither pixels nor the gesture flag in the version');
    const o = list[0];
    const png = await decodePng(page, (await download(page)).buf);
    const box = { x: Math.ceil(o.left) + 2, y: Math.ceil(o.top) + 2, w: Math.floor(o.width) - 4, h: Math.floor(o.height) - 4 };
    assert.ok(maxStep(png, box) <= 12, `stripes of 200 levels become a smooth blur (largest step ${maxStep(png, box)})`);
    assert.ok(countIn(png, box, (c) => c[0] > 200 && c[1] < 40) === 0, 'no pure red stripe is left');
    // the strength is read from the selected blur, and moves it (the export dissolved the selection: select the blur again)
    await tool(page, 'select');
    const [bx, by] = m.pt(400, 300);
    await page.mouse.click(bx, by);
    assert.equal(await page.locator('#blur').inputValue(), '40', 'the slider shows the strength of the selected blur');
    await setInput('#blur', 90);
    await shotWhere(page, id, (s) => s.versions[0].objects[0].block === 90, 'strength of the selected blur changed');
    await page.keyboard.press('Control+z');
    await shotWhere(page, id, (s) => s.versions[0].objects[0].block === 40, 'undo');
    // by keyboard (the undo cleared the selection)
    await page.mouse.click(bx, by);
    assert.equal(await page.locator('#blur').inputValue(), '40', 'the slider shows the strength of the selected blur');
    await page.locator('#blur').focus();
    await page.keyboard.press('ArrowRight');
    await shotWhere(page, id, (s) => s.versions[0].objects[0].block === 42, 'the slider answers the keyboard');
    // and it is remembered: the next blur has this strength
    await tool(page, 'blur');
    assert.equal(await page.locator('#blur').inputValue(), '42');
  });

  it('blur has no steps between blocks; the pixelation of the same pattern does', async () => {
    await library([], async () => plant(page, { kind: 'checker', w: 1600, h: 900, title: 'Checker' }));
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    // blocks of 40 px aligned on the 40 px squares: the means alternate 0 / 255 from one block to the next
    await setVersions(page, id, [version([blurObject(200, 120, 800, 400, 40), pixelObject(200, 560, 800, 280, 40)])]);
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    const png = await decodePng(page, (await download(page)).buf);
    const blurBox = { x: 200, y: 120, w: 800, h: 400 }, pixelBox = { x: 200, y: 560, w: 800, h: 280 };
    const blurStep = maxStep(png, blurBox), pixelStep = maxStep(png, pixelBox);
    assert.ok(pixelStep >= 150, `the mosaic jumps from block to block (${pixelStep} levels)`);
    assert.ok(blurStep <= 24, `the blur does not (${blurStep} levels at most between neighbours)`);
    // it is a blur of the means and not a flat or a copy: it still varies, and none of the original's pure black / white is left
    let lo = 255, hi = 0;
    for (let y = blurBox.y; y < blurBox.y + blurBox.h; y++) for (let x = blurBox.x; x < blurBox.x + blurBox.w; x++) { const v = px(png, x, y)[0]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(hi - lo > 120, `still varies (${lo}..${hi})`);
    assert.ok(countIn(png, blurBox, (c) => c[0] === 0 || c[0] === 255) < blurBox.w * blurBox.h * 0.01, 'the original pixels are gone');
  });

  it('IRREVERSIBLE: two images that differ inside the blocks but have the same block means export the exact same blur', async () => {
    const region = { x: 200, y: 200, w: 800, h: 400 };
    await library([], async () => {
      await plant(page, { kind: 'blocks', w: 1600, h: 900, title: 'Flat blocks', region, block: 40 });
      await plant(page, { kind: 'detailed', w: 1600, h: 900, title: 'Detailed blocks', region, block: 40 });
    });
    await ready(page);
    const shots = await dbDump(page);
    const A = shots.find((s) => s.title === 'Flat blocks'), B = shots.find((s) => s.title === 'Detailed blocks');
    assert.notEqual(await originalHash(page, A.id), await originalHash(page, B.id), 'the two originals differ');
    for (const s of [A, B]) await setVersions(page, s.id, [version([blurObject(region.x, region.y, region.w, region.h, 40)])]);
    await page.reload();
    await ready(page);
    const exported = {};
    for (const s of [A, B]) {
      await titled(page, s.title).click();
      await waitOut(page, 1600, 900);
      exported[s.title] = await decodePng(page, (await download(page)).buf);
    }
    const a = exported[A.title], b = exported[B.title];
    // A software rasterizer rounds half a level by the image under the blur at a few pixels; a blur that read the inside of the blocks differs by tens of levels nearly everywhere.
    let apart = 0, widest = 0;
    for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); if (d) { apart++; widest = Math.max(widest, d); } }
    assert.ok(widest <= 1 && apart <= a.data.length * 0.0005, `the blur depends on the block means only (${apart} values apart, by ${widest} at most)`);
    // the originals really differ under the blur, and the output really is smooth
    assert.ok(maxStep(a, region) <= 40, `smooth (${maxStep(a, region)})`);
  });

  it('parity: editor, grouped export, every format, the strip thumbnail; and persistence, versions, undo and redo', async () => {
    const region = { x: 200, y: 200, w: 800, h: 400 };
    await library([], async () => plant(page, { kind: 'disc', w: 1600, h: 900, title: 'Disc' }));
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    const crop = { x: 100, y: 100, w: 1200, h: 600 };
    await setVersions(page, id, [version([blurObject(region.x, region.y, region.w, region.h, 120), { type: 'Rect', left: 1050, top: 150, width: 120, height: 80, fill: '#2563eb', strokeWidth: 0, objectCaching: false }], { crop })]);
    await page.reload();
    await ready(page);
    await waitOut(page, 1200, 600);
    const png = await download(page);
    const E = await decodePng(page, png.buf);
    const centre = [500, 300]; // the middle of the disc, in the cropped image
    const middle = px(E, ...centre);
    assert.ok(middle[0] > 60 && middle[0] < 220, `the disc is blurred, not black and not gone (${middle})`);
    assert.deepEqual(px(E, 1000, 90).slice(0, 3), BLUE.slice(0, 3), 'the fill next to it');

    // grouped export: the same rendering, pixel for pixel
    await openBatch(page, [id]);
    const zip = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    await closeBatch(page);
    const entry = await decodePng(page, readZip(zip.buf)[0].data);
    assert.equal(Buffer.compare(entry.data, E.data), 0, 'the grouped export is not pixel for pixel the export of the editor');

    // the other formats draw the same canvas
    for (const format of ['jpeg', 'webp']) {
      await setDefaultFormat(page, format);
      const file = await downloadAfter(page, () => page.click('#download'));
      const image = await decodeImage(page, file.buf, MIME[format]);
      let sum = 0, n = 0;
      for (let y = 100; y < 500; y += 4) for (let x = 100; x < 900; x += 4) { sum += Math.abs(px(image, x, y)[0] - px(E, x, y)[0]); n++; }
      assert.ok(sum / n < 3, `${format}: mean difference with the PNG ${(sum / n).toFixed(2)}`);
    }
    await setDefaultFormat(page, 'pdf');
    assert.equal((await readPdf((await downloadAfter(page, () => page.click('#download'))).buf)).length, 1, 'PDF');
    await setDefaultFormat(page, 'png');

    // persistence: reload, same pixels
    await page.reload();
    await ready(page);
    await waitOut(page, 1200, 600);
    assert.equal(Buffer.compare((await decodePng(page, (await download(page)).buf)).data, E.data), 0, 'same pixels after a reload');
    // versions: a copy keeps the blur, and the original does not have it
    await page.click('#newVersion');
    await shotWhere(page, id, (s) => s.versions.length === 2 && s.versions[1].objects.some((o) => o.type === 'BlurRegion'), 'V2 duplicates the blur');
    // the thumbnail of the strip, written by the editor for the displayed version, shows the blur and not the disc under it
    const { k } = thumbPlan(crop.w, crop.h);
    const thumbCentre = async () => {
      const b64 = await page.evaluate(async (id) => {
        const s = await (await import(`${location.origin}/db.js`)).getShot(id);
        return s.thumb ? btoa(String.fromCharCode(...new Uint8Array(await s.thumb.arrayBuffer()))) : null;
      }, id);
      return b64 ? px(await decodeImage(page, Buffer.from(b64, 'base64'), 'image/webp'), Math.round(centre[0] * k), Math.round(centre[1] * k))[0] : -1;
    };
    const seen = await poll(async () => { const v = await thumbCentre(); return v > 30 ? v : null; }, { what: 'a thumbnail that shows the blur (a sharp disc would be 0)', timeout: 15_000 });
    assert.ok(Math.abs(seen - middle[0]) <= 25, `thumbnail ${seen} against the export ${middle[0]}`);
    assert.equal(Buffer.compare((await decodePng(page, (await download(page)).buf)).data, E.data), 0, 'V2 renders like V1');
    await page.locator('#versions button', { hasText: 'Original' }).click();
    await page.waitForSelector('#versions button[aria-pressed="true"]:has-text("Original")');
    assert.deepEqual(px(await decodePng(page, (await download(page)).buf), 600, 400), [0, 0, 0, 255], 'the original is untouched: the disc is black');
    await page.locator('#versions button', { hasText: 'V1' }).click();
    await waitOut(page, 1200, 600);
    // undo / redo of a blur drawn by hand
    const m = await mapper(page, 1600, 900);
    await tool(page, 'blur');
    await drag(page, m, 90, 90, 320, 180); // over the red bar of the picture
    await shotWhere(page, id, (s) => s.versions[0].objects.filter((o) => o.type === 'BlurRegion').length === 2, 'second blur saved');
    await page.keyboard.press('Control+z');
    await shotWhere(page, id, (s) => s.versions[0].objects.filter((o) => o.type === 'BlurRegion').length === 1, 'undo removes it');
    await page.keyboard.press('Control+y');
    await shotWhere(page, id, (s) => s.versions[0].objects.filter((o) => o.type === 'BlurRegion').length === 2, 'redo brings it back');
    const redone = await decodePng(page, (await download(page)).buf);
    assert.notEqual(Buffer.compare(redone.data, E.data), 0, 'the second blur is drawn');
    assert.ok(maxStep(redone, { x: 5, y: 5, w: 200, h: 50 }) <= 40, 'the red bar is now a smooth blur');
  });

  it('a gesture never recomputes the blur: only the release does, once; zoom and pan do not; temporary canvases go back', async () => {
    await library([spec('Live', 1600, 900)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const id = (await lastShot()).id;
    const m = await mapper(page, 1600, 900);
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__gid = 0;
      const get = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { w.__gid++; return get.apply(this, args); };
      w.__canvases = [];
      const create = document.createElement.bind(document);
      document.createElement = (name, ...rest) => { const el = create(name, ...rest); if (name === 'canvas') w.__canvases.push(el); return el; };
    });
    const reads = () => page.evaluate(() => /** @type {any} */ (window).__gid);
    const press = async (x, y) => { const [sx, sy] = m.pt(x, y); await page.mouse.move(sx, sy); await page.mouse.down(); };
    const moveTo = async (x, y) => { const [sx, sy] = m.pt(x, y); await page.mouse.move(sx, sy, { steps: 24 }); };

    await tool(page, 'blur');
    await press(240, 220);
    await moveTo(700, 480); // drawing: every frame follows the image under the rectangle
    assert.equal(await reads(), 0, 'no pixel was read while drawing');
    await page.mouse.up();
    await poll(async () => (await reads()) === 1, { what: 'one exact computation after the release' });
    await shotWhere(page, id, (s) => s.versions[0]?.objects.length === 1, 'saved');

    await tool(page, 'select');
    await press(470, 350); // inside the blur: move it
    await moveTo(900, 600);
    assert.equal(await reads(), 1, 'no pixel was read while moving');
    await page.mouse.up();
    await poll(async () => (await reads()) === 2, { what: 'one more after the move' });
    await sleep(300);
    assert.equal(await reads(), 2, 'and no more');

    // resize with the corner handle, then zoom and pan
    const o = (await objects(id))[0];
    const right = o.left + o.width, bottom = o.top + o.height;
    await press(right, bottom);
    await moveTo(right + 80, bottom + 40);
    assert.equal(await reads(), 2, 'no pixel was read while resizing');
    await page.mouse.up();
    await poll(async () => (await reads()) === 3, { what: 'one more after the resize' });
    const [cx, cy] = m.pt(800, 450);
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, i < 6 ? -80 : 80);
    await page.keyboard.up('Control');
    for (let i = 0; i < 8; i++) await page.mouse.wheel(40, 40);
    await sleep(400);
    assert.equal(await reads(), 3, 'zoom and pan only redraw the small tile');

    // memory: the scratch canvas that read the pixels is back to 0, the tiles are a pixel per block
    const left = await page.evaluate(() => /** @type {any} */ (window).__canvases.filter((c) => !c.isConnected).map((c) => c.width * c.height));
    assert.ok(left.every((area) => area <= 60 * 60), `temporary canvases still holding pixels: ${left.filter((a) => a > 3600)}`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), 3, 'the canvases of the editor only (Fabric\'s two and the backdrop of the look)');
    // deleting the blur gives its tiles back
    await page.keyboard.press('Delete');
    await shotWhere(page, id, (s) => s.versions[0].objects.length === 0, 'blur deleted');
    await poll(async () => (await page.evaluate(() => /** @type {any} */ (window).__canvases.filter((c) => !c.isConnected && c.width * c.height > 0).length)) === 0, { what: 'tiles of the deleted blur given back' });
  });

  it('no CSP violation, no unexpected console error', async () => {
    await grabCsp();
    assert.deepEqual(csp, [], 'CSP violations');
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), [], 'console errors');
  });
});
