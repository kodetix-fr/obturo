// The stamp (the address of the page and the date of the capture, as a text), the ends of an arrow (arrow, line, double arrow), the pen
// (freehand) and the emoji, in the real extension. The steps follow one another: each one starts from the state the previous one left.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, drag, mapper, poll, px, ready, resetLibrary, sleep, spec, tool, waitOut } from './support/editor.mjs';

describe('editor: stamp, arrow ends, pen, emoji', () => {
  let h, page, m, id;
  const W = 1600, H = 900;
  const objectsOf = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return s.versions[s.active]?.objects ?? [];
  };
  const last = async () => (await objectsOf()).at(-1);
  const visible = (selector) => page.locator(selector).isVisible();
  const pageErrors = () => h.errors.filter((e) => e.startsWith('[pageerror]'));

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Tools', W, H, false)]);
    await ready(page);
    await waitOut(page, W, H);
    id = (await dbDump(page))[0].id;
    m = await mapper(page, W, H);
  });
  after(() => h?.close());

  it('an arrow has a head at the end by default; the ends choice turns it into a line, and the selected one into a double arrow', async () => {
    await tool(page, 'arrow');
    assert.equal(await visible('#endProps'), true, 'the ends are chosen with the arrow tool');
    assert.equal(await page.isChecked('#endsPick input[value="end"]'), true, 'a head at the end by default');
    await drag(page, m, 100, 100, 400, 100);
    await poll(async () => (await last())?.type === 'Arrow' && (await last()).ends === 'end', { what: 'an arrow with a head at the end' });
    await page.locator('#endsPick label:has(input[value="none"])').click();
    await drag(page, m, 100, 200, 400, 260);
    await poll(async () => (await last())?.ends === 'none', { what: 'a plain line' });
    assert.equal((await objectsOf()).length, 2);
    await tool(page, 'select');
    await page.mouse.click(...m.pt(250, 230));
    assert.equal(await page.isChecked('#endsPick input[value="none"]'), true, 'the selected line shows its ends');
    await page.locator('#endsPick label:has(input[value="both"])').click();
    await poll(async () => (await last()).ends === 'both', { what: 'the line becomes a double arrow' });
    assert.equal((await objectsOf()).length, 2, 'changed, not duplicated');
    await page.keyboard.press('Control+z');
    await poll(async () => (await last()).ends === 'none', { what: 'undo gives the line back' });
    await tool(page, 'rect');
    assert.equal(await visible('#endProps'), false, 'no ends for a rectangle');
  });

  it('the pen draws a freehand stroke with the color and the stroke of the style bar, and it stays after the tool is left', async () => {
    await tool(page, 'pen');
    assert.equal(await visible('#lineProps'), true, 'color and stroke');
    await page.locator('#lineSwatches label:has(input[value="#2563eb"])').click();
    const before = (await objectsOf()).length;
    const [x0, y0] = m.pt(600, 500);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) await page.mouse.move(x0 + i * 9, y0 + Math.sin(i / 3) * 40);
    await page.mouse.up();
    await poll(async () => (await objectsOf()).length === before + 1 && (await last()).type === 'Path', { what: 'a stroke saved as a Path' });
    const stroke = await last();
    assert.equal(stroke.stroke, '#2563eb');
    assert.ok(stroke.strokeWidth >= 3, `a visible stroke: ${stroke.strokeWidth}`);
    assert.equal(stroke.strokeUniform, true, 'the width does not stretch with the size');
    assert.equal(stroke.fill, null, 'a stroke, not an area');
    await page.keyboard.press('Control+z');
    await poll(async () => (await objectsOf()).length === before, { what: 'undo takes the stroke away' });
    await page.keyboard.press('Control+y');
    await poll(async () => (await last()).type === 'Path', { what: 'redo gives it back' });
    await tool(page, 'select');
    await page.mouse.click(...m.pt(700, 500));
    await page.locator('#lineSwatches label:has(input[value="#43a047"])').click();
    await poll(async () => (await last()).stroke === '#43a047', { what: 'a selected stroke takes the color of the style bar' });
    assert.deepEqual(pageErrors(), [], 'no error on the page');
  });

  it('an emoji is placed with a click, picked in the style bar, never typed into, and changed once selected', async () => {
    const stageHeight = () => page.locator('#stage').evaluate((el) => el.clientHeight);
    const before = await stageHeight();
    await tool(page, 'emoji');
    assert.equal(await visible('#emojiProps'), true);
    assert.equal(await stageHeight(), before, 'the style bar keeps its height: the image does not jump when the tool is picked');
    assert.equal(await visible('#lineProps'), false, 'an emoji has no color or stroke');
    assert.equal(await page.locator('#emojiPick input').count(), 20);
    const glyphs = await page.locator('#emojiPick input').evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value));
    await page.locator('#emojiPick label').nth(7).click();
    await page.mouse.click(...m.pt(1200, 200));
    await poll(async () => (await last())?.type === 'Emoji' && (await last()).text === glyphs[7], { what: 'the emoji picked is placed' });
    const placed = await last();
    assert.ok(placed.fontSize >= 12 && placed.left < 1200 && placed.left + placed.width > 1200, 'centered on the click');
    await page.mouse.click(...m.pt(1400, 200)); // the tool stays armed
    await poll(async () => (await objectsOf()).filter((o) => o.type === 'Emoji').length === 2, { what: 'a second emoji' });
    await tool(page, 'select');
    await page.mouse.click(...m.pt(1200, 200));
    assert.equal(await page.isChecked(`#emojiPick label:nth-child(8) input`), true, 'the selected emoji is the one checked');
    assert.equal(await visible('#textProps'), false, 'no text settings for an emoji');
    await page.locator('#emojiPick label').nth(2).click();
    await poll(async () => (await objectsOf()).some((o) => o.type === 'Emoji' && o.text === glyphs[2]), { what: 'the selected emoji changes' });
    assert.equal((await objectsOf()).filter((o) => o.type === 'Emoji').length, 2, 'changed, not duplicated');
  });

  it('the stamp adds the address and the date as a selected text at the bottom left, and it is in the exported image', async () => {
    await page.keyboard.press('Escape');
    const before = (await objectsOf()).length;
    await page.click('#stamp');
    await poll(async () => (await objectsOf()).length === before + 1, { what: 'a stamp saved' });
    const stamp = await last();
    assert.equal(stamp.type, 'IText');
    assert.match(stamp.text, /^example\.test\/Tools {2}\| {2}.*20\d\d/, `the address, then the date: ${stamp.text}`);
    assert.ok(stamp.left < W / 10 && stamp.top + stamp.height > H * 0.9 && stamp.top + stamp.height < H, `at the bottom left: ${stamp.left}, ${stamp.top}`);
    assert.ok(stamp.left + stamp.width * (stamp.scaleX ?? 1) < W, 'inside the image');
    assert.equal(stamp.backgroundColor, '#ffffff', 'readable on any page');
    assert.equal(await visible('#textProps'), true, 'it is a text: the text settings follow it');
    const { buf } = await download(page);
    const img = await decodePng(page, buf);
    assert.deepEqual(px(img, Math.round(stamp.left) + 1, Math.round(stamp.top) + 1).slice(0, 3), [255, 255, 255], 'its white box is in the image');
    await tool(page, 'select'); // the export let go of the selection
    await page.mouse.click(...m.pt(stamp.left + 10, stamp.top + stamp.height / 2));
    await page.keyboard.press('Delete');
    await poll(async () => (await objectsOf()).length === before, { what: 'a stamp is deleted like any text' });
    await page.keyboard.press('Control+z');
    await poll(async () => (await last()).type === 'IText', { what: 'and undone like any text' });
    const count = (await objectsOf()).length;
    await page.click('#stamp');
    await page.click('#stamp');
    await sleep(400);
    assert.equal((await objectsOf()).length, count, 'a second press selects the stamp, it does not add another');
    assert.match((await last()).text, /^example\.test\/Tools/, 'still the one stamp');
  });

  it('after a reload every kind comes back as what it was: the ends of the line, the emoji, the stroke, the stamp', async () => {
    const count = (await objectsOf()).length;
    await page.reload();
    await ready(page);
    await waitOut(page, W, H);
    m = await mapper(page, W, H);
    assert.equal((await objectsOf()).length, count);
    await tool(page, 'select');
    await page.mouse.click(...m.pt(250, 230));
    assert.equal(await visible('#endProps'), true, 'the line is an arrow with ends');
    assert.equal(await page.isChecked('#endsPick input[value="none"]'), true, 'and still a plain line');
    await page.mouse.click(...m.pt(1200, 200));
    assert.equal(await visible('#emojiProps'), true, 'the emoji is still an emoji');
    await page.mouse.click(...m.pt(700, 500));
    assert.equal(await visible('#endProps'), false, 'a stroke has no ends');
    assert.equal(await page.isChecked('#lineSwatches input[value="#43a047"]'), true, 'and its color');
    assert.deepEqual(pageErrors(), [], 'no error on the page');
  });
});

describe('editor: the stamp on a very tall capture', () => {
  let h, page;
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [{ ...spec('Tall', 800, 6000, false), url: 'https://example.test/t?token=abc' }]);
    await ready(page);
    await waitOut(page, 800, 6000);
  });
  after(() => h?.close());

  it('the stamp is brought into view, not left thousands of pixels below it', async () => {
    const darkPixels = async () => {
      const img = await decodePng(page, await page.locator('#stage').screenshot());
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 120 && img.data[i + 1] < 120 && img.data[i + 2] < 120) n++;
      return n;
    };
    assert.equal(await darkPixels(), 0, 'nothing dark on the stage before the stamp');
    await page.click('#stamp');
    await poll(async () => (await darkPixels()) > 200, { what: 'the text of the stamp on the stage' });
    const shot = (await dbDump(page))[0];
    const stamp = shot.versions[shot.active].objects.find((o) => o.stamp);
    assert.match(stamp.text, /^example\.test\/t\?token=abc {2}\| /, 'with Hide sensitive text off the address keeps its query');
  });
});

describe('editor: the stamp with Hide sensitive text on', () => {
  let h, page;
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [{ ...spec('Query', 1600, 900, false), url: 'https://example.test/t?token=abc&email=jane@example.test' }], undefined, { language: 'en', theme: 'auto', redactSensitive: true });
    await ready(page);
    await waitOut(page, 1600, 900);
  });
  after(() => h?.close());

  it('keeps the query of the address out of the image', async () => {
    await page.click('#stamp');
    const stamp = await poll(async () => {
      const shot = (await dbDump(page))[0];
      return shot.versions[shot.active]?.objects.find((o) => o.stamp);
    }, { what: 'a stamp saved' });
    assert.match(stamp.text, /^example\.test\/t {2}\| /, `the path only: ${stamp.text}`);
    assert.ok(!/token|jane|\?/.test(stamp.text), 'no token, no e-mail');
  });
});

describe('editor: the new controls in a narrow window', () => {
  let h, page;
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [spec('Narrow', 1600, 900, false)]);
    await ready(page);
    await waitOut(page, 1600, 900);
  });
  after(() => h?.close());

  it('the emoji row stays inside the window and the image buttons stay together', async () => {
    for (const [w, hh] of [[480, 900], [820, 900], [1100, 900]]) {
      await page.setViewportSize({ width: w, height: hh });
      await poll(async () => (await page.evaluate(() => innerWidth)) === w, { what: 'the window size' });
      await tool(page, 'emoji');
      const r = await page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        const last = document.querySelector('#emojiPick label:last-child').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth, last: last.right, inner: innerWidth, tops: ['beautify', 'stamp', 'rotate'].map((id) => Math.round(box(id).top)) };
      });
      assert.ok(r.overflow <= 0, `the page does not scroll sideways at ${w}: ${r.overflow}`);
      assert.ok(r.last <= r.inner, `the last emoji is inside the window at ${w}: ${r.last}`);
      assert.equal(new Set(r.tops).size, 1, `Beautify, Stamp and Rotate share a row at ${w}: ${r.tops}`);
    }
  });
});
