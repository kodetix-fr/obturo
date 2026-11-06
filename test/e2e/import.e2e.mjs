// Import of images that come from outside: a file picked (the button), an image pasted (Ctrl+V) or dropped on the library. The
// events are the ones a user makes (a paste event with a clipboard, a drag with files, a file chooser), built in the page: no
// permission is involved, which is the point (the manifest is pinned by manifest.test.js).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, poll, ready, resetLibrary, sha256, spec, waitOut } from './support/editor.mjs';
import enUi from '../../locales/en.ui.js';

// A 1x1 GIF, the smallest one there is (a format the browser decodes and cannot encode).
const GIF = 'R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

/** Defines window.__make(specs) in the page: File objects from specs { name, type, w, h, color } or { name, type, b64 }. */
const install = (page) => page.evaluate(() => {
  window.__make = (specs) => Promise.all(specs.map(async ({ name, type, w = 320, h = 200, color = '#d00', b64, text }) => {
    if (b64 !== undefined) return new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type });
    if (text !== undefined) return new File([text], name, { type });
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#00d';
    g.fillRect(0, 0, Math.floor(w / 2), Math.floor(h / 2)); // the top left quarter is blue: the image is not uniform
    const blob = await canvas.convertToBlob({ type });
    return new File([blob], name, { type: blob.type });
  }));
});

describe('library: import of images (picked, pasted, dropped)', () => {
  let h, page;
  const count = async () => (await dbDump(page)).length;
  const bannerText = () => page.evaluate(() => (document.getElementById('banner').hidden ? null : document.getElementById('bannerText').textContent));
  /** What the page stores of shot `id`: its fields, and the first bytes and the size of its original. */
  const stored = (id) => page.evaluate(async (id) => {
    const { getShot, getOriginal } = await import(`${location.origin}/db.js`);
    const shot = await getShot(id);
    const blob = await getOriginal(id);
    return { url: shot.url, title: shot.title, w: shot.w, h: shot.h, bytes: shot.bytes, type: blob.type, size: blob.size, head: [...new Uint8Array(await blob.slice(0, 8).arrayBuffer())] };
  }, id);
  const last = async () => (await dbDump(page)).at(-1);
  /** A paste of `specs` on `target` (a selector): whether the page took it (preventDefault). */
  const paste = (specs, target = 'body') => page.evaluate(async ({ specs, target }) => {
    const data = new DataTransfer();
    for (const f of await window.__make(specs)) data.items.add(f);
    const e = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector(target).dispatchEvent(e);
    return e.defaultPrevented;
  }, { specs, target });
  /** A drag of `specs` over the page, then (unless `leave`) the drop. Returns what the page said at each step. */
  const drag = (specs, { drop = true } = {}) => page.evaluate(async ({ specs, drop }) => {
    const data = new DataTransfer();
    for (const f of await window.__make(specs)) data.items.add(f);
    const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true });
    document.body.dispatchEvent(over);
    const shown = !document.getElementById('dropHint').hidden;
    let dropped = null;
    if (drop) {
      const e = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      dropped = e.defaultPrevented;
    }
    return { overPrevented: over.defaultPrevented, shown, dropped, hiddenAfter: document.getElementById('dropHint').hidden };
  }, { specs, drop });
  const grew = (before, n = 1) => poll(async () => (await count()) === before + n, { what: `${n} shot(s) added to ${before}` });

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
  });
  after(() => h?.close());

  const fresh = async (specs = [spec('First', 1600, 900)]) => {
    await resetLibrary(page, h, specs);
    if (specs.length) { await ready(page); await waitOut(page, specs.at(-1).w, specs.at(-1).h); } else await page.waitForSelector('#stageMsg[data-state="empty"]:not([hidden])');
    await install(page);
  };

  it('nothing is loaded for it at startup: import.js comes with the first import', async () => {
    const requested = [];
    const watch = (r) => requested.push(r.url());
    page.on('request', watch);
    try {
      await fresh();
      assert.equal(requested.some((u) => u.endsWith('/import.js')), false, 'import.js is not fetched with the library');
      await paste([{ name: 'first.png', type: 'image/png' }]);
      await poll(async () => requested.some((u) => u.endsWith('/import.js')), { what: 'import.js fetched by the first import' });
    } finally {
      page.off('request', watch);
    }
  });

  it('a file picked with the button: a PNG is kept as it is, titled by its name, with no address, and opens in the editor', async () => {
    await fresh();
    const before = await count();
    // the file: made in the page, taken out as bytes (what a disk would give)
    const b64 = await page.evaluate(async () => {
      const [f] = await window.__make([{ name: 'quarterly chart.png', type: 'image/png', w: 640, h: 360 }]);
      return btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())));
    });
    const buffer = Buffer.from(b64, 'base64');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#importBtn')]);
    assert.equal(chooser.isMultiple(), true, 'several files can be picked');
    await chooser.setFiles([{ name: 'quarterly chart.png', mimeType: 'image/png', buffer }]);
    await grew(before);
    await waitOut(page, 640, 360);
    const s = await stored((await last()).id);
    assert.deepEqual([s.url, s.title, s.w, s.h, s.type], ['', 'quarterly chart', 640, 360, 'image/png']);
    assert.equal(s.size, buffer.length, 'the same bytes: a PNG is not written again');
    assert.equal(sha256(Buffer.from(await page.evaluate(async (id) => {
      const { getOriginal } = await import(`${location.origin}/db.js`);
      return [...new Uint8Array(await (await getOriginal(id)).arrayBuffer())];
    }, (await last()).id))), sha256(buffer));
    assert.equal(await bannerText(), null, 'nothing to say');
  });

  it('an image pasted (Ctrl+V): titled "Pasted image", opens in the editor, the paste is taken by the page', async () => {
    await fresh();
    const before = await count();
    assert.equal(await paste([{ name: 'image.png', type: 'image/png', w: 500, h: 300 }]), true, 'the page took the paste');
    await grew(before);
    await waitOut(page, 500, 300);
    assert.equal((await stored((await last()).id)).title, enUi['import.pasted']);
  });

  // The real thing: an image on the real clipboard (what a screenshot tool or "copy image" leaves there), the real key.
  it('a real Ctrl+V with an image on the clipboard imports it', async () => {
    await fresh();
    const before = await count();
    await page.bringToFront();
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(280, 180);
      const g = canvas.getContext('2d');
      g.fillStyle = '#0a0';
      g.fillRect(0, 0, 280, 180);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await canvas.convertToBlob({ type: 'image/png' }) })]);
    });
    await page.keyboard.press('ControlOrMeta+V');
    await grew(before);
    await waitOut(page, 280, 180);
    assert.equal((await stored((await last()).id)).title, enUi['import.pasted'], 'a browser names a pasted image "image.png"');
  });

  it('a paste with only text is left alone, and so is a paste into a field', async () => {
    await fresh();
    const before = await count();
    assert.equal(await paste([{ name: 'notes.txt', type: 'text/plain', text: 'hello' }]), false, 'a file that is not an image: not taken');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'field'; document.body.append(i); });
    assert.equal(await paste([{ name: 'image.png', type: 'image/png' }], '#field'), false, 'an image pasted into a text field is the field\'s');
    await page.evaluate(() => document.getElementById('field').remove());
    await new Promise((done) => setTimeout(done, 600));
    assert.equal(await count(), before, 'nothing was added');
  });

  it('images dropped: the box shows while they are over the page, then the shots are added, the last one opens', async () => {
    await fresh();
    const before = await count();
    const r = await drag([{ name: 'one.png', type: 'image/png', w: 300, h: 200 }, { name: 'two.png', type: 'image/png', w: 400, h: 250 }, { name: 'three.png', type: 'image/png', w: 500, h: 320 }]);
    assert.deepEqual([r.overPrevented, r.shown, r.dropped, r.hiddenAfter], [true, true, true, true], 'the page takes the drag (the browser would open the file), the box shows, the drop hides it');
    await grew(before, 3);
    await waitOut(page, 500, 320);
    assert.deepEqual((await dbDump(page)).slice(-3).map((s) => [s.title, s.w, s.h]), [['one', 300, 200], ['two', 400, 250], ['three', 500, 320]], 'in the order dropped');
  });

  it('the box goes when the drag leaves the window', async () => {
    await fresh();
    await drag([{ name: 'one.png', type: 'image/png' }], { drop: false });
    assert.equal(await page.evaluate(() => document.getElementById('dropHint').hidden), false);
    await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })));
    assert.equal(await page.evaluate(() => document.getElementById('dropHint').hidden), true);
  });

  it('a JPEG, a WebP and a GIF are stored as PNG, same size: nothing is lost, only the format changes', async () => {
    await fresh();
    const before = await count();
    await drag([
      { name: 'photo.jpg', type: 'image/jpeg', w: 400, h: 300 },
      { name: 'modern.webp', type: 'image/webp', w: 360, h: 240 },
      { name: 'dot.gif', type: 'image/gif', b64: GIF },
    ]);
    await grew(before, 3);
    const rows = (await dbDump(page)).slice(-3);
    assert.deepEqual(rows.map((s) => [s.title, s.w, s.h]), [['photo', 400, 300], ['modern', 360, 240], ['dot', 1, 1]]);
    for (const row of rows) {
      const s = await stored(row.id);
      assert.deepEqual([s.type, s.head], ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], row.title);
    }
    await waitOut(page, 1, 1);
  });

  it('a thumbnail is made for an imported shot, like for a capture, and its card has no site', async () => {
    await fresh();
    const before = await count();
    await paste([{ name: 'card.png', type: 'image/png', w: 640, h: 400 }]);
    await grew(before);
    await poll(async () => (await last()).hasThumb, { what: 'thumbnail of the imported shot' });
    assert.equal(await page.locator('#strip li.shot').last().locator('.host').count(), 1);
    assert.equal(await page.locator('#strip li.shot').first().locator('.host').innerText(), 'card', 'the title stands in for the site (no address)');
  });

  it('files that are not images, and images that are too big, are refused with the reason; the good ones are still added', async () => {
    await fresh();
    let before = await count();
    await drag([{ name: 'notes.txt', type: 'text/plain', text: 'hello' }]);
    await poll(async () => (await bannerText()) === enUi['import.err.type'].replace('{name}', 'notes.txt'), { what: 'not an image' });
    await drag([{ name: 'fake.png', type: 'image/png', text: 'not a png at all' }]);
    await poll(async () => (await bannerText()) === enUi['import.err.type'].replace('{name}', 'fake.png'), { what: 'a file that says it is a PNG and is not' });
    await drag([{ name: 'wide.png', type: 'image/png', w: 17000, h: 10 }]);
    await poll(async () => (await bannerText()) === enUi['import.err.big'].replace('{name}', 'wide.png'), { what: 'too wide' });
    await drag([{ name: 'huge.png', type: 'image/png', w: 6000, h: 5400 }]); // 32.4 million pixels
    await poll(async () => (await bannerText()) === enUi['import.err.big'].replace('{name}', 'huge.png'), { what: 'too many pixels', timeout: 20_000 });
    assert.equal(await count(), before, 'nothing was added by any of them');
    // one good image among the bad ones: it is added and opened, the banner names the first that was refused
    before = await count();
    await drag([{ name: 'broken.txt', type: 'text/plain', text: 'x' }, { name: 'good.png', type: 'image/png', w: 420, h: 280 }]);
    await grew(before);
    await waitOut(page, 420, 280);
    await poll(async () => (await bannerText()) === enUi['import.err.type'].replace('{name}', 'broken.txt'), { what: 'the banner names the refused file' });
  });

  // A few bytes can declare an image of billions of pixels. The header is read before the decoder is asked to build it: the file below
  // would not decode anyway (it is only a header), so "too large" and not "not an image" proves that the size was read first.
  it('a small file that declares a huge image is refused as too large, before any decoding', async () => {
    await fresh();
    const before = await count();
    const be32 = (n) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), be32(13), Buffer.from('IHDR'), be32(40000), be32(40000), Buffer.from([8, 6, 0, 0, 0, 0, 0, 0, 0])]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0xff, 0xff, 0xff, 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    await drag([{ name: 'bomb.png', type: 'image/png', b64: png.toString('base64') }]);
    await poll(async () => (await bannerText()) === enUi['import.err.big'].replace('{name}', 'bomb.png'), { what: 'a PNG that declares 40,000 x 40,000 px' });
    await drag([{ name: 'bomb.jpg', type: 'image/jpeg', b64: jpeg.toString('base64') }]);
    await poll(async () => (await bannerText()) === enUi['import.err.big'].replace('{name}', 'bomb.jpg'), { what: 'a JPEG that declares 65,535 x 65,535 px' });
    assert.equal(await count(), before);
  });

  it('with an empty library, the first import opens the editor; the empty state is gone', async () => {
    await fresh([]);
    assert.equal(await count(), 0);
    await paste([{ name: 'first.png', type: 'image/png', w: 800, h: 450 }]);
    await grew(0);
    await ready(page);
    await waitOut(page, 800, 450);
    assert.equal(await page.evaluate(() => document.body.hasAttribute('data-empty')), false);
  });

  it('with a dialog open, a paste or a drop imports nothing (but a drop never opens the file)', async () => {
    await fresh();
    const before = await count();
    await page.click('#settingsBtn');
    await page.waitForSelector('dialog#settings[open]');
    assert.equal(await paste([{ name: 'behind.png', type: 'image/png' }]), false, 'the paste is not taken behind a dialog');
    const r = await drag([{ name: 'behind.png', type: 'image/png' }]);
    assert.deepEqual([r.overPrevented, r.shown, r.dropped], [true, false, true], 'the drag is taken (the file is not opened), the box is not shown, nothing is imported');
    await new Promise((done) => setTimeout(done, 600));
    assert.equal(await count(), before);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
  });

  it('a second tab (read-only): the button is disabled, a paste imports nothing, a drop does not open the file', async () => {
    await fresh();
    const before = await count();
    const second = await h.context.newPage();
    try {
      await second.goto(h.url());
      await second.waitForSelector('#stageMsg[data-state="error"]:not([hidden])', { timeout: 20_000 }); // read-only
      await install(second);
      assert.equal(await second.locator('#importBtn').isDisabled(), true);
      const taken = await second.evaluate(async () => {
        const data = new DataTransfer();
        data.items.add((await window.__make([{ name: 'ro.png', type: 'image/png' }]))[0]);
        const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        document.body.dispatchEvent(paste);
        const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
        document.body.dispatchEvent(drop);
        return { paste: paste.defaultPrevented, drop: drop.defaultPrevented };
      });
      assert.deepEqual(taken, { paste: false, drop: true });
      await new Promise((done) => setTimeout(done, 600));
      assert.equal(await count(), before, 'nothing was added from the read-only tab');
      assert.equal(second.url().split('#')[0], h.url(), 'the tab did not navigate to the dropped file');
    } finally {
      await second.close();
    }
  });

  it('no console error over the whole session', () => {
    assert.deepEqual(h.errors, []);
  });
});
