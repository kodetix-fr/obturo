// The About section of the settings, the dot that says there are news, and the one request for a review, in the real extension. The state
// (the last version whose news were seen, the captures counted) is the one the service worker and the pages share; the tests write it the
// way the code does, through about.js and settings.js. A real popup cannot be opened in a test: popup.html is loaded as a page.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchExtension } from './support/browser.mjs';
import { resetLibrary } from './support/editor.mjs';
import { quota, startSite, tabActive, tabOf, until } from './support/capture.mjs';
import { LINKS, REVIEW_STEP } from '../../about-pure.js';
import { LANGUAGES } from '../../languages.js';
import enUi from '../../locales/en.ui.js';
import enPopup from '../../locales/en.popup.js';

const VERSION = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')).version;
const [MAJOR, MINOR] = VERSION.split('.');
const START = { seen: VERSION, captures: 0, asked: 0, next: REVIEW_STEP };

describe('about: the news dot, the About section, the request for a review', () => {
  let h, bench, library;

  /** The state as the extension keeps it. */
  const notice = () => bench.evaluate(async () => (await import(`${location.origin}/about.js`)).readNotice());
  /** Replaces the state; `update` is what the extension does when it is installed or updated (about.js noteInstalled). */
  const put = (n) => bench.evaluate(async (n) => { const { updateKv } = await import(`${location.origin}/settings.js`); await updateKv('about', () => n); }, n);
  const installed = (details) => bench.evaluate(async (d) => (await import(`${location.origin}/about.js`)).noteInstalled(d), details);

  const dotShown = () => library.evaluate(() => !document.getElementById('settingsDot').hidden);
  /** The library, started again from the state in the database (the dot is read after the first paint). */
  const openLibrary = async () => {
    await resetLibrary(library, h, []);
    await library.waitForSelector('#settingsBtn');
  };

  /** popup.html as a page: no window to close, a tab that is only recorded. `order`: receives the marks of the popup and the files it asks for, in the order they happen. */
  async function openPopup(order) {
    const page = await h.context.newPage();
    if (order) {
      page.on('console', (m) => { if (m.text().startsWith('[mark] ')) order.push(m.text().slice(7)); });
      page.on('request', (r) => order.push(r.url().split('/').pop()));
      await page.addInitScript(() => {
        const mark = performance.mark.bind(performance);
        performance.mark = (name, options) => { console.debug(`[mark] ${name}`); return mark(name, options); };
      });
    }
    await page.addInitScript(() => {
      window.__created = [];
      window.close = () => {};
      Object.assign(chrome.tabs, { create: async (/** @type {{ url: string }} */ o) => { window.__created.push(o.url); } });
    });
    await page.goto(h.url('popup.html'));
    await page.waitForFunction(() => performance.getEntriesByName('obturo:popup-notice').length > 0); // the dot and the request are in, or not
    return page;
  }
  const settingsRow = (popup) => popup.evaluate(() => {
    const row = document.querySelector('[data-id="open-settings"]');
    return { aria: row?.getAttribute('aria-label'), dot: !!row?.querySelector('.dot') };
  });
  const askBox = (popup) => popup.evaluate(() => {
    const box = document.getElementById('ask');
    return box && {
      text: box.querySelector('.ask-review span')?.textContent, buttons: [...box.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent),
      label: box.getAttribute('aria-label'), inMenu: !!box.closest('#menu'), linksHidden: /** @type {HTMLElement} */ (document.getElementById('links')).hidden,
    };
  });

  before(async () => {
    h = await launchExtension({ instrumented: false, lang: 'en-US' });
    bench = await h.context.newPage();
    await bench.goto(h.url('manifest.json'));
    library = await h.context.newPage();
  });
  after(() => h?.close());

  it('a first install has nothing new: the state starts at this version, no dot in the library or the popup, no request', async () => {
    const first = await until(async () => { const n = await notice(); return n.seen ? n : null; }, 'the worker notes the install');
    assert.deepEqual(first, START);
    await openLibrary();
    await library.waitForFunction(() => performance.getEntriesByName('obturo:strip-rendered').length > 0);
    await library.waitForTimeout(300);
    assert.equal(await dotShown(), false, 'no dot in the library');
    const popup = await openPopup();
    assert.deepEqual(await settingsRow(popup), { aria: 'Settings', dot: false });
    assert.equal(await askBox(popup), null, 'no request');
    await popup.close();
  });

  it('after an update to a new minor release the settings button has a dot, the popup row too; after a patch update neither', async () => {
    await put({});
    await installed({ reason: 'update', previousVersion: '0.1.0' });
    assert.equal((await notice()).seen, '0.1.0', 'an update that kept no state starts from the version it came from');
    await openLibrary();
    await library.waitForSelector('#settingsDot:not([hidden])');
    assert.equal(await library.getAttribute('#settingsBtn', 'aria-describedby'), 'settingsNew', 'the dot is described to a screen reader');
    assert.equal(await library.getAttribute('#settingsBtn', 'title'), 'Settings, New', 'the tip says there is news');
    assert.equal(await library.evaluate(() => document.getElementById('settingsNew').textContent), 'New');
    const popup = await openPopup();
    assert.deepEqual(await settingsRow(popup), { aria: 'Settings, New', dot: true });
    await popup.close();

    await put({});
    await installed({ reason: 'update', previousVersion: `${MAJOR}.${MINOR}.0` });
    await openLibrary();
    await library.waitForFunction(() => performance.getEntriesByName('obturo:strip-rendered').length > 0);
    await library.waitForTimeout(300);
    assert.equal(await dotShown(), false, 'a patch update: no dot');
    const patched = await openPopup();
    assert.deepEqual(await settingsRow(patched), { aria: 'Settings', dot: false });
    await patched.close();
  });

  it('the dot opens the settings on the About section, which shows the version and the news; once seen, the dot is gone everywhere and stays gone', async () => {
    await put({ ...START, seen: '0.1.0' });
    await library.setViewportSize({ width: 800, height: 420 });
    await openLibrary();
    await library.waitForSelector('#settingsDot:not([hidden])');
    await library.click('#settingsBtn');
    await library.waitForSelector('dialog#settings[open]');
    await library.waitForSelector('#settingsDot[hidden]', { state: 'attached' });
    const where = await library.evaluate(() => {
      const dialog = document.getElementById('settings').getBoundingClientRect();
      const about = document.getElementById('aboutSection').getBoundingClientRect();
      return { scrolled: document.getElementById('settings').scrollTop > 0, visible: about.top < dialog.bottom - 40 && about.bottom > dialog.top + 100 };
    });
    assert.deepEqual(where, { scrolled: true, visible: true }, 'with news, the dialog opens on the About section');
    const about = await library.evaluate(() => ({
      version: document.getElementById('aboutVersion').textContent, news: document.getElementById('aboutNews').hidden ? null : document.querySelector('#aboutNews p').textContent,
      newsTitle: document.querySelector('#aboutNews h4').textContent,
    }));
    assert.equal(about.version, `Version ${VERSION}`);
    assert.equal(about.newsTitle, enUi['about.newsTitle']);
    assert.equal(about.news, enUi['about.news']);
    await until(async () => (await notice()).seen === VERSION, 'the news are marked as seen');
    assert.equal(await library.getAttribute('#settingsBtn', 'aria-describedby'), null);
    assert.equal(await library.getAttribute('#settingsBtn', 'title'), 'Settings', 'the tip is the plain one again');
    const popup = await openPopup();
    assert.deepEqual(await settingsRow(popup), { aria: 'Settings', dot: false }, 'the popup follows');
    await popup.close();
    await openLibrary();
    await library.waitForTimeout(300);
    assert.equal(await dotShown(), false, 'and it stays gone after a reload');
    await library.setViewportSize({ width: 1500, height: 900 });
  });

  it('the About section holds the honest sentence and three links that open in a new tab: the store reviews, the issues, Oblitero; nothing about a private tool', async () => {
    await put(START);
    await openLibrary();
    await library.click('#settingsBtn');
    await library.waitForSelector('dialog#settings[open]');
    const section = await library.evaluate(() => {
      const link = (id) => { const a = /** @type {HTMLAnchorElement} */ (document.getElementById(id)); return { href: a.href, target: a.target, rel: a.rel, text: a.textContent.trim() }; };
      return {
        review: link('reviewLink'), issues: link('issuesLink'), oblitero: link('obliteroLink'), support: link('supportLink'),
        text: document.getElementById('aboutSection').textContent, last: [...document.querySelectorAll('#settings [data-section]')].at(-1)?.id,
      };
    });
    assert.equal(section.review.href, LINKS.reviews);
    assert.equal(section.issues.href, LINKS.issues);
    assert.equal(section.oblitero.href, LINKS.oblitero);
    for (const l of [section.review, section.issues, section.oblitero]) {
      assert.equal(l.target, '_blank');
      assert.match(l.rel, /noopener/);
      assert.ok(l.text.length > 3, 'the link says what it is');
    }
    assert.equal(section.review.text, enUi['about.review']);
    assert.equal(section.issues.text, enUi['about.problem']);
    assert.equal(section.support.href, 'https://kodetix.fr/soutenir', 'the support link is still there');
    assert.equal(section.last, 'aboutSection', 'the About section is the last one');
    assert.match(section.text, /free, open source \(MIT\) and nothing leaves your computer/);
    assert.match(section.text, /A review helps other people find it/);
    assert.doesNotMatch(section.text, /Decurto|train|feed/i, 'it promises no use of the reviews');
    assert.equal(await library.evaluate(() => document.getElementById('aboutNews').hidden), false, 'the news of this release are there to read');
    await library.click('#settings .dlg-head button');
  });

  it('the request is not there before the count is reached, and not in the first paint of the popup', async () => {
    await put({ ...START, captures: REVIEW_STEP - 1 });
    const early = await openPopup();
    assert.equal(await askBox(early), null);
    assert.equal((await notice()).asked, 0, 'nothing written when it is not the time');
    await early.close();

    await put({ ...START, captures: REVIEW_STEP });
    const order = [];
    const popup = await openPopup(order);
    const painted = order.indexOf('obturo:popup-painted');
    const files = ['popup-notice.js', 'about.js', 'about-pure.js', 'settings.js'];
    assert.ok(painted > 0 && order.includes('popup.js'), `the order was recorded: ${order.join(', ')}`);
    assert.deepEqual(files.filter((f) => !order.includes(f)), [], 'the files of the notice are loaded');
    assert.deepEqual(files.filter((f) => order.indexOf(f) < painted), [], `none of them before the first paint: ${order.join(', ')}`);
    await popup.close();
  });

  it('at the count the popup asks, with the same words for everyone, in one row that takes the place of the two links; the request is out of the list of actions', async () => {
    await put({ ...START, captures: REVIEW_STEP });
    const popup = await openPopup();
    const box = await askBox(popup);
    assert.deepEqual(box, {
      text: enPopup['popup.ask.row'], label: enPopup['popup.ask.label'], inMenu: false, linksHidden: true,
      buttons: [enPopup['popup.ask.row'], enPopup['popup.ask.never']],
    });
    assert.equal(await popup.locator('[role=menuitem]').count(), 11, 'the actions are the same');
    assert.doesNotMatch(box.text, /\bstars?\b|reward|discount|prize/i, 'no star count asked, nothing offered');
    assert.deepEqual(await notice(), { ...START, captures: REVIEW_STEP, asked: 1, next: 2 * REVIEW_STEP }, 'shown once: it comes back after REVIEW_STEP more captures');
    await popup.close();
    const again = await openPopup();
    assert.equal(await askBox(again), null, 'a popup opened again without an answer does not ask again');
    await again.close();
  });

  it('ignored, the request comes back once after REVIEW_STEP more captures, and then never', async () => {
    await put({ ...START, captures: 2 * REVIEW_STEP - 1, asked: 1, next: 2 * REVIEW_STEP });
    const early = await openPopup();
    assert.equal(await askBox(early), null);
    await early.close();
    await put({ ...START, captures: 2 * REVIEW_STEP, asked: 1, next: 2 * REVIEW_STEP });
    const second = await openPopup();
    assert.notEqual(await askBox(second), null, 'the second request');
    assert.deepEqual(await notice(), { ...START, captures: 2 * REVIEW_STEP, asked: 2, next: null });
    await second.close();
    await put({ ...START, captures: 10_000, asked: 2, next: null });
    const never = await openPopup();
    assert.equal(await askBox(never), null, 'never a third');
    await never.close();
  });

  it('"Give a review" opens the reviews page and the request never returns', async () => {
    await put({ ...START, captures: REVIEW_STEP });
    const popup = await openPopup();
    await popup.click('#ask .ask-review');
    await until(() => popup.evaluate(() => window.__created.length), 'a tab is opened');
    assert.deepEqual(await popup.evaluate(() => window.__created), [LINKS.reviews]);
    assert.equal((await notice()).next, null);
    await popup.close();
    await put({ ...(await notice()), captures: 10_000 });
    const after = await openPopup();
    assert.equal(await askBox(after), null);
    await after.close();
  });

  it('the cross takes the request away for good and gives the two links back; closing the popup is "later"', async () => {
    await put({ ...START, captures: REVIEW_STEP });
    const no = await openPopup();
    await no.click('#ask .ask-never');
    await no.waitForSelector('#ask', { state: 'detached' });
    assert.equal(await no.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('links')).hidden), false, 'the two links are back');
    assert.equal((await notice()).next, null);
    assert.equal((await no.evaluate(() => window.__created)).length, 0, 'no page opened');
    await no.close();

    await put({ ...START, captures: REVIEW_STEP });
    const later = await openPopup();
    assert.notEqual(await askBox(later), null);
    await later.close();
    assert.deepEqual(await notice(), { ...START, captures: REVIEW_STEP, asked: 1, next: 2 * REVIEW_STEP }, 'closed without an answer: it comes back at the next count');
  });

  it('the popup request reads well in every language: no key shown, one row, no cut word, the popup under the 600 px Chrome allows', async () => {
    for (const code of Object.keys(LANGUAGES)) {
      await bench.evaluate((c) => { localStorage.setItem('obturo.appearance', JSON.stringify({ language: c, theme: 'auto' })); }, code);
      await put({ ...START, captures: REVIEW_STEP });
      const popup = await openPopup();
      const box = await popup.evaluate(() => {
        const el = /** @type {HTMLElement} */ (document.getElementById('ask'));
        const label = /** @type {HTMLElement} */ (el.querySelector('.ask-review span'));
        const bottom = Math.max(...[...document.querySelectorAll('button, #ask')].map((e) => e.getBoundingClientRect().bottom));
        return {
          text: el.textContent, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth, cut: label.scrollWidth > label.clientWidth + 1,
          row: el.getBoundingClientRect().height, height: document.body.getBoundingClientRect().height, bottom,
        };
      });
      assert.doesNotMatch(box.text, /popup\./, `${code}: no key shown`);
      assert.deepEqual([box.sideways, box.cut], [false, false], `${code}: nothing sticks out, no word cut`);
      assert.ok(box.row < 45, `${code}: one row: ${box.row}`);
      assert.ok(box.height < 600 && box.bottom < 600, `${code}: the popup with the request fits the 600 px of Chrome: ${box.height}, ${box.bottom}`);
      await popup.close();
    }
    await bench.evaluate(() => localStorage.removeItem('obturo.appearance'));
  });

  it('no error on any page', () => {
    assert.deepEqual(h.errors, []);
  });
});

describe('about: the captures count', () => {
  let h, site, page, sw;
  const captures = () => sw.evaluate(async () => (await __t.settings.readKv('about'))?.captures ?? 0);
  const capture = async () => sw.evaluate((tab) => __t.capture(tab), await tabOf(sw));

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1280, height: 800 } });
    sw = h.sw;
    await sw.evaluate(() => __t.settings.setSettings({ language: 'en', noTrace: false }));
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p1200.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.visibilityState === 'visible');
    await tabActive(sw, await tabOf(sw));
  });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('a capture kept in the history is one more; a capture in the no-trace mode counts for none', async () => {
    await quota();
    const before = await captures();
    await capture();
    await until(async () => (await captures()) === before + 1, 'the capture is counted');
    await sw.evaluate(() => __t.settings.setSettings({ noTrace: true }));
    await quota();
    await capture();
    await quota();
    await quota();
    assert.equal(await captures(), before + 1, 'nothing is kept, nothing is counted');
  });
});
