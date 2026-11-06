// The numbered marker, in the real extension with the real mouse and keyboard: one click per step, the smallest free number, the
// color and the size of the panel, a resize that keeps a circle, undo and redo, versions, what the export and the grouped export draw.
// The steps follow one another: each one starts from the state left by the previous one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, mapper, poll, px, ready, resetLibrary, sleep, spec, tool, waitOut } from './support/editor.mjs';
import { batchDone, closeBatch, downloadAfter, openBatch, readZip } from './support/export.mjs';

const RED = [229, 57, 53]; // the default color of the panel (#e53935)
const near = (actual, expected, tolerance, what) => assert.ok(expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance), `${what}: ${actual.slice(0, 3)} is not within ${tolerance} of ${expected}`);
const bright = (p) => p[0] > 200 && p[1] > 200 && p[2] > 200;
const dark = (p) => p[0] < 90 && p[1] < 90 && p[2] < 90;

describe('editor: numbered markers', () => {
  let h, page, m, id, otherId;
  /** The markers of the displayed version of the shot, as saved: { n, left, top, width, height, fill, cx, cy }. */
  const markers = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return (s.versions[s.active]?.objects ?? []).filter((o) => o.type === 'Marker').map((o) => ({ ...o, cx: o.left + o.width / 2, cy: o.top + o.height / 2 })); // before the first marker there is no version
  };
  const numbers = async () => (await markers()).map((o) => o.n);
  const click = (x, y) => page.mouse.click(...m.pt(x, y));
  const pressed = (name) => page.getAttribute(`[data-tool="${name}"]`, 'aria-pressed');
  /** The marker `n` as saved, once `check` holds for it. */
  const marker = async (/** @type {number} */ n, /** @type {(o: any) => boolean} */ check = () => true, what = `marker ${n}`) => poll(async () => (await markers()).find((o) => o.n === n && check(o)), { what });
  const exported = async () => decodePng(page, (await download(page)).buf);

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Other', 800, 600, false), spec('Steps', 1600, 900, false)]); // the last one opens
    await ready(page);
    await waitOut(page, 1600, 900);
    const shots = await dbDump(page);
    [otherId, id] = [shots[0].id, shots[1].id];
    m = await mapper(page, 1600, 900);
  });
  after(() => h?.close());

  it('one click per step places the next number, centered on the click, and the tool stays', async () => {
    await tool(page, 'marker');
    assert.equal(await pressed('marker'), 'true');
    for (const x of [200, 400, 600]) await click(x, 200);
    await poll(async () => (await numbers()).length === 3, { what: 'three markers saved' });
    assert.deepEqual(await numbers(), [1, 2, 3]);
    const s = (await dbDump(page)).find((x) => x.id === id);
    assert.equal(s.versions.length, 1, 'V1 is born with the first marker');
    for (const [i, o] of (await markers()).entries()) {
      assert.deepEqual([o.width, o.height], [40, 40], '1 / 40 of the width of the image');
      assert.equal(o.fill, '#e53935');
      assert.ok(Math.abs(o.cx - (200 + i * 200)) <= 2 && Math.abs(o.cy - 200) <= 2, `centered on the click: ${o.cx}, ${o.cy}`);
    }
    assert.equal(await pressed('marker'), 'true', 'the tool stays: the steps go one after the other');
    await click(800, 200);
    await poll(async () => (await numbers()).length === 4, { what: 'a fourth marker' });
    assert.deepEqual(await numbers(), [1, 2, 3, 4]);
    assert.ok(!JSON.stringify((await dbDump(page)).find((x) => x.id === id).versions).includes('data:'), 'no pixels in the versions');
  });

  it('a click that drags a little still places a marker where the button went down; nothing else is drawn', async () => {
    await page.mouse.move(...m.pt(1000, 200));
    await page.mouse.down();
    await page.mouse.move(...m.pt(1030, 230), { steps: 5 });
    await page.mouse.up();
    await poll(async () => (await numbers()).length === 5, { what: 'a fifth marker' });
    assert.deepEqual(await numbers(), [1, 2, 3, 4, 5]);
    assert.ok(Math.abs((await marker(5)).cx - 1000) <= 2, 'where the button went down');
    assert.equal((await dbDump(page)).find((x) => x.id === id).versions[0].objects.length, 5);
  });

  it('delete the 2 and the steps after it come down, so the steps read 1, 2, 3, 4 and the next marker is a 5', async () => {
    await tool(page, 'select');
    const two = await marker(2);
    await click(two.cx, two.cy);
    await page.keyboard.press('Delete');
    await poll(async () => (await numbers()).length === 4, { what: 'the 2 is deleted' });
    assert.deepEqual((await numbers()).sort(), [1, 2, 3, 4], 'the gap is closed');
    await tool(page, 'marker');
    await click(400, 500);
    await poll(async () => (await numbers()).length === 5, { what: 'a marker placed again' });
    assert.deepEqual((await numbers()).sort(), [1, 2, 3, 4, 5]);
  });

  it('the export draws the disc in its color, the number in white, inside a ring of the same ink', async () => {
    await tool(page, 'select');
    const one = await marker(1);
    const img = await exported();
    const [cx, cy] = [Math.round(one.cx), Math.round(one.cy)];
    near(px(img, cx - 12, cy + 10), RED, 4, 'the disc, away from the number');
    near(px(img, cx + 15, cy), RED, 4, 'the disc, to the right of the number');
    assert.ok(bright(px(img, cx + 18, cy)), 'the ring: white where the disc would otherwise be red');
    let ink = 0;
    for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) if (bright(px(img, x, y))) ink++;
    assert.ok(ink > 25, `the number is in white (${ink} px)`);
    assert.ok(!near3(px(img, cx + 26, cy)), 'nothing outside the disc');
  });

  it('with a marker selected the panel says "Size", and its color and size follow the panel', async () => {
    assert.equal(await page.locator('#thickLabel').innerText(), 'Stroke', 'the label of a line');
    const one = await marker(1);
    await click(one.cx, one.cy);
    await poll(async () => (await page.locator('#thickLabel').innerText()) === 'Size', { what: 'the label for a marker' });
    assert.equal(await page.inputValue('#color'), '#e53935', 'the panel shows the color of the marker');
    await page.evaluate(() => {
      const color = /** @type {HTMLInputElement} */ (document.getElementById('color'));
      color.value = '#fbc02d';
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await marker(1, (o) => o.fill === '#fbc02d', 'the yellow marker saved');
    let img = await exported();
    const y1 = await marker(1);
    const [cx, cy] = [Math.round(y1.cx), Math.round(y1.cy)];
    near(px(img, cx - 12, cy + 10), [251, 192, 45], 4, 'yellow disc');
    let ink = 0;
    for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) if (dark(px(img, x, y))) ink++;
    assert.ok(ink > 25, `the number turns dark on a light color (${ink} px)`);
    await click(y1.cx, y1.cy); // the export let go of the selection
    await page.waitForFunction(() => document.getElementById('thickLabel').textContent === 'Size');
    await page.locator('#thick label').nth(2).click(); // thick
    const big = await marker(1, (o) => o.width === 72, 'the marker is thick');
    assert.deepEqual([big.width, big.height], [72, 72]);
    assert.ok(Math.abs(big.cx - y1.cx) <= 1 && Math.abs(big.cy - y1.cy) <= 1, 'the size changes around the center');
    img = await exported();
    near(px(img, Math.round(big.cx) - 28, Math.round(big.cy) + 8), [251, 192, 45], 4, 'the disc is bigger');
    await click(big.cx, big.cy); // the export let go of the selection again
    await page.waitForFunction(() => document.getElementById('thickLabel').textContent === 'Size');
    await page.locator('#thick label').nth(1).click(); // back to medium for what follows
    await marker(1, (o) => o.width === 40, 'back to medium');
    await tool(page, 'rect');
    assert.equal(await page.locator('#thickLabel').innerText(), 'Stroke', 'a line again');
    await tool(page, 'select');
  });

  it('a corner handle resizes it, and it stays a circle (the scale is baked into the size)', async () => {
    const three = await marker(3);
    await click(three.cx, three.cy);
    await page.waitForFunction(() => document.getElementById('thickLabel').textContent === 'Size');
    const [x, y] = [three.left + three.width, three.top + three.height]; // bottom right corner of its box
    const [sx, sy] = m.pt(x, y);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(...m.pt(x + 60, y + 60), { steps: 8 });
    await page.mouse.up();
    const big = await marker(3, (o) => o.width > 55, 'the marker is bigger');
    assert.equal(big.width, big.height, 'a circle');
    assert.ok((big.scaleX ?? 1) === 1 && (big.scaleY ?? 1) === 1, 'the scale is baked into the size');
    assert.equal(big.n, 3, 'its number is its own');
  });

  it('undo and redo follow the markers', async () => {
    await page.keyboard.press('Control+Z');
    await marker(3, (o) => o.width === 40, 'the resize is undone');
    await page.keyboard.press('Control+Shift+Z');
    await marker(3, (o) => o.width > 55, 'the resize is redone');
    await page.keyboard.press('Control+Z'); // and back, for what follows
    await marker(3, (o) => o.width === 40, 'undone again');
  });

  it('escape ends the tool', async () => {
    await tool(page, 'marker');
    assert.equal(await pressed('marker'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await pressed('select'), 'true');
    assert.equal(await pressed('marker'), 'false');
  });

  it('a new version copies the markers; its next number comes from its own markers only', async () => {
    await page.click('#newVersion');
    await poll(async () => (await dbDump(page)).find((x) => x.id === id).versions.length === 2, { what: 'V2 saved' });
    assert.deepEqual((await numbers()).sort(), [1, 2, 3, 4, 5], 'the copy has the markers of V1');
    await tool(page, 'marker');
    await click(1200, 600);
    await poll(async () => (await numbers()).length === 6, { what: 'a marker in V2' });
    assert.deepEqual((await numbers()).sort(), [1, 2, 3, 4, 5, 6]);
    const s = (await dbDump(page)).find((x) => x.id === id);
    assert.equal(s.versions[0].objects.length, 5, 'V1 is untouched');
    await tool(page, 'select');
  });

  it('what is saved is what is drawn after a reload', async () => {
    const before = await exported();
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    const after = await exported();
    assert.equal(Buffer.compare(after.data, before.data), 0, 'the export after the reload is the export before it, pixel for pixel');
    const six = await marker(6);
    near(px(after, Math.round(six.cx) - 12, Math.round(six.cy) + 10), RED, 4, 'the sixth marker is there');
  });

  it('the grouped export draws the same markers, pixel for pixel', async () => {
    const editor = await exported();
    await openBatch(page, [otherId, id]);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const entries = readZip(file.buf);
    assert.equal(entries.length, 2);
    const image = await decodePng(page, entries[1].data);
    assert.deepEqual([image.width, image.height], [editor.width, editor.height]);
    assert.equal(Buffer.compare(image.data, editor.data), 0, 'the markers of the grouped export are those of the editor');
    await closeBatch(page);
  });

  it('no console error over the whole session', () => {
    assert.deepEqual(h.errors, []);
  });
});

/** Is the pixel the disc color? @param {number[]} p */
function near3(p) {
  return RED.every((v, i) => Math.abs(p[i] - v) <= 12);
}

describe('editor: the text and the number of a marker, typed on the image', () => {
  let h, page, m, id, otherId;
  const markers = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return (s.versions[s.active]?.objects ?? []).filter((o) => o.type === 'Marker');
  };
  const byNumber = async (/** @type {number} */ n) => (await markers()).find((o) => o.n === n);
  const click = (x, y) => page.mouse.click(...m.pt(x, y));
  const dbl = (x, y) => page.mouse.dblclick(...m.pt(x, y));
  const exported = async () => decodePng(page, (await download(page)).buf);
  const field = () => page.locator('.marker-edit');
  const fieldOpen = () => page.evaluate(() => document.activeElement?.classList.contains('marker-edit') ?? false);
  /** Where the disc and the text of a saved marker are (document coordinates), whatever its side. */
  const geometry = (o) => {
    const d = o.height, f = o.width - d;
    const cx = o.side === 'left' ? o.left + f + d / 2 : o.left + d / 2;
    return { d, cx, cy: o.top + d / 2, textX: o.side === 'left' ? o.left + f / 2 : o.left + d + f / 2 };
  };

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Other', 800, 600, false), spec('Texts', 1600, 900, false)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const shots = await dbDump(page);
    [otherId, id] = [shots[0].id, shots[1].id];
    m = await mapper(page, 1600, 900);
  });
  after(() => h?.close());

  it('a new marker opens a field on its text, on the image: type, Enter keeps it, and the tool stays for the next step', async () => {
    await tool(page, 'marker');
    await click(200, 200);
    await poll(async () => (await markers()).length === 1, { what: 'a marker placed' });
    assert.equal(await fieldOpen(), true, 'the keyboard is in a field on the image');
    assert.equal(await page.locator('#markerProps').isVisible(), true, 'the style bar has its choices for a marker');
    assert.equal(await page.locator('#markerProps input[type="text"]').count(), 0, 'and no text field of its own: the text is typed on the marker');
    await page.keyboard.type('Open the menu', { delay: 5 });
    await poll(async () => (await byNumber(1))?.label === 'Open the menu', { what: 'the text is saved as it is typed' });
    const one = await byNumber(1);
    assert.equal(one.height, 40);
    assert.ok(one.width > 100, `the box holds the text (${one.width})`);
    await page.keyboard.press('Enter');
    assert.equal(await field().count(), 0, 'Enter closes the field');
    assert.equal(await page.getAttribute('[data-tool="marker"]', 'aria-pressed'), 'true', 'the tool stays');
    await click(200, 400); // the next step: a click elsewhere places it, and the field is open for it
    await poll(async () => (await markers()).length === 2, { what: 'a second marker' });
    assert.equal((await byNumber(1)).label, 'Open the menu', 'the first keeps its text');
    assert.equal((await byNumber(2)).label, '', 'no text yet for the second');
    assert.equal(await fieldOpen(), true);
    await page.keyboard.press('Escape'); // takes the field away, the marker stays...
    assert.equal(await field().count(), 0);
    assert.equal(await page.getAttribute('[data-tool="marker"]', 'aria-pressed'), 'true', '... and the tool too');
    assert.deepEqual([(await byNumber(2)).width, (await byNumber(2)).height], [40, 40], 'a plain disc is still a square');
    await page.keyboard.press('Escape'); // the second Esc ends the tool
    assert.equal(await page.getAttribute('[data-tool="select"]', 'aria-pressed'), 'true');
  });

  it('the field is laid over the text, in the color of the marker, as big as it, and follows the zoom', async () => {
    await tool(page, 'select');
    const one = await byNumber(1);
    const g = geometry(one);
    await dbl(g.textX, g.cy);
    assert.equal(await fieldOpen(), true);
    assert.equal(await field().inputValue(), 'Open the menu', 'it holds the text it edits');
    const box = await field().boundingBox();
    const [cx, cy] = m.pt(g.textX, g.cy);
    assert.ok(Math.abs(box.x + box.width / 2 - cx) <= 4 && Math.abs(box.y + box.height / 2 - cy) <= 4, `centered on the text: field ${JSON.stringify(box)} against ${cx},${cy}`);
    assert.ok(Math.abs(box.width - (one.width - 40 - 8) * m.v.z) <= 6, `as wide as the text: ${box.width} for ${(one.width - 48) * m.v.z}`);
    assert.equal(await field().evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(229, 57, 53)', 'the color of the marker');
    const before = await field().boundingBox();
    await page.evaluate(({ x, y }) => { // Ctrl + wheel over the image: zoom in
      const el = /** @type {HTMLElement} */ (document.querySelector('canvas.upper-canvas'));
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await sleep(300);
    const after = await field().boundingBox();
    assert.ok(after.width > before.width * 1.2, `the field grows with the zoom (${before.width} -> ${after.width})`);
    assert.equal(await fieldOpen(), true, 'and stays open');
    await page.keyboard.press('Escape');
    await page.click('#fit'); // back to the fitted view for the clicks of the next tests
    await sleep(200);
    m = await mapper(page, 1600, 900);
  });

  it('a double click edits the text of a marker, or its number on the disc; Enter edits the text of a selected marker; Esc puts back what was there', async () => {
    const one = await byNumber(1);
    const g = geometry(one);
    await dbl(g.textX, g.cy);
    await field().fill('Close it');
    await page.keyboard.press('Enter');
    await poll(async () => (await byNumber(1)).label === 'Close it', { what: 'the new text' });
    await dbl(g.cx, g.cy); // the disc: the number
    assert.equal(await field().inputValue(), '1', 'it holds the number');
    await page.keyboard.type('12');
    await poll(async () => (await markers()).some((o) => o.n === 12), { what: 'the number, as it is typed' });
    await page.keyboard.press('Escape');
    await poll(async () => (await byNumber(1))?.label === 'Close it', { what: 'Esc puts the number back' });
    assert.equal(await byNumber(12), undefined);
    await dbl(g.cx, g.cy);
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    await poll(async () => (await byNumber(7))?.label === 'Close it', { what: 'number 7' });
    for (const bad of ['', '0', 'ab']) { // nothing valid typed: the number it had
      await dbl(g.cx, g.cy);
      await field().fill(bad);
      await page.keyboard.press('Enter');
      assert.equal((await byNumber(7))?.label, 'Close it', JSON.stringify(bad));
    }
    await dbl(g.cx, g.cy);
    await field().fill('1234');
    assert.equal(await field().inputValue(), '123', 'three digits at most');
    await page.keyboard.press('Escape');
    // Enter on a selected marker edits its text
    await tool(page, 'select');
    await click(g.cx, g.cy);
    await page.waitForSelector('#markerProps:not([hidden])');
    await page.keyboard.press('Enter');
    assert.equal(await field().inputValue(), 'Close it');
    await page.keyboard.press('Escape');
    await dbl(g.cx, g.cy);
    await page.keyboard.type('1'); // back to 1 for the next steps
    await page.keyboard.press('Enter');
    await poll(async () => (await byNumber(1))?.label === 'Close it', { what: 'number 1 again' });
    assert.equal((await markers()).length, 2);
  });

  it('two markers can have the same number when it is typed; the next one placed is still the smallest free', async () => {
    const two = await byNumber(2);
    const g = geometry(two);
    await dbl(g.cx, g.cy);
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await poll(async () => (await markers()).every((o) => o.n === 1), { what: 'two markers numbered 1' });
    await dbl(g.cx, g.cy);
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await poll(async () => (await markers()).map((o) => o.n).sort().join() === '1,2', { what: 'back to 1 and 2' });
  });

  it('editing is one step of the history, undone as a whole; leaving the field keeps the text', async () => {
    const one = await byNumber(1);
    const g = geometry(one);
    await dbl(g.textX, g.cy);
    await field().fill('Second text');
    await page.mouse.click(...m.pt(900, 700)); // elsewhere: the field closes and keeps it
    await poll(async () => (await byNumber(1)).label === 'Second text', { what: 'kept' });
    assert.equal(await field().count(), 0);
    await page.keyboard.press('Control+z');
    await poll(async () => (await byNumber(1)).label === 'Close it', { what: 'undo gives the old text back, in one step' });
    await page.keyboard.press('Control+y');
    await poll(async () => (await byNumber(1)).label === 'Second text', { what: 'redo' });
    await page.keyboard.press('Control+z');
    await poll(async () => (await byNumber(1)).label === 'Close it', { what: 'undone again' });
  });

  it('a text is cut at 60 characters, emptied to nothing, and Ctrl+Z in an empty field takes the marker just placed back', async () => {
    const one = await byNumber(1);
    const g = geometry(one);
    await dbl(g.textX, g.cy);
    await field().fill('x'.repeat(80));
    assert.equal((await field().inputValue()).length, 60, 'the field stops at 60 characters');
    await page.keyboard.press('Enter');
    await poll(async () => (await byNumber(1)).label === 'x'.repeat(60), { what: '60 characters saved' });
    await dbl(g.textX, g.cy);
    await field().fill('');
    await page.keyboard.press('Enter');
    await poll(async () => (await byNumber(1)).label === '', { what: 'an empty text is no text' });
    assert.equal((await byNumber(1)).width, 40, 'the box is the disc again');
    assert.equal(geometry(await byNumber(1)).cx, g.cx, 'the disc has not moved');
    await page.keyboard.press('Control+z');
    await poll(async () => (await byNumber(1)).label === 'x'.repeat(60), { what: 'undo' });
    await page.keyboard.press('Control+z');
    await poll(async () => (await byNumber(1)).label === 'Close it', { what: 'undo again' });
    // a marker just placed has an empty field with the focus: Ctrl+Z there takes the marker back
    const count = (await markers()).length;
    await tool(page, 'marker');
    await click(1200, 600);
    await poll(async () => (await markers()).length === count + 1, { what: 'a marker placed' });
    assert.equal(await fieldOpen(), true);
    await page.keyboard.press('Control+z');
    await poll(async () => (await markers()).length === count, { what: 'the marker is taken back' });
    await tool(page, 'select');
  });

  it('the text is on the right of the disc, goes to the left on its own when it would leave the image, and the style bar chooses', async () => {
    assert.equal((await byNumber(1)).side, 'right');
    await tool(page, 'marker');
    await click(1520, 300); // near the right edge of a 1600 px image
    await poll(async () => (await markers()).length === 3, { what: 'a marker near the edge' });
    await page.keyboard.type('Export it from here', { delay: 5 });
    await page.keyboard.press('Enter');
    const near = await poll(async () => { const o = (await markers()).find((x) => x.label === 'Export it from here'); return o?.side === 'left' ? o : null; }, { what: 'the text went to the left on its own' });
    assert.equal(near.sideAuto, true);
    const g = geometry(near);
    assert.ok(Math.abs(g.cx - 1520) <= 2 && Math.abs(g.cy - 300) <= 2, `the disc stayed where it was clicked: ${g.cx}, ${g.cy}`);
    assert.ok(near.left + near.width <= 1600 + 1, 'the whole marker is inside the image');
    await page.keyboard.press('Escape');
    await tool(page, 'select');
    // the style bar: a choice is final, and the disc stays
    await click(g.cx, g.cy);
    await page.waitForSelector('#markerProps:not([hidden])');
    assert.equal(await page.isChecked('#sidePick input[value="left"]'), true, 'the bar shows the side');
    await page.locator('#sidePick label:has(input[value="right"])').click();
    const flipped = await poll(async () => { const o = (await markers()).find((x) => x.label === 'Export it from here'); return o?.side === 'right' ? o : null; }, { what: 'the text on the right' });
    assert.equal(flipped.sideAuto, false, 'a choice is final');
    const g2 = geometry(flipped);
    assert.ok(Math.abs(g2.cx - g.cx) <= 1 && Math.abs(g2.cy - g.cy) <= 1, 'the disc has not moved');
    await page.keyboard.press('Control+z');
    await poll(async () => (await markers()).find((x) => x.label === 'Export it from here')?.side === 'left', { what: 'undone: back on the left' });
    await page.keyboard.press('Control+y');
    await poll(async () => (await markers()).find((x) => x.label === 'Export it from here')?.side === 'right', { what: 'redone' });
    // typing more does not move a text whose side was chosen
    await page.keyboard.press('Enter');
    await page.keyboard.type(' now, please');
    await page.keyboard.press('Enter');
    assert.equal((await markers()).find((x) => x.label.startsWith('Export it'))?.side, 'right', 'it stays where it was put');
    // back to the left for the next test
    await click(g.cx, g.cy);
    await page.locator('#sidePick label:has(input[value="left"])').click();
    await poll(async () => (await markers()).find((x) => x.label.startsWith('Export it'))?.side === 'left', { what: 'left again' });
  });

  it('the export draws the text on the left of the disc, and the grouped export draws the same markers, after a reload too', async () => {
    const o = (await markers()).find((x) => x.label.startsWith('Export it'));
    const g = geometry(o);
    const img = await exported();
    const mid = Math.round(o.left + (o.width - 40) / 2); // the middle of the pill, on the left of the disc
    const colored = (p) => RED.every((v, i) => Math.abs(p[i] - v) <= 12);
    assert.ok(colored(px(img, mid, Math.round(g.cy + 12))) || colored(px(img, mid + 6, Math.round(g.cy - 12))), 'the pill is on the left of the disc');
    assert.ok(!colored(px(img, Math.round(g.cx + 60), Math.round(g.cy))), 'and nothing on the right of the disc');
    const before = await exported();
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    const after = await exported();
    assert.equal(Buffer.compare(after.data, before.data), 0, 'the same pixels after a reload');
    await openBatch(page, [otherId, id]);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const image = await decodePng(page, readZip(file.buf)[1].data);
    assert.equal(Buffer.compare(image.data, after.data), 0, 'the grouped export draws the same markers');
    await closeBatch(page);
  });

  it('no console error over the whole session', () => {
    assert.deepEqual(h.errors, []);
  });
});
