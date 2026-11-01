// Beautify, on the stage of the editor: while the displayed version has a look, the stage shows the capture inside it (the
// background, the padding, the corners, the window bar), and the capture stays editable where it is drawn. Pixels are read from a
// screenshot of the stage, on the seeded images (spec(...)): white where nothing is drawn, a green square at 1000, 300 (200 x 200),
// nothing that depends on a font. The look in the downloads and the panel are in beautify.e2e.mjs.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, drag, mapper, poll, px, ready, resetLibrary, shotWhere, spec, tool, waitOut } from './support/editor.mjs';

const CLEAN = { language: 'en', theme: 'auto', downloadFormat: 'png', downloadQuality: 0.9, pdfLayout: 'fit', pdfEncoding: 'flate' };
const BLUE = [37, 99, 235, 255]; // #2563eb, the blue of the palette
const WHITE = [255, 255, 255, 255];
const GREEN = [0, 170, 0, 255];
const BLACK = [0, 0, 0, 255];
const near = (actual, expected, tolerance, what) => assert.ok(expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance), `${what}: ${actual} is not within ${tolerance} of ${expected}`);

describe('beautify: the editor shows the look around the capture', () => {
  let h, page;
  const open = async (w, hgt) => { await ready(page); await waitOut(page, w, hgt); };
  const openPanel = async () => {
    await page.click('#beautify');
    await page.waitForSelector('#bePop:not([hidden])');
  };
  const refitted = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const closePanel = async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#bePop', { state: 'hidden' });
    await refitted(); // the stage is wide again and the editor fits the capture in it
  };
  const setRange = (id, value) => page.evaluate(({ id, value }) => {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
  const choose = (name, value) => page.click(`#bePop input[name="${name}"][value="${value}"]`);
  /** A flat blue look with no shadow on the capture of `w` x `hgt`, the panel closed. */
  const lookOn = async ({ padding, radius = 0, frame = 'none', w, hgt }) => {
    await openPanel();
    await page.click('#beOn');
    await choose('beBg', '#2563eb');
    await setRange('bePadding', padding);
    await setRange('beRadius', radius);
    await choose('beShadow', 'none');
    await choose('beFrame', frame);
    await waitOut(page, w + 2 * padding, hgt + 2 * padding + (frame === 'window' ? 36 : 0));
    await closePanel();
  };
  const lookOff = async (w, hgt) => {
    await openPanel();
    await page.click('#beOn');
    await waitOut(page, w, hgt);
    await closePanel();
  };
  /** Where the editor puts the capture on the stage (px of the stage), read from the clip of its canvas, and the size of the stage. */
  const placed = () => page.evaluate(() => {
    const stage = document.getElementById('stage');
    const clip = /** @type {HTMLElement} */ (stage.querySelector('.lower-canvas')).style.clipPath;
    const [inset, round = '0'] = clip.replace(/^inset\(|\)$/g, '').split(' round ');
    if (!inset) return { clip };
    // Chrome writes the shorthand of the margins: one to four values (top, right, bottom, left).
    const four = (text) => {
      const a = text.split(' ').map(parseFloat);
      return a.length === 1 ? [a[0], a[0], a[0], a[0]] : a.length === 2 ? [a[0], a[1], a[0], a[1]] : a.length === 3 ? [a[0], a[1], a[2], a[1]] : a;
    };
    const [top, right, bottom, left] = four(inset);
    const radii = four(round);
    return {
      clip, x: left, y: top, w: stage.clientWidth - left - right, h: stage.clientHeight - top - bottom,
      stageW: stage.clientWidth, stageH: stage.clientHeight, radii,
    };
  });
  const stageShot = async () => decodePng(page, await page.locator('#stage').screenshot());
  /** How many pixels the backdrop behind the canvas has drawn. */
  const backdropDrawn = () => page.evaluate(() => {
    const el = /** @type {HTMLCanvasElement} */ (document.querySelector('#stage > div > canvas'));
    const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let drawn = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) drawn++;
    return drawn;
  });

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  it('with the look on, the stage shows the background and the padding around the capture, all of it in sight; off, the plain capture', async () => {
    await resetLibrary(page, h, [spec('Alpha', 1280, 720)], undefined, CLEAN);
    await open(1280, 720);
    assert.equal((await placed()).clip, '', 'no look, no clip');
    assert.equal(await backdropDrawn(), 0, 'and nothing behind the canvas');
    await lookOn({ padding: 48, w: 1280, hgt: 720 });
    const p = await placed();
    const z = p.w / 1280;
    assert.ok(z < 1 && z > 0.2, `the framed result is fitted, zoom ${z}`);
    assert.ok(Math.abs(p.h / 720 - z) < 1e-6, 'the capture keeps its proportions');
    const padding = 48 * z;
    assert.ok(p.x - padding >= -0.5 && p.x + p.w + padding <= p.stageW + 0.5, 'the whole look is in sight, sideways');
    assert.ok(p.y - padding >= -0.5 && p.y + p.h + padding <= p.stageH + 0.5, 'and from the top to the bottom');
    assert.deepEqual(p.radii, [0, 0, 0, 0], 'square corners');
    const stage = await stageShot();
    assert.deepEqual(px(stage, Math.round(p.x - padding / 2), Math.round(p.y + p.h / 2)), BLUE, 'the background, left of the capture');
    assert.deepEqual(px(stage, Math.round(p.x + p.w / 2), Math.round(p.y + p.h + padding / 2)), BLUE, 'and under it');
    assert.deepEqual(px(stage, Math.round(p.x + 700 * z), Math.round(p.y + 600 * z)), WHITE, 'the capture itself, white there');
    assert.deepEqual(px(stage, Math.round(p.x + 1100 * z), Math.round(p.y + 400 * z)), GREEN, 'and its green square');
    assert.notDeepEqual(px(stage, 2, 2), BLUE, 'the stage around the look is the stage');
    assert.ok(await backdropDrawn() > 0);

    await lookOff(1280, 720);
    assert.equal((await placed()).clip, '', 'off: the canvas is not clipped');
    assert.equal(await backdropDrawn(), 0, 'and the backdrop is empty');
    const plain = await stageShot();
    assert.notDeepEqual(px(plain, Math.round(p.x - padding / 2), Math.round(p.y + p.h / 2)), BLUE, 'the background is gone');
  });

  it('the corners are rounded and the window bar is there: the same pixels as the download, around the capture', async () => {
    await resetLibrary(page, h, [spec('Small', 400, 250)], undefined, CLEAN);
    await open(400, 250);
    await lookOn({ padding: 40, radius: 24, frame: 'window', w: 400, hgt: 250 }); // 480 x 366, small enough to stay at 100 %
    const p = await placed();
    assert.equal(p.w, 400, 'at 100 %');
    assert.deepEqual(p.radii, [0, 0, 24, 24], 'square under the bar, rounded at the bottom');
    const stage = await stageShot();
    const file = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([file.width, file.height], [480, 366]);
    const ox = p.x - 40, oy = p.y - 40 - 36; // the corner of the whole result, on the stage
    const same = (x, y, what) => near(px(stage, Math.round(ox + x), Math.round(oy + y)), px(file, x, y), 6, what);
    same(5, 5, 'the background, top left');
    same(474, 360, 'the background, bottom right');
    same(240, 40 + 8, 'the bar');
    same(40 + 25, 40 + 18, 'the red dot');
    same(40 + 43, 40 + 18, 'the yellow dot');
    same(40 + 61, 40 + 18, 'the green dot');
    same(40 + 200, 40 + 36 + 125, 'the capture');
    same(40 + 2, 40 + 36 + 250 - 2, 'the cut corner of the capture');
    assert.deepEqual(px(stage, Math.round(ox + 40 + 1), Math.round(oy + 40 + 36 + 250 - 2)), BLUE, 'the rounded corner shows the background, not the square corner of the image');
  });

  it('annotations are drawn where the pointer is and land there in the download; off, the annotation is still there', async () => {
    await resetLibrary(page, h, [spec('Alpha', 1280, 720)], undefined, CLEAN);
    await open(1280, 720);
    await lookOn({ padding: 48, w: 1280, hgt: 720 });
    const m = await mapper(page, 1280, 720, { x: -48, y: -48, w: 1376, h: 816 }); // the capture and its padding, in sight
    const p = await placed();
    const stageBox = await page.locator('#stage').boundingBox();
    const [sx, sy] = m.pt(0, 0);
    assert.ok(Math.abs(sx - stageBox.x - p.x) < 0.5 && Math.abs(sy - stageBox.y - p.y) < 0.5, 'the corner of the capture is where the look puts it');
    await tool(page, 'flat');
    await drag(page, m, 990, 290, 1210, 510); // over the green square
    const { id } = (await dbDump(page)).at(-1);
    await shotWhere(page, id, (s) => s.versions[0]?.objects.length === 1, 'the flat is saved');
    const framed = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([framed.width, framed.height], [1376, 816]);
    assert.deepEqual(px(framed, 48 + 1100, 48 + 400), BLACK, 'the black flat is on the green square, shifted by the padding');
    assert.deepEqual(px(framed, 48 + 700, 48 + 250), WHITE, 'and nowhere else');
    assert.deepEqual(px(framed, 2, 2), BLUE, 'the padding is the background');
    const stage = await stageShot();
    const z = p.w / 1280;
    assert.deepEqual(px(stage, Math.round(p.x + 1100 * z), Math.round(p.y + 400 * z)), BLACK, 'the stage shows the flat where it was drawn');
    await lookOff(1280, 720);
    const plain = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([plain.width, plain.height], [1280, 720]);
    assert.deepEqual(px(plain, 1100, 400), BLACK, 'the annotation is in the plain capture too');
  });

  it('100 % and Fit follow the look, the wheel stays inside it, and a crop that is edited shows the whole image', async () => {
    await resetLibrary(page, h, [spec('Alpha', 1280, 720)], undefined, CLEAN);
    await open(1280, 720);
    await lookOn({ padding: 48, w: 1280, hgt: 720 });
    const fitted = await placed();
    await page.click('#actual');
    await poll(async () => (await placed()).w === 1280, { what: 'the capture at its own size' });
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -4000); // up, as far as it goes
    await poll(async () => (await placed()).y > 0, { what: 'the view reached the top of the look' });
    assert.ok((await placed()).y >= 48 - 0.5, 'at the top, the padding shows above the capture');
    await page.click('#fit');
    await poll(async () => Math.abs((await placed()).w - fitted.w) < 1, { what: 'Fit is back' });
    await page.click('#crop');
    await poll(async () => (await placed()).clip === '', { what: 'the look is suspended while the crop is edited' });
    assert.equal(await backdropDrawn(), 0);
    await page.click('#cropCancel');
    await poll(async () => (await placed()).clip !== '', { what: 'and comes back' });
    assert.ok(await backdropDrawn() > 0);
  });

  it('the panel is a column next to the stage: the capture and its look are fitted in what is left and stay visible, and closing gives the width back', async () => {
    await resetLibrary(page, h, [spec('Alpha', 1280, 720)], undefined, CLEAN);
    await open(1280, 720);
    const wide = await page.evaluate(() => document.getElementById('stage').clientWidth);
    await openPanel();
    await page.click('#beOn');
    await choose('beBg', '#2563eb');
    await choose('beShadow', 'none');
    await setRange('bePadding', 48);
    await waitOut(page, 1376, 816);
    await refitted();
    const panel = await page.locator('#bePop').boundingBox();
    const stageBox = await page.locator('#stage').boundingBox();
    assert.ok(stageBox.x + stageBox.width <= panel.x + 0.5, `the panel is right of the stage, not over it: stage ends at ${stageBox.x + stageBox.width}, panel starts at ${panel.x}`);
    assert.ok(Math.abs(panel.y - stageBox.y) < 1 && Math.abs(panel.height - stageBox.height) < 1, 'and it takes the height of the stage');
    const p = await placed();
    assert.ok(p.stageW < wide - 200, `the stage is narrower: ${p.stageW} instead of ${wide}`);
    const z = p.w / 1280, padding = 48 * z;
    assert.ok(p.x - padding >= -0.5 && p.x + p.w + padding <= p.stageW + 0.5, 'the whole look is in sight beside the panel');
    assert.ok(await backdropDrawn() > 0, 'and drawn');
    near(px(await stageShot(), Math.round(p.x - padding / 2), Math.round(p.y + p.h / 2)), BLUE, 6, 'the background is on the stage while the panel is open');

    await closePanel();
    const after = await placed();
    assert.equal(after.stageW, wide, 'the stage has its width back');
    assert.ok(after.w > p.w, 'and the capture is fitted larger');
  });

  it('a slider moves the look on the stage while it is dragged, and the version keeps it when it is let go', async () => {
    await resetLibrary(page, h, [spec('Alpha', 1280, 720)], undefined, CLEAN);
    await open(1280, 720);
    await lookOn({ padding: 48, w: 1280, hgt: 720 });
    const { id } = (await dbDump(page)).at(-1);
    await shotWhere(page, id, (s) => s.versions[0]?.beautify?.padding === 48, 'the look is saved');
    await openPanel();
    await refitted();
    const before = (await placed()).w;
    await page.evaluate(() => {
      const el = /** @type {HTMLInputElement} */ (document.getElementById('bePadding'));
      el.value = '120';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitOut(page, 1520, 960); // 1280 + 2 x 120, 720 + 2 x 120
    await poll(async () => (await placed()).w < before, { what: 'the capture is smaller on the stage: the padding grew' });
    await new Promise((done) => setTimeout(done, 500));
    assert.equal((await dbDump(page)).find((s) => s.id === id).versions[0].beautify.padding, 48, 'nothing is kept while the slider is held');
    await page.evaluate(() => document.getElementById('bePadding').dispatchEvent(new Event('change', { bubbles: true })));
    await shotWhere(page, id, (s) => s.versions[0].beautify.padding === 120, 'kept when it is let go');
    await closePanel();
  });

  it('a cropped version shows only the crop in its look, and the output label counts the crop and the padding', async () => {
    await resetLibrary(page, h, [spec('Alpha', 1280, 720)], undefined, CLEAN);
    await open(1280, 720);
    await lookOn({ padding: 48, w: 1280, hgt: 720 });
    const { id } = (await dbDump(page)).at(-1);
    await shotWhere(page, id, (s) => s.versions[0]?.beautify?.padding === 48, 'the look is saved');
    await page.evaluate(async (id) => {
      const { getShot, updateShot } = await import(`${location.origin}/db.js`);
      const shot = await getShot(id);
      await updateShot(id, { versions: [{ ...shot.versions[0], crop: { x: 100, y: 100, w: 700, h: 400 } }] });
    }, id);
    await page.reload();
    await open(796, 496); // 700 + 96, 400 + 96
    const p = await placed();
    assert.ok(Math.abs(p.w / p.h - 700 / 400) < 0.01, 'the window has the shape of the crop');
    const z = p.w / 700;
    const stage = await stageShot();
    assert.deepEqual(px(stage, Math.round(p.x + p.w / 2), Math.round(p.y + p.h + 48 * z / 2)), BLUE, 'under the crop there is the padding, not the rest of the image');
    assert.deepEqual(px(stage, Math.round(p.x - 48 * z / 2), Math.round(p.y + p.h / 2)), BLUE, 'and left of it');
    const file = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([file.width, file.height], [796, 496]);
    assert.deepEqual(h.errors.filter((e) => !/favicon/.test(e)), [], 'no console error in the whole session');
  });
});
