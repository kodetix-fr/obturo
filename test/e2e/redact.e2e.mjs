// "Hide sensitive text", in the real extension: with the setting on, the e-mail addresses, phone numbers, IBANs, card numbers and keys found in the text
// of the page are covered in black while the image is taken (visible part, area, element, full page), the page is back exactly as it was, and a note says how
// many were hidden. The pixels are checked as the share of near-black pixels in the box of each text, which does not depend on the fonts of the machine. The
// service worker is the one of the package; the test copy only gets host_permissions and the hook, and starts with the copy mode (no page of actions).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DPR, launchExtension } from './support/browser.mjs';
import { finalBadge, maxId, quota, resetBadges, startSite, tabActive, tabOf, until } from './support/capture.mjs';

describe('hide sensitive text', () => {
  let h, site, page, sw, tab;
  const run = (name, t = tab) => sw.evaluate(([n, x]) => __t.run(n, x), [name, t]);
  const setting = (on) => sw.evaluate((v) => __t.settings.setSettings({ redactSensitive: v }), on);

  // Red text on white: unhidden, almost no pixel is near-black; hidden, the whole box is.
  const FIXTURE = [
    ['mail', 'contact: ', 'jane.example@example.test', 120],
    ['phone', 'tel ', '+33 6 12 34 56 78', 170],
    ['iban', 'IBAN ', 'FR14 2004 1010 0505 0001 3M02 606', 220],
    ['card', 'card ', '4111 1111 1111 1111', 270],
    ['key', 'key ', 'sk_live_' + '4eC39HqLyjWDarjtT1zdp7dc', 320],
    ['plain', 'order ', '12345 and the name Jane', 370],
    ['low', 'mail ', 'bob.example@example.test', 2300],
  ];
  const build = () => page.evaluate((items) => {
    document.getElementById('fixture')?.remove();
    const f = document.createElement('div');
    f.id = 'fixture';
    for (const [id, prefix, secret, top] of items) {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:100px;top:${top}px;font:22px monospace;color:rgb(200,0,0);background:#fff;padding:4px`;
      d.append(prefix);
      const s = document.createElement('span');
      s.id = id;
      s.textContent = secret;
      d.append(s);
      f.append(d);
    }
    const panel = document.createElement('div');
    panel.id = 'panel';
    panel.style.cssText = 'position:absolute;left:800px;top:120px;width:520px;height:160px;overflow:auto;font:22px monospace;color:rgb(200,0,0);background:#fff';
    const line = (text, id) => {
      const d = document.createElement('div');
      if (!id) { d.textContent = text; return d; }
      const s = document.createElement('span');
      s.id = id;
      s.textContent = text;
      d.append(s);
      return d;
    };
    panel.append(line('panel.top@example.test', 'panelTop'), ...Array.from({ length: 30 }, (_, i) => line(`line ${i + 1}`)), line('rk_test_' + '1234567890abcdef', 'panelDeep'));
    f.append(panel);
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:800px;top:320px;font:22px monospace;color:rgb(200,0,0);background:#fff;padding:4px';
    const inShadow = document.createElement('span');
    inShadow.id = 'inShadow';
    inShadow.textContent = 'shadow.name@example.test';
    host.attachShadow({ mode: 'open' }).append(inShadow);
    f.append(host);
    document.body.append(f);
  }, FIXTURE);

  /** The box of an element in the page (CSS px, document coordinates). */
  const boxOf = (id) => page.evaluate((id) => {
    const el = document.getElementById(id) ?? /** @type {any} */ (document.getElementById('fixture').lastChild).shadowRoot.getElementById(id);
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  }, id);
  /** Share of near-black pixels in a box of the last shot; `origin` is where the shot starts in the page (an area, an element). */
  const dark = async (box, origin = { x: 0, y: 0 }) => {
    const r = { x: Math.round((box.x - origin.x + 2) * DPR), y: Math.round((box.y - origin.y + 2) * DPR), w: Math.round((box.w - 4) * DPR), h: Math.round((box.h - 4) * DPR) };
    return sw.evaluate(async (r) => {
      const [last] = (await __t.db.queryShots({ limit: 1 })).items;
      const bitmap = await createImageBitmap(await __t.db.getOriginal(last.id));
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const px = ctx.getImageData(r.x, r.y, r.w, r.h).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 60 && px[i + 1] < 60 && px[i + 2] < 60) n++;
      return n / (px.length / 4);
    }, r);
  };
  const HIDDEN = 0.9;
  const SHOWN = 0.1;
  const note = () => page.evaluate(() => document.getElementById('obturo-notice')?.shadowRoot?.textContent ?? null);
  const noteGone = () => page.evaluate(() => document.getElementById('obturo-notice')?.remove());
  /** What the page is made of, the note aside: the markup, the sheets and the highlights. Empty style attributes are not counted: fullpage.js leaves them. */
  const state = async () => {
    await noteGone();
    return page.evaluate(() => ({ html: new XMLSerializer().serializeToString(document.documentElement).replaceAll(' style=""', ''), sheets: document.adoptedStyleSheets.length, highlights: CSS.highlights.size }));
  };
  /** Runs a capture on the test tab and waits for the shot. */
  const capture = async (name) => {
    await quota();
    await page.bringToFront();
    tab = await tabOf(sw);
    await tabActive(sw, tab);
    await resetBadges(sw);
    const before = await maxId(sw);
    await run(name);
    await until(async () => (await maxId(sw)) === before + 1, name, 40_000);
  };

  before(async () => {
    site = await startSite();
    h = await launchExtension({ hook: true, hostPermissions: true, realWindow: true, instrumented: false, size: { width: 1920, height: 1080 } });
    sw = h.sw;
    await sw.evaluate(() => __t.settings.setSettings({ language: 'en' }));
    page = await h.context.newPage();
    await page.goto(`${site.origin}/p3000.html`);
    await page.bringToFront();
    await page.waitForFunction(() => document.readyState === 'complete' && document.visibilityState === 'visible');
    tab = await tabOf(sw);
    await tabActive(sw, tab);
  });
  afterEach(async () => { await setting(false); await noteGone(); });
  after(async () => {
    await h?.close();
    await site?.close();
  });

  it('visible part: every kind is covered, what is not sensitive is not, the page is back as it was, and the note counts', async () => {
    await build();
    await setting(true);
    const before = await state();
    await capture('capture-visible');
    for (const id of ['mail', 'phone', 'iban', 'card', 'key', 'panelTop']) assert.ok(await dark(await boxOf(id)) > HIDDEN, `${id} is covered`);
    assert.ok(await dark(await boxOf('plain')) < SHOWN, 'a text with nothing sensitive in it is left alone');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /sensitive items? covered in the text of the page/);
    assert.deepEqual(await state(), before, 'no node, no sheet, no highlight left behind');
    assert.deepEqual((await finalBadge(sw))?.[0], 'OK');
  });

  it('text that is selected is covered too, and the selection is back afterwards', async () => {
    await build();
    await setting(true);
    await page.evaluate(() => {
      const range = new Range();
      range.selectNodeContents(/** @type {HTMLElement} */ (document.getElementById('mail')));
      const selection = /** @type {Selection} */ (getSelection());
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await capture('capture-visible');
    assert.ok(await dark(await boxOf('mail')) > HIDDEN, 'the selected e-mail is covered');
    assert.equal(await page.evaluate(() => /** @type {Selection} */ (getSelection()).toString()), 'jane.example@example.test', 'the selection is back');
  });

  it('text that is selected and not sensitive keeps its selection in the image', async () => {
    await build();
    await setting(true);
    await page.evaluate(() => {
      const range = new Range();
      range.selectNodeContents(/** @type {HTMLElement} */ (document.getElementById('plain')));
      const selection = /** @type {Selection} */ (getSelection());
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await capture('capture-visible');
    assert.ok(await dark(await boxOf('plain')) < SHOWN, 'a selection that hides nothing is left alone');
    assert.equal(await page.evaluate(() => /** @type {Selection} */ (getSelection()).toString()), '12345 and the name Jane');
  });

  it('text drawn in an SVG is covered too', async () => {
    await build();
    await page.evaluate(() => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '420');
      svg.setAttribute('height', '50');
      svg.style.cssText = 'position:absolute;left:100px;top:430px;background:#fff';
      const text = document.createElementNS(ns, 'text');
      text.id = 'svgMail';
      text.setAttribute('x', '4');
      text.setAttribute('y', '32');
      text.setAttribute('font-size', '22');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', 'rgb(200,0,0)');
      text.textContent = 'svg.person@example.test';
      svg.append(text);
      /** @type {HTMLElement} */ (document.getElementById('fixture')).append(svg);
    });
    await setting(true);
    await capture('capture-visible');
    assert.ok(await dark(await boxOf('svgMail')) > HIDDEN, 'the e-mail drawn in the SVG is covered');
    await page.waitForSelector('#obturo-notice', { state: 'attached' }); // the note comes once the page is back
    assert.equal(await page.evaluate(() => getComputedStyle(/** @type {Element} */ (document.getElementById('svgMail'))).fill), 'rgb(200, 0, 0)', 'the text has its own color back');
  });

  it('a value split by the markup of the page is covered, and two blocks are not joined', async () => {
    await build();
    await page.evaluate(() => {
      const node = (tag, text = '', id = '') => {
        const e = document.createElement(tag);
        e.textContent = text;
        if (id) e.id = id;
        return e;
      };
      const row = (id, top, ...children) => {
        const d = node('div', '', id);
        d.style.cssText = `position:absolute;left:100px;top:${top}px;font:22px monospace;color:rgb(200,0,0);background:#fff;padding:4px`;
        d.append(...children);
        /** @type {HTMLElement} */ (document.getElementById('fixture')).append(d);
      };
      const wrap = (id, ...children) => {
        const s = node('span', '', id);
        s.append(...children);
        return s;
      };
      row('rowPhone', 430, wrap('splitPhone', node('span', '+33 6'), ' ', node('b', '12 34'), ' ', node('i', '56 78')));
      row('rowCard', 480, wrap('splitCard', node('span', '4111'), node('span', ' 1111'), ' ', node('span', '1111 '), node('span', '1111')));
      row('rowBlocks', 530, node('div', 'order 4111', 'blockA'), node('div', '1111 1111 1111', 'blockB'));
      row('rowBreak', 620, node('span', '4111 1111', 'breakA'), node('br'), node('span', '1111 1111', 'breakB'));
    });
    await setting(true);
    await capture('capture-visible');
    assert.ok(await dark(await boxOf('splitPhone')) > HIDDEN, 'a phone number in three elements');
    assert.ok(await dark(await boxOf('splitCard')) > HIDDEN, 'a card number in four elements');
    assert.ok(await dark(await boxOf('blockA')) < SHOWN, 'the end of one block is not the start of a number');
    assert.ok(await dark(await boxOf('blockB')) < SHOWN, 'the start of the next block is not the end of a number');
    assert.ok(await dark(await boxOf('breakA')) < SHOWN, 'a line break ends a number');
    assert.ok(await dark(await boxOf('breakB')) < SHOWN, 'a line break starts another one');
  });

  it('the note counts what shows: a row that cannot be seen is covered but not counted', async () => {
    await build();
    await page.evaluate(() => {
      const fixture = /** @type {HTMLElement} */ (document.getElementById('fixture'));
      fixture.replaceChildren();
      for (const [id, style] of [['seenMail', ''], ['hiddenMail', 'visibility:hidden'], ['faintMail', 'opacity:0']]) {
        const d = document.createElement('div');
        d.id = id;
        d.style.cssText = `position:absolute;left:100px;top:${id === 'seenMail' ? 120 : id === 'hiddenMail' ? 170 : 220}px;font:22px monospace;${style}`;
        d.textContent = `${id}.person@example.test`;
        fixture.append(d);
      }
    });
    await setting(true);
    await capture('capture-visible');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /^Obturo\s*1 sensitive item covered/);
  });

  it('the setting off: nothing is covered, nothing is said', async () => {
    await build();
    await capture('capture-visible');
    for (const id of ['mail', 'phone', 'iban', 'card', 'key']) assert.ok(await dark(await boxOf(id)) < SHOWN, `${id} is as the page shows it`);
    assert.equal(await note(), null);
  });

  it('a scrolling panel: the text that scrolls into view is covered too', async () => {
    await build();
    await setting(true);
    await page.evaluate(() => { document.getElementById('panel').scrollTop = document.getElementById('panel').scrollHeight; });
    await capture('capture-visible');
    assert.ok(await dark(await boxOf('panelDeep')) > HIDDEN, 'the key at the bottom of the panel, scrolled into view');
  });

  it('an open shadow root: the text in it is covered', async () => {
    await build();
    await setting(true);
    await capture('capture-visible');
    assert.ok(await dark(await boxOf('inShadow')) > HIDDEN, 'the address in the shadow root');
  });

  it('an area: only what the area keeps is covered and counted', async () => {
    await build();
    await setting(true);
    await quota();
    await page.bringToFront();
    tab = await tabOf(sw);
    await tabActive(sw, tab);
    const area = { rect: { x: 90, y: 110, w: 700, h: 105 }, vw: await page.evaluate(() => innerWidth), vh: await page.evaluate(() => innerHeight) }; // the e-mail and the phone number
    const before = await maxId(sw);
    await sw.evaluate(([t, a]) => __t.capture(t, a), [tab, area]);
    await until(async () => (await maxId(sw)) === before + 1, 'the area');
    const origin = { x: 90, y: 110 };
    assert.ok(await dark(await boxOf('mail'), origin) > HIDDEN, 'the e-mail');
    assert.ok(await dark(await boxOf('phone'), origin) > HIDDEN, 'the phone number');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /^Obturo\s*2 sensitive items covered/, 'the two the area keeps, not the ones outside it');
  });

  it('an element: what the element holds is covered', async () => {
    await build();
    await setting(true);
    await page.evaluate(() => { document.getElementById('mail').parentElement.id = 'mailBox'; });
    await quota();
    await page.bringToFront();
    tab = await tabOf(sw);
    await tabActive(sw, tab);
    const before = await maxId(sw);
    await run('capture-element');
    await page.waitForSelector('#obturo-element', { state: 'attached', timeout: 5000 });
    const box = await boxOf('mailBox');
    await page.mouse.move(box.x + 10, box.y + 8);
    await page.mouse.down();
    await page.mouse.up();
    await until(async () => (await maxId(sw)) === before + 1, 'the element');
    assert.ok(await dark(await boxOf('mail'), { x: box.x, y: box.y }) > HIDDEN, 'the e-mail of the element');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /1 sensitive item covered/);
  });

  it('the full page: what is far down is covered too, and the page is back as it was', async () => {
    await build();
    await setting(true);
    const before = await state();
    await capture('capture-full');
    for (const id of ['mail', 'key', 'low']) assert.ok(await dark(await boxOf(id)) > HIDDEN, `${id} is covered in the tall image`);
    assert.ok(await dark(await boxOf('plain')) < SHOWN, 'the text with nothing sensitive in it is left alone');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /sensitive items covered in the text of the page/);
    assert.deepEqual(await state(), before, 'no node, no sheet, no highlight left behind');
  });

  it('nothing sensitive on the page: the note says it was looked for', async () => {
    await page.evaluate(() => document.getElementById('fixture')?.remove());
    await setting(true);
    await capture('capture-visible');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /No e-mail address, phone number, IBAN, card number or key found/);
  });

  it('the note of a capture is not in the image of the next one', async () => {
    await build();
    await setting(true);
    await capture('capture-visible');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    await capture('capture-visible');
    const corner = await page.evaluate(() => ({ x: innerWidth - 16 - 60, y: innerHeight - 16 - 40 }));
    const color = await sw.evaluate(async ([c, dpr]) => {
      const [last] = (await __t.db.queryShots({ limit: 1 })).items;
      const bitmap = await createImageBitmap(await __t.db.getOriginal(last.id));
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      return [...ctx.getImageData(Math.round(c.x * dpr), Math.round(c.y * dpr), 1, 1).data].slice(0, 3);
    }, [corner, DPR]);
    assert.notDeepEqual(color, [37, 99, 235], 'not the blue of the note of the first capture');
  });

  it('a page too big to be searched in full: the capture is taken and says so', async () => {
    await build();
    await setting(true);
    await page.evaluate(() => {
      const big = document.createElement('div');
      big.id = 'big';
      big.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden';
      for (let i = 0; i < 205_000; i++) big.append(document.createTextNode('abcdef'));
      document.body.append(big);
    });
    await capture('capture-visible');
    await page.waitForSelector('#obturo-notice', { state: 'attached' });
    assert.match(await note(), /too big to be searched in full/);
    await page.evaluate(() => document.getElementById('big').remove());
  });

  it('no image with the text showing: when the cover cannot be put up, nothing is captured', async () => {
    await build();
    await setting(true);
    await sw.evaluate(() => {
      globalThis.__realExecute = chrome.scripting.executeScript;
      chrome.scripting.executeScript = (o) => (o.files?.includes('redact.js') ? Promise.reject(new Error('blocked')) : globalThis.__realExecute(o));
    });
    try {
      await quota();
      await page.bringToFront();
      tab = await tabOf(sw);
      await tabActive(sw, tab);
      await resetBadges(sw);
      const before = await maxId(sw);
      await run('capture-visible');
      await until(async () => (await finalBadge(sw))?.[0] === 'ERR', 'the red badge');
      assert.equal(await maxId(sw), before, 'no shot was saved');
    } finally {
      await sw.evaluate(() => { chrome.scripting.executeScript = globalThis.__realExecute; });
    }
  });
});
