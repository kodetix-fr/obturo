// The colors of the editor in the real extension: ONE control everywhere (the swatches of the palette and a free color), for the line of
// a rectangle or an arrow, a text and its background, a marker, the highlighter and the solid fill. Choosing a color is enough: the
// background of a text has no box to tick, and "None" takes it away.
// The steps follow one another: each one starts from the state left by the previous one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, drag, mapper, poll, ready, resetLibrary, spec, tool, waitOut } from './support/editor.mjs';

describe('editor: one color control for everything', () => {
  let h, page, m, id;
  const objectsOf = async () => {
    const s = (await dbDump(page)).find((x) => x.id === id);
    return s.versions[s.active]?.objects ?? [];
  };
  const last = async () => (await objectsOf()).at(-1);
  const visible = (selector) => page.locator(selector).isVisible();
  const pick = (group, hex) => page.locator(`#${group} label:has(input[value="${hex}"])`).click();
  const setFree = (selector, hex) => page.evaluate(([sel, value]) => {
    const input = /** @type {HTMLInputElement} */ (document.querySelector(sel));
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, hex]);

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Colors', 1600, 900, false)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    id = (await dbDump(page))[0].id;
    m = await mapper(page, 1600, 900);
  });
  after(() => h?.close());

  it('the line color is the palette and a free color: the next rectangle, and the selected one, follow it', async () => {
    assert.equal(await page.locator('#lineSwatches input').count(), 9, 'the palette');
    assert.equal(await page.isChecked('#lineSwatches input[value="#e53935"]'), true, 'red by default');
    await tool(page, 'rect');
    await pick('lineSwatches', '#2563eb');
    assert.equal(await page.inputValue('#color'), '#2563eb', 'the free color holds the one in use');
    await drag(page, m, 100, 100, 400, 300);
    await poll(async () => (await last())?.stroke === '#2563eb', { what: 'a blue rectangle saved' });
    // the new rectangle is selected: a swatch recolors it, once, as one step of the history
    await pick('lineSwatches', '#43a047');
    await poll(async () => (await last()).stroke === '#43a047', { what: 'the rectangle turns green' });
    assert.equal((await objectsOf()).length, 1, 'recolored, not duplicated');
    await page.keyboard.press('Control+z');
    await poll(async () => (await last()).stroke === '#2563eb', { what: 'undo gives the blue back' });
    await page.keyboard.press('Control+y');
    await poll(async () => (await last()).stroke === '#43a047', { what: 'redo' });
    await tool(page, 'select'); // undo and redo let go of the selection
    await page.mouse.click(...m.pt(250, 200));
    await setFree('#color', '#12ab34');
    await poll(async () => (await last()).stroke === '#12ab34', { what: 'a free color' });
    assert.equal(await page.locator('#lineSwatches input:checked').count(), 0, 'a free color matches no swatch');
  });

  it('an arrow takes the same color; a text has a color and no stroke setting', async () => {
    await tool(page, 'arrow');
    await pick('lineSwatches', '#fb8c00');
    await drag(page, m, 600, 300, 900, 200);
    await poll(async () => (await last())?.type === 'Arrow' && (await last()).stroke === '#fb8c00', { what: 'an orange arrow' });
    assert.equal(await visible('#strokeField'), true, 'an arrow has a stroke');
    await tool(page, 'text');
    assert.equal(await visible('#textProps'), true);
    assert.equal(await visible('#strokeField'), false, 'a text has no stroke');
    const [tx, ty] = m.pt(300, 600);
    await page.mouse.click(tx, ty);
    await page.keyboard.type('Legend', { delay: 8 });
    await pick('lineSwatches', '#ec407a');
    await page.keyboard.press('Escape');
    await poll(async () => { const o = await last(); return o?.type === 'IText' && o.fill === '#ec407a'; }, { what: 'a pink text' });
  });

  it('the background of a text: no box to tick, "None" first, any color, and the next texts follow', async () => {
    const [tx, ty] = m.pt(300, 600);
    await tool(page, 'select');
    await page.mouse.click(tx + 20, ty + 15); // the text
    await page.waitForSelector('#textProps:not([hidden])');
    assert.equal(await page.locator('#bgSwatches input').count(), 10, 'None, then the palette');
    assert.equal(await page.isChecked('#bgSwatches input[value=""]'), true, 'no background yet: None is checked');
    assert.equal(await page.getAttribute('#bgSwatches input[value=""]', 'aria-label'), 'None');
    await pick('bgSwatches', '#ffeb3b');
    await poll(async () => (await last()).backgroundColor === '#ffeb3b', { what: 'yellow background' });
    await setFree('#bgColor', '#112233');
    await poll(async () => (await last()).backgroundColor === '#112233', { what: 'a free color as a background' });
    assert.equal(await page.locator('#bgSwatches input:checked').count(), 0);
    await pick('bgSwatches', '');
    await poll(async () => !(await last()).backgroundColor, { what: 'None takes the background away' });
    // the choice is for the next texts too
    await pick('bgSwatches', '#43a047');
    await page.keyboard.press('Control+z'); // (undoes the selected text's background: the panel keeps the green)
    await tool(page, 'text');
    const [x2, y2] = m.pt(900, 600);
    await page.mouse.click(x2, y2);
    await page.keyboard.type('Second', { delay: 8 });
    await page.keyboard.press('Escape');
    await poll(async () => { const o = await last(); return o?.type === 'IText' && o.text === 'Second' && o.backgroundColor === '#43a047'; }, { what: 'the next text has the green background' });
  });

  it('the highlighter takes any color of the palette or a free one, and never hides what is under it', async () => {
    await tool(page, 'highlight');
    assert.equal(await page.locator('#hlSwatches input').count(), 9);
    await setFree('#hlColor', '#00bcd4');
    await drag(page, m, 1000, 500, 1400, 560);
    await poll(async () => (await last())?.type === 'Highlight' && (await last()).fill === '#00bcd4', { what: 'a free-color highlighter' });
    assert.equal((await last()).opacity, 0.6, 'never fully opaque');
  });

  it('the colors are remembered for the next session', async () => {
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    assert.equal(await page.inputValue('#color'), '#ec407a', 'line color');
    assert.equal(await page.inputValue('#hlColor'), '#00bcd4', 'highlighter');
    assert.equal(await page.isChecked('#bgSwatches input[value="#43a047"]'), true, 'text background');
  });

  it('no console error over the whole session', async () => {
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), []);
  });
});
