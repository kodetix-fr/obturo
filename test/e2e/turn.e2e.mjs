// The quarter turn of a capture, in the real extension: the image, the crop and what is drawn on it turn together, the original is never
// touched, a hiding region and a marker stay upright, and the turn comes back after a reload. The steps follow one another.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { dbDump, decodePng, download, drag, mapper, originalHash, poll, px, ready, resetLibrary, spec, tool, waitOut } from './support/editor.mjs';

describe('editor: turn', () => {
  let h, page, m, id, hash;
  const W = 1600, H = 900;
  const shot = async () => (await dbDump(page)).find((x) => x.id === id);
  const version = async () => { const s = await shot(); return s.versions[s.active]; };
  const objectsOf = async () => (await version())?.objects ?? [];
  const pageErrors = () => h.errors.filter((e) => e.startsWith('[pageerror]'));
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} is not ${b}`);
  const turn = async (w, hh) => { await page.click('#rotate'); await waitOut(page, w, hh); m = await mapper(page, w, hh); };
  const center = (o) => ({ x: o.left + (o.width * (o.scaleX ?? 1) + (o.strokeWidth || 0)) / 2, y: o.top + (o.height * (o.scaleY ?? 1) + (o.strokeWidth || 0)) / 2 });

  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    page.on('dialog', (d) => d.accept());
    await resetLibrary(page, h, [spec('Turn', W, H, true)]);
    await ready(page);
    await waitOut(page, W, H);
    id = (await dbDump(page))[0].id;
    hash = await originalHash(page, id);
    m = await mapper(page, W, H);
  });
  after(() => h?.close());

  it('a quarter turn turns the image and what is drawn on it, as one step that can be undone', async () => {
    await tool(page, 'arrow');
    await drag(page, m, 100, 100, 400, 100);
    await tool(page, 'select');
    await poll(async () => (await objectsOf()).length === 1, { what: 'an arrow saved' });
    await turn(H, W);
    const v = await poll(async () => { const x = await version(); return x?.turn === 1 ? x : null; }, { what: 'the version records the turn' });
    assert.equal(v.objects.length, 1);
    const { buf } = await download(page);
    const img = await decodePng(page, buf);
    assert.deepEqual([img.width, img.height], [H, W], 'the export is the turned image');
    assert.deepEqual(px(img, 500, 1100).slice(0, 3), [0, 170, 0], 'the green square went from (1100, 400) to (500, 1100)');
    const red = [];
    for (let x = 780; x <= 820; x++) { const [r, g, b] = px(img, x, 250); if (r > 180 && g < 100 && b < 100) red.push(x); }
    assert.ok(red.length >= 3, `the arrow is now vertical near x 800: ${red}`);
    const flat = [];
    for (let x = 200; x <= 300; x++) { const [r, g, b] = px(img, x, 100); if (r > 180 && g < 100 && b < 100) flat.push(x); }
    assert.equal(flat.length, 0, 'and it is no longer where it was drawn');
    await page.keyboard.press('Control+z');
    await waitOut(page, W, H);
    await poll(async () => ((await version()).turn ?? 0) === 0, { what: 'undo gives the turn back' });
    await page.keyboard.press('Control+y');
    await waitOut(page, H, W);
    await poll(async () => (await version()).turn === 1, { what: 'redo turns again' });
    assert.deepEqual(await originalHash(page, id), hash, 'the original is never rewritten');
    assert.deepEqual(pageErrors(), []);
  });

  it('the hiding regions and the markers stay upright and keep their place on the image', async () => {
    m = await mapper(page, H, W);
    await tool(page, 'pixel');
    await drag(page, m, 300, 1200, 700, 1400); // 400 x 200 in the turned image
    await tool(page, 'rect');
    await drag(page, m, 100, 100, 260, 220); // an outline, 160 x 120
    await tool(page, 'flat');
    await drag(page, m, 500, 300, 640, 380); // a solid fill, 140 x 80
    await tool(page, 'marker');
    await page.mouse.click(...m.pt(300, 500));
    await page.keyboard.press('Escape');
    await tool(page, 'select');
    await poll(async () => (await objectsOf()).some((o) => o.type === 'PixelRegion') && (await objectsOf()).some((o) => o.type === 'Marker') && (await objectsOf()).filter((o) => o.type === 'Rect').length === 2, { what: 'a region, two rectangles and a marker saved' });
    const before = await objectsOf();
    const region = before.find((o) => o.type === 'PixelRegion'), marker = before.find((o) => o.type === 'Marker');
    const rc = center(region), mc = { x: marker.left + marker.height / 2, y: marker.top + marker.height / 2 };
    await turn(W, H);
    const after = await poll(async () => { const v = await version(); return v.turn === 2 ? v.objects : null; }, { what: 'turned again' });
    const region2 = after.find((o) => o.type === 'PixelRegion'), marker2 = after.find((o) => o.type === 'Marker');
    assert.equal(region2.angle ?? 0, 0, 'a hiding region is never tilted');
    for (const kind of ['rect', 'flat']) {
      const o = after.find((x) => x.type === 'Rect' && !!x.fill === (kind === 'flat'));
      const was = before.find((x) => x.type === 'Rect' && !!x.fill === (kind === 'flat'));
      assert.equal(o.angle ?? 0, 0, `${kind}: a rectangle stays upright, its box turns`);
      near(o.width, was.height, `${kind}: the box turns (width)`);
      near(o.height, was.width, `${kind}: the box turns (height)`);
      near(center(o).x, W - center(was).y, `${kind}: it follows the image (x)`);
      near(center(o).y, center(was).x, `${kind}: it follows the image (y)`);
    }
    near(region2.width, region.height, 'the sides of the region box are swapped (width)');
    near(region2.height, region.width, 'the sides of the region box are swapped (height)');
    near(center(region2).x, W - rc.y, 'the region follows the image (x)');
    near(center(region2).y, rc.x, 'the region follows the image (y)');
    assert.equal(marker2.angle ?? 0, 0, 'a marker stays upright');
    near(marker2.left + marker2.height / 2, W - mc.y, 'the disc of the marker follows the image (x)');
    near(marker2.top + marker2.height / 2, mc.x, 'the disc of the marker follows the image (y)');
    assert.deepEqual(pageErrors(), []);
  });

  it('the crop turns with the image, and four turns bring everything back', async () => {
    await turn(H, W); // three turns
    await turn(W, H); // four: the original orientation, objects where they were
    const v = await poll(async () => { const x = await version(); return (x.turn ?? 0) === 0 && x.objects.some((o) => o.type === 'Arrow') ? x : null; }, { what: 'four turns are none' });
    const arrow = v.objects.find((o) => o.type === 'Arrow');
    near(arrow.left, 100, 'the arrow is back (x)');
    near(arrow.top, 100, 'the arrow is back (y)');
    await page.click('#crop');
    await drag(page, m, W, H, 1000, 500);
    await page.click('#cropOk');
    await poll(async () => (await version()).crop, { what: 'a crop saved' });
    const crop = (await version()).crop;
    await page.click('#rotate');
    const turned = await poll(async () => { const x = await version(); return x.turn === 1 ? x : null; }, { what: 'turned with a crop' });
    assert.deepEqual([turned.crop.x, turned.crop.y, turned.crop.w, turned.crop.h], [H - crop.y - crop.h, crop.x, crop.h, crop.w], 'the crop covers the same part of the image');
    await waitOut(page, Math.floor(crop.h), Math.floor(crop.w));
  });

  it('a new version keeps the turn, the original stays upright, and the turn survives a reload', async () => {
    await page.click('#newVersion');
    await poll(async () => (await shot()).versions.length === 2, { what: 'a second version' });
    await poll(async () => (await version()).turn === 1, { what: 'a copy of the displayed state keeps its turn' });
    const crop = (await version()).crop;
    await page.locator('#versions button', { hasText: 'Original' }).click();
    await waitOut(page, W, H);
    await poll(async () => (await shot()).active === -1, { what: 'the original is shown' });
    await page.locator('#versions button', { hasText: 'V2' }).click();
    await poll(async () => (await shot()).active === 1, { what: 'V2 is shown again' });
    await waitOut(page, Math.floor(crop.w), Math.floor(crop.h));
    await page.reload();
    await ready(page);
    await waitOut(page, Math.floor(crop.w), Math.floor(crop.h));
    await poll(async () => (await version()).turn === 1, { what: 'the turn is kept after a reload' });
    assert.deepEqual(await originalHash(page, id), hash, 'the original is never rewritten');
    assert.deepEqual(pageErrors(), [], 'no error on the page');
  });

  it('a grouped export draws the turned and cropped version, not the original', async () => {
    const out = await page.evaluate(async (id) => {
      const { getOriginal, queryShots } = await import(`${location.origin}/db.js`);
      const { renderVersion } = await import(`${location.origin}/export-batch.js`);
      const s = (await queryShots({ limit: 1000 })).items.find((x) => x.id === id);
      const bitmap = await createImageBitmap(await getOriginal(id));
      const version = s.versions[s.active];
      const canvas = await renderVersion(bitmap, version);
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 250, width, 1).data;
      const red = [];
      for (let x = 0; x < width; x++) if (data[x * 4] > 180 && data[x * 4 + 1] < 100 && data[x * 4 + 2] < 100) red.push(x);
      canvas.width = canvas.height = 0;
      bitmap.close();
      return { width, height, red: red.length, crop: version.crop };
    }, id);
    assert.deepEqual([out.width, out.height], [out.crop.w, out.crop.h], 'the size of the crop, in the turned image');
    assert.ok(out.width < out.height, 'a wide crop became a tall one');
    assert.ok(out.red >= 3, 'the arrow is drawn in its turned place');
  });
});

describe('editor: turn keeps what the person was doing', () => {
  let h, page, m;
  const W = 1600, H = 900;
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 3, `${what}: ${a} is not ${b}`);
  before(async () => {
    h = await launchExtension();
    page = await h.context.newPage();
    await resetLibrary(page, h, [spec('Keep', 1600, 900, true)]);
    await ready(page);
    await waitOut(page, 1600, 900);
    m = await mapper(page, 1600, 900);
  });
  after(() => h?.close());

  it('keeps the zoom, the selected object and a crop box that is not applied yet', async () => {
    const zoom = () => page.locator('#zoomLabel').innerText();
    await tool(page, 'flat');
    await drag(page, m, 100, 100, 400, 300);
    await tool(page, 'select');
    await page.mouse.click(...m.pt(250, 200));
    assert.equal(await page.locator('#del').isEnabled(), true, 'an object is selected');
    await page.click('#actual');
    const z = await zoom();
    await page.click('#rotate');
    await waitOut(page, H, W);
    assert.equal(await zoom(), z, 'the zoom is kept');
    assert.equal(await page.locator('#del').isEnabled(), true, 'the selection is kept');
    await page.click('#fit');
    m = await mapper(page, H, W);
    await page.click('#crop');
    await drag(page, m, H, W, 600, 1000);
    await page.click('#rotate');
    await waitOut(page, W, H);
    assert.equal(await page.locator('#cropGroup').isVisible(), true, 'the crop box is still there to apply');
    await page.click('#cropOk');
    const v = await poll(async () => { const s = (await dbDump(page))[0]; const x = s.versions[s.active]; return x.crop && x.turn === 2 ? x : null; }, { what: 'the crop saved' });
    near(v.crop.x, 600, 'the crop box turned with the image (x)');
    near(v.crop.w, 1000, 'the crop box turned with the image (width)');
    assert.ok(Math.abs(v.crop.h - 600) <= 3 && v.crop.y <= 3, `and (height, top): ${JSON.stringify(v.crop)}`);
  });
});
