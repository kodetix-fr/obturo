// The column of tools of the editor, in the real extension: they are in groups by what they are for (choose, annotate, put in evidence, hide),
// each group apart from the next one, and Crop is apart from all of them. The order is part of how the editor is learned: a test keeps it.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { ready, resetLibrary, spec } from './support/editor.mjs';

describe('editor: the order of the tools', () => {
  let h, page;

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [spec('Rail', 800, 600, false)]);
    await ready(page);
  });
  after(() => h?.close());

  it('select | arrow, outline, marker, text | highlighter, spotlight | solid fill, pixelate, blur, then crop on its own', async () => {
    const column = await page.evaluate(() => [...document.querySelectorAll('.rail #tools > *, .rail > .rail-sep, .rail > #crop')]
      .map((el) => (el.classList.contains('rail-sep') ? '|' : /** @type {HTMLElement} */ (el).dataset.tool ?? el.id)));
    assert.deepEqual(column, ['select', '|', 'arrow', 'rect', 'marker', 'text', '|', 'highlight', 'spot', '|', 'flat', 'pixel', 'blur', '|', 'crop']);
  });

  it('every tool has its label and its tooltip, and the order on screen is the order in the page', async () => {
    const tools = await page.locator('.rail .tool').evaluateAll((els) => els.map((el) => ({ label: el.querySelector('.lbl')?.textContent, title: el.getAttribute('title') })));
    assert.equal(tools.length, 11);
    assert.ok(tools.every((t) => t.label && t.title), JSON.stringify(tools));
    const tops = await page.locator('.rail .tool').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    assert.deepEqual([...tops].sort((a, b) => a - b), tops, 'from top to bottom, in the order of the page');
  });
});
