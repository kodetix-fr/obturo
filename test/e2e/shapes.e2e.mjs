// The shape of an area in the real extension: a rectangle, a rounded rectangle or an ellipse, for the outline, the solid fill, the highlighter, the
// spotlight, the pixelation and the blur. The corner radii are the whole of the shape: they are saved with the object, resized with it, and drawn
// the same by the editor, the export and the grouped export. The steps follow one another: each one starts from the state left by the previous one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, diffInfo, download, drag, mapper, poll, px, ready, resetLibrary, spec, tool, waitOut } from './support/editor.mjs';
import { batchDone, closeBatch, downloadAfter, openBatch, readZip } from './support/export.mjs';

const near = (actual, expected, tolerance, what) => assert.ok(expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance), `${what}: ${actual.slice(0, 3)} is not within ${tolerance} of ${expected}`);
const isEllipse = (o) => o.rx > 0 && Math.abs(o.rx - o.width / 2) < 0.6 && Math.abs(o.ry - o.height / 2) < 0.6; // the mouse lands between whole pixels at this zoom
const BLACK = [0, 0, 0];
const SHADE = 0.45;

describe('editor: the shape of an area', () => {
  let h, page, m, id, otherId, plain;
  const objectsOf = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return s.versions[s.active]?.objects ?? [];
  };
  const last = async () => (await objectsOf()).at(-1);
  const exported = async () => decodePng(page, (await download(page)).buf);
  const visible = (selector) => page.locator(selector).isVisible();
  const choose = (shape) => page.locator(`#shapePick label:has(input[value="${shape}"])`).click();
  const checkedShape = () => page.locator('#shapePick input:checked').getAttribute('value');
  /** Draws with `name` a box (x1, y1, x2, y2), in `shape`, and waits for it to be saved: the object, as saved. */
  const draw = async (name, shape, [x1, y1, x2, y2]) => {
    const n = (await objectsOf()).length;
    await tool(page, name);
    await choose(shape);
    await drag(page, m, x1, y1, x2, y2);
    return poll(async () => ((await objectsOf()).length === n + 1 ? last() : null), { what: `${name} ${shape} saved` });
  };

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Other', 800, 600, false), spec('Shapes', 1600, 900, true)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const shots = await dbDump(page);
    [otherId, id] = [shots[0].id, shots[1].id];
    m = await mapper(page, 1600, 900);
    plain = await exported(); // the image as it is
  });
  after(() => h?.close());

  it('the choice of shape is there for the six tools that draw an area, and for no other', async () => {
    for (const name of ['rect', 'flat', 'highlight', 'spot', 'pixel', 'blur']) {
      await tool(page, name);
      assert.equal(await visible('#shapeProps'), true, name);
      assert.equal(await page.locator('#shapePick input').count(), 4, 'rectangle, rounded, ellipse, free hand');
      assert.equal(await checkedShape(), 'rect', `${name}: the rectangle first`);
    }
    for (const name of ['arrow', 'text', 'marker', 'select']) {
      await tool(page, name);
      assert.equal(await visible('#shapeProps'), false, name);
    }
    assert.equal(await page.getAttribute('#shapePick input[value="round"]', 'aria-label'), null, 'named by its text for assistive technology');
    assert.equal(await page.locator('#shapePick label:has(input[value="round"]) .vh').innerText(), 'Rounded rectangle');
  });

  it('a solid fill in an ellipse and in a rounded rectangle: the corners of the box are not hidden, the rest is, and it stays opaque', async () => {
    const ellipse = await draw('flat', 'ellipse', [1300, 100, 1500, 300]);
    assert.deepEqual([ellipse.type, ellipse.fill], ['Rect', '#000000']);
    assert.ok(isEllipse(ellipse), `the radii are half the sides: ${ellipse.rx} x ${ellipse.ry} in ${ellipse.width} x ${ellipse.height}`);
    const round = await draw('flat', 'round', [1300, 500, 1500, 700]);
    assert.ok(Math.abs(round.rx - Math.min(round.width, round.height) / 4) < 0.2 && round.rx === round.ry, `a quarter of the short side: ${round.rx}`);
    const img = await exported();
    near(px(img, 1400, 200), BLACK, 0, 'the middle of the ellipse');
    near(px(img, 1305, 105), px(plain, 1305, 105), 0, 'the corner of the box of the ellipse is not hidden');
    near(px(img, 1400, 102), BLACK, 0, 'the top of the ellipse');
    near(px(img, 1303, 503), px(plain, 1303, 503), 0, 'the corner of the rounded rectangle is not hidden');
    near(px(img, 1400, 502), BLACK, 0, 'the middle of its top edge is');
    near(px(img, 1302, 600), BLACK, 0, 'the middle of its left edge is');
    assert.ok(!JSON.stringify(await objectsOf()).includes('data:'), 'no pixels in the versions');
  });

  it('the shape of a new area is the one of the tool, kept for next time; each tool has its own', async () => {
    await tool(page, 'flat');
    assert.equal(await checkedShape(), 'round', 'the flat remembers the last one');
    await tool(page, 'pixel');
    assert.equal(await checkedShape(), 'rect', 'another tool has its own');
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    await tool(page, 'flat');
    assert.equal(await checkedShape(), 'round', 'remembered across sessions');
  });

  it('a selected area shows its shape, and changing it changes that area only, as one step of the history', async () => {
    await tool(page, 'select');
    await page.mouse.click(...m.pt(1400, 200)); // the ellipse
    await page.waitForSelector('#shapeProps:not([hidden])');
    assert.equal(await checkedShape(), 'ellipse');
    await choose('rect');
    await poll(async () => (await objectsOf())[0].rx === 0 && (await objectsOf())[0].ry === 0, { what: 'the ellipse is a rectangle' });
    assert.ok((await objectsOf())[1].rx > 40, 'the other one is untouched');
    near(px(await exported(), 1305, 105), BLACK, 0, 'the corner is hidden now');
    await page.keyboard.press('Control+z');
    await poll(async () => isEllipse((await objectsOf())[0]), { what: 'undo gives the ellipse back' });
    await page.keyboard.press('Control+y');
    await poll(async () => (await objectsOf())[0].rx === 0, { what: 'redo' });
    await page.keyboard.press('Control+z');
    await poll(async () => isEllipse((await objectsOf())[0]), { what: 'back to the ellipse' });
  });

  it('a resize keeps the shape: the radii follow the new size', async () => {
    await tool(page, 'select');
    await page.mouse.click(...m.pt(1400, 200));
    await page.waitForSelector('#shapeProps:not([hidden])');
    const [sx, sy] = m.pt(1500, 300); // bottom right corner of the box
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(...m.pt(1560, 340), { steps: 8 });
    await page.mouse.up();
    const big = await poll(async () => { const o = (await objectsOf())[0]; return o.width > 230 ? o : null; }, { what: 'the ellipse is bigger' });
    assert.ok(isEllipse(big), `still an ellipse: ${big.width} x ${big.height}, radii ${big.rx} x ${big.ry}`);
    assert.equal(await checkedShape(), 'ellipse');
    await page.keyboard.press('Control+z'); // back to 200 x 200 for what follows
    await poll(async () => (await objectsOf())[0].width < 205, { what: 'undone' });
  });

  it('the outline of a rectangle follows the shape: a stroked ellipse leaves the corners of its box alone', async () => {
    const o = await draw('rect', 'ellipse', [100, 600, 400, 800]);
    assert.equal(o.fill, '');
    assert.ok(isEllipse(o), 'an ellipse');
    const img = await exported();
    near(px(img, 250, 600), [229, 57, 53], 8, 'the stroke at the top of the ellipse');
    near(px(img, 103, 603), px(plain, 103, 603), 0, 'nothing in the corner of its box');
    near(px(img, 250, 700), px(plain, 250, 700), 0, 'and it is not filled');
  });

  it('the highlighter in an ellipse: the page takes the color inside, not in the corners', async () => {
    const o = await draw('highlight', 'ellipse', [700, 600, 1000, 800]);
    assert.ok(isEllipse(o), 'an ellipse');
    const img = await exported();
    const inside = px(img, 850, 700);
    assert.ok(inside[2] < 235, `the center is tinted (${inside})`);
    near(px(img, 703, 603), px(plain, 703, 603), 0, 'the corner of the box is not');
  });

  it('pixelation and blur in an ellipse: the corners of the box show the image, the inside is hidden', async () => {
    await draw('pixel', 'ellipse', [210, 210, 590, 390]);
    const img = await exported();
    near(px(img, 213, 213), px(plain, 213, 213), 0, 'the corner of the box is the image');
    near(px(img, 587, 387), px(plain, 587, 387), 0, 'and the opposite one');
    const centre = px(img, 400, 300);
    assert.notDeepEqual(centre.slice(0, 3), px(plain, 400, 300).slice(0, 3), 'the inside is pixelated');
    await draw('blur', 'round', [1000, 300, 1200, 500]);
    const blurred = await exported();
    near(px(blurred, 1002, 302), px(plain, 1002, 302), 0, 'the corner of the rounded box is the image');
  });

  it('the spotlight in an ellipse: bright inside, dimmed in the corners of its box; with a rectangle that overlaps, one shade', async () => {
    const base = await exported(); // what is there before it
    const dimmed = (x, y) => px(base, x, y).slice(0, 3).map((c) => Math.round(c * SHADE));
    await draw('spot', 'ellipse', [100, 100, 500, 300]);
    assert.ok(isEllipse((await objectsOf()).find((x) => x.type === 'Spot')), 'an ellipse (a spotlight goes to the back)');
    const first = await exported();
    near(px(first, 300, 250), px(base, 300, 250), 0, 'inside the ellipse: untouched');
    near(px(first, 105, 105), dimmed(105, 105), 2, 'the corner of the box is dimmed');
    near(px(first, 1450, 800), dimmed(1450, 800), 3, 'far away is dimmed');
    // a rectangular spotlight over the corner: its area is bright, and where the two overlap it is bright once
    await draw('spot', 'rect', [90, 90, 200, 200]);
    const two = await exported();
    near(px(two, 105, 105), px(base, 105, 105), 0, 'the corner is bright inside the rectangle');
    near(px(two, 150, 150), px(base, 150, 150), 0, 'and where it overlaps the ellipse');
    near(px(two, 450, 200), px(base, 450, 200), 0, 'inside the ellipse, away from the rectangle');
    near(px(two, 480, 120), dimmed(480, 120), 2, 'still dimmed in the corner of the ellipse, far from the rectangle');
  });

  it('what is saved is what is drawn after a reload, and the grouped export draws the same shapes', async () => {
    const before = await exported();
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    const after = await exported();
    // Fabric saves 2 decimals: the edge of an ellipse that falls between two pixels is drawn a hair differently from the one that was never
    // saved. Anything but a handful of edge pixels must be the same.
    let off = 0;
    for (let i = 0; i < after.data.length; i += 4) {
      if (Math.max(Math.abs(after.data[i] - before.data[i]), Math.abs(after.data[i + 1] - before.data[i + 1]), Math.abs(after.data[i + 2] - before.data[i + 2])) > 3) off++;
    }
    assert.ok(off <= 8, `the same pixels after a reload, to the rounding of the edges (${off} px off by more than 3 levels; ${diffInfo(after, before)})`);
    await openBatch(page, [otherId, id]);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const image = await decodePng(page, readZip(file.buf)[1].data);
    assert.equal(Buffer.compare(image.data, after.data), 0, 'the grouped export is the export of the editor');
    await closeBatch(page);
  });

  it('no console error over the whole session', () => {
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), []);
  });
});

describe('editor: free hand', () => {
  let h, page, m, id, otherId, plain;
  const objectsOf = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return s.versions[s.active]?.objects ?? [];
  };
  const exported = async () => decodePng(page, (await download(page)).buf);
  const choose = (shape) => page.locator(`#shapePick label:has(input[value="${shape}"])`).click();
  /** Moves the mouse along `points` (document coordinates) with the button down. */
  const stroke = async (points) => {
    await page.mouse.move(...m.pt(...points[0]));
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...m.pt(...p), { steps: 6 });
    await page.mouse.up();
  };
  /** Draws a free shape with `name` along `points`, and waits for the object to be saved. */
  const draw = async (name, points) => {
    const known = new Set((await objectsOf()).map((o) => JSON.stringify(o)));
    await tool(page, name);
    await choose('free');
    await stroke(points);
    return poll(async () => (await objectsOf()).find((o) => o.pts?.length && !known.has(JSON.stringify(o))) ?? null, { what: `${name} free saved` });
  };
  const TRIANGLE = [[1300, 100], [1500, 100], [1400, 300], [1300, 100]];

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Other', 800, 600, false), spec('Free', 1600, 900, true)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const shots = await dbDump(page);
    [otherId, id] = [shots[0].id, shots[1].id];
    m = await mapper(page, 1600, 900);
    plain = await exported();
  });
  after(() => h?.close());

  it('a free solid fill: a triangle drawn by hand hides the triangle, and the corners of its box stay', async () => {
    const o = await draw('flat', TRIANGLE);
    assert.deepEqual([o.type, o.fill], ['Lasso', '#000000']);
    assert.ok(o.pts.length >= 6 && o.pts.length <= 12, `simplified to a few points (${o.pts.length / 2})`);
    assert.ok(o.pts.every((v) => v >= 0 && v <= 1), 'fractions of the box');
    const img = await exported();
    near(px(img, 1400, 150), BLACK, 0, 'inside the triangle');
    near(px(img, 1310, 290), px(plain, 1310, 290), 0, 'the bottom left corner of the box is not hidden');
    near(px(img, 1490, 290), px(plain, 1490, 290), 0, 'nor the bottom right one');
    near(px(img, 1400, 280), BLACK, 0, 'the point of the triangle');
    assert.ok(!JSON.stringify(await objectsOf()).includes('data:'), 'no pixels in the versions');
  });

  it('a click, a short drag or a straight line draws nothing for an area; a line is a stroke for the highlighter', async () => {
    const n = (await objectsOf()).length;
    await tool(page, 'flat');
    await page.mouse.click(...m.pt(900, 400));
    await stroke([[900, 400], [903, 402]]);
    await stroke([[700, 400], [800, 400], [900, 400]]); // a straight horizontal line has no area
    assert.equal((await objectsOf()).length, n, 'nothing drawn');
  });

  it('the pen of a free highlighter: one stroke along the path, wide as the pen, the page takes the color and never hides', async () => {
    const o = await draw('highlight', [[200, 650], [600, 650], [600, 720], [300, 720]]);
    assert.equal(o.type, 'Highlight');
    assert.ok(o.brush >= 12, `the pen is ${o.brush} px wide`);
    assert.ok(o.pts.length >= 8);
    const img = await exported();
    const on = px(img, 400, 650), beside = px(img, 400, 650 + o.brush / 2 + 8), far = px(img, 400, 690);
    assert.ok(on[2] < 235, `the pen tints the page along the path (${on})`);
    near(beside, px(plain, 400, 650 + o.brush / 2 + 8), 0, 'and not beyond the width of the pen');
    near(far, px(plain, 400, 690), 0, 'nor between the two strokes of the path');
    assert.deepEqual(px(img, 600, 685).slice(0, 3), px(img, 400, 650).slice(0, 3), 'the same tint on the corner: one stroke, multiplied once');
  });

  it('a free spotlight: bright inside the path, dimmed outside, and one shade with a rectangle that overlaps', async () => {
    const base = await exported();
    const dimmed = (x, y) => px(base, x, y).slice(0, 3).map((c) => Math.round(c * SHADE));
    await draw('spot', [[100, 100], [500, 100], [300, 300], [100, 100]]);
    const first = await exported();
    near(px(first, 300, 150), px(base, 300, 150), 0, 'inside the triangle');
    near(px(first, 450, 280), dimmed(450, 280), 2, 'the corner of its box is dimmed');
    await tool(page, 'spot');
    await choose('rect');
    await drag(page, m, 400, 150, 600, 350);
    await poll(async () => (await objectsOf()).filter((o) => o.type === 'Spot').length === 2, { what: 'a second spotlight' });
    const two = await exported();
    near(px(two, 450, 280), px(base, 450, 280), 0, 'the rectangle makes the corner bright');
    near(px(two, 150, 250), dimmed(150, 250), 2, 'the rest is still dimmed');
  });

  it('a free pixelation and a free blur: the inside of the path is hidden, the outside is the image', async () => {
    const before = await exported();
    await draw('pixel', [[210, 210], [590, 210], [400, 390], [210, 210]]);
    await draw('blur', [[1000, 300], [1200, 300], [1100, 500], [1000, 300]]);
    const img = await exported();
    near(px(img, 215, 380), px(before, 215, 380), 0, 'the corner of the pixelation box, outside the triangle');
    assert.notDeepEqual(px(img, 400, 250).slice(0, 3), px(before, 400, 250).slice(0, 3), 'inside it, the stripes are gone');
    near(px(img, 1010, 490), px(before, 1010, 490), 0, 'the corner of the blur box is the image');
    assert.notDeepEqual(px(img, 1100, 340).slice(0, 3), px(before, 1100, 340).slice(0, 3), 'inside the triangle it is blurred');
  });

  it('a free area can be given another shape (it becomes a plain one, undoable), and a plain one cannot be made free', async () => {
    await tool(page, 'select');
    await page.mouse.click(...m.pt(1400, 150)); // the free fill
    await page.waitForSelector('#shapeProps:not([hidden])');
    assert.equal(await page.locator('#shapePick input:checked').getAttribute('value'), 'free');
    assert.notDeepEqual(px(await exported(), 1320, 150).slice(0, 3), BLACK, 'a point outside the triangle');
    await page.mouse.click(...m.pt(1400, 150)); // (the export let go of the selection)
    await page.waitForSelector('#shapeProps:not([hidden])');
    await choose('ellipse');
    await poll(async () => { const o = (await objectsOf()).find((x) => x.type === 'Lasso'); return o && !o.pts.length && o.rx > 0; }, { what: 'the fill is an ellipse of its box' });
    near(px(await exported(), 1320, 150), BLACK, 0, 'the ellipse of its box covers (1320, 150), which the triangle did not');
    await page.keyboard.press('Control+z');
    await poll(async () => (await objectsOf()).find((x) => x.type === 'Lasso')?.pts.length > 0, { what: 'undo gives the free shape back' });
    // a plain rectangle: "free hand" is not offered for it
    await tool(page, 'flat');
    await choose('rect');
    await drag(page, m, 700, 100, 900, 200);
    await poll(async () => (await objectsOf()).some((x) => x.type === 'Rect'), { what: 'a plain rectangle' });
    await tool(page, 'select');
    await page.mouse.click(...m.pt(800, 150));
    await page.waitForSelector('#shapeProps:not([hidden])');
    assert.equal(await page.locator('#shapePick input[value="free"]').isDisabled(), true, 'a selected plain area cannot become free');
    assert.equal(await page.locator('#shapePick input[value="ellipse"]').isDisabled(), false);
  });

  it('a resize keeps the free shape: the points are fractions of the box', async () => {
    await tool(page, 'select');
    await page.mouse.click(...m.pt(1400, 150));
    await page.waitForSelector('#shapeProps:not([hidden])');
    const lasso = (await objectsOf()).find((x) => x.type === 'Lasso');
    const [sx, sy] = m.pt(lasso.left + lasso.width, lasso.top + lasso.height);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(...m.pt(lasso.left + lasso.width + 80, lasso.top + lasso.height + 60), { steps: 8 });
    await page.mouse.up();
    const big = await poll(async () => { const o = (await objectsOf()).find((x) => x.type === 'Lasso'); return o.width > lasso.width + 40 ? o : null; }, { what: 'bigger' });
    assert.deepEqual(big.pts, lasso.pts, 'the same fractions: the shape is stretched with its box');
    assert.equal(big.scaleX ?? 1, 1, 'the scale is baked into the size');
    await page.keyboard.press('Control+z');
  });

  it('what is saved is what is drawn after a reload, and the grouped export draws the same free shapes', async () => {
    const before = await exported();
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    const after = await exported();
    let off = 0;
    for (let i = 0; i < after.data.length; i += 4) {
      if (Math.max(Math.abs(after.data[i] - before.data[i]), Math.abs(after.data[i + 1] - before.data[i + 1]), Math.abs(after.data[i + 2] - before.data[i + 2])) > 3) off++;
    }
    assert.ok(off <= 60, `the same pixels after a reload, to the rounding of the edges (${off} px off by more than 3 levels; ${diffInfo(after, before)})`);
    await openBatch(page, [otherId, id]);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const image = await decodePng(page, readZip(file.buf)[1].data);
    assert.equal(Buffer.compare(image.data, after.data), 0, 'the grouped export is the export of the editor');
    await closeBatch(page);
  });

  it('no console error over the whole session', () => {
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), []);
  });
});
