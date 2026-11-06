// The settings dialog in the real extension, in every language and at a narrow width: a choice of a segmented control is ONE line (its row
// wraps instead), nothing sticks out of its pill, and the dialog never scrolls sideways. A French text is longer than the English one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { resetLibrary, seedSettings } from './support/editor.mjs';
import { LANGUAGES } from '../../languages.js';

describe('settings: the close button stays in view', () => {
  let h, page;

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, []);
  });
  after(() => h?.close());

  it('in a short window, scrolled to the bottom, the title and the close button are still at the top of the dialog and a click closes it', async () => {
    await page.goto(h.url('manifest.json'));
    await seedSettings(page, { language: 'en' });
    await page.setViewportSize({ width: 800, height: 420 });
    await page.goto(h.url('library.html#settings'));
    await page.waitForSelector('dialog#settings[open]');
    const reach = await page.evaluate(() => {
      const dialog = /** @type {HTMLElement} */ (document.getElementById('settings'));
      dialog.scrollTop = dialog.scrollHeight;
      return { scrollable: dialog.scrollHeight > dialog.clientHeight + 40, scrolled: dialog.scrollTop > 40 };
    });
    assert.deepEqual(reach, { scrollable: true, scrolled: true }, 'the dialog really scrolls in a short window');
    const where = await page.evaluate(() => {
      const dialog = document.getElementById('settings').getBoundingClientRect();
      const button = document.querySelector('#settings .dlg-head button').getBoundingClientRect();
      return { fromTop: Math.round(button.top - dialog.top), inside: button.bottom <= dialog.bottom && button.top >= dialog.top };
    });
    assert.ok(where.inside && where.fromTop < 24, `the close button sits at the top of the dialog (${where.fromTop} px from it)`);
    await page.click('#settings .dlg-head button');
    await page.waitForFunction(() => !(/** @type {HTMLDialogElement} */ (document.getElementById('settings'))).open);
  });

  it('it opens at the top, and a fade at the bottom says there is more until the end is reached', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
    const state = () => page.evaluate(() => {
      const dialog = /** @type {HTMLElement} */ (document.getElementById('settings'));
      return { top: dialog.scrollTop, fade: getComputedStyle(/** @type {Element} */ (document.getElementById('settingsForm')), '::after').opacity };
    });
    assert.deepEqual(await state(), { top: 0, fade: '1' }, 'at the top there is more below');
    await page.evaluate(() => { const dialog = /** @type {HTMLElement} */ (document.getElementById('settings')); dialog.scrollTop = dialog.scrollHeight; });
    await page.waitForFunction(() => getComputedStyle(/** @type {Element} */ (document.getElementById('settingsForm')), '::after').opacity === '0');
    await page.click('#settings .dlg-head button');
    await page.waitForFunction(() => !(/** @type {HTMLDialogElement} */ (document.getElementById('settings'))).open);
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
    assert.equal((await state()).top, 0, 'reopened at the first section');
    await page.click('#settings .dlg-head button');
  });
});

describe('settings: the support link', () => {
  let h, page;

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, []);
  });
  after(() => h?.close());

  it('is the last block of the settings, points to the support page of kodetix.fr, to open in a new tab, in every language', async () => {
    for (const code of Object.keys(LANGUAGES)) {
      await page.goto(h.url('manifest.json'));
      await seedSettings(page, { language: code });
      await page.goto(h.url('library.html#settings'));
      await page.waitForSelector('dialog#settings[open]');
      const link = await page.evaluate(() => {
        const a = /** @type {HTMLAnchorElement} */ (document.getElementById('supportLink'));
        const sections = [...document.querySelectorAll('#settings [data-section]')];
        return {
          href: a.href, target: a.target, rel: a.rel, text: a.textContent.trim(),
          last: sections.at(-1) === a.closest('section'), title: sections.at(-1).querySelector('h3').textContent.trim(),
        };
      });
      assert.equal(link.href, 'https://kodetix.fr/soutenir', code);
      assert.equal(link.target, '_blank', code);
      assert.match(link.rel, /noopener/, code);
      assert.ok(link.last && link.text.length > 3 && link.title.length > 1, `${code}: the section is last and its texts are there`);
      assert.doesNotMatch(link.text + link.title, /settings\./, `${code}: no key shown instead of a text`);
    }
  });
});

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
