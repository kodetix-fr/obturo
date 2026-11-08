import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { A4, MAX_PAGE_PT, assemblePdf, packRgb, planPages } from './pdf.js';

/** @typedef {import('pdf-lib').PDFRawStream} PDFRawStream */

// --- A strict reader of what assemblePdf writes (independent of it): header, xref entry by entry, stream lengths ---

/** Checks the layout the way a reader that trusts the xref would walk it. Returns the objects by number. */
function readPdf(buf) {
  const latin1 = (from, to) => buf.toString('latin1', from, to);
  assert.equal(latin1(0, 9), '%PDF-1.4\n');
  assert.ok(buf[10] > 127 && buf[11] > 127 && buf[12] > 127 && buf[13] > 127, 'binary comment after the header');
  const tail = /startxref\n(\d+)\n%%EOF\n$/.exec(latin1(Math.max(0, buf.length - 40)));
  assert.ok(tail, 'startxref and %%EOF close the file');
  const xref = Number(tail[1]);
  assert.equal(latin1(xref, xref + 5), 'xref\n');
  const head = /^0 (\d+)\n/.exec(latin1(xref + 5, xref + 25));
  assert.ok(head, 'xref subsection header');
  const count = Number(head[1]);
  let p = xref + 5 + head[0].length;
  const offsets = [];
  for (let n = 0; n < count; n++, p += 20) {
    const entry = latin1(p, p + 20);
    assert.match(entry, n === 0 ? /^0000000000 65535 f \n$/ : /^\d{10} 00000 n \n$/, `xref entry ${n} is exactly 20 bytes`);
    offsets.push(Number(entry.slice(0, 10)));
  }
  const trailer = /^trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info 3 0 R >>\n/.exec(latin1(p, p + 80));
  assert.ok(trailer && Number(trailer[1]) === count, 'trailer');

  const objects = [];
  for (let n = 1; n < count; n++) {
    const start = offsets[n];
    const end = n + 1 < count ? offsets[n + 1] : xref;
    const body = buf.subarray(start, end);
    const label = `${n} 0 obj\n`;
    assert.equal(body.toString('latin1', 0, label.length), label, `object ${n} sits where the xref says`);
    const cut = body.indexOf('\nstream\n');
    if (cut < 0) {
      assert.ok(body.toString('latin1').endsWith('\nendobj\n'), `object ${n} ends with endobj`);
      objects[n] = { dict: body.toString('latin1', label.length, body.length - 8) };
      continue;
    }
    const dict = body.toString('latin1', label.length, cut);
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1]);
    const data = body.subarray(cut + 8, cut + 8 + length);
    assert.equal(data.length, length, `object ${n}: the stream is as long as /Length says`);
    assert.equal(body.toString('latin1', cut + 8 + length), '\nendstream\nendobj\n', `object ${n}: endstream follows the data`);
    objects[n] = { dict, data };
  }
  return { objects, count };
}

const rgb = (w, h, f) => {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(f(x, y), (y * w + x) * 3);
  return out;
};

// --- planPages ---

test('planPages fit: one page at 96 dpi (px x 0.75 = pt)', () => {
  assert.deepEqual(planPages([{ width: 1920, height: 1080 }], 'fit'), [{ image: 0, w: 1440, h: 810, drawW: 1440, drawH: 810, x: 0, y: 0 }]);
});

test('planPages fit: a page of exactly 14,400 pt stays whole, one more pixel cuts it in two equal pages', () => {
  assert.equal(planPages([{ width: 800, height: 19200 }], 'fit').length, 1); // 14,400 pt
  const cut = planPages([{ width: 800, height: 19201 }], 'fit');
  assert.equal(cut.length, 2);
  assert.ok(cut.every((p) => p.h <= MAX_PAGE_PT && p.h === cut[0].h && p.w === 600));
  assert.ok(Math.abs(cut[0].h * 2 - 19201 * 0.75) < 1e-9, 'the pages add up to the image');
});

test('planPages fit: the slices of a tall image are one picture at different offsets', () => {
  const pages = planPages([{ width: 800, height: 40000 }], 'fit'); // 30,000 pt -> 3 pages of 10,000
  assert.equal(pages.length, 3);
  for (const [k, p] of pages.entries()) {
    assert.equal(p.image, 0);
    assert.equal(p.drawH, 30000);
    assert.equal(p.h, 10000);
    // the bottom edge of the picture is (k + 1) pages below its own top, minus the picture height
    assert.equal(p.y, (k + 1) * 10000 - 30000);
  }
  assert.equal(pages[2].y, 0, 'the last page ends with the picture');
});

test('planPages fit: wider than the limit is scaled to it, a tiny image is brought up to the minimum', () => {
  const [wide] = planPages([{ width: 20000, height: 1000 }], 'fit'); // 15,000 pt wide
  assert.equal(wide.w, MAX_PAGE_PT);
  assert.ok(Math.abs(wide.drawH - 750 * (MAX_PAGE_PT / 15000)) < 1e-9, 'same ratio');
  const [tiny] = planPages([{ width: 1, height: 1 }], 'fit');
  assert.equal(Math.min(tiny.w, tiny.h), 3);
});

test('planPages a4: width of an A4 page, slices of an A4 height, the last one partly blank', () => {
  // 1190 px wide -> factor 0.5: 3 bands of 1684 px are exactly 3 pages
  const exact = planPages([{ width: 1190, height: 5052 }], 'a4');
  assert.equal(exact.length, 3);
  assert.deepEqual(exact.map((p) => p.y), [842 - 2526, 1684 - 2526, 2526 - 2526]);
  assert.ok(exact.every((p) => p.w === A4.w && p.h === A4.h && p.drawW === A4.w && p.drawH === 2526));
  // a short image: one page, even if it is smaller than the sheet
  const [small] = planPages([{ width: 300, height: 200 }], 'a4');
  assert.deepEqual([small.drawW, Math.round(small.drawH), small.y === 842 - small.drawH], [595, 397, true]);
  // a hair over a whole number of pages gives one more page; the epsilon keeps rounding noise from doing the same
  assert.equal(planPages([{ width: 595, height: 842 * 2 }], 'a4').length, 2);
  assert.equal(planPages([{ width: 595, height: 842 * 2 + 1 }], 'a4').length, 3);
});

test('planPages a4: a screen a little taller than a page stays on one page, a long one is still cut', () => {
  // 813 x 1440 (a 1440 x 813 screen turned): 1.77 times taller than wide, one page at 475 pt wide, centered
  const [turned] = planPages([{ width: 813, height: 1440 }], 'a4');
  assert.deepEqual([turned.drawH, Math.round(turned.drawW), turned.y, Math.round(turned.x)], [A4.h, 475, 0, 60]);
  assert.equal(planPages([{ width: 813, height: 1440 }, { width: 813, height: 1440 }], 'a4').length, 2, 'one page each');
  // a page of 1920 x 16384 would be 99 pt wide on one page: it is cut at the page width, as before
  const tall = planPages([{ width: 1920, height: 16384 }], 'a4');
  assert.ok(tall.length > 1 && tall.every((p) => p.drawW === A4.w && p.x === 0));
  // the limit: 1.887 times taller than wide keeps three quarters of the width scale
  assert.equal(planPages([{ width: 1000, height: 1880 }], 'a4').length, 1);
  assert.equal(planPages([{ width: 1000, height: 1900 }], 'a4').length, 2);
});

test('planPages: several images keep their order and index', () => {
  // the tall one is 30,000 pt: 3 pages
  const pages = planPages([{ width: 100, height: 100 }, { width: 100, height: 40000 }, { width: 100, height: 100 }], 'fit');
  assert.deepEqual(pages.map((p) => p.image), [0, 1, 1, 1, 2]);
});

// --- packRgb ---

test('packRgb drops the alpha byte and keeps the order of the pixels', () => {
  const rgba = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  const out = new Uint8Array(12);
  packRgb(rgba, 4, out);
  assert.deepEqual([...out], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  packRgb(rgba, 2, out); // only the first pixels
  assert.deepEqual([...out.subarray(0, 6)], [1, 2, 3, 4, 5, 6]);
});

// --- assemblePdf ---

/** @param {number} w @param {number} h @param {(x: number, y: number) => number[]} f @returns {import('./pdf.js').PdfImage} */
const flateImage = (w, h, f) => ({ width: w, height: h, filter: 'FlateDecode', data: deflateSync(rgb(w, h, f)) });

test('assemblePdf: exact xref, lengths and layout, whatever the form of the data', async () => {
  const pixels = (x, y) => [x * 40, y * 90, 7];
  const stream = deflateSync(rgb(8, 4, pixels));
  /** @type {import('./pdf.js').PdfImage[]} */
  const images = [
    { width: 8, height: 4, filter: 'FlateDecode', data: stream }, // one typed array
    { width: 8, height: 4, filter: 'FlateDecode', data: new Blob([stream]) }, // a Blob
    { width: 8, height: 4, filter: 'DCTDecode', data: [Buffer.from('JPEG'), new Blob(['-data'])] }, // several parts
  ];
  // 8 x 4 px = 6 x 3 pt; the middle image is a tall one (8 x 40000 px = 30,000 pt, 3 pages): 5 pages in all
  const pages = planPages([{ width: 8, height: 4 }, { width: 8, height: 40000 }, { width: 8, height: 4 }], 'fit');
  const pdf = assemblePdf(images, pages);
  assert.equal(pdf.type, 'application/pdf');
  const { objects, count } = readPdf(Buffer.from(await pdf.arrayBuffer()));
  assert.equal(pages.length, 5);
  assert.equal(count, 1 + 3 + 3 + 5 * 2, 'object 0, 3 fixed objects, 3 images, 5 pages with their content');
  assert.match(objects[2].dict, /^<< \/Type \/Pages \/Kids \[7 0 R 9 0 R 11 0 R 13 0 R 15 0 R\] \/Count 5 >>$/);
  assert.equal(objects[3].dict, '<< /Producer (Obturo) >>');
  assert.deepEqual(inflateSync(objects[4].data), rgb(8, 4, pixels));
  assert.deepEqual(inflateSync(objects[5].data), rgb(8, 4, pixels));
  assert.equal(objects[6].data.toString('latin1'), 'JPEG-data');
  assert.match(objects[6].dict, /\/Filter \/DCTDecode/);
  assert.match(objects[4].dict, /\/Width 8 \/Height 4 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode/);
  assert.match(objects[7].dict, /\/MediaBox \[0 0 6 3\]/);
  assert.equal(objects[8].data.toString('latin1'), 'q 6 0 0 3 0 0 cm /Im0 Do Q');
  // object 9 is the first slice of the tall picture: image object 5, offset of its own
  assert.match(objects[9].dict, /\/MediaBox \[0 0 6 10000\] \/Resources << \/XObject << \/Im0 5 0 R >> >> \/Contents 10 0 R/);
  assert.equal(objects[10].data.toString('latin1'), 'q 6 0 0 30000 0 -20000 cm /Im0 Do Q');
  assert.equal(objects[12].data.toString('latin1'), 'q 6 0 0 30000 0 -10000 cm /Im0 Do Q');
  assert.equal(objects[14].data.toString('latin1'), 'q 6 0 0 30000 0 0 cm /Im0 Do Q');
});

test('assemblePdf: a PDF that pdf-lib loads, with the pages, boxes and image that were asked for', async () => {
  const pixels = (x, y) => [x * 20, y * 60, (x + y) * 10];
  const images = [flateImage(10, 4, pixels)];
  const pdf = assemblePdf(images, planPages([{ width: 1190, height: 5052 }], 'a4'));
  const doc = await PDFDocument.load(Buffer.from(await pdf.arrayBuffer()), { updateMetadata: false });
  assert.equal(doc.getPageCount(), 3);
  for (const page of doc.getPages()) assert.deepEqual(page.getMediaBox(), { x: 0, y: 0, width: 595, height: 842 });
  const xobjects = doc.getPage(2).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  const image = /** @type {PDFRawStream | undefined} */ (xobjects?.lookup(PDFName.of('Im0'), PDFStream));
  assert.ok(image, 'the image is in the resources of the page');
  assert.equal(image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), 10);
  assert.equal(image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(), 4);
  assert.deepEqual(Buffer.from(decodePDFRawStream(image).decode()), rgb(10, 4, pixels), 'the pixels come back as they went in');
  assert.equal(doc.getProducer(), 'Obturo');
});

test('assemblePdf: the slices of a tall image share ONE image object', async () => {
  const images = [flateImage(8, 2, () => [1, 2, 3])];
  const pages = planPages([{ width: 8, height: 100000 }], 'fit'); // 75,000 pt
  assert.equal(pages.length, 6);
  const { objects, count } = readPdf(Buffer.from(await assemblePdf(images, pages).arrayBuffer()));
  assert.equal(count, 1 + 3 + 1 + 6 * 2, 'one image object, whatever the number of pages');
  for (let i = 0; i < 6; i++) assert.match(objects[5 + 2 * i].dict, /\/Im0 4 0 R/);
});

test('assemblePdf: refuses an empty document or a page without its image', () => {
  assert.throws(() => assemblePdf([], []), /at least one page/);
  assert.throws(() => assemblePdf([flateImage(1, 1, () => [0, 0, 0])], []), /at least one page/);
  assert.throws(() => assemblePdf([flateImage(1, 1, () => [0, 0, 0])], planPages([{ width: 1, height: 1 }, { width: 1, height: 1 }], 'fit')), /missing image/);
});
