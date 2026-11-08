// The stamp (the address of the page and the date of the capture, as a text), the ends of an arrow (arrow, line, double arrow), the pen
// (freehand) and the emoji, in the real extension. The steps follow one another: each one starts from the state the previous one left.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, drag, mapper, poll, px, ready, resetLibrary, sleep, spec, stageUnderBar, tool, waitOut } from './support/editor.mjs';

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
      const img = await decodePng(page, await stageUnderBar(page));
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 120 && img.data[i + 1] < 120 && img.data[i + 2] < 120) n++;
      return n;
    };
    assert.equal(await darkPixels(), 0, 'nothing dark on the stage before the stamp');
    await page.click('#stamp');
    await poll(async () => (await darkPixels()) > 200, { what: 'the text of the stamp on the stage' });
    const shot = (await dbDump(page))[0];
    const stamp = shot.versions[shot.active].objects.find((o) => o.stamp);
    assert.match(stamp.text, /^example\.test\/t {2}\| /, 'with Hide sensitive text off the address still leaves its query out');
  });
});

describe('editor: the stamp with an address that carries secrets', () => {
  let h, page;
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [{ ...spec('Query', 1600, 900, false), url: 'https://example.test/t?token=abc&email=jane@example.test' }], undefined, { language: 'en', theme: 'auto', redactSensitive: true });
    await ready(page);
    await waitOut(page, 1600, 900);
  });
  after(() => h?.close());

  it('keeps the query of the address out of the image, with the setting on or off', async () => {
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
      if (w >= 820) assert.equal(new Set(r.tops).size, 1, `Beautify, Stamp and Rotate share a row at ${w}: ${r.tops}`);
    }
  });
});

describe('editor: the stamp on a wide capture seen at its real size', () => {
  let h, page;
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [spec('Wide', 6000, 600, false)]);
    await ready(page);
    await waitOut(page, 6000, 600);
  });
  after(() => h?.close());

  it('the stamp is brought into view when the view shows another part of the image', async () => {
    const darkPixels = async () => {
      const img = await decodePng(page, await stageUnderBar(page));
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 120 && img.data[i + 1] < 120 && img.data[i + 2] < 120) n++;
      return n;
    };
    await page.click('#actual');
    await sleep(300);
    assert.equal(await darkPixels(), 0, 'nothing dark on the stage before the stamp');
    await page.click('#stamp');
    await poll(async () => (await darkPixels()) > 200, { what: 'the text of the stamp on the stage' });
  });
});

describe('editor: one mode, one pressed tool', () => {
  let h, page;
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [spec('Modes', 1600, 900, false)]);
    await ready(page);
    await waitOut(page, 1600, 900);
  });
  after(() => h?.close());

  it('during a crop only Crop is pressed, and the tool that was armed comes back after it', async () => {
    const pressed = () => page.locator('.rail .tool[aria-pressed="true"]').evaluateAll((els) => els.map((el) => el.dataset.tool ?? el.id));
    await tool(page, 'arrow');
    assert.deepEqual(await pressed(), ['arrow']);
    await page.click('#crop');
    assert.deepEqual(await pressed(), ['crop'], 'the crop is the mode');
    await page.click('#cropCancel');
    assert.deepEqual(await pressed(), ['select'], 'back on Select, the crop released');
  });

  it('the keyboard walks the app bar left to right, then the tools', async () => {
    const order = await page.evaluate(() => ['importBtn', 'historyBtn', 'settingsBtn'].map((id) => [id, document.getElementById(id).getBoundingClientRect().left]).sort((a, b) => Number(a[1]) - Number(b[1])).map((x) => x[0]));
    const dom = await page.evaluate(() => [...document.querySelectorAll('#importBtn, #historyBtn, #settingsBtn')].map((el) => el.id));
    assert.deepEqual(dom, order, 'the DOM order is the left to right order');
    const stops = await page.evaluate(() => {
      const ids = ['versions', 'newVersion', 'pin', 'copy', 'download', 'downloadMenu', 'importBtn', 'historyBtn', 'settingsBtn'];
      const all = [...document.querySelectorAll('button')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      const at = (el) => all.indexOf(el);
      const pill = document.querySelector('#versions button') ?? document.getElementById('newVersion');
      return { ids: ids.map((id) => at(id === 'versions' ? pill : document.getElementById(id))), tool: at(document.querySelector('.rail .tool[aria-pressed="true"]')) };
    });
    assert.ok(stops.ids.every((n, i) => n >= 0 && (i === 0 || n > stops.ids[i - 1])), `the stops follow the bar: ${stops.ids}`);
    assert.ok(stops.tool > stops.ids.at(-1), 'the first tool comes after Settings');
  });
});

describe('editor: the style bar floats, the output bar holds the output', () => {
  let h, page, m;
  const W = 1600, H = 900;
  const pageErrors = () => h.errors.filter((e) => e.startsWith('[pageerror]'));
  const visible = (selector) => page.locator(selector).isVisible();
  const size = async (w, hh) => {
    await page.setViewportSize({ width: w, height: hh });
    await poll(async () => (await page.evaluate(() => innerWidth)) === w && (await page.evaluate(() => innerHeight)) === hh, { what: 'the window size' });
    await sleep(120);
  };

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [spec('Bars', W, H, false)]);
    await ready(page);
    await waitOut(page, W, H);
    m = await mapper(page, W, H);
  });
  after(() => h?.close());

  it('the stage keeps its place and its size whatever the tool, at 820 and 480 px wide', async () => {
    for (const [w, hh] of [[820, 900], [480, 900]]) {
      await size(w, hh);
      const stages = new Set();
      for (const name of ['select', 'arrow', 'rect', 'pen', 'marker', 'text', 'emoji', 'highlight', 'spot', 'flat', 'pixel', 'blur']) {
        await tool(page, name);
        const box = await page.locator('#stage').boundingBox();
        stages.add(`${Math.round(box.y)}:${Math.round(box.height)}`);
      }
      assert.equal(stages.size, 1, `one stage top and height at ${w} px, got ${[...stages]}`);
    }
    await size(1500, 900);
    await tool(page, 'select');
    m = await mapper(page, W, H);
  });

  it('the style bar lies over the stage and the picture is worked out under it', async () => {
    const r = await page.evaluate(() => {
      const bar = document.getElementById('props').getBoundingClientRect();
      const stage = document.getElementById('stage').getBoundingClientRect();
      return { barTop: bar.top, stageTop: stage.top, barBottom: bar.bottom, over: document.elementFromPoint(bar.x + 40, bar.bottom - 4)?.closest('#props') !== null };
    });
    assert.equal(r.barTop, r.stageTop, 'the bar starts where the stage starts');
    assert.ok(r.over, 'a click at the bottom of the bar reaches the bar, not the picture');
  });

  it('the output size is a button that opens the Download menu, where the scale and the width are', async () => {
    assert.equal(await visible('#scalePct'), false, 'no field in the bar');
    assert.equal(await page.locator('.status input').count(), 0, 'the bar has no field');
    await page.click('#outBtn');
    await page.waitForSelector('#dlPop:not([hidden])');
    assert.equal(await page.inputValue('#scalePct'), '100');
    assert.equal(await page.inputValue('#scaleW'), String(W));
    await page.fill('#scaleW', '800');
    await page.press('#scaleW', 'Tab');
    await waitOut(page, 800, 450);
    assert.equal(await page.inputValue('#scalePct'), '50', 'the scale follows the width');
    await page.fill('#scalePct', '100');
    await page.press('#scalePct', 'Enter');
    await waitOut(page, W, H);
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('#downloadMenu', 'aria-expanded'), 'false');
  });

  it('Remove crop is only there when there is a crop', async () => {
    assert.equal(await visible('#cropClear'), false, 'no crop, no button');
    await page.click('#crop');
    await drag(page, m, 200, 200, 1000, 700);
    await page.click('#cropOk');
    await page.waitForSelector('#cropClear', { state: 'visible' });
    await page.click('#cropClear');
    await page.waitForSelector('#cropClear', { state: 'hidden' });
    await waitOut(page, W, H);
  });

  it('the image buttons come first, the output and the zoom after, and the zoom shows what applies', async () => {
    const lefts = await page.evaluate(() => ['beautify', 'stamp', 'rotate', 'outBtn', 'fit'].map((id) => document.getElementById(id).getBoundingClientRect().left));
    assert.deepEqual([...lefts].sort((a, b) => a - b), lefts, `left to right: ${lefts}`);
    const state = async () => ({ fit: await page.getAttribute('#fit', 'aria-pressed'), actual: await page.getAttribute('#actual', 'aria-pressed'), label: await visible('#zoomLabel') });
    assert.deepEqual(await state(), { fit: 'true', actual: 'false', label: true }, 'fitted: Fit applies, the percentage is shown');
    await page.click('#actual');
    assert.deepEqual(await state(), { fit: 'false', actual: 'true', label: false }, 'actual size: 100 % applies and is not said twice');
    await page.keyboard.down('Control');
    await page.mouse.move(...m.pt(800, 450));
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await poll(async () => (await state()).label, { what: 'a zoom of its own shows its percentage' });
    assert.deepEqual(await state(), { fit: 'false', actual: 'false', label: true });
    await page.click('#fit');
    assert.equal((await state()).fit, 'true');
    assert.deepEqual(pageErrors(), [], 'no error on the page');
  });
});
