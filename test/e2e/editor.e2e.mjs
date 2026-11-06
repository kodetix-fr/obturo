// Full walkthrough of the editor in the real extension, with the real mouse and keyboard:
// tools, hiding, versions, crop, scale, export, persistence, clipboard, security, eviction.
// The steps follow one another: each one starts from the state left by the previous one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  dbDump, decodePng, diffInfo, download, drag, mapper, originalHash, outText, pngSize, poll, px, ready, resetLibrary, seed,
  sha256, shotWhere, sleep, tool, waitOut,
} from './support/editor.mjs';
import { fitView } from '../../view.js';
import { outputSize } from '../../versions.js';

describe('editor: full walkthrough', () => {
  let h, page;
  const csp = [];
  const grabCsp = async (p = page) => { csp.push(...(await p.evaluate(() => window.__csp).catch(() => []))); };
  const lastObject = async (id) => (await dbDump(page)).find((s) => s.id === id).versions[0].objects.at(-1);
  const pressed = (label) => page.locator('#versions button', { hasText: label });
  let A, m, E1;

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  it('empty state: message and editor disabled', async () => {
    await resetLibrary(page, h, []); // empty database, language forced to English
    await page.waitForSelector('#stageMsg:not([hidden])');
    assert.ok((await page.locator('#stageMsg').innerText()).includes('No captures yet'), 'empty message missing');
    assert.notEqual(await page.locator('#ui').getAttribute('disabled'), null, 'editor not disabled');
  });

  it('opens directly on the most recent one (1920x16384 full page)', async () => {
    await seed(page, { w: 1600, h: 900, title: 'Capture A', url: 'https://example.test/a', stripes: true });
    await seed(page, { w: 3840, h: 2160, title: 'Capture B 4K', url: 'https://example.test/b' });
    await seed(page, { w: 1920, h: 16384, title: 'Capture C full page', url: 'https://example.test/c' });
    await grabCsp();
    await page.reload();
    await ready(page);
    assert.equal(await outText(page), 'Output: 1920 × 16384 px');
    assert.equal(await page.locator('#strip li.shot').count(), 3, 'shots in the strip');
    assert.equal(await page.locator('#strip li.shot').first().getAttribute('aria-current'), 'true', 'current shot');
  });

  it('thumbnails generated on demand then persisted, without counting as an edit', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#strip img[src]').length === 3, null, { timeout: 20_000 });
    const shots = await poll(async () => {
      const s = await dbDump(page);
      return s.every((x) => x.hasThumb) ? s : null;
    }, { what: 'thumbnails persisted' });
    assert.ok(shots.every((x) => x.versions.length === 0 && x.active === -1), 'a thumbnail must not count as an edit');
  });

  it('rectangle, arrow, pixelation, black flat, text', async () => {
    await page.locator('#strip li.shot').nth(2).locator('button.open').click(); // A, the oldest
    await ready(page);
    await waitOut(page, 1600, 900);
    A = (await dbDump(page)).find((s) => s.title === 'Capture A');
    m = await mapper(page, 1600, 900);

    await tool(page, 'rect'); await drag(page, m, 100, 100, 500, 300);
    await tool(page, 'arrow'); await drag(page, m, 700, 300, 900, 200);
    await tool(page, 'pixel'); await drag(page, m, 240, 220, 560, 380);
    await tool(page, 'flat'); await drag(page, m, 1000, 300, 1200, 500);
    await tool(page, 'text');
    const [tx, ty] = m.pt(700, 100);
    await page.mouse.click(tx, ty);
    await page.keyboard.type('Hello \xe9', { delay: 8 }); // "\xe9" (e acute): non-ASCII on purpose, it must survive typing and saving
    await page.keyboard.press('Escape');
    const s = await shotWhere(page, A.id, (x) => x.versions[0]?.objects.length === 5 && x.versions[0].objects[4].text === 'Hello \xe9', 'five objects saved');
    assert.equal(s.active, 0, 'active version (V1 created by the first action)');
    assert.equal(s.versions.length, 1);
    assert.deepEqual(s.versions[0].objects.map((o) => o.type), ['Rect', 'Arrow', 'PixelRegion', 'Rect', 'IText']);
    assert.ok(!JSON.stringify(s.versions[0].objects).includes('data:'), 'pixels leaked into the JSON of the versions');
  });

  it('styled text: font, size, bold, background, color', async () => {
    await page.click('#bold');
    await page.selectOption('#font', { label: 'Serif' });
    await page.fill('#size', '48');
    await page.press('#size', 'Tab');
    await page.locator('#bgSwatches label:has(input[value="#ffeb3b"])').click(); // choosing a color is enough: no box to tick
    await page.evaluate(() => {
      const color = /** @type {HTMLInputElement} */ (document.getElementById('color'));
      color.value = '#1b5e20';
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const s = await shotWhere(page, A.id, (x) => {
      const t = x.versions[0].objects[4];
      return t.fontWeight === 'bold' && t.fontSize === 48 && t.backgroundColor === '#ffeb3b' && t.fill === '#1b5e20';
    }, 'text style saved');
    assert.ok(String(s.versions[0].objects[4].fontFamily).includes('Georgia'), `font ${s.versions[0].objects[4].fontFamily}`);
  });

  it('PNG export: size and pixels (rectangle, block pixelation, black flat, text)', async () => {
    const file = await download(page);
    assert.match(file.name, /^example\.test_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/); // suggestedFilename: the host and the date of the capture
    E1 = await decodePng(page, file.buf);
    assert.deepEqual([E1.width, E1.height], [1600, 900], 'dimensions');
    const [r, g, b] = px(E1, 300, 100);
    assert.ok(Math.abs(r - 229) < 4 && Math.abs(g - 57) < 4 && Math.abs(b - 53) < 4, `rectangle edge ${[r, g, b]}`);
    assert.deepEqual(px(E1, 1100, 400).slice(0, 3), [0, 0, 0], 'black flat');
    assert.deepEqual(px(E1, 250, 230), px(E1, 252, 230), 'pixels of the same pixelated block');
    const block = px(E1, 250, 230);
    assert.ok(block[0] > 40 && block[2] > 40, `pixelated block not averaged ${block}`);
    let nonWhite = 0;
    for (let y = 100; y < 150; y++) for (let x = 700; x < 900; x++) if (px(E1, x, y).slice(0, 3).some((c) => c < 240)) nonWhite++;
    assert.ok(nonWhite > 500, `text missing (${nonWhite} px)`);
  });

  it('selection, move and resize with the mouse, undo, redo, delete', async () => {
    await tool(page, 'rect'); await drag(page, m, 100, 600, 300, 700); // R2: 6th object
    await tool(page, 'select');
    await drag(page, m, 150, 650, 250, 680); // move by +100, +30
    await shotWhere(page, A.id, (s) => {
      const o = s.versions[0].objects.at(-1);
      return s.versions[0].objects.length === 6 && Math.abs(o.left - 200) <= 3 && Math.abs(o.top - 630) <= 3;
    }, 'rectangle moved');
    let r = await lastObject(A.id);
    // bottom-right handle (corner of the bounding box, stroke included)
    await drag(page, m, 200 + 200 + r.strokeWidth / 2, 630 + 100 + r.strokeWidth / 2, 500, 760);
    r = (await shotWhere(page, A.id, (s) => s.versions[0].objects.at(-1).width > 280, 'rectangle enlarged')).versions[0].objects.at(-1);
    assert.equal(r.scaleX ?? 1, 1, 'scale baked into the size');
    const widthAfterResize = r.width;

    await page.keyboard.press('Control+z');
    await shotWhere(page, A.id, (s) => Math.abs(s.versions[0].objects.at(-1).width - 200) <= 3, 'undo');
    await page.keyboard.press('Control+y');
    await shotWhere(page, A.id, (s) => Math.abs(s.versions[0].objects.at(-1).width - widthAfterResize) <= 3, 'redo');

    const selectR2 = async () => { const [x, y] = m.pt(300, 680); await page.mouse.click(x, y); }; // undo / redo clear the selection
    await selectR2();
    await page.keyboard.press('Delete');
    await shotWhere(page, A.id, (s) => s.versions[0].objects.length === 5, 'deletion');
    await page.keyboard.press('Control+z');
    await shotWhere(page, A.id, (s) => s.versions[0].objects.length === 6, 'undo the deletion');
    await selectR2();
    await page.keyboard.press('Delete');
    await shotWhere(page, A.id, (s) => s.versions[0].objects.length === 5, 'rectangle removed: V1 back to 5 objects');
  });

  it('new version (duplicates), crop with the mouse, scale, export', async () => {
    await page.click('#newVersion');
    let s = await shotWhere(page, A.id, (x) => x.versions.length === 2 && x.active === 1, 'V2 created');
    assert.equal(s.versions[1].objects.length, s.versions[0].objects.length, 'copy of the version');
    assert.equal(s.versions[1].name, 'V2');
    await page.click('#crop');
    await drag(page, m, 0, 0, 100, 50);
    await drag(page, m, 1600, 900, 1400, 800);
    await page.click('#cropOk');
    await page.fill('#scalePct', '50');
    await page.press('#scalePct', 'Tab');
    s = await shotWhere(page, A.id, (x) => x.versions[1].scale === 0.5 && x.versions[1].crop, 'crop and scale saved');
    const crop = s.versions[1].crop;
    assert.ok(Math.abs(crop.x - 100) <= 4 && Math.abs(crop.y - 50) <= 4, `crop ${JSON.stringify(crop)}`);
    const out = outputSize(1600, 900, s.versions[1]);
    assert.equal(await outText(page), `Output: ${out.w} × ${out.h} px`);
    const file = await download(page);
    assert.deepEqual(Object.values(pngSize(file.buf)), [out.w, out.h], 'exported dimensions');
    assert.match(file.name, /\.png$/);
  });

  it('V1 intact: export identical pixel for pixel after a round trip between versions', async () => {
    await pressed('V1').click();
    await waitOut(page, 1600, 900);
    const E1b = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([E1b.width, E1b.height], [1600, 900]);
    assert.equal(Buffer.compare(E1b.data, E1.data), 0, `pixels of V1 differ after the return: ${diffInfo(E1b, E1)}`);
  });

  it('the original is immutable: export identical byte for byte', async () => {
    const before = await originalHash(page, A.id);
    await pressed('Original').click();
    await page.waitForSelector('#versions button[aria-pressed="true"]:has-text("Original")');
    const exported = await download(page);
    assert.equal(sha256(exported.buf), before, 'fingerprint of the exported original');
    assert.equal(await originalHash(page, A.id), before, 'fingerprint of the original in the database');
  });

  it('deleting a version; the smallest free name is reused', async () => {
    await pressed('V2').click();
    await page.click('#delVersion');
    await page.click('#cfOk'); // the confirmation dialog (the same as the history's)
    let s = await shotWhere(page, A.id, (x) => x.versions.length === 1 && x.active === 0, 'after deleting V2');
    assert.equal(s.versions[0].name, 'V1');
    await page.click('#newVersion');
    s = await shotWhere(page, A.id, (x) => x.versions.length === 2, 'new version');
    assert.deepEqual(s.versions.map((v) => v.name), ['V1', 'V2']);
    await page.click('#delVersion');
    await page.click('#cfOk'); // the confirmation dialog (the same as the history's)
    await shotWhere(page, A.id, (x) => x.versions.length === 1 && x.active === 0, 'back to V1');
  });

  it('drawing from the Original creates a new blank version, V1 stays intact', async () => {
    await pressed('Original').click();
    await page.waitForSelector('#versions button[aria-pressed="true"]:has-text("Original")');
    await sleep(250); // no visible signal to wait for: the empty scene of the original loads
    await tool(page, 'rect'); await drag(page, m, 100, 600, 300, 700);
    const s = await shotWhere(page, A.id, (x) => x.versions.length === 2 && x.active === 1, 'version created from the original');
    assert.equal(s.versions[1].objects.length, 1, 'objects of the new version');
    assert.equal(s.versions[0].objects.length, 5, 'objects of V1');
    await page.click('#delVersion');
    await page.click('#cfOk'); // the confirmation dialog (the same as the history's)
    await shotWhere(page, A.id, (x) => x.versions.length === 1 && x.active === 0, 'back to V1');
  });

  it('resizing the window: the canvas follows and the view stays fitted', async () => {
    const label = () => page.locator('#zoomLabel').innerText();
    const before = await label();
    await page.setViewportSize({ width: 1000, height: 650 });
    await poll(async () => (await label()) !== before, { what: 'zoom recomputed' });
    const [cw, ch] = await page.evaluate(() => [document.getElementById('stage').clientWidth, document.getElementById('stage').clientHeight]);
    assert.equal(await label(), `${Math.round(fitView(cw, ch, 1600, 900).z * 100)}%`, 'zoom after resizing');
    assert.equal(await page.evaluate(() => document.querySelector('.upper-canvas').getBoundingClientRect().width), cw, 'canvas width');
    await page.setViewportSize({ width: 1500, height: 900 });
    await poll(async () => (await label()) === before, { what: 'initial zoom restored' });
    m = await mapper(page, 1600, 900);
  });

  it('pixelated region: its content follows its position, alone then in a multiple selection', async () => {
    await seed(page, { w: 1600, h: 900, title: 'Capture D', url: 'https://example.test/d', stripes: true });
    await grabCsp();
    await page.reload();
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
    await tool(page, 'pixel'); await drag(page, m, 240, 220, 560, 380); // on the stripes
    await tool(page, 'select');
    await drag(page, m, 400, 300, 1100, 400); // moved by (+700, +100) onto the green square
    const D = (await dbDump(page)).find((s) => s.title === 'Capture D');
    await shotWhere(page, D.id, (s) => Math.abs((s.versions[0]?.objects[0]?.left ?? 0) - 940) <= 6, 'region moved');
    let E = await decodePng(page, (await download(page)).buf);
    assert.deepEqual(px(E, 1100, 400).slice(0, 3), [0, 170, 0], 'moved region: must show the green underneath');
    assert.notDeepEqual(px(E, 250, 230), px(E, 252, 230), 'old location: the original stripes must reappear');

    // multiple selection: a 2nd region on the stripes and a flat next to it, moved together
    await tool(page, 'pixel'); await drag(page, m, 240, 220, 560, 380);
    await tool(page, 'flat'); await drag(page, m, 240, 390, 560, 430);
    await tool(page, 'select');
    await drag(page, m, 200, 180, 620, 450); // lasso around both (the 1st region is far away)
    await drag(page, m, 400, 300, 410, 300); // small move of the group (+10): still on the stripes
    // On screen, SELECTION STILL ACTIVE (the export dissolves it before drawing, so it does not see this defect).
    // Region at (250..570, 220..380), blocks of 20 px aligned on its left edge: 290..310 is ONE block.
    // Correct mosaic = identical neighboring pixels; raw stripes (transparent region) = alternating pixels.
    const screen = await decodePng(page, await page.screenshot());
    const dpr = await page.evaluate(() => devicePixelRatio); // the screenshot is in physical pixels
    const [sx0] = m.pt(292, 300);
    const [sx1] = m.pt(308, 300);
    const row = Math.round(m.pt(0, 300)[1] * dpr);
    const colors = new Set();
    for (let x = Math.round(sx0 * dpr) + 1; x < Math.round(sx1 * dpr) - 1; x++) colors.add(px(screen, x, row).slice(0, 3).join());
    assert.equal(colors.size, 1, `on screen during the multiple selection: the region must be a uniform mosaic, ${colors.size} colors seen (${[...colors].slice(0, 4).join(' | ')})`);

    await drag(page, m, 410, 300, 410, 600); // then move the group toward the white
    await shotWhere(page, D.id, (s) => s.versions[0].objects.length === 3 && s.versions[0].objects.some((o) => o.type === 'Rect' && o.top > 600), 'group moved');
    E = await decodePng(page, (await download(page)).buf);
    // moved region: (240..560, 520..680); moved flat: (240..560, 690..730)
    const white = px(E, 300, 600).slice(0, 3);
    assert.ok(white.every((c) => c >= 250), `group moved: the region must show the white underneath, got ${white}`);
    assert.deepEqual(px(E, 400, 710).slice(0, 3), [0, 0, 0], 'flat moved with the group');
    assert.notDeepEqual(px(E, 250, 230), px(E, 252, 230), 'old location of the group: original stripes');
  });

  it('persistence after reload: active version restored, identical rendering', async () => {
    await grabCsp();
    await page.reload();
    await ready(page);
    await page.locator('#strip button.open[title^="Capture A"]').click();
    await waitOut(page, 1600, 900);
    assert.equal(await page.locator('#versions button[aria-pressed="true"]').innerText(), 'V1', 'active version');
    const E1c = await decodePng(page, (await download(page)).buf);
    assert.equal(Buffer.compare(E1c.data, E1.data), 0, `rendering differs after reload: ${diffInfo(E1c, E1)}`);
  });

  it('copy the image: the clipboard receives a PNG of the right size', async () => {
    // We wrap clipboard.write to record what the application hands it (reading the system clipboard requires a
    // permission that cannot be granted to an extension origin).
    await page.evaluate(() => {
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = (items) => { window.__clip = items; return write(items); };
    });
    await page.click('#copy');
    await page.waitForFunction(() => document.getElementById('copyLabel').textContent === 'Copied', null, { timeout: 8000 });
    const copied = await page.evaluate(async () => {
      const item = window.__clip[0];
      const bitmap = await createImageBitmap(await item.getType('image/png'));
      return [item.types.join(), bitmap.width, bitmap.height];
    });
    assert.deepEqual(copied, ['image/png', 1600, 900]);
  });

  it('hostile title and URL: never interpreted as HTML', async () => {
    await seed(page, { w: 800, h: 600, title: '<img src=x onerror="window.__xss=1"><b>bold</b>', url: 'https://evil.example/<svg onload=window.__xss=2>' });
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => document.querySelectorAll('#strip li.shot').length >= 5);
    assert.equal(await page.evaluate(() => window.__xss), undefined, 'script executed');
    const first = page.locator('#strip li.shot').first();
    assert.ok((await first.locator('button.open').getAttribute('title')).includes('<img src=x'), 'title not kept as is');
    assert.equal(await first.locator('.meta .host').innerText(), 'evil.example', 'host shown');
    // (our own icons are svg.ic: an svg without that class would be the injected one)
    assert.equal(await page.locator('#strip b, #strip svg:not(.ic), #strip img[src="x"]').count(), 0, 'element injected into the strip');
  });

  it('shot removed from the history while open: clear banner, never recreated by the autosave', async () => {
    await page.locator('#strip button.open[title^="Capture B"]').click(); // B 4K, unedited
    await waitOut(page, 3840, 2160);
    const B = (await dbDump(page)).find((s) => s.title === 'Capture B 4K');
    const other = await h.context.newPage(); // the shot goes away without this tab knowing (retention, deletion elsewhere)
    await other.goto(h.url('manifest.json'));
    await other.evaluate(async (id) => { await (await import(`${location.origin}/db.js`)).deleteShot(id); }, B.id);
    await grabCsp(other);
    await other.close();
    assert.ok(!(await dbDump(page)).some((s) => s.id === B.id), 'B should be gone');
    await page.bringToFront();
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForSelector('#banner:not([hidden])', { timeout: 5000 });
    assert.ok((await page.locator('#banner').innerText()).includes('removed from the history'), 'eviction message');
    m = await mapper(page, 3840, 2160);
    await tool(page, 'rect');
    await drag(page, m, 100, 100, 600, 400); // first change: the autosave fires 500 ms later
    await sleep(1000); // absence to prove: no signal to wait for
    assert.ok((await page.locator('#banner').innerText()).includes('no longer saved'), 'saving warning');
    assert.ok(!(await dbDump(page)).some((s) => s.id === B.id), 'the autosave recreated the evicted shot');
  });

  it('deleting a shot asks first and names it, cancel keeps it, and confirming also removes its original', async () => {
    const before = await dbDump(page);
    const victim = before.at(-1);
    const del = page.locator(`#strip li.shot[data-id="${victim.id}"] button.del`);
    await del.click();
    await page.waitForSelector('#confirmDlg[open]');
    assert.equal(await page.locator('#cfTitle').innerText(), 'Delete this capture?');
    assert.ok((await page.locator('#cfBody').innerText()).includes(victim.title || victim.host), 'the dialog names the capture');
    await page.click('#cfCancel');
    assert.equal((await dbDump(page)).length, before.length, 'cancel keeps it');
    await del.click();
    await page.click('#cfOk');
    await poll(async () => (await dbDump(page)).length === before.length - 1, { what: 'shot deleted' });
    const gone = await page.evaluate(async (id) => {
      const { getOriginal } = await import(`${location.origin}/db.js`);
      return (await getOriginal(id)) === undefined;
    }, victim.id);
    assert.ok(gone, 'original still present');
  });

  it('no CSP violation nor console error over the whole session', async () => {
    await grabCsp();
    assert.deepEqual(csp, [], 'CSP violations');
    assert.deepEqual(h.errors.filter((e) => !/willReadFrequently/.test(e)), [], 'console errors');
  });
});
