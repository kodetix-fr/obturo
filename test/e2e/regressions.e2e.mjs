// Editor non-regressions: one scenario per fixed defect, each on an empty database.
// Concurrent writes, exact black flat, deleting a version while typing, database failures, closely spaced
// openings, scale on the original, thumbnail following the version, output ceiling, rounding, accessibility,
// two-tab lock.
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  dbDump, decodePng, download, drag, mapper, outText, pngSize, poll, px, ready, resetLibrary, setOutput, shotWhere, sleep, spec,
  titled, tool, waitOut,
} from './support/editor.mjs';

describe('editor: non-regressions', () => {
  let h, page;
  const onDialog = (d) => d.accept();
  const csp = [];
  const grabCsp = async () => { csp.push(...(await page.evaluate(() => window.__csp).catch(() => []))); };
  const reset = async (specs, extra) => {
    await grabCsp();
    await resetLibrary(page, h, specs, extra);
  };
  const shots = () => dbDump(page);
  const objectCount = async (index = 0) => (await shots())[index].versions[0]?.objects.length ?? 0;
  const fillScale = async (percent) => {
    await setOutput(page, '#scalePct', percent);
  };
  const pageErrors = () => h.errors.filter((e) => e.startsWith('[pageerror]'));

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', onDialog);
  });
  after(() => h?.close());

  it('a change during a write in flight, then a stale timer, no longer block the writes', async () => {
    await reset([spec('S1')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    await tool(page, 'rect'); await drag(page, m, 100, 100, 300, 200); // change 1: write 500 ms later
    // We hold the write for about 1.2 s: a long write transaction on the store blocks the editor's one.
    await page.evaluate(() => {
      window.__hold = new Promise((done) => {
        const request = indexedDB.open('obturo');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('shots', 'readwrite');
          const store = tx.objectStore('shots');
          const start = performance.now();
          const tick = () => { if (performance.now() - start < 1200) store.get(1).onsuccess = tick; };
          tick();
          tx.oncomplete = () => { db.close(); done(); };
        };
      });
    });
    await sleep(800); // write 1 is in flight, held back
    await tool(page, 'rect'); await drag(page, m, 400, 100, 600, 200); // change 2, DURING the write
    await page.evaluate(() => window.__hold);
    await poll(async () => (await objectCount()) === 2, { what: 'two changes saved' });
    await sleep(700); // lets the stale timer of change 2 pass
    await tool(page, 'rect'); await drag(page, m, 700, 100, 900, 200); // change 3: the old code never wrote it
    await poll(async () => (await objectCount()) === 3, { what: 'the 3rd change is saved' });
  });

  it('solid fill (black by default): no non-black pixel inside, from 33 to 200 %, with crop and move', async () => {
    await reset([spec('S2')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    await tool(page, 'flat'); await drag(page, m, 230, 215, 570, 385); // on the stripes
    await tool(page, 'select'); await drag(page, m, 400, 300, 413.7, 307.3); // move to a non-integer position
    await page.click('#crop');
    await drag(page, m, 0, 0, 150, 100);
    await drag(page, m, 1600, 900, 1000, 600);
    await page.click('#cropOk');
    const bad = [];
    for (const percent of [33, 37, 50, 61, 100, 200]) {
      await fillScale(percent);
      const shot = await shotWhere(page, (await shots())[0].id, (s) => s.versions[0]?.scale === percent / 100 && s.versions[0].crop, `scale ${percent} % saved`);
      const png = await decodePng(page, (await download(page)).buf);
      const v = shot.versions[0];
      const flat = v.objects.find((o) => o.type === 'Rect' && o.fill === '#000000');
      const x0 = (flat.left - v.crop.x) * v.scale, y0 = (flat.top - v.crop.y) * v.scale;
      const x1 = x0 + flat.width * flat.scaleX * v.scale, y1 = y0 + flat.height * flat.scaleY * v.scale;
      let wrong = 0, total = 0;
      // pixels 100 % covered: [x, x+1] entirely inside [x0, x1], with no tolerance margin
      for (let y = Math.ceil(y0); y <= Math.floor(y1) - 1; y++) {
        for (let x = Math.ceil(x0); x <= Math.floor(x1) - 1; x++) {
          total++;
          const p = px(png, x, y);
          if (p[0] || p[1] || p[2] || p[3] !== 255) wrong++;
        }
      }
      if (wrong || !total) bad.push(`${percent} % : ${wrong}/${total}`);
    }
    assert.deepEqual(bad, [], 'non-black pixels inside the flat');
  });

  it('deleting a version while typing a text does not leak into the remaining version; confirmation asked', async () => {
    await reset([spec('S3')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    await tool(page, 'rect'); await drag(page, m, 100, 100, 300, 200); // V1: 1 object
    await page.click('#newVersion');
    await shotWhere(page, (await shots())[0].id, (s) => s.versions.length === 2, 'V2 created');
    await tool(page, 'text');
    const [tx, ty] = m.pt(700, 400);
    await page.mouse.click(tx, ty);
    await page.keyboard.type('SECRET'); // the text stays IN EDITING
    await page.click('#delVersion'); // refusal: nothing changes
    await page.waitForSelector('#confirmDlg[open]');
    assert.ok((await page.locator('#cfTitle').innerText()).includes('V2'), 'the confirmation names the version');
    await page.click('#cfCancel');
    await page.waitForFunction(() => !document.querySelector('#confirmDlg[open]'));
    await sleep(700);
    assert.equal((await shots())[0].versions.length, 2, 'the refused deletion deleted anyway');
    await page.click('#delVersion');
    await page.waitForSelector('#confirmDlg[open]');
    await page.click('#cfOk');
    const s = await shotWhere(page, (await shots())[0].id, (x) => x.versions.length === 1, 'V2 deleted');
    assert.equal(s.versions[0].objects.length, 1, 'objects of V1 (the text of V2 must not be there)');
    assert.ok(!JSON.stringify(s.versions[0]).includes('SECRET'), 'the text of the deleted version leaked into V1');
  });

  it('save failure: change kept, error banner, retry, closing not blocked', async () => {
    await reset([spec('S4a'), spec('S4b', 1280, 720)]);
    await ready(page);
    await titled(page, 'S4a').click();
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    const id = (await shots()).find((s) => s.title === 'S4a').id;
    await page.evaluate(() => { window.__failDb = 'write'; });
    await tool(page, 'rect'); await drag(page, m, 100, 100, 300, 200);
    await page.waitForSelector('#banner:not([hidden])', { timeout: 8000 });
    assert.ok((await page.locator('#banner').innerText()).includes('Saving failed'), 'error banner missing');
    assert.equal((await shots()).find((s) => s.title === 'S4a').versions.length, 0, 'nothing must be written during the failure');
    await page.evaluate(() => { window.__failDb = false; });
    await tool(page, 'rect'); await drag(page, m, 400, 100, 600, 200); // the next change retries, the first one included
    await shotWhere(page, id, (s) => s.versions[0]?.objects.length === 2, 'both rectangles are written');
    // Closing during the failure: opening the other shot must not fail.
    await page.evaluate(() => { window.__failDb = 'write'; });
    await tool(page, 'rect'); await drag(page, m, 700, 100, 900, 200);
    await titled(page, 'S4b').click();
    await ready(page);
    await waitOut(page, 1280, 720);
    await poll(async () => (await page.locator('#banner').innerText()).includes('could not be saved'), { what: 'closing warning' });
    await page.evaluate(() => { window.__failDb = false; });
  });

  it('closely spaced clicks (0 to 15 ms): no error, the editor ends on the last clicked shot', async () => {
    await reset([spec('S5a', 1600, 900), spec('S5b', 1280, 720), spec('S5c', 800, 600), spec('S5d', 1920, 1080)]);
    await ready(page);
    // strip order: the most recent first
    const text = ['Output: 1920 × 1080 px', 'Output: 800 × 600 px', 'Output: 1280 × 720 px', 'Output: 1600 × 900 px'];
    for (const gap of [0, 3, 8, 15]) {
      for (const order of [[1, 2, 3], [3, 1, 2], [2, 3, 1, 0, 2]]) {
        // We edit the shot opened just before: closing it must then SAVE (write + thumbnail), which opens the window
        // where two simultaneous closings trample each other.
        const [cw, ch] = (await outText(page)).match(/\d+/g).map(Number);
        const m = await mapper(page, cw, ch);
        await tool(page, 'rect'); await drag(page, m, 20, 20, 90, 70, 3);
        await page.evaluate(async ({ order, gap }) => {
          const buttons = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#strip li.shot button.open')]);
          for (const i of order) {
            buttons[i].click();
            await new Promise((done) => setTimeout(done, gap));
          }
        }, { order, gap });
        const last = order.at(-1);
        await page.waitForFunction((t) => document.getElementById('out').textContent === t && !(/** @type {HTMLFieldSetElement} */ (document.getElementById('ui'))).disabled, text[last], { timeout: 15_000 });
        await poll(() => page.evaluate(() => [...document.querySelectorAll('#strip li.shot')].findIndex((li) => li.hasAttribute('aria-current'))).then((i) => i === last), { what: `current shot (gap ${gap} ms, order ${order})` });
        // (when this order ends on the shot of the previous one, the text and the strip are right from the start, and the editor is
        // still between closing and mounting: wait for it rather than count at once)
        await poll(async () => (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 3, { what: `a single editor (2 Fabric canvases and the backdrop of the look) must remain (gap ${gap} ms, order ${order})` });
      }
    }
    assert.deepEqual(pageErrors(), [], 'page errors');
  });

  it('first scale or width input on the original: taken into account', async () => {
    await reset([spec('S7a', 1600, 900), spec('S7b', 1400, 800)]); // different sizes: we know which shot is open
    await ready(page);
    await titled(page, 'S7a').click();
    await waitOut(page, 1600, 900);
    await fillScale(50);
    await shotWhere(page, (await shots()).find((s) => s.title === 'S7a').id, (s) => s.versions[0]?.scale === 0.5, 'scale saved');
    assert.equal(await outText(page), 'Output: 800 × 450 px');
    await titled(page, 'S7b').click();
    await waitOut(page, 1400, 800);
    await setOutput(page, '#scaleW', 700);
    await shotWhere(page, (await shots()).find((s) => s.title === 'S7b').id, (s) => s.versions[0]?.scale === 0.5, 'scale deduced from the width');
    assert.equal(await outText(page), 'Output: 700 × 400 px');
  });

  it('unreadable original or unavailable database: clear message, never an endless "Loading"', async () => {
    await reset([spec('S8ok')], async () => {
      await page.evaluate(async () => {
        const { addShot } = await import(`${location.origin}/db.js`);
        await addShot({ original: new Blob(['this is not a PNG'], { type: 'image/png' }), url: 'https://example.test/bad', title: 'S8bad', w: 100, h: 100 });
      });
    });
    await page.waitForFunction(() => /open this capture/.test(document.getElementById('stageMsg').textContent), null, { timeout: 15_000 });
    assert.ok(!(await page.locator('#stageMsg').innerText()).includes('Loading'), 'stuck on "Loading"');
    assert.ok((await page.locator('#banner:not([hidden])').innerText()).includes('unreadable'), 'unreadable image banner');
    await titled(page, 'S8ok').click();
    await ready(page);
    await waitOut(page, 1600, 900);
    assert.ok(await page.locator('#banner').isHidden(), 'the banner must disappear when a valid shot opens');
    await page.evaluate(() => { window.__failDb = true; });
    await titled(page, 'S8bad').click();
    await page.waitForSelector('#banner:not([hidden])', { timeout: 5000 });
    await page.evaluate(() => { window.__failDb = false; });
    await page.evaluate(() => sessionStorage.setItem('failDb', '1'));
    await page.reload();
    // Without a readable database the settings are unreadable too: the language falls back to the browser's. The
    // messages are therefore checked by key, not by text.
    await page.waitForFunction(() => document.getElementById('bannerText').dataset.i18n === 'msg.readFailed', null, { timeout: 10_000 });
    assert.equal(await page.locator('#stageTitle').getAttribute('data-i18n'), 'state.dbUnavailable', 'unavailable database message');
    await page.evaluate(() => sessionStorage.removeItem('failDb'));
    assert.deepEqual(pageErrors(), [], 'unhandled rejection');
  });

  it('the thumbnail follows the displayed version: a solid fill also hides the strip', async () => {
    await reset([spec('S9')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    await page.waitForFunction(() => document.querySelectorAll('#strip img[src]').length === 1);
    const m = await mapper(page, 1600, 900);
    const luminance = () => page.evaluate(async () => {
      const { queryShots } = await import(`${location.origin}/db.js`);
      const s = (await queryShots({ limit: 1000 })).items.at(-1); // the oldest
      if (!s.thumb) return 255;
      const bitmap = await createImageBitmap(s.thumb);
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0);
      const d = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return sum / (d.length / 4);
    });
    const waitLuminance = (test, what) => poll(async () => test(await luminance()), { what, timeout: 8000 });
    await waitLuminance((l) => l > 150, 'light thumbnail of the original');
    await tool(page, 'flat'); await drag(page, m, -8, -8, 1608, 908); // covers the whole image
    await waitLuminance((l) => l < 10, 'black thumbnail of V1 (the original leaks into the strip)');
    await page.locator('#versions button', { hasText: 'Original' }).click();
    await waitLuminance((l) => l > 150, 'back on the original: light thumbnail');
    await page.locator('#versions button', { hasText: 'V1' }).click();
    await waitLuminance((l) => l < 10, 'back on V1: black thumbnail');
    assert.ok(await page.evaluate(() => {
      const img = /** @type {HTMLImageElement} */ (document.querySelector('#strip img'));
      return img.complete && img.naturalWidth > 0;
    }), 'strip image not refreshed');
  });

  it('scale capped with a clear message; the export holds', async () => {
    await reset([spec('S10tall', 1920, 16384, false), spec('S104k', 3840, 2160, false)]);
    await ready(page);
    await waitOut(page, 3840, 2160);
    await fillScale(1000);
    await poll(async () => (await page.locator('#outNote').innerText()).includes('reduced'), { what: 'ceiling message (4K)' });
    const [w, h] = (await outText(page)).match(/\d+/g).map(Number);
    assert.ok(w <= 16384 && h <= 16384 && w * h <= 100e6, `4K output above the ceiling: ${w}x${h}`);
    await titled(page, 'S10tall').click();
    await waitOut(page, 1920, 16384);
    await fillScale(1000);
    await poll(async () => (await page.locator('#outNote').innerText()).includes('reduced'), { what: 'ceiling message (full page)' });
    assert.equal(await outText(page), 'Output: 1920 × 16384 px', 'full page capped at 100 %');
    assert.deepEqual(Object.values(pngSize((await download(page)).buf)), [1920, 16384], 'capped export');
  });

  it('801 x 601 at 50 %: 400 x 300, last row and last column opaque', async () => {
    await reset([spec('S11', 801, 601, false)]);
    await ready(page);
    await waitOut(page, 801, 601);
    await fillScale(50);
    await waitOut(page, 400, 300);
    const png = await decodePng(page, (await download(page)).buf);
    assert.deepEqual([png.width, png.height], [400, 300], 'exported size');
    let transparent = 0;
    for (let x = 0; x < png.width; x++) if (px(png, x, png.height - 1)[3] !== 255) transparent++;
    for (let y = 0; y < png.height; y++) if (px(png, png.width - 1, y)[3] !== 255) transparent++;
    assert.equal(transparent, 0, 'semi-transparent pixels on the last row or column');
  });

  it('a simple click with a tool creates neither a version nor an "edited" badge', async () => {
    await reset([spec('S12')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    for (const name of ['rect', 'arrow', 'pixel', 'blur', 'flat']) {
      await tool(page, name);
      const [x, y] = m.pt(300, 300);
      await page.mouse.click(x, y);
    }
    await sleep(900); // absence to prove: we let the autosave pass
    assert.equal((await shots())[0].versions.length, 0, 'versions created by simple clicks');
    assert.ok(await page.locator('#strip li[aria-current] .badge').isHidden(), 'edited badge shown');
    await tool(page, 'rect'); await drag(page, m, 100, 100, 300, 200); // a real drawing does create V1
    await shotWhere(page, (await shots())[0].id, (s) => s.versions.length === 1, 'V1 created by a real drawing');
    assert.ok(await page.locator('#strip li[aria-current] .badge').isVisible(), 'edited badge expected after a drawing');
  });

  it('pixelation: minimum block of 16 and advice on text; accessibility labels', async () => {
    await reset([spec('S13')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    assert.equal(await page.getAttribute('#block', 'min'), '16', 'minimum block');
    assert.ok((await page.getAttribute('[data-tool="pixel"]', 'title')).includes('prefer a solid fill'), 'pixelation tooltip');
    assert.ok((await page.getAttribute('[data-tool="blur"]', 'title')).includes('prefer a solid fill'), 'blur tooltip');
    assert.equal(await page.getAttribute('#blur', 'min'), '16', 'minimum blur block, as the pixelation');
    assert.equal(await page.getAttribute('#blur', 'max'), '120');
    assert.deepEqual([await page.getAttribute('#bold', 'aria-label'), await page.getAttribute('#italic', 'aria-label'), await page.getAttribute('#underline', 'aria-label')], ['Bold', 'Italic', 'Underline']);
    assert.equal(await page.getAttribute('.upper-canvas', 'role'), 'img', 'canvas role');
    assert.ok((await page.getAttribute('.upper-canvas', 'aria-label')).includes('S13'), 'canvas label');
    assert.equal(await page.getAttribute('#zoomLabel', 'aria-live'), null, 'zoom aria-live');
    assert.equal(await page.evaluate(() => Number(/** @type {HTMLInputElement} */ (document.getElementById('block')).value) >= 16), true, 'default block');
  });

  it('the read-only tab counts the whole history on All history, not the strip', async () => {
    await reset(Array.from({ length: 14 }, (_, i) => spec(`R${i + 1}`, 200, 120, false)));
    await ready(page);
    await poll(async () => (await page.locator('#historyAllCount').innerText()) === '14', { what: 'the count of the editing tab' });
    const second = await h.context.newPage();
    await second.goto(h.url());
    await second.waitForSelector('#banner:not([hidden])', { timeout: 10_000 });
    assert.equal(await second.locator('#strip li.shot').count(), 12, 'the strip holds the 12 latest');
    await poll(async () => (await second.locator('#historyAllCount').innerText()) === '14', { what: 'the count of the read-only tab' });
    await second.close();
  });

  it('a tool stays armed after a drag: two drags draw two objects, and Escape puts Select back', async () => {
    await reset([spec('S7')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    await tool(page, 'blur');
    await drag(page, m, 100, 100, 400, 180);
    await drag(page, m, 100, 260, 400, 340);
    const pressed = (name) => page.getAttribute(`.tool[data-tool="${name}"]`, 'aria-pressed');
    assert.equal(await pressed('blur'), 'true', 'still armed');
    await poll(async () => (await objectCount()) === 2, { what: 'two objects saved' });
    await page.keyboard.press('Escape');
    assert.equal(await pressed('select'), 'true');
    assert.equal(await pressed('blur'), 'false');
  });

  it('a version is renamed on its pill: double click or F2, Enter keeps, Escape leaves it, and the name is in the file and the dialog', async () => {
    await reset([spec('S8')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const m = await mapper(page, 1600, 900);
    await tool(page, 'rect');
    await drag(page, m, 100, 100, 400, 300);
    const names = async () => (await shots())[0].versions.map((v) => v.name);
    await poll(async () => (await names()).length === 1, { what: 'V1 saved' });
    const input = page.locator('#versions input.pill-name');
    await page.locator('#versions button[data-i="0"]').dblclick();
    await input.fill('  Before   the fix ');
    await input.press('Enter');
    await poll(async () => (await names())[0] === 'Before the fix', { what: 'the name saved' });
    assert.equal(await page.locator('#versions button[data-i="0"]').innerText(), 'Before the fix');
    await page.locator('#versions button[data-i="0"]').dblclick();
    await input.fill('Nope');
    await input.press('Escape');
    assert.equal(await page.locator('#versions button[data-i="0"]').innerText(), 'Before the fix', 'Escape leaves the name as it was');
    await page.locator('#versions button[data-i="0"]').focus();
    await page.keyboard.press('F2');
    await input.fill('After');
    await input.press('Enter');
    await poll(async () => (await names())[0] === 'After', { what: 'F2 renames too' });
    assert.match((await download(page)).name, /_After\.png$/, 'the name of a version the person chose ends the name of the file');
    await page.click('#delVersion');
    await page.waitForSelector('#confirmDlg[open]');
    assert.match(await page.locator('#cfTitle').innerText(), /^Delete version After\?/);
    await page.click('#cfCancel');
    await page.locator('#versions button[data-i="0"]').dblclick();
    await input.fill('');
    await input.press('Enter');
    await poll(async () => (await names())[0] === 'V1', { what: 'an empty name gives back V1' });
    assert.doesNotMatch((await download(page)).name, /_V1\.png$/, 'V1 is not a name');
  });

  it('a read-only tab shows the capture as it was edited, copies it, downloads it and follows the strip', async () => {
    await reset([spec('S5a', 1000, 600), spec('S5b', 1200, 700)]);
    await ready(page);
    await waitOut(page, 1200, 700);
    const m = await mapper(page, 1200, 700);
    await tool(page, 'flat');
    await drag(page, m, 100, 100, 400, 300);
    const edited = (await shots()).at(-1);
    await shotWhere(page, edited.id, (s) => s.versions.length > 0, 'the edit is saved');
    const second = await h.context.newPage();
    second.on('dialog', onDialog);
    try {
      await second.goto(h.url());
      await second.waitForSelector('#viewer:not([hidden])', { timeout: 20_000 });
      await poll(async () => (await second.locator('#viewerImg').evaluate((img) => img.naturalWidth)) === 1200, { what: 'the edited capture' });
      const inside = await second.locator('#viewerImg').evaluate((img) => {
        const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight).getContext('2d');
        c.drawImage(img, 0, 0);
        return [...c.getImageData(250, 200, 1, 1).data];
      });
      assert.deepEqual(inside, [0, 0, 0, 255], 'the black fill of the edit is in the picture');
      await second.evaluate(() => {
        const write = navigator.clipboard.write.bind(navigator.clipboard);
        navigator.clipboard.write = (items) => { window.__clip = items; return write(items); };
      });
      await second.bringToFront();
      await second.click('#viewerCopy');
      await second.waitForFunction(() => document.getElementById('viewerCopy').textContent === 'Copied', null, { timeout: 8000 });
      const copied = await second.evaluate(async () => {
        const bitmap = await createImageBitmap(await window.__clip[0].getType('image/png'));
        return [bitmap.width, bitmap.height];
      });
      assert.deepEqual(copied, [1200, 700], 'the clipboard gets the edited picture');
      const [file] = await Promise.all([second.waitForEvent('download', { timeout: 20_000 }), second.click('#viewerDownload')]);
      const img = await decodePng(page, readFileSync(await file.path()));
      assert.deepEqual(px(img, 250, 200), [0, 0, 0, 255], 'the file is the edited picture');
      assert.deepEqual([img.width, img.height], [1200, 700]);
      const [again] = await Promise.all([second.waitForEvent('download', { timeout: 20_000 }), second.click('#viewerDownload')]);
      assert.ok(readFileSync(await file.path()).equals(readFileSync(await again.path())), 'a second download gives the same file');
      assert.equal(await second.locator('#viewerImg').evaluate((i) => i.naturalWidth), 1200, 'the picture is still displayed');
      await tool(page, 'flat');
      await drag(page, m, 600, 400, 900, 550);
      await poll(() => second.locator('#viewerImg').evaluate((img) => {
        const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight).getContext('2d');
        c.drawImage(img, 0, 0);
        return c.getImageData(750, 470, 1, 1).data[0] === 0;
      }), { what: 'the read-only tab follows an edit made in the editing tab' });
      await second.locator('#strip button.open').nth(1).click();
      await poll(async () => (await second.locator('#viewerImg').evaluate((i) => i.naturalWidth)) === 1000, { what: 'the other capture' });
      const open = () => second.evaluate(() => window.__c.bmp - window.__c.bmpClosed);
      const settled = await open();
      for (let i = 0; i < 6; i++) await second.locator('#strip button.open').nth(i % 2).click();
      await poll(async () => (await second.locator('#viewerImg').evaluate((img) => img.naturalWidth)) === 1000, { what: 'the capture the last click asked for' });
      assert.equal(await open(), settled, 'no bitmap is left open by captures shown in quick succession');
      assert.notEqual(await second.locator('#ui').getAttribute('disabled'), null, 'nothing to edit in this tab');
      assert.equal(await second.locator('#pin').isDisabled(), true);
      assert.equal((await shots()).length, 2, 'nothing was written');
    } finally {
      await second.close();
    }
  });

  // Last: this scenario replaces the current page.
  it('two tabs: the second one is read-only; reloading does not lock itself', async () => {
    await reset([spec('S6')]);
    await ready(page);
    await waitOut(page, 1600, 900);
    const second = await h.context.newPage();
    second.on('dialog', onDialog);
    await second.goto(h.url());
    await second.waitForSelector('#banner:not([hidden])', { timeout: 10_000 });
    assert.ok((await second.locator('#banner').innerText()).includes('already open in another tab'), 'read-only message');
    await second.waitForSelector('#viewer:not([hidden])');
    assert.deepEqual(await second.locator('#viewerImg').evaluate((img) => [img.naturalWidth, img.naturalHeight]), [1600, 900], 'the capture is shown');
    assert.notEqual(await second.locator('#ui').getAttribute('disabled'), null, 'editor not disabled in the second tab');
    assert.equal(await second.evaluate(() => performance.getEntriesByName('obturo:editor-loaded').length), 0, 'the editor must not load');
    await second.locator('#strip button.open').first().click();
    await sleep(400); // absence to prove: the editor must not open
    assert.notEqual(await second.locator('#ui').getAttribute('disabled'), null, 'a click in read-only mode opened the editor');
    await second.close();
    for (let i = 0; i < 3; i++) { // a reload must never think it is the "second tab"
      await page.reload();
      await ready(page);
    }
    // closing the tab releases the lock: a new tab can edit
    await page.close();
    page = await h.context.newPage();
    page.on('dialog', onDialog);
    await page.goto(h.url());
    await ready(page);
  });

  it('no CSP violation, no unhandled page error, only the expected console errors', async () => {
    await grabCsp();
    assert.deepEqual(csp, [], 'CSP violations');
    assert.deepEqual(pageErrors(), [], 'page errors');
    const unexpected = h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e));
    assert.deepEqual(unexpected, [], 'unexpected console errors');
  });
});
