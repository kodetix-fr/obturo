// The highlighter and the spotlight, in the real extension with the real mouse: what the export draws (a color multiplied with the image,
// a shade over everything but the areas), the order of the objects, several spotlights as one shade, undo, a reload, the grouped export.
// The steps follow one another: each one starts from the state left by the previous one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, drag, mapper, poll, px, ready, resetLibrary, spec, tool, waitOut } from './support/editor.mjs';
import { batchDone, closeBatch, downloadAfter, openBatch, readZip } from './support/export.mjs';

const OPACITY = 0.6; // HIGHLIGHT_OPACITY: the pen never hides, whatever its color
// What a highlighter of color `rgb` leaves of a pixel `base`: the pixel and the multiplied pixel, mixed at the strength of the pen.
const tint = (rgb, base = [255, 255, 255]) => base.map((v, i) => Math.round(v * (1 - OPACITY * (1 - rgb[i] / 255))));
const YELLOW_RGB = [255, 235, 59]; // #ffeb3b, the yellow of the palette
const PINK_RGB = [236, 64, 122]; // #ec407a
const YELLOW = tint(YELLOW_RGB);
const PINK = tint(PINK_RGB);
const near = (actual, expected, tolerance, what) => assert.ok(expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance), `${what}: ${actual.slice(0, 3)} is not within ${tolerance} of ${expected}`);
const SHADE = 0.45; // what a spotlight leaves of a pixel: 1 - 0.55

describe('editor: highlighter and spotlight', () => {
  let h, page, m, id, otherId;
  const objectsOf = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return s.versions[s.active]?.objects ?? [];
  };
  const types = async () => (await objectsOf()).map((o) => o.type);
  const exported = async () => decodePng(page, (await download(page)).buf);
  const visible = (selector) => page.locator(selector).isVisible();

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Other', 800, 600, false), spec('Marks', 1600, 900, false)]); // white, with pale bands at the top of each 400 px
    await ready(page);
    await waitOut(page, 1600, 900);
    const shots = await dbDump(page);
    [otherId, id] = [shots[0].id, shots[1].id];
    m = await mapper(page, 1600, 900);
  });
  after(() => h?.close());

  it('the highlighter multiplies its color with the image: white takes the color, black stays black, a pale band takes it too', async () => {
    const plain = await exported(); // nothing drawn yet: the image as it is
    await tool(page, 'flat');
    await drag(page, m, 1000, 150, 1100, 250); // a black square: the "text"
    await tool(page, 'highlight');
    assert.equal(await visible('#highlightProps'), true, 'the swatches of the highlighter');
    assert.equal(await visible('#lineProps'), false, 'no line color for it');
    await drag(page, m, 900, 20, 1200, 300); // over the white, the black square and a pale band
    await poll(async () => (await types()).join() === 'Rect,Highlight', { what: 'two objects saved' });
    const hl = (await objectsOf())[1];
    assert.deepEqual([hl.fill, hl.opacity], ['#ffeb3b', OPACITY]);
    assert.ok(!JSON.stringify(await objectsOf()).includes('data:'), 'no pixels in the versions');
    const img = await exported();
    near(px(img, 950, 200), YELLOW, 1, 'white under the highlighter');
    near(px(img, 1050, 200), [0, 0, 0], 0, 'black under the highlighter');
    near(px(img, 800, 200), [255, 255, 255], 0, 'white next to it');
    const band = px(plain, 1000, 60); // a pale band
    near(px(img, 1000, 60), tint(YELLOW_RGB, band.slice(0, 3)), 1, 'a color multiplied with a color');
  });

  it('the color of the swatches goes to the selected highlighter, and to the next ones', async () => {
    await tool(page, 'select');
    await page.mouse.click(...m.pt(1150, 100)); // the highlighter (the export let go of the selection)
    await page.waitForSelector('#highlightProps:not([hidden])');
    assert.equal(await page.locator('#hlSwatches input:checked').getAttribute('value'), '#ffeb3b', 'the panel shows its color');
    await page.locator('#hlSwatches label:has(input[value="#ec407a"])').click(); // pink
    await poll(async () => (await objectsOf())[1].fill === '#ec407a', { what: 'the highlighter is pink' });
    await tool(page, 'highlight');
    await drag(page, m, 100, 600, 300, 700);
    await poll(async () => (await types()).length === 3, { what: 'a third object' });
    assert.equal((await objectsOf())[2].fill, '#ec407a', 'the color chosen is the one of the next highlighter');
    const img = await exported();
    near(px(img, 200, 650), PINK, 1, 'pink on white');
    near(px(img, 950, 200), PINK, 1, 'the first one changed to pink');
  });

  it('the spotlight dims everything but its area, and a click or a short drag draws nothing', async () => {
    await tool(page, 'spot');
    assert.equal(await visible('#spotProps'), true, 'a hint, nothing to set');
    assert.equal(await visible('#lineProps'), false);
    await page.mouse.click(...m.pt(1400, 700)); // a click
    await drag(page, m, 1400, 700, 1402, 701); // a drag of a couple of pixels
    assert.equal((await types()).length, 3, 'nothing drawn');
    await drag(page, m, 300, 130, 700, 380);
    await poll(async () => (await types()).length === 4, { what: 'a spotlight saved' });
    assert.equal((await types())[0], 'Spot', 'sent to the back: first in the list');
    const img = await exported();
    near(px(img, 500, 250), [255, 255, 255], 0, 'white inside the area stays white');
    near(px(img, 1300, 300), [255, 255, 255].map((c) => Math.round(c * SHADE)), 2, 'white outside is dimmed');
    for (const [x, y] of [[0, 0], [1599, 0], [0, 899], [1599, 899]]) assert.ok(px(img, x, y).slice(0, 3).every((c) => c <= 115 + 2), `the corner ${x},${y} is dimmed (${px(img, x, y)})`); // pale bands there: at most 255 x 0.45
    near(px(img, 200, 650), tint(PINK_RGB, [255, 255, 255].map((c) => Math.round(c * SHADE))), 2, 'a highlighter multiplies with the image as it is shown: the dimmed one');
  });

  it('what is drawn after the spotlight is not dimmed, and a spotlight drawn later goes under what exists', async () => {
    await tool(page, 'rect');
    await drag(page, m, 1000, 600, 1300, 800); // a red rectangle, outside the bright area
    await poll(async () => (await types()).length === 5, { what: 'a rectangle' });
    const img = await exported();
    near(px(img, 1000, 700), [229, 57, 53], 4, 'the border of the rectangle, over the shade, keeps its color');
    // a second spotlight is sent to the back too: the rectangle stays on top of it
    await tool(page, 'spot');
    await drag(page, m, 900, 500, 1100, 750); // covers the left edge of the rectangle
    await poll(async () => (await types()).length === 6, { what: 'a second spotlight' });
    assert.deepEqual((await types()).slice(0, 2), ['Spot', 'Spot'], 'both at the back');
    const after = await exported();
    near(px(after, 1000, 700), [229, 57, 53], 4, 'the red border is still not dimmed');
    near(px(after, 1200, 800), [229, 57, 53], 4, 'the bottom border, outside both areas, is red: over the shade, not dimmed');
  });

  it('several spotlights are ONE shade with a hole each; an overlap is bright once, not dark twice', async () => {
    const img = await exported();
    const bright = (x, y, what) => near(px(img, x, y), [255, 255, 255], 0, what);
    const dim = (x, y, what) => near(px(img, x, y), [255, 255, 255].map((c) => Math.round(c * SHADE)), 2, what);
    bright(500, 250, 'the first area');
    bright(950, 550, 'the second area (left of the rectangle)');
    dim(1450, 300, 'outside both');
    dim(800, 600, 'between them');
    // a third area overlapping the first
    await tool(page, 'spot');
    await drag(page, m, 600, 300, 900, 450);
    await poll(async () => (await types()).filter((t) => t === 'Spot').length === 3, { what: 'a third spotlight' });
    const three = await exported();
    near(px(three, 650, 340), [255, 255, 255], 0, 'the overlap of two areas is bright');
    near(px(three, 850, 340), [255, 255, 255], 0, 'the part of the third area outside the first');
  });

  it('delete a spotlight: the next one paints the shade; undo and redo follow', async () => {
    await tool(page, 'select');
    // the third spotlight (index 0..2 in the list, the last drawn goes to the back: it is first)
    await page.mouse.click(...m.pt(880, 340)); // inside the third area only: selects the spotlight under the pointer
    await page.keyboard.press('Delete');
    await poll(async () => (await types()).filter((t) => t === 'Spot').length === 2, { what: 'a spotlight deleted' });
    let img = await exported();
    near(px(img, 880, 340), [255, 255, 255].map((c) => Math.round(c * SHADE)), 2, 'its area is dimmed again');
    near(px(img, 500, 250), [255, 255, 255], 0, 'the others are still bright');
    await page.keyboard.press('Control+Z');
    await poll(async () => (await types()).filter((t) => t === 'Spot').length === 3, { what: 'undone' });
    await page.keyboard.press('Control+Shift+Z');
    await poll(async () => (await types()).filter((t) => t === 'Spot').length === 2, { what: 'redone' });
    img = await exported();
    near(px(img, 880, 340), [255, 255, 255].map((c) => Math.round(c * SHADE)), 2, 'dimmed after redo');
  });

  it('delete the FIRST spotlight too: the shade comes from the one that is left', async () => {
    await tool(page, 'select');
    await page.mouse.click(...m.pt(400, 200)); // inside the first area
    await page.keyboard.press('Delete');
    await poll(async () => (await types()).filter((t) => t === 'Spot').length === 1, { what: 'one spotlight left' });
    const img = await exported();
    near(px(img, 400, 200), [255, 255, 255].map((c) => Math.round(c * SHADE)), 2, 'the area of the deleted one is dimmed');
    near(px(img, 950, 550), [255, 255, 255], 0, 'the area that is left is bright');
  });

  // The shade is painted outside the box of the spotlight: Fabric must not skip it because that box is out of the view. A spotlight in the
  // bottom right corner goes to the back, so it is the one that paints the shade; the view is then moved to the top left, away from it.
  it('a spotlight whose area is out of view still dims what is in view', async () => {
    await tool(page, 'spot');
    await drag(page, m, 1500, 820, 1590, 890);
    await poll(async () => (await types()).filter((t) => t === 'Spot').length === 2, { what: 'a spotlight in the corner' });
    await page.click('#actual'); // 100 %: the image no longer fits the stage
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
    await page.keyboard.down('Shift'); // Shift + wheel scrolls sideways
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
    await page.keyboard.up('Shift');
    const stage = await page.locator('#stage').boundingBox();
    const shot = await page.screenshot({ clip: { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2, width: 4, height: 4 } });
    const middle = px(await decodePng(page, shot), 1, 1);
    assert.ok(middle[0] < 200 && middle[1] < 200 && middle[2] < 200, `the middle of the view shows the dimmed image, not the white one: ${middle.slice(0, 3)}`);
    await page.click('#fit');
    m = await mapper(page, 1600, 900);
  });

  it('what is saved is what is drawn after a reload, and the grouped export draws the same', async () => {
    const before = await exported();
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    const after = await exported();
    assert.equal(Buffer.compare(after.data, before.data), 0, 'the export after the reload is the export before it, pixel for pixel');
    await openBatch(page, [otherId, id]);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const entries = readZip(file.buf);
    const image = await decodePng(page, entries[1].data);
    assert.deepEqual([image.width, image.height], [after.width, after.height]);
    assert.equal(Buffer.compare(image.data, after.data), 0, 'the grouped export dims and highlights exactly as the editor does');
    await closeBatch(page);
  });

  it('no console error over the whole session', () => {
    assert.deepEqual(h.errors, []);
  });
});
