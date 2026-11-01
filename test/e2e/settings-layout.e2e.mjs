// The settings dialog in the real extension, in every language and at a narrow width: a choice of a segmented control is ONE line (its row
// wraps instead), nothing sticks out of its pill, and the dialog never scrolls sideways. A French text is longer than the English one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { resetLibrary, seedSettings } from './support/editor.mjs';
import { LANGUAGES } from '../../languages.js';

describe('settings: the choices keep their shape', () => {
  let h, page;

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, []);
  });
  after(() => h?.close());

  for (const language of Object.keys(LANGUAGES)) {
    for (const width of [1280, 360]) {
      it(`${language}, ${width} px wide: no label of a choice is cut or broken over several lines, no sideways scroll`, async () => {
        await page.goto(h.url('manifest.json'));
        await seedSettings(page, { language });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(h.url('library.html#settings'));
        await page.waitForSelector('dialog#settings[open]');
        await page.waitForFunction((l) => document.documentElement.lang === l, language);
        const report = await page.evaluate(() => {
          const choices = [...document.querySelectorAll('#settings .seg > label > span')].filter((s) => s.textContent.trim());
          const broken = choices.filter((s) => {
            const r = s.getBoundingClientRect();
            return r.height > 32 || s.scrollWidth > s.clientWidth + 1; // one line of 26 px; the text fits in its pill
          }).map((s) => s.textContent.trim());
          const dialog = /** @type {HTMLElement} */ (document.getElementById('settings'));
          const body = /** @type {HTMLElement} */ (document.getElementById('settingsBody'));
          return { count: choices.length, broken, dialogSideways: dialog.scrollWidth > dialog.clientWidth + 1, bodySideways: body.scrollWidth > body.clientWidth + 1 };
        });
        assert.ok(report.count >= 10, `the choices were found (${report.count})`);
        assert.deepEqual(report.broken, [], 'choices cut or broken');
        assert.equal(report.dialogSideways || report.bodySideways, false, 'the dialog scrolls sideways');
        // the long choice of the full-page settings, the one that was broken, is on its own line when it must be, and still on the right otherwise
        const seg = await page.locator('#settings [aria-labelledby="fullPageFixedLabel"]').boundingBox();
        const dialog = await page.locator('#settings').boundingBox();
        assert.ok(seg && dialog && seg.x >= dialog.x && seg.x + seg.width <= dialog.x + dialog.width, 'the choice is inside the dialog');
      });
    }
  }
});
