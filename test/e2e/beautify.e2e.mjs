// Beautify, in the real extension: the panel of the editor (its preview, its keyboard, its texts), the look in the downloads
// (size, corners, background, bar, JPEG backdrop), in the grouped export (pixel for pixel the same), in the thumbnail, and the
// life of the look across turning it off, a new version, undo and the scale ceiling. The geometry is tested in beautify-pure.test.js.
//
// Pixel checks use the seeded images (spec(...)): white where nothing is drawn, a green square at 1000, 300 (200 x 200), and
// nothing that depends on a font.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, outText, poll, px, ready, resetLibrary, shotWhere, spec, titled, waitOut } from './support/editor.mjs';
import { MIME, batchDone, chooseFormat, closeBatch, decodeImage, downloadAfter, readPdf, readZip } from './support/export.mjs';

const CLEAN = { language: 'en', theme: 'auto', downloadFormat: 'png', downloadQuality: 0.9, pdfLayout: 'fit', pdfEncoding: 'flate' };
const BLUE = [37, 99, 235, 255]; // #2563eb, the blue of the palette
const WHITE = [255, 255, 255, 255];
const GREEN = [0, 170, 0, 255];
const BAR = [236, 238, 242, 255];
const near = (actual, expected, tolerance, what) => assert.ok(expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance), `${what}: ${actual} is not within ${tolerance} of ${expected}`);

describe('beautify: the editor, the downloads, the grouped export', () => {
  let h, page;
  // The last one added is the one that opens.
  const library = (specs = [spec('Bravo', 800, 450), spec('Alpha', 1280, 720)], settings = CLEAN) => resetLibrary(page, h, specs, undefined, settings);
  const open = async (w = 1280, hgt = 720) => { await ready(page); await waitOut(page, w, hgt); };
  const openPanel = async () => {
    await page.click('#beautify');
    await page.waitForSelector('#bePop:not([hidden])');
  };
  const closePanel = async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#bePop', { state: 'hidden' });
  };
  const choose = (name, value) => page.click(`#bePop input[name="${name}"][value="${value}"]`);
  const turnOn = () => page.click('#beOn');
  const setRange = (id, value) => page.evaluate(({ id, value }) => {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
  /** A look without shadow, so that the pixels outside the window are the background's. */
  const flat = async ({ bg, padding, radius, frame = 'none' }) => {
    await choose('beBg', bg);
    await setRange('bePadding', padding);
    await setRange('beRadius', radius);
    await choose('beShadow', 'none');
    await choose('beFrame', frame);
  };
  const png = async () => decodePng(page, (await download(page)).buf);

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  it('the button is there with its text; the panel is off for a capture without a look, and opens on a keyboard press', async () => {
    await library();
    await open();
    assert.equal((await page.locator('#beautify').innerText()).trim(), 'Beautify');
    assert.equal(await page.getAttribute('#beautify', 'aria-expanded'), 'false');
    await page.focus('#beautify');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#bePop:not([hidden])');
    assert.equal(await page.getAttribute('#beautify', 'aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'beOn', 'the focus goes in');
    assert.equal(await page.isChecked('#beOn'), false);
    assert.equal(await page.locator('#bePadding').isDisabled(), true, 'nothing to set while it is off');
    assert.equal(await page.getAttribute('#bePop', 'role'), 'dialog');
    assert.equal(await page.getAttribute('#bePop', 'aria-label'), 'Beautify');
    await closePanel();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'beautify', 'Escape gives the focus back');
    assert.equal(await page.getAttribute('#beautify', 'aria-expanded'), 'false');
    assert.equal(await outText(page), 'Output: 1280 × 720 px');
    assert.equal((await dbDump(page)).at(-1).versions.length, 0, 'opening it changes nothing');
  });

  it('turning it on creates V1 and the output size counts the padding; the preview has the shape of the result; off gives the plain size back', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await waitOut(page, 1376, 816); // 1280 + 2 x 48, 720 + 2 x 48
    assert.equal(await page.locator('#bePadding').isDisabled(), false);
    assert.equal(await page.locator('#beautify').getAttribute('data-on'), '');
    await page.waitForSelector('#versions button:nth-child(2)'); // V1
    await poll(async () => {
      const { width, height } = await page.locator('#bePreview').evaluate((c) => ({ width: c.width, height: c.height }));
      return width > 0 && Math.abs(width / height - 1376 / 816) < 0.02;
    }, { what: 'the preview has the proportions of 1376 x 816' });
    await choose('beFrame', 'window');
    await waitOut(page, 1376, 852); // + the bar
    await turnOn(); // off
    await waitOut(page, 1280, 720);
    assert.equal(await page.locator('#beautify').getAttribute('data-on'), null);
    await poll(async () => {
      const { width, height } = await page.locator('#bePreview').evaluate((c) => ({ width: c.width, height: c.height }));
      return Math.abs(width / height - 1280 / 720) < 0.02;
    }, { what: 'the preview of the plain capture' });
    const { id } = (await dbDump(page)).at(-1);
    await shotWhere(page, id, (s) => s.versions.length === 1 && s.versions[0].beautify === null, 'off is stored as no look');
    await closePanel();
    const file = await png();
    assert.deepEqual([file.width, file.height], [1280, 720], 'the download is the plain capture again');
  });

  it('PNG: the size is the capture plus the padding, a color background and rounded corners, the capture inside', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: '#2563eb', padding: 40, radius: 24 });
    await waitOut(page, 1360, 800);
    await closePanel();
    const file = await png();
    assert.deepEqual([file.width, file.height], [1360, 800]);
    assert.deepEqual(px(file, 0, 0), BLUE, 'the background at the corner');
    assert.deepEqual(px(file, 41, 41), BLUE, 'the corner of the window is rounded: the background shows where it is cut');
    assert.deepEqual(px(file, 40 + 700, 40 + 250), WHITE, 'the capture, white there');
    assert.deepEqual(px(file, 40 + 1100, 40 + 400), GREEN, 'the capture, the green square');
    assert.deepEqual(px(file, 1359, 799), BLUE, 'the background at the other corner');
  });

  it('PNG: no background keeps the transparency, around the capture and in the cut corners', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: 'none', padding: 40, radius: 24 });
    await waitOut(page, 1360, 800);
    await closePanel();
    const file = await png();
    assert.equal(px(file, 0, 0)[3], 0, 'the padding is transparent');
    assert.equal(px(file, 41, 41)[3], 0, 'so is the cut corner');
    assert.deepEqual(px(file, 40 + 700, 40 + 250), WHITE);
    assert.equal(px(file, 40 + 24, 40 + 24)[3], 255, 'the capture is opaque where the corner has not cut it');
  });

  it('PNG: a gradient, and the window bar above the capture with its three dots', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: 'g1', padding: 40, radius: 0, frame: 'window' });
    await waitOut(page, 1360, 836); // + 36 for the bar
    await closePanel();
    const file = await png();
    assert.deepEqual([file.width, file.height], [1360, 836]);
    near(px(file, 0, 0), [6, 182, 212, 255], 4, 'the gradient starts with its first color at the top left corner');
    near(px(file, 1359, 835), [59, 130, 246, 255], 4, 'and ends with the second at the bottom right');
    assert.deepEqual(px(file, 40 + 400, 40 + 8), BAR, 'the bar');
    near(px(file, 40 + 25, 40 + 18), [255, 95, 87, 255], 2, 'the red dot');
    near(px(file, 40 + 43, 40 + 18), [254, 188, 46, 255], 2, 'the yellow dot');
    near(px(file, 40 + 61, 40 + 18), [40, 200, 64, 255], 2, 'the green dot');
    assert.deepEqual(px(file, 40 + 700, 40 + 36 + 250), WHITE, 'the capture starts under the bar');
  });

  it('the shadow darkens the padding under the window and nowhere else', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: '#ffffff', padding: 64, radius: 12 });
    await choose('beShadow', 'strong');
    await waitOut(page, 1408, 848);
    await closePanel();
    const file = await png();
    assert.deepEqual(px(file, 2, 2), WHITE, 'far from the window, the plain background');
    const under = px(file, 64 + 640, 64 + 720 + 8); // just under the window, inside the shadow
    assert.ok(under[0] < 235 && under[0] === under[1] && under[1] === under[2], `a gray shadow under the window, got ${under}`);
  });

  it('JPEG: a background that is no background is white, not black', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: 'none', padding: 40, radius: 24 });
    await waitOut(page, 1360, 800);
    await closePanel();
    await chooseFormat(page, 'jpeg');
    const file = await downloadAfter(page, () => page.click('#download'));
    const image = await decodeImage(page, file.buf, MIME.jpeg);
    assert.deepEqual([image.width, image.height], [1360, 800]);
    near(px(image, 2, 2), WHITE, 3, 'the padding');
    near(px(image, 41, 41), WHITE, 3, 'the cut corner');
  });

  it('the thumbnail shows the look, in the proportions of the result', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: '#2563eb', padding: 40, radius: 0 });
    await waitOut(page, 1360, 800);
    await closePanel();
    const [{ id }] = (await dbDump(page)).toReversed();
    const read = () => page.evaluate(async (id) => {
      const { getShots } = await import(`${location.origin}/db.js`);
      const [row] = await getShots([id]);
      if (!row?.thumb) return null;
      const bmp = await createImageBitmap(row.thumb);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return { width: bmp.width, height: bmp.height, corner: [...g.getImageData(1, 1, 1, 1).data] };
    }, id);
    const thumb = await poll(async () => {
      const t = await read();
      return t && Math.abs(t.corner[2] - 235) < 20 ? t : null;
    }, { what: 'a thumbnail with the blue background' });
    assert.ok(thumb.width <= 240 && thumb.width >= 230, `a thumbnail about 240 px wide, got ${thumb.width}`);
    assert.ok(Math.abs(thumb.width / thumb.height - 1360 / 800) < 0.03, `the proportions of the result, got ${thumb.width} x ${thumb.height}`);
    near(thumb.corner.slice(0, 3), BLUE.slice(0, 3), 14, 'the background at the corner of the thumbnail');
  });

  it('a new version starts without the look, the first one keeps its own, and the panel offers the last look when it is turned on', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await flat({ bg: '#2563eb', padding: 40, radius: 24, frame: 'window' });
    await waitOut(page, 1360, 836);
    await closePanel();
    await page.click('#newVersion');
    await waitOut(page, 1280, 720); // V2: plain
    await page.waitForSelector('#versions button:nth-child(3)');
    await openPanel();
    assert.equal(await page.isChecked('#beOn'), false, 'V2 has no look');
    assert.equal(await page.isChecked('#bePop input[name="beFrame"][value="window"]'), true, 'the last look is the one on offer');
    assert.equal(await page.inputValue('#bePadding'), '40');
    await turnOn();
    await waitOut(page, 1360, 836);
    await closePanel();
    await page.click('#versions button:nth-child(2)'); // back to V1
    await waitOut(page, 1360, 836);
    const { id } = (await dbDump(page)).at(-1);
    await shotWhere(page, id, (s) => s.versions.length === 2 && s.versions.every((v) => v.beautify?.padding === 40), 'both versions are stored with the look');
    await page.click('#versions button:nth-child(1)'); // the original
    await waitOut(page, 1280, 720);
  });

  it('undo and redo carry the look', async () => {
    await library();
    await open();
    await openPanel();
    await turnOn();
    await waitOut(page, 1376, 816);
    await closePanel();
    await page.click('#undo');
    await waitOut(page, 1280, 720);
    await page.click('#redo');
    await waitOut(page, 1376, 816);
  });

  it('the scale ceiling counts the padding and the bar: the scale comes down further than for the capture alone', async () => {
    await library([spec('Wide', 1600, 900)]);
    await open(1600, 900);
    await page.fill('#scalePct', '1000');
    await page.press('#scalePct', 'Enter');
    const plain = Number(await page.inputValue('#scalePct'));
    assert.ok(plain < 1000 && plain > 800, `the scale of the capture alone is brought down to the ceiling, got ${plain}`);
    await openPanel();
    await turnOn();
    await flat({ bg: '#2563eb', padding: 128, radius: 12, frame: 'window' });
    await poll(async () => Number(await page.inputValue('#scalePct')) < plain, { what: 'the scale comes down again' });
    const scale = Number(await page.inputValue('#scalePct')) / 100;
    const [w, hgt] = (await outText(page)).match(/\d+/g).map(Number);
    assert.ok(w <= 16384 && hgt <= 16384 && w * hgt <= 100e6, `the output ${w} x ${hgt} is inside the ceilings`);
    assert.ok(w * hgt > 99e6 * 0.98, `and close to them, ${w * hgt} px (scale ${scale})`);
    assert.ok(await page.locator('#outNote').innerText(), 'the note says that the scale was reduced');
    await closePanel();
  });

  it('the panel stays inside a narrow window', async () => {
    await library();
    await page.setViewportSize({ width: 560, height: 800 });
    await open();
    await openPanel();
    const box = await page.locator('#bePop').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 560, `the panel is inside the window: x ${box.x}, width ${box.width}`);
    assert.ok(box.y >= 0, `and under the top: y ${box.y}`);
    await closePanel();
    await page.setViewportSize({ width: 1500, height: 900 });
  });

  it('the French texts: the button and the panel', async () => {
    await library(undefined, { ...CLEAN, language: 'fr' });
    await ready(page);
    assert.equal((await page.locator('#beautify').innerText()).trim(), 'Habillage');
    await openPanel();
    assert.equal(await page.getAttribute('#bePop', 'aria-label'), 'Habillage');
    assert.equal((await page.locator('#bePop .be-on span').innerText()).trim(), 'Habiller cette version');
    assert.equal((await page.locator('#beShadowLabel').innerText()).trim(), 'Ombre');
    await closePanel();
  });
});

describe('beautify: the grouped export draws the same pixels as the editor', () => {
  let h, page, ids;
  const choose = (name, value) => page.click(`#bePop input[name="${name}"][value="${value}"]`);

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Alpha', 1280, 720), spec('Bravo', 800, 450), spec('Charlie', 900, 500)], undefined, CLEAN);
    await ready(page);
    ids = (await dbDump(page)).map((s) => s.id);
  });
  after(() => h?.close());

  it('ZIP of two beautified captures and one plain one: the entries are the downloads of the editor, to the pixel', async () => {
    const editor = {};
    // Alpha: the default look with a window bar. Bravo: the look offered after Alpha's, with less padding.
    await titled(page, 'Alpha').click();
    await waitOut(page, 1280, 720);
    await page.click('#beautify');
    await page.waitForSelector('#bePop:not([hidden])');
    await page.click('#beOn');
    await choose('beFrame', 'window');
    await waitOut(page, 1376, 852);
    await page.keyboard.press('Escape');
    editor[ids[0]] = await decodePng(page, (await download(page)).buf);

    await titled(page, 'Bravo').click();
    await waitOut(page, 800, 450);
    await page.click('#beautify');
    await page.waitForSelector('#bePop:not([hidden])');
    assert.equal(await page.isChecked('#beOn'), false);
    assert.equal(await page.isChecked('#bePop input[name="beFrame"][value="window"]'), true, 'the look of Alpha is on offer');
    await page.click('#beOn');
    await page.evaluate(() => {
      const el = /** @type {HTMLInputElement} */ (document.getElementById('bePadding'));
      el.value = '20';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose('beShadow', 'strong');
    await waitOut(page, 840, 526); // 800 + 40, 450 + 40 + 36
    await page.keyboard.press('Escape');
    editor[ids[1]] = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([editor[ids[0]].width, editor[ids[0]].height], [1376, 852]);
    assert.deepEqual([editor[ids[1]].width, editor[ids[1]].height], [840, 526]);
    await page.waitForFunction(async (id) => {
      const { getShots } = await import(`${location.origin}/db.js`);
      return (await getShots([id]))[0].versions[0]?.beautify?.padding === 20;
    }, ids[1]);

    await page.evaluate(async (all) => (await import(`${location.origin}/export-ui.js`)).openBatchExport(all), ids);
    await page.waitForSelector('#exportDialog[open]');
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const entries = readZip(file.buf);
    assert.equal(entries.length, 3);
    for (const [i, id] of [[0, ids[0]], [1, ids[1]]]) {
      const image = await decodePng(page, entries[i].data);
      assert.deepEqual([image.width, image.height], [editor[id].width, editor[id].height], `size of entry ${i}`);
      assert.equal(Buffer.compare(image.data, editor[id].data), 0, `entry ${i}: not pixel for pixel the download of the editor`);
    }
    const charlie = await decodePng(page, entries[2].data);
    assert.deepEqual([charlie.width, charlie.height], [900, 500], 'the plain capture stays plain');
    await closeBatch(page);
  });

  it('PDF of a beautified capture: one page that holds the picture of the whole result', async () => {
    await titled(page, 'Bravo').click();
    await waitOut(page, 840, 526);
    await page.click('#beautify');
    await page.waitForSelector('#bePop:not([hidden])');
    await choose('beBg', 'none');
    await choose('beShadow', 'none');
    await page.keyboard.press('Escape');
    await waitOut(page, 840, 526);
    await page.evaluate(async (id) => (await import(`${location.origin}/export-ui.js`)).openBatchExport([id]), ids[1]);
    await page.waitForSelector('#exportDialog[open]');
    await page.click('#exportDialog input[name="exOutput"][value="pdf"]');
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const pages = await readPdf(file.buf);
    assert.deepEqual(pages.map((p) => [p.imageWidth, p.imageHeight]), [[840, 526]], 'the framed capture, padding and bar included');
    await closeBatch(page);
    assert.deepEqual(h.errors.filter((e) => !/favicon/.test(e)), [], 'no console error in the whole session');
  });
});
