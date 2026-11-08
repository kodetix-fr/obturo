// The downloads of the library in the real extension: the Download button and its format menu (PNG, JPEG, WebP, PDF, quality
// with a live estimate, PDF options), its errors, its keyboard and language handling, the Download section of the settings,
// and the grouped export (ZIP of images, multipage PDF, progress, cancel, captures that fail). Every file that a download
// produces is read back: magic bytes, pixels, pages, entries.
//
// The engines themselves (encode.js, pdf.js, zip.js) are tested in export.e2e.mjs; the pure logic in *.test.js.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import {
  dbDump, decodePng, diffInfo, download, drag, mapper, originalHash, poll, px, ready, resetLibrary, setOutput, seedSettings, sha256, shotWhere, sleep,
  spec, titled, tool, waitOut,
} from './support/editor.mjs';
import {
  MIME, batchDone, chooseFormat, closeBatch, closeMenu, decodeImage, downloadAfter, isFormat, openBatch, openMenu, readPdf, readZip,
  setDefaultFormat, setOriginal, stored,
} from './support/export.mjs';
import { suggestedFilename } from '../../encode.js';

const CLEAN = { language: 'en', theme: 'auto', downloadFormat: 'png', downloadQuality: 0.9, pdfLayout: 'fit', pdfEncoding: 'flate' };
const NAME = (ext) => new RegExp(`^example\\.test_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(-\\d+)?\\.${ext}$`);
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', pdf: 'pdf' };
const GREEN = [0, 170, 0]; // the square of the seeded images (spec(...) draws it at 1000, 300, 200 x 200)
const near = (actual, expected, tolerance, what) => assert.ok(expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance), `${what}: ${actual} is not within ${tolerance} of ${expected}`);
/** Largest difference of a channel between two decoded images of the same size, and the share of pixels that differ. */
function difference(a, b) {
  let max = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
    if (d) n++;
    max = Math.max(max, d);
  }
  return { max, share: n / (a.data.length / 4) };
}
const sizeOf = (text) => { // "~ 184 KB" -> bytes
  const m = /([\d.,]+)\s*(KB|MB|B|Ko|Mo|o)\b/.exec(text);
  assert.ok(m, `a size in "${text}"`);
  return Number(m[1].replace(',', '.')) * ({ B: 1, o: 1, KB: 1024, Ko: 1024, MB: 1048576, Mo: 1048576 }[m[2]]);
};

describe('export: the Download button and its menu', () => {
  let h, page;
  const text = (selector) => page.locator(selector).innerText();
  const library = (specs = [spec('First', 1600, 900), spec('Second', 1280, 720)], settings = CLEAN) => resetLibrary(page, h, specs, undefined, settings);
  const open = async (w = 1280, hgt = 720) => { await ready(page); await waitOut(page, w, hgt); };
  // A black flat over the green square, so that the shot has a version.
  const mask = async (w = 1280, hgt = 720) => {
    const m = await mapper(page, w, hgt);
    await tool(page, 'flat');
    await drag(page, m, 990, 290, 1210, 510);
    await page.waitForSelector('#versions button:nth-child(2)');
  };
  /** The estimate has settled (no run due or in progress). */
  const settled = () => page.waitForFunction(() => {
    const el = document.getElementById('dlEstimate');
    return el && /\d/.test(el.textContent) && el.dataset.stale !== '1' && !/…/.test(el.textContent);
  }, null, { timeout: 15_000 });

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  it('the format of the button follows the settings; the main click downloads PNG, JPEG, WebP and PDF, each read back', async () => {
    await library();
    await open();
    assert.equal(await text('#downloadFmt'), 'PNG');
    const [shot] = (await dbDump(page)).toReversed(); // the one on screen, the most recent
    const original = await originalHash(page, shot.id);
    for (const format of ['png', 'jpeg', 'webp', 'pdf']) {
      await setDefaultFormat(page, format);
      const file = await downloadAfter(page, () => page.click('#download'));
      assert.ok(isFormat[format](file.buf), `${format}: signature`);
      assert.match(file.name, NAME(EXT[format]));
      if (format === 'pdf') {
        const pages = await readPdf(file.buf);
        assert.deepEqual(pages, [{ width: 960, height: 540, filter: '/FlateDecode', imageWidth: 1280, imageHeight: 720 }], 'one page the size of the image at 96 dpi, lossless');
      } else {
        const image = await decodeImage(page, file.buf, MIME[format]);
        assert.deepEqual([image.width, image.height], [1280, 720], `${format}: dimensions`);
        near(px(image, 1100, 400).slice(0, 3), GREEN, format === 'png' ? 0 : 12, `${format}: the green square`);
        near(px(image, 20, 700).slice(0, 3), [255, 255, 255], format === 'png' ? 0 : 6, `${format}: the white background`);
      }
      if (format === 'png') assert.equal(sha256(file.buf), original, 'the original goes out as it is, never re-encoded');
    }
    assert.equal((await stored(page)).downloadFormat, 'pdf');
    assert.equal(await text('#downloadFmt'), 'PDF');
    await page.reload(); // the format survives a reload
    await open();
    assert.equal(await text('#downloadFmt'), 'PDF');
  });

  it('the menu is a one-time "Download as": it keeps its choice for the session and never writes the Settings', async () => {
    await library();
    await open();
    await chooseFormat(page, 'jpeg');
    assert.equal(await text('#downloadFmt'), 'PNG', 'the button follows the Settings');
    assert.equal((await stored(page)).downloadFormat, 'png');
    await openMenu(page);
    assert.equal(await page.isChecked('#dlPop input[value="jpeg"]'), true, 'the menu kept its choice');
    const file = await downloadAfter(page, () => page.click('#dlPop .dl-foot .btn'));
    assert.ok(isFormat.jpeg(file.buf));
    assert.equal(await text('#downloadFmt'), 'PNG');
    await setDefaultFormat(page, 'webp'); // the Settings say something else: the menu starts from them again
    await openMenu(page);
    assert.equal(await page.isChecked('#dlPop input[value="webp"]'), true);
    await closeMenu(page);
  });

  it('the menu stays inside the window, however narrow it is', async () => {
    await library();
    await open();
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    try {
      for (const [w, hh] of [[1500, 900], [820, 650], [480, 700], [360, 640]]) {
        await page.setViewportSize({ width: w, height: hh });
        await poll(async () => (await page.evaluate(() => innerWidth)) === w, { what: 'the window size' });
        await openMenu(page);
        const r = await page.evaluate(() => {
          const b = document.getElementById('dlPop').getBoundingClientRect();
          return { left: b.left, right: b.right, bottom: b.bottom, width: innerWidth, height: innerHeight };
        });
        assert.ok(r.left >= 0 && r.right <= r.width, `the menu is inside the width at ${w} x ${hh}: ${JSON.stringify(r)}`);
        assert.ok(r.bottom <= r.height, `the menu is inside the height at ${w} x ${hh}: ${JSON.stringify(r)}`);
        await closeMenu(page);
      }
    } finally {
      await page.setViewportSize(size);
    }
  });

  it('the name of the file comes from suggestedFilename: the host and the date of the capture', async () => {
    await library([{ ...spec('Named', 1000, 500), url: 'https://app.example.test/some/page?q=1' }]);
    await open(1000, 500);
    const [shot] = await dbDump(page);
    const createdAt = await page.evaluate(async (id) => (await (await import(`${location.origin}/db.js`)).getShot(id)).createdAt, shot.id);
    const file = await downloadAfter(page, () => page.click('#download'));
    assert.equal(file.name, suggestedFilename({ url: 'https://app.example.test/some/page?q=1', createdAt }, 'png'));
    assert.match(file.name, /^app\.example\.test_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  });

  it('an edited version is rendered as displayed in every format: the black flat is black', async () => {
    await library();
    await open();
    await mask();
    for (const format of ['png', 'jpeg', 'webp', 'pdf']) {
      await setDefaultFormat(page, format);
      const file = await downloadAfter(page, () => page.click('#download'));
      assert.ok(isFormat[format](file.buf), `${format}: signature`);
      if (format === 'pdf') {
        assert.equal((await readPdf(file.buf)).length, 1);
        continue;
      }
      const image = await decodeImage(page, file.buf, MIME[format]);
      near(px(image, 1100, 400).slice(0, 3), [0, 0, 0], format === 'png' ? 0 : 8, `${format}: the hidden square`);
      near(px(image, 700, 600).slice(0, 3), [255, 255, 255], format === 'png' ? 0 : 6, `${format}: the rest of the image`);
    }
  });

  it('quality: the slider changes the size, the estimate is the size of the file, and the Settings are not written', async () => {
    await library();
    await open();
    await chooseFormat(page, 'jpeg');
    await openMenu(page);
    assert.equal(await page.locator('#dlQuality').isVisible(), true, 'the slider of a lossy format');
    const sizes = {};
    for (const q of [1, 0.1]) {
      await page.locator('#dlQuality').fill(String(q));
      await sleep(350); // the pause after the last move of the slider
      await settled();
      assert.equal(await text('#dlQualityLabel + .dl-pct'), `${Math.round(q * 100)}%`, 'the value beside the slider');
      const estimate = sizeOf(await text('#dlEstimate'));
      const file = await downloadAfter(page, () => page.click('#dlPop .dl-foot .btn')); // the menu closes and downloads
      sizes[q] = file.buf.length;
      assert.ok(Math.abs(estimate - file.buf.length) <= Math.max(1100, file.buf.length * 0.03), `estimate ${estimate} against a file of ${file.buf.length} bytes (q=${q})`);
      assert.equal((await stored(page)).downloadQuality, 0.9, 'the default quality of the Settings is untouched');
      await openMenu(page);
    }
    assert.ok(sizes[0.1] < sizes[1] / 2, `quality 10% (${sizes[0.1]}) must be far lighter than 100% (${sizes[1]})`);
    await page.click('#dlPop label.dl-opt:has(input[value="png"])'); // lossless: no slider, no estimate
    await page.waitForSelector('#dlQuality', { state: 'hidden' });
    await closeMenu(page);
  });

  it('the estimate waits for the first move of the slider, and a big image is estimated from a band of it, marked "~"', async () => {
    await library([spec('Big', 3200, 1800)]); // 5.76 million pixels: more than a band
    await open(3200, 1800);
    await chooseFormat(page, 'jpeg');
    // every canvas that reaches an encoder, and its size
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__encoded = [];
      const record = (proto, name) => {
        const original = proto[name];
        proto[name] = function (...args) { w.__encoded.push([this.width, this.height]); return original.apply(this, args); };
      };
      record(OffscreenCanvas.prototype, 'convertToBlob');
      record(HTMLCanvasElement.prototype, 'toBlob');
    });
    const encoded = () => page.evaluate(() => /** @type {any} */ (window).__encoded);
    await openMenu(page);
    await sleep(900); // the pause of the estimate, and more
    assert.deepEqual(await encoded(), [], 'nothing is rendered or encoded when the menu opens');
    assert.equal(await text('#dlEstimate'), '(move the slider)');
    await page.click('#dlPop label.dl-opt:has(input[value="webp"])'); // a format change before the slider moves does not start one either
    await sleep(500);
    assert.deepEqual(await encoded(), []);
    await page.click('#dlPop label.dl-opt:has(input[value="jpeg"])');

    await page.locator('#dlQuality').fill('0.6');
    await settled();
    const first = await encoded();
    assert.deepEqual(first, [[3200, 1250]], 'a band of 1250 rows (4 million pixels), not the 1800 of the image');
    const estimate = await text('#dlEstimate');
    assert.match(estimate, /^~ [\d.]+\s(KB|MB)$/, 'extrapolated: approximate'); // \s: the no-break space of fmtBytes
    const file = await downloadAfter(page, () => page.click('#dlPop .dl-foot .btn'));
    const ratio = sizeOf(estimate) / file.buf.length;
    assert.ok(ratio > 0.4 && ratio < 2.5, `estimate ${estimate} against a file of ${file.buf.length} bytes`); // a synthetic image, with few details: the band only roughly tells

    // later moves and the other format reuse the band
    await openMenu(page);
    await page.locator('#dlQuality').fill('0.8');
    await settled();
    await page.click('#dlPop label.dl-opt:has(input[value="webp"])'); // the slider has asked: the format follows
    await page.waitForFunction(() => /^~ /.test(document.getElementById('dlEstimate').textContent) && document.getElementById('dlEstimate').dataset.stale !== '1');
    const later = (await encoded()).slice(1);
    assert.ok(later.length >= 2 && later.every(([w, hgt]) => w === 3200 && (hgt === 1250 || hgt === 1800)), `later encodings: ${JSON.stringify(later)}`);
    await closeMenu(page);
  });

  it('PDF options: one page fitted or A4, lossless or light JPEG, never written to the Settings; the quality counts for the light PDF only', async () => {
    await library();
    await open();
    await chooseFormat(page, 'pdf');
    await openMenu(page);
    assert.equal(await page.locator('#dlQuality').isVisible(), false, 'lossless pictures: no quality');
    await page.click('#dlPop label:has(input[name="dlLayout"][value="a4"])');
    await page.click('#dlPop label:has(input[name="dlEncoding"][value="jpeg"])');
    assert.equal(await page.locator('#dlQuality').isVisible(), true, 'light pictures: the quality counts');
    assert.equal(await page.locator('#dlEstimate').isVisible(), false, 'no estimate for a PDF');
    assert.match(await text('#dlPop .dl-foot .btn'), /^Download PDF$/);
    const file = await downloadAfter(page, () => page.click('#dlPop .dl-foot .btn'));
    assert.deepEqual(await readPdf(file.buf), [{ width: 595, height: 842, filter: '/DCTDecode', imageWidth: 1280, imageHeight: 720 }], 'an A4 page, JPEG picture');
    const settings = await stored(page);
    assert.deepEqual([settings.downloadFormat, settings.pdfLayout, settings.pdfEncoding], ['png', 'fit', 'flate'], 'the Settings are as they were');
    await page.reload(); // the menu starts from the Settings again: lossless pictures on a fitted page
    await open();
    await openMenu(page);
    await page.click('#dlPop label.dl-opt:has(input[value="pdf"])');
    assert.equal(await page.locator('#dlPop input[name="dlLayout"][value="fit"]').isChecked(), true);
    assert.equal(await page.locator('#dlPop input[name="dlEncoding"][value="flate"]').isChecked(), true);
    const again = await downloadAfter(page, () => page.click('#dlPop .dl-foot .btn'));
    assert.deepEqual(await readPdf(again.buf), [{ width: 960, height: 540, filter: '/FlateDecode', imageWidth: 1280, imageHeight: 720 }]);
  });

  it('the menu by keyboard: Enter opens it on the chosen format, arrows choose, Escape closes and gives the focus back', async () => {
    await library();
    await open();
    const caret = page.locator('#downloadMenu');
    assert.equal(await caret.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(await caret.getAttribute('aria-expanded'), 'false');
    assert.equal(await caret.getAttribute('aria-label'), 'Download options');
    await page.focus('#downloadMenu');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#dlPop:not([hidden])');
    assert.equal(await caret.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.getAttribute('#dlPop', 'role'), 'dialog');
    assert.equal(await page.getAttribute('#dlPop', 'aria-label'), 'Download options');
    assert.equal(await text('#dlFormatLabel'), 'Format');
    assert.equal(await page.getAttribute('.dl-formats', 'role'), 'radiogroup');
    assert.equal(await page.getAttribute('.dl-formats', 'aria-labelledby'), 'dlFormatLabel');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('value')), 'png', 'the focus is on the chosen format');
    await page.keyboard.press('ArrowDown');
    await poll(async () => (await text('#dlPop .dl-foot .btn')) === 'Download JPEG', { what: 'JPEG chosen by the arrow' });
    assert.equal(await text('#downloadFmt'), 'PNG', 'the button of the editor follows the Settings, not the menu');
    await page.keyboard.press('ArrowDown');
    await poll(async () => (await text('#dlPop .dl-foot .btn')) === 'Download WebP', { what: 'WebP chosen by the arrow' });
    await page.keyboard.press('Tab'); // the size fields come next, then the quality slider of a lossy format
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'scalePct');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'scaleW');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'dlQuality');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#dlPop', { state: 'hidden' });
    assert.equal(await caret.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'downloadMenu', 'the focus goes back to the caret');
    // a click anywhere else closes it
    await openMenu(page);
    await page.mouse.click(700, 400);
    await page.waitForSelector('#dlPop', { state: 'hidden' });
    // so does the focus leaving it
    await openMenu(page);
    await page.focus('#fit');
    await page.waitForSelector('#dlPop', { state: 'hidden' });
    // and Tab through the menu leaves it after its last control
    await openMenu(page);
    for (let i = 0; i < 8 && await page.locator('#dlPop').isVisible(); i++) await page.keyboard.press('Tab');
    assert.equal(await page.locator('#dlPop').isVisible(), false, 'Tab walked out of the menu');
    // the caret toggles
    await page.click('#downloadMenu');
    await page.waitForSelector('#dlPop:not([hidden])');
    await page.click('#downloadMenu');
    await page.waitForSelector('#dlPop', { state: 'hidden' });
  });

  it('the editor shortcuts do not act behind the open menu', async () => {
    await library();
    await open();
    const m = await mapper(page, 1280, 720);
    await tool(page, 'rect');
    await drag(page, m, 100, 100, 300, 200); // drawn and selected
    const [shot] = (await dbDump(page)).toReversed();
    await shotWhere(page, shot.id, (s) => s.versions[0]?.objects.length === 1, 'rectangle saved');
    await openMenu(page);
    await page.focus('#downloadMenu'); // inside the group, so the menu stays open
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await sleep(900); // absence to prove: the autosave would have fired by now
    assert.equal((await dbDump(page)).at(-1).versions[0].objects.length, 1, 'the rectangle was deleted behind the menu');
    await closeMenu(page);
  });

  it('opening the menu changes nothing in the editor: a crop in progress is kept, an export abandons it as it always did', async () => {
    await library();
    await open();
    await page.click('#crop');
    await page.waitForSelector('#cropGroup:not([hidden])');
    await chooseFormat(page, 'jpeg'); // opens and closes the menu
    await openMenu(page);
    await page.locator('#dlQuality').fill('0.8'); // the estimate starts with the first move of the slider, and leaves the crop alone
    await settled();
    assert.equal(await page.locator('#cropGroup').isVisible(), true, 'the crop was abandoned by the menu');
    assert.equal(await page.getAttribute('#crop', 'aria-pressed'), 'true');
    const file = await downloadAfter(page, () => page.click('#dlPop .dl-foot .btn'));
    assert.ok(isFormat.jpeg(file.buf));
    assert.equal(await page.locator('#cropGroup').isVisible(), false, 'an export leaves the crop tool, as before');
  });

  it('busy while it works (one export at a time), and clear errors that leave the interface usable', async () => {
    await library();
    await open();
    await mask();
    // The encoder of the browser, made slow ('slow'), unable ('null': the answer of a canvas that is too large), or deaf to the
    // format asked ('png': it answers with a PNG).
    const patch = (mode) => page.evaluate((mode) => {
      const w = /** @type {any} */ (window);
      const original = w.__toBlob ?? HTMLCanvasElement.prototype.toBlob;
      w.__toBlob = original;
      HTMLCanvasElement.prototype.toBlob = function (cb, type, quality) {
        if (mode === 'slow') setTimeout(() => original.call(this, cb, type, quality), 700);
        else if (mode === 'null') cb(null);
        else original.call(this, cb, 'image/png', quality);
      };
    }, mode);
    const unpatch = () => page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = /** @type {any} */ (window).__toBlob; });
    const banner = () => page.locator('#bannerText').innerText();

    // a slow encoder: the button says so, a second click does nothing, one file arrives
    await patch('slow');
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('#download');
    await page.waitForSelector('#split[data-busy]');
    assert.equal(await page.getAttribute('#download', 'aria-busy'), 'true');
    assert.equal(await text('#dlStatus'), 'Exporting…');
    await page.click('#download', { force: true });
    await poll(() => downloads.length >= 1, { what: 'the download' });
    await page.waitForSelector('#split:not([data-busy])');
    assert.equal(await page.getAttribute('#download', 'aria-busy'), 'false');
    await sleep(300);
    assert.equal(downloads.length, 1, 'a second click while busy must not start a second export');
    await unpatch();

    // the browser answers with nothing: the output is too large
    await patch('null');
    await page.click('#download');
    await page.waitForSelector('#banner:not([hidden])');
    assert.match(await banner(), /^Export failed: the output size is too large for the browser/);
    await page.waitForSelector('#split:not([data-busy])');
    await unpatch();
    const ok = await downloadAfter(page, () => page.click('#download')); // the button works again
    assert.ok(isFormat.png(ok.buf));

    // the browser answers with another format than the one asked
    await setDefaultFormat(page, 'webp');
    await patch('png');
    await page.evaluate(() => { document.getElementById('banner').hidden = true; });
    await page.click('#download');
    await page.waitForFunction(() => /can't create this format/.test(document.getElementById('bannerText').textContent));
    await page.waitForSelector('#split:not([data-busy])');
    await unpatch();
    const webp = await downloadAfter(page, () => page.click('#download'));
    assert.ok(isFormat.webp(webp.buf), 'works again once the encoder does');
    page.removeAllListeners('download');
  });

  it('Copy image stays a PNG, whatever the download format', async () => {
    await library();
    await open();
    await chooseFormat(page, 'jpeg');
    await page.evaluate(() => {
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = (items) => { window.__clip = items; return write(items); };
    });
    await page.click('#copy');
    await poll(() => page.evaluate(() => !!window.__clip), { what: 'the clipboard write' });
    assert.deepEqual(await page.evaluate(() => window.__clip.map((item) => item.types)), [['image/png']]);
  });

  it('the canvases made to copy the image and for the thumbnail give their pixels back as soon as the blob is there', async () => {
    await library();
    await open();
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__made = [];
      w.__toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) { w.__made.push([type, this]); return w.__toBlob.call(this, callback, type, quality); };
      w.__write = navigator.clipboard.write;
      navigator.clipboard.write = async () => {}; // the copy itself is not the point
    });
    try {
      await mask(); // a version: its autosave makes the thumbnail (WebP)
      const released = (type) => page.evaluate((type) => /** @type {any} */ (window).__made.filter(([t]) => t === type).map(([, c]) => c.width), type);
      await poll(async () => (await released('image/webp')).length > 0, { what: 'the thumbnail was encoded' });
      await poll(async () => (await released('image/webp')).every((w) => w === 0), { what: 'the canvas of the thumbnail gave its pixels back' });
      await page.click('#copy'); // renderPng
      await poll(async () => (await released('image/png')).length > 0, { what: 'the image to copy was encoded' });
      await poll(async () => (await released('image/png')).every((w) => w === 0), { what: 'the canvas of the copy gave its pixels back' });
    } finally {
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        HTMLCanvasElement.prototype.toBlob = w.__toBlob;
        navigator.clipboard.write = w.__write;
      });
    }
  });

  it('the language changes live while the menu is open: texts, units and the button', async () => {
    await library();
    await open();
    await setDefaultFormat(page, 'jpeg');
    await openMenu(page);
    assert.equal(await text('#dlEstimate'), '(move the slider)', 'no estimate before the slider moves');
    await seedSettings(page, { language: 'fr' });
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    assert.equal(await text('#dlEstimate'), '(déplace le curseur)');
    await seedSettings(page, { language: 'en' });
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#dlQuality').fill('0.8');
    await settled();
    assert.match(await text('#dlEstimate'), /^[\d.]+\sKB$/, 'a small image is encoded whole: the size of the file, no "~"');
    await seedSettings(page, { language: 'fr' });
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    assert.equal(await text('#dlFormatLabel'), 'Format');
    assert.equal(await text('#dlQualityLabel'), 'Qualité');
    assert.equal(await text('#dlPop .dl-opt:first-child .dl-hint'), 'Sans perte, texte net');
    assert.equal(await text('#dlPop .dl-foot .btn'), 'Télécharger en JPEG');
    assert.match(await text('#dlEstimate'), /^[\d,]+\sKo$/, 'the unit follows the language');
    assert.equal(await text('#dlQualityLabel + .dl-pct'), '80\u00a0%');
    assert.equal(await page.getAttribute('#dlPop', 'aria-label'), 'Options de téléchargement');
    assert.equal(await text('#download .lbl'), 'Télécharger');
    assert.equal(await page.getAttribute('#downloadMenu', 'aria-label'), 'Options de téléchargement');
    assert.equal(await text('#downloadFmt'), 'JPEG', 'a format name is not translated');
    await seedSettings(page, { language: 'en' });
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await text('#dlQualityLabel'), 'Quality');
    assert.match(await text('#dlEstimate'), /KB$/);
    await closeMenu(page);
  });

  it('settings: the Download section sets the default format, the quality and the PDF options', async () => {
    await library();
    await open();
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
    assert.equal(await text('dialog h3:has-text("Download")'), 'Download');
    assert.deepEqual(await page.locator('dialog input[name="downloadFormat"]').evaluateAll((els) => els.map((e) => e.value)), ['png', 'jpeg', 'webp', 'pdf']);
    assert.equal(await page.isChecked('dialog input[name="downloadFormat"][value="png"]'), true);
    assert.equal(await page.isChecked('dialog input[name="pdfLayout"][value="fit"]'), true);
    assert.equal(await page.isChecked('dialog input[name="pdfEncoding"][value="flate"]'), true);
    assert.equal(await text('#downloadQualityOut'), '90%');
    await page.check('dialog input[name="downloadFormat"][value="webp"]');
    await poll(async () => (await stored(page)).downloadFormat === 'webp', { what: 'format stored' });
    await poll(async () => (await text('#downloadFmt')) === 'WebP', { what: 'the button follows the dialog' });
    await page.locator('#downloadQualityRange').fill('0.4');
    await poll(async () => (await stored(page)).downloadQuality === 0.4, { what: 'quality stored' });
    assert.equal(await text('#downloadQualityOut'), '40%');
    await page.check('dialog input[name="pdfLayout"][value="a4"]');
    await page.check('dialog input[name="pdfEncoding"][value="jpeg"]');
    await poll(async () => { const s = await stored(page); return s.pdfLayout === 'a4' && s.pdfEncoding === 'jpeg'; }, { what: 'PDF options stored' });
    await page.selectOption('dialog select[name="language"]', 'fr');
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    assert.equal(await text('dialog section[data-section="download"] h3'), 'Téléchargement');
    assert.equal(await text('#downloadQualityOut'), '40\u00a0%', 'the percentage follows the language');
    assert.equal(await text('#downloadFormatLabel'), 'Format par défaut');
    await page.selectOption('dialog select[name="language"]', 'en');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
    // the menu opens on what the dialog stored, and the main click uses it
    await openMenu(page);
    assert.equal(await page.isChecked('#dlPop input[value="webp"]'), true);
    assert.equal(await page.locator('#dlQuality').inputValue(), '0.4');
    await closeMenu(page);
    const file = await downloadAfter(page, () => page.click('#download'));
    assert.ok(isFormat.webp(file.buf));
  });

  it('settings: the file name template names the download; a blank one goes back to the default; the title is only used when asked', async () => {
    await library([{ ...spec('Quarterly: report?', 1000, 500), url: 'https://app.example.test/some/page' }]);
    await open(1000, 500);
    const [shot] = await dbDump(page);
    const createdAt = await page.evaluate(async (id) => (await (await import(`${location.origin}/db.js`)).getShot(id)).createdAt, shot.id);
    assert.doesNotMatch((await downloadAfter(page, () => page.click('#download'))).name, /Quarterly/, 'the default name has no title');
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
    assert.equal(await text('label[for="filenameTemplate"]'), 'File name');
    assert.equal(await page.inputValue('#filenameTemplate'), '{host}_{date}_{time}');
    await page.fill('#filenameTemplate', '{title} - {host}');
    await page.press('#filenameTemplate', 'Tab'); // the change event
    await poll(async () => (await stored(page)).filenameTemplate === '{title} - {host}', { what: 'template stored' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
    assert.equal((await downloadAfter(page, () => page.click('#download'))).name, 'Quarterly- report- - app.example.test.png', 'what Windows forbids in a title becomes -');
    assert.equal((await downloadAfter(page, () => page.click('#download'))).name, suggestedFilename({ url: 'https://app.example.test/some/page', title: 'Quarterly: report?', createdAt }, 'png', '{title} - {host}'));
    await page.reload(); // the template survives a reload
    await open(1000, 500);
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
    assert.equal(await page.inputValue('#filenameTemplate'), '{title} - {host}');
    await page.fill('#filenameTemplate', '   ');
    await page.press('#filenameTemplate', 'Tab');
    await poll(async () => (await stored(page)).filenameTemplate === '{host}_{date}_{time}', { what: 'blank template: the default is stored' });
    await poll(async () => (await page.inputValue('#filenameTemplate')) === '{host}_{date}_{time}', { what: 'the field shows the default again' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
    assert.match((await downloadAfter(page, () => page.click('#download'))).name, /^app\.example\.test_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  });

  it('no CSP violation, no console error but the expected ones', async () => {
    assert.deepEqual(await page.evaluate(() => window.__csp), [], 'CSP violations');
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), [], 'console errors');
  });
});

describe('export: the grouped export', () => {
  let h, page, ids;
  const editor = {}; // id -> the PNG that the editor exports for it
  const text = (selector) => page.locator(selector).innerText();
  const specs = () => [spec('Alpha', 1600, 900), spec('Bravo', 1280, 720), spec('Charlie', 1000, 500), spec('Delta', 900, 600)];
  const fresh = async (list = specs(), settings = CLEAN) => {
    await resetLibrary(page, h, list, undefined, settings);
    await ready(page);
    return (await dbDump(page)).map((s) => s.id);
  };
  const exportAs = async (output) => { // output: 'zip' | 'pdf'
    await page.click(`#exportDialog input[name="exOutput"][value="${output}"]`);
  };
  /** Every decode of an original takes 250 ms (or back to normal), so that a test has time to click in the middle of a group. */
  const slowDecodes = (on) => page.evaluate((on) => {
    const w = /** @type {any} */ (window);
    if (on) {
      w.__decode ??= w.createImageBitmap;
      w.createImageBitmap = async (/** @type {any[]} */ ...args) => { await new Promise((done) => setTimeout(done, 250)); return w.__decode(...args); };
    } else if (w.__decode) {
      w.createImageBitmap = w.__decode;
    }
  }, on);
  /** Opens the shot by its title and waits for the editor. */
  const show = async (title, w, hgt) => {
    await titled(page, title).click();
    await waitOut(page, w, hgt);
  };

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    ids = await fresh();
    // Bravo: a black flat over the green square. Charlie: a pixelated region over the stripes, then a crop. Delta: a rectangle,
    // at 60 % of the size. Alpha stays as it was captured.
    await show('Bravo', 1280, 720);
    let m = await mapper(page, 1280, 720);
    await tool(page, 'flat');
    await drag(page, m, 990, 290, 1210, 510);
    await shotWhere(page, ids[1], (s) => s.versions[0]?.objects.length === 1, 'Bravo saved');
    await show('Charlie', 1000, 500);
    m = await mapper(page, 1000, 500);
    await tool(page, 'pixel');
    await drag(page, m, 180, 180, 420, 420);
    await shotWhere(page, ids[2], (s) => s.versions[0]?.objects.length === 1, 'Charlie saved');
    await show('Delta', 900, 600);
    m = await mapper(page, 900, 600);
    await tool(page, 'rect');
    await drag(page, m, 150, 150, 450, 350);
    await setOutput(page, '#scalePct', 60, 'Enter');
    await waitOut(page, 540, 360);
    await shotWhere(page, ids[3], (s) => s.versions[0]?.objects.length === 1 && s.versions[0].scale === 0.6, 'Delta saved');
    // The crop of Charlie is written straight into its version (the crop tool is tested elsewhere).
    await page.evaluate(async (id) => {
      const { getShot, updateShot } = await import(`${location.origin}/db.js`);
      const shot = await getShot(id);
      await updateShot(id, { versions: [{ ...shot.versions[0], crop: { x: 60, y: 60, w: 700, h: 360 } }] });
    }, ids[2]);
    await page.reload(); // the editor reads the versions back from the database: what the grouped export reads too
    await ready(page);
    // What the editor itself exports, for the comparison with the grouped export.
    await show('Bravo', 1280, 720);
    editor[ids[1]] = await decodePng(page, (await download(page)).buf);
    await show('Delta', 540, 360);
    editor[ids[3]] = await decodePng(page, (await download(page)).buf);
    await show('Charlie', 700, 360); // the editor stays on the pixelated region while the others are exported
    editor[ids[2]] = await decodePng(page, (await download(page)).buf);
  });
  after(() => h?.close());

  it('ZIP of images: each capture as displayed, the unedited one untouched, the edited ones identical to the editor export', async () => {
    const before = await page.evaluate(() => window.__c.bmp - window.__c.bmpClosed);
    await openBatch(page, ids);
    assert.equal(await text('#exTitle'), 'Export captures');
    assert.equal(await text('#exportDialog .ex-part:not([hidden]) .ex-count'), '4 captures selected');
    assert.equal(await page.isChecked('#exportDialog input[name="exOutput"][value="zip"]'), true);
    assert.equal(await page.isChecked('#exportDialog input[name="exFormat"][value="png"]'), true);
    assert.equal(await page.locator('#exportDialog .ex-note').isVisible(), true, 'the version note');
    assert.equal(await page.locator('#exQuality').isVisible(), false, 'PNG: no quality');
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    // Nothing is kept: the bitmaps are closed, the canvases of the export are gone (the editor's three remain: Fabric's two and the backdrop of the look).
    assert.equal(await page.evaluate(() => window.__c.bmp - window.__c.bmpClosed), before, 'bitmaps left open');
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), 3, 'canvases left in the page');
    assert.equal(await text('#exSummary'), 'Captures exported: 4 of 4. The file is downloading.');
    assert.match(file.name, /^obturo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/);
    assert.ok(isFormat.zip(file.buf));
    const entries = readZip(file.buf);
    assert.equal(entries.length, 4);
    for (const e of entries) assert.match(e.name, NAME('png'));
    assert.equal(sha256(entries[0].data), await originalHash(page, ids[0]), 'Alpha is unedited: its original goes in as it is');
    for (const [i, id] of [[1, ids[1]], [2, ids[2]], [3, ids[3]]]) {
      const image = await decodePng(page, entries[i].data);
      assert.deepEqual([image.width, image.height], [editor[id].width, editor[id].height], `size of entry ${i}`);
      if (i < 3) {
        assert.equal(Buffer.compare(image.data, editor[id].data), 0, `entry ${i}: not pixel for pixel the export of the editor (${diffInfo(image, editor[id])})`);
      } else { // a downscaled image: the browser resamples the original a hair differently for a bitmap it has not shown yet
        const { max, share } = difference(image, editor[id]);
        assert.ok(max <= 3 && share < 0.03, `entry ${i}: ${max} levels at most, ${(share * 100).toFixed(2)}% of the pixels differ from the export of the editor`);
      }
    }
    assert.deepEqual([editor[ids[2]].width, editor[ids[2]].height], [700, 360], 'the crop of Charlie');
    const bravo = await decodePng(page, entries[1].data);
    assert.deepEqual(px(bravo, 1100, 400), [0, 0, 0, 255], 'the hidden square stays hidden in the grouped export');
    assert.deepEqual(px(bravo, 700, 600), [255, 255, 255, 255], 'around it the image is untouched');
    await closeBatch(page);
    // The editor, open on Charlie, still draws its own image (the pixelated region reads the image of the editor).
    const again = await decodePng(page, (await download(page)).buf);
    assert.equal(Buffer.compare(again.data, editor[ids[2]].data), 0, 'the editor lost its image while another capture was exported');
  });

  it('ZIP of images: the entries follow the file name template, a repeated name is numbered, the file of the group keeps its own name', async () => {
    try {
      for (const { template, names } of [{ template: '{title}', names: ['Alpha.png', 'Bravo.png', 'Charlie.png', 'Delta.png'] }, { template: 'shot', names: ['shot.png', 'shot-1.png', 'shot-2.png', 'shot-3.png'] }]) {
        await seedSettings(page, { filenameTemplate: template });
        await openBatch(page, ids);
        const file = await downloadAfter(page, () => page.click('#exStart'));
        await batchDone(page);
        assert.match(file.name, /^obturo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/);
        assert.deepEqual(readZip(file.buf).map((e) => e.name), names, template);
        await closeBatch(page);
      }
    } finally {
      await seedSettings(page, { filenameTemplate: '{host}_{date}_{time}' });
    }
  });

  it('JPEG ZIP: the quality counts, the entries are JPEG files, and the Settings are not written', async () => {
    await openBatch(page, ids);
    await page.click('#exportDialog input[name="exFormat"][value="jpeg"]');
    assert.equal(await page.locator('#exQuality').isVisible(), true);
    await page.locator('#exQuality').fill('0.3');
    assert.equal(await text('#exQualityLabel + .dl-slider .dl-pct'), '30%');
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const entries = readZip(file.buf);
    assert.equal(entries.length, 4);
    for (const e of entries) {
      assert.match(e.name, NAME('jpg'));
      assert.ok(isFormat.jpeg(e.data), e.name);
    }
    const bravo = await decodeImage(page, entries[1].data, 'image/jpeg');
    near(px(bravo, 1100, 400).slice(0, 3), [0, 0, 0], 8, 'the hidden square');
    const s = await stored(page);
    assert.deepEqual([s.downloadFormat, s.downloadQuality], ['png', 0.9], 'the Settings are as they were');
    await closeBatch(page);
    await page.reload(); // the dialog starts from the Settings again
    await ready(page);
  });

  it('multipage PDF: one page per capture, fitted or A4, lossless or light', async () => {
    await openBatch(page, [ids[0], ids[1]]);
    assert.equal(await text('#exportDialog .ex-part:not([hidden]) .ex-count'), '2 captures selected');
    await exportAs('pdf');
    assert.equal(await page.locator('#exportDialog input[name="exFormat"]').first().isVisible(), false, 'the image format is for the ZIP');
    assert.equal(await page.locator('#exportDialog input[name="exLayout"]').first().isVisible(), true);
    assert.equal(await page.locator('#exQuality').isVisible(), false, 'lossless pictures: no quality');
    let file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    assert.match(file.name, /^obturo_.*\.pdf$/);
    assert.ok(isFormat.pdf(file.buf));
    assert.deepEqual(await readPdf(file.buf), [
      { width: 1200, height: 675, filter: '/FlateDecode', imageWidth: 1600, imageHeight: 900 },
      { width: 960, height: 540, filter: '/FlateDecode', imageWidth: 1280, imageHeight: 720 },
    ]);
    await closeBatch(page);

    await openBatch(page, [ids[0], ids[1]]);
    await exportAs('pdf');
    await page.click('#exportDialog input[name="exLayout"][value="a4"]');
    await page.click('#exportDialog input[name="exEncoding"][value="jpeg"]');
    assert.equal(await page.locator('#exQuality').isVisible(), true, 'light pictures: the quality counts');
    file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    assert.deepEqual(await readPdf(file.buf), [
      { width: 595, height: 842, filter: '/DCTDecode', imageWidth: 1600, imageHeight: 900 },
      { width: 595, height: 842, filter: '/DCTDecode', imageWidth: 1280, imageHeight: 720 },
    ]);
    const s = await stored(page);
    assert.deepEqual([s.pdfLayout, s.pdfEncoding], ['fit', 'flate'], 'the PDF options of the Settings are as they were');
    await closeBatch(page);
    await page.reload(); // the dialog starts from the Settings again
    await ready(page);
  });

  it('a PDF default makes the dialog start on the PDF output', async () => {
    await seedSettings(page, { downloadFormat: 'pdf' });
    await openBatch(page, ids);
    assert.equal(await page.isChecked('#exportDialog input[name="exOutput"][value="pdf"]'), true);
    await page.click('#exCancel');
    await page.waitForSelector('#exportDialog', { state: 'hidden' });
    await seedSettings(page, CLEAN);
  });

  it('cancel in the middle of a group: the export stops, nothing is downloaded, the interface is usable', async () => {
    await slowDecodes(true); // each decode takes 250 ms, so that there is time to click
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await openBatch(page, ids);
    await page.click('#exStart');
    await page.waitForFunction(() => /Exporting capture 2 of 4/.test(document.getElementById('exProgressText')?.textContent ?? ''), null, { timeout: 15_000 });
    assert.equal(await page.locator('#exStart').isVisible(), false, 'no second start while running');
    assert.ok(Number(await page.getAttribute('#exportDialog progress', 'value')) > 0, 'the progress moves');
    await page.click('#exCancel');
    await batchDone(page);
    assert.equal(await text('#exSummary'), 'Export canceled. Nothing was downloaded.');
    assert.equal(await page.locator('#exCancel').isVisible(), false);
    await sleep(700);
    assert.equal(downloads.length, 0, 'a canceled export downloads nothing');
    await closeBatch(page);
    await slowDecodes(false);
    // Escape cancels a running export too, and a second export works afterwards
    await slowDecodes(true);
    await openBatch(page, ids);
    await page.click('#exStart');
    await page.waitForFunction(() => /Exporting capture 2 of 4/.test(document.getElementById('exProgressText')?.textContent ?? ''), null, { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await batchDone(page);
    assert.equal(await text('#exSummary'), 'Export canceled. Nothing was downloaded.');
    await closeBatch(page);
    await slowDecodes(false);
    await openBatch(page, ids);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    assert.equal(readZip(file.buf).length, 4, 'a fresh export after the cancels');
    await closeBatch(page);
    assert.equal(downloads.length, 1);
    page.removeAllListeners('download');
    const single = await downloadAfter(page, () => page.click('#download'));
    assert.ok(isFormat.png(single.buf), 'the Download button of the editor still works');
  });

  it('a capture that cannot be exported is reported with its cause, the others are exported', async () => {
    // JPEG, so that every image is decoded (a PNG original that is not edited goes into the archive as it is, undecoded)
    const list = await fresh([spec('One', 800, 600), spec('Two', 800, 600), spec('Three', 800, 600)], { ...CLEAN, downloadFormat: 'jpeg' });
    await setOriginal(page, list[0], null); // gone
    await setOriginal(page, list[1], [1, 2, 3, 4, 5]); // not an image
    await openBatch(page, list);
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    assert.equal(await text('#exSummary'), 'Captures exported: 1 of 3. The file is downloading.');
    const items = await page.locator('#exFailures li').allInnerTexts();
    assert.equal(items.length, 2);
    assert.match(items[0], /^example\.test_.*\.jpg - the capture no longer exists$/);
    assert.match(items[1], /^example\.test_.*\.jpg - the image can't be read$/);
    const entries = readZip(file.buf);
    assert.equal(entries.length, 1);
    assert.ok(isFormat.jpeg(entries[0].data));
    await closeBatch(page);

    // nothing can be exported: no file, a clear message
    await setOriginal(page, list[2], null);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await openBatch(page, list);
    await page.click('#exStart');
    await batchDone(page);
    assert.equal(await text('#exSummary'), 'Nothing could be exported (0 of 3).');
    assert.equal(await page.locator('#exFailures li').count(), 3);
    await sleep(500);
    assert.equal(downloads.length, 0);
    page.removeAllListeners('download');
    await closeBatch(page);
    // an id that does not exist is a failure too, without stopping the others
    await openBatch(page, [list[2], 987654]);
    await page.click('#exStart');
    await batchDone(page);
    assert.equal(await page.locator('#exFailures li').count(), 2);
    assert.match(await text('#exFailures li:first-child'), /^#987654 - the capture no longer exists$/);
    await closeBatch(page);
  });

  it('too many captures: the dialog says so and cannot start', async () => {
    await openBatch(page, Array.from({ length: 201 }, (_, i) => 5000 + i));
    assert.equal(await text('#exportDialog .ex-part:not([hidden]) .ex-count'), '201 captures selected');
    assert.match(await text('#exportDialog .ex-warn'), /^An export takes 200 captures at most/);
    assert.equal(await page.locator('#exStart').isDisabled(), true);
    await page.click('#exCancel');
    await page.waitForSelector('#exportDialog', { state: 'hidden' });
    await openBatch(page, [5000]); // one: singular, no warning
    assert.equal(await text('#exportDialog .ex-part:not([hidden]) .ex-count'), '1 capture selected');
    assert.equal(await page.locator('#exportDialog .ex-warn').isVisible(), false);
    assert.equal(await page.locator('#exStart').isDisabled(), false);
    await page.click('#exCancel');
    await page.waitForSelector('#exportDialog', { state: 'hidden' });
  });

  it('edited captures that display their original: the dialog counts them and says they go out without their changes', async () => {
    const list = await fresh([spec('Plain', 800, 600), spec('Edited', 800, 600), spec('Edited too', 800, 600)]);
    // two of them have a version but show the original (the "Original" button was the last choice)
    const setActive = (ids, active) => page.evaluate(async ({ ids, active }) => {
      const { updateShot } = await import(`${location.origin}/db.js`);
      for (const id of ids) await updateShot(id, { versions: [{ name: 'V1', crop: null, scale: 1, objects: [] }], active });
    }, { ids, active });
    await setActive([list[1], list[2]], -1);
    await page.reload();
    await ready(page);
    const notice = page.locator('#exportDialog .ex-asis');
    await openBatch(page, list);
    assert.equal(await notice.isVisible(), true);
    assert.equal(await notice.innerText(), '2 edited captures are set to Original: they are exported as displayed, without their changes.');
    assert.equal(await page.locator('#exportDialog .ex-note').isVisible(), true, 'the general rule is still written');
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const entries = readZip(file.buf);
    assert.deepEqual(entries.map((e) => sha256(e.data)), await Promise.all(list.map((id) => originalHash(page, id))), 'exported as displayed: the originals, as they are');
    await closeBatch(page);

    await openBatch(page, [list[0], list[1]]); // one of them: singular
    assert.equal(await notice.innerText(), '1 edited capture is set to Original: it is exported as displayed, without its changes.');
    await seedSettings(page, { language: 'fr' }); // follows the language while the dialog is open
    await page.waitForFunction(() => /^1 capture éditée est réglée sur Original/.test(document.querySelector('#exportDialog .ex-asis').textContent));
    await seedSettings(page, { language: 'en' });
    await page.waitForFunction(() => /^1 edited capture/.test(document.querySelector('#exportDialog .ex-asis').textContent));
    await page.click('#exCancel');
    await page.waitForSelector('#exportDialog', { state: 'hidden' });

    await openBatch(page, [list[0]]); // nothing edited: no notice
    assert.equal(await notice.isVisible(), false);
    await page.click('#exCancel');
    await page.waitForSelector('#exportDialog', { state: 'hidden' });

    await setActive([list[1], list[2]], 0); // they display their version now: nothing to warn about
    await openBatch(page, list);
    assert.equal(await notice.isVisible(), false);
    await page.click('#exCancel');
    await page.waitForSelector('#exportDialog', { state: 'hidden' });
  });

  it('what is on screen in the editor is exported, even before its autosave', async () => {
    const list = await fresh([spec('Left', 1280, 720), spec('Right', 1280, 720)]);
    await show('Right', 1280, 720);
    const m = await mapper(page, 1280, 720);
    await tool(page, 'flat');
    await drag(page, m, 990, 290, 1210, 510);
    const row = (await dbDump(page)).find((s) => s.id === list[1]);
    await openBatch(page, [list[1]]); // within the 500 ms of the autosave, in all likelihood
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const image = await decodePng(page, readZip(file.buf)[0].data);
    assert.deepEqual(px(image, 1100, 400), [0, 0, 0, 255], `the unsaved flat is in the export (it was ${row.versions.length ? 'already' : 'not yet'} saved)`);
    await closeBatch(page);
  });

  it('the language changes live while the dialog is open', async () => {
    const two = await fresh([spec('Left', 800, 600), spec('Right', 800, 600)]);
    await openBatch(page, two);
    assert.equal(await text('#exTitle'), 'Export captures');
    await seedSettings(page, { language: 'fr' });
    await page.waitForFunction(() => document.getElementById('exTitle').textContent === 'Exporter des captures');
    assert.equal(await text('#exportDialog .ex-part:not([hidden]) .ex-count'), '2 captures sélectionnées');
    assert.equal(await text('#exStart'), 'Exporter');
    assert.equal(await text('#exCancel'), 'Annuler');
    assert.match(await text('#exportDialog .ex-note'), /^Chaque capture est exportée telle qu'elle est affichée/);
    await page.click('#exportDialog input[name="exOutput"][value="pdf"]');
    assert.equal(await text('#exportDialog .row:has(input[name="exLayout"]) > span'), 'Pages');
    await page.click('#exStart');
    await batchDone(page);
    assert.match(await text('#exSummary'), /^Captures exportées\u00a0: 2 sur 2\./);
    await seedSettings(page, { language: 'en' });
    await page.waitForFunction(() => /^Captures exported: 2 of 2/.test(document.getElementById('exSummary').textContent));
    await closeBatch(page);
  });

  it('the Export button of the selection bar of the history exports exactly the selected captures', async () => {
    const list = await fresh(specs());
    await page.click('#historyAll');
    await page.waitForSelector('#history[open]');
    await page.waitForFunction(() => document.querySelectorAll('#hvGrid .hv-card').length === 4);
    for (const i of [0, 2]) { // the first and the third card, most recent first: the last and the second capture
      const card = page.locator('#hvGrid .hv-card').nth(i);
      await card.hover();
      await card.locator('input[type=checkbox]').click();
    }
    await page.waitForSelector('#hvBulk:not([hidden])');
    assert.equal(await text('#bulkExport'), 'Export…');
    await page.click('#bulkExport');
    await page.waitForSelector('#exportDialog[open]');
    assert.equal(await text('#exportDialog .ex-part:not([hidden]) .ex-count'), '2 captures selected');
    const file = await downloadAfter(page, () => page.click('#exStart'));
    await batchDone(page);
    const entries = readZip(file.buf);
    assert.deepEqual(entries.map((e) => sha256(e.data)), [await originalHash(page, list[1]), await originalHash(page, list[3])], 'the two selected captures, in the order of the captures');
    await closeBatch(page);
    assert.equal(await page.evaluate(() => /** @type {HTMLDialogElement} */ (document.getElementById('history')).open), true, 'the history sheet is still there, with its selection');
    assert.match(await text('#hvSelCount'), /^2 selected$/);
    await page.click('#hvClose');
    await page.waitForSelector('#history', { state: 'hidden' });
  });

  it('no CSP violation, no console error but the expected ones', async () => {
    assert.deepEqual(await page.evaluate(() => window.__csp), [], 'CSP violations');
    assert.deepEqual(h.errors.filter((e) => !/^\[console\.error\] (Obturo:|Failed to load resource)/.test(e)), [], 'console errors');
  });
});
