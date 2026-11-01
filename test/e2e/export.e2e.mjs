// The export engines (encode.js, pdf.js, zip.js) in the real Chromium of Playwright: the encoders and canvases of the
// browser, CompressionStream, and a PDF reader (the PDF viewer of Chromium, which is PDFium) opening what pdf.js wrote.
//
// The engines need no extension API, so this file does not load the extension: a tiny local server hands the three
// modules to a plain page and to a dedicated worker (no DOM, like the service worker). Throwaway profile (mkdtemp,
// removed by its exact path); nothing is written in the repository.
//
// E2E_BENCH=1 also prints the durations of the budgets of docs/ARCHITECTURE.md (the last block of this file).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright-core';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, decodePDFRawStream } from 'pdf-lib';

/** @typedef {import('pdf-lib').PDFRawStream} PDFRawStream */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MODULES = new Set(['/encode.js', '/pdf.js', '/zip.js']);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const once = (fn) => { let p; return () => (p ??= fn()); };

/** Retries `fn` until it returns a truthy value; fails with `what` after `timeout` ms. */
async function waitFor(fn, { timeout = 20_000, interval = 250, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(interval);
  }
}

// A worker that runs the three engines, then reports what it saw. It has no document or window, like the service worker.
const WORKER = `
import { encodeImage } from '/encode.js';
import { buildPdf } from '/pdf.js';
import { buildZip } from '/zip.js';
self.onmessage = async () => {
  try {
    const c = new OffscreenCanvas(60, 40);
    const g = c.getContext('2d');
    g.fillStyle = '#c00'; g.fillRect(0, 0, 60, 40);
    const png = await encodeImage(c, { format: 'png' });
    const jpeg = await encodeImage(c, { format: 'jpeg' });
    const webp = await encodeImage(c, { format: 'webp', quality: 0.5 });
    const pdf = await buildPdf([{ source: c, width: 60, height: 40 }], { layout: 'a4' });
    const pdfJpeg = await buildPdf([{ source: c, width: 60, height: 40 }], { encoding: 'jpeg' });
    const zip = await buildZip([{ name: 'a.png', blob: png }, { name: 'b.jpg', blob: jpeg }]);
    const head = async (b, n) => [...new Uint8Array(await b.slice(0, n).arrayBuffer())];
    postMessage({
      ok: true,
      noDom: typeof document === 'undefined' && typeof window === 'undefined',
      png: await head(png, 4), jpeg: await head(jpeg, 3), webp: await head(webp, 4), pdf: await head(pdf, 5), zip: await head(zip, 4),
      pdfTypes: [pdf.type, pdfJpeg.type], zipType: zip.type, pdfSizes: [pdf.size, pdfJpeg.size],
    });
  } catch (e) {
    postMessage({ ok: false, error: String((e && e.stack) || e) });
  }
};`;

// --- Readers of the test: what a PDF or a ZIP reader checks, written independently of the engines ---

/** Walks a PDF by its cross-reference table, entry by entry, and checks every length. Returns the stream of each object. */
function readPdf(buf) {
  const latin1 = (from, to) => buf.toString('latin1', from, to);
  assert.equal(latin1(0, 9), '%PDF-1.4\n');
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
    assert.match(entry, n === 0 ? /^0000000000 65535 f \n$/ : /^\d{10} 00000 n \n$/, `xref entry ${n} is 20 bytes`);
    offsets.push(Number(entry.slice(0, 10)));
  }
  assert.match(latin1(p, p + 80), new RegExp(`^trailer\\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\\n`));
  const streams = [];
  for (let n = 1; n < count; n++) {
    const body = buf.subarray(offsets[n], n + 1 < count ? offsets[n + 1] : xref);
    const label = `${n} 0 obj\n`;
    assert.equal(body.toString('latin1', 0, label.length), label, `object ${n} sits where the xref says`);
    const cut = body.indexOf('\nstream\n');
    if (cut < 0) {
      assert.ok(body.toString('latin1').endsWith('\nendobj\n'));
      continue;
    }
    const length = Number(/\/Length (\d+)/.exec(body.toString('latin1', 0, cut))?.[1]);
    assert.equal(body.toString('latin1', cut + 8 + length), '\nendstream\nendobj\n', `object ${n}: /Length is exact`);
    streams[n] = body.subarray(cut + 8, cut + 8 + length);
  }
  return { count, streams };
}

/** The pages of a PDF as pdf-lib reads them: the box, and the image in the resources. */
async function loadPdf(buf) {
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const pages = doc.getPages().map((page) => {
    const image = /** @type {PDFRawStream | undefined} */ (
      page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)?.lookup(PDFName.of('Im0'), PDFStream));
    assert.ok(image, 'every page draws an image');
    return {
      box: page.getMediaBox(),
      image,
      width: image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
      height: image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(),
      filter: String(image.dict.get(PDFName.of('Filter'))),
    };
  });
  return { doc, pages };
}

/** Entries of a ZIP, checked as an extractor would: [{ name, data }]. */
function readZip(buf) {
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    assert.equal(buf.readUInt16LE(p + 10), 0, 'stored');
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const data = buf.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    assert.equal(crc32(data), crc, 'CRC-32 checked by zlib');
    entries.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLength), data });
    p += 46 + nameLength;
  }
  return entries;
}

const near = (actual, expected, tolerance, what) => {
  assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance), `${what}: ${actual} is not within ${tolerance} of ${expected}`);
};
const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const rgbOf = (text) => /** @type {string[]} */ (text.match(/\d+/g)).map(Number);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const RED = [224, 0, 0], GREEN = [0, 160, 0], BLUE = [0, 0, 224], WHITE = [255, 255, 255];

describe('export engines in Chromium', () => {
  let server, root, context, page, origin;
  const errors = [];
  const shown = { pdf: null }; // the PDF that the server hands to the viewer
  let viewerReady = false;
  let seq = 0;

  /** The result of a function of the page that returns the base64 of a Blob, as a Buffer. */
  const bytesOf = async (b64) => Buffer.from(await b64, 'base64');

  /**
   * Opens a PDF in the PDF viewer of Chromium (PDFium) at a page, and returns the colours of its center column at the given
   * fractions of the height ("view=Fit": the fractions of the screenshot are those of the page). Waits for the render to
   * settle, the viewer first paints its grey background. A page number past the last one shows the last page.
   */
  async function renderPage(pdf, pageNo, fractions) {
    shown.pdf = pdf;
    const viewer = await context.newPage();
    try {
      await viewer.goto(`${origin}/doc.pdf?${++seq}#page=${pageNo}&view=Fit&toolbar=0&navpanes=0`);
      let previous = '';
      return await waitFor(async () => {
        const samples = await page.evaluate(({ b64, fractions }) => /** @type {any} */ (window).lab.sampleColumn(b64, fractions), {
          b64: (await viewer.screenshot()).toString('base64'), fractions,
        });
        const key = JSON.stringify(samples);
        const settled = key === previous && !samples.includes('rgb(40, 40, 40)'); // 40: the grey of the viewer
        previous = key;
        return settled ? samples : null;
      }, { timeout: 30_000, what: `PDF page ${pageNo} drawn by the viewer` });
    } finally {
      await viewer.close();
    }
  }

  before(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      res.setHeader('cache-control', 'no-store');
      if (path === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><meta charset="utf-8"><title>export</title>'); }
      if (path === '/doc.pdf') { res.setHeader('content-type', 'application/pdf'); return res.end(shown.pdf); }
      if (path === '/worker.js') { res.setHeader('content-type', 'text/javascript'); return res.end(WORKER); }
      if (MODULES.has(path)) { res.setHeader('content-type', 'text/javascript'); return res.end(readFileSync(join(REPO, path))); }
      res.statusCode = 404;
      res.end();
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${server.address().port}`;
    root = mkdtempSync(join(tmpdir(), 'obt-x-'));
    context = await chromium.launchPersistentContext(join(root, 'p'), {
      channel: 'chromium', headless: true, args: ['--no-first-run', '--no-default-browser-check'], viewport: { width: 900, height: 700 },
    });
    page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    await page.goto(`${origin}/`);
    await page.evaluate(() => {
      // Helpers of the tests, in the page.
      /** @type {any} */ (window).lab = {
        /** w x h canvas in horizontal bands of CSS colours. */
        bands(w, h, colors) {
          const c = new OffscreenCanvas(w, h);
          const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
          colors.forEach((color, i) => {
            g.fillStyle = color;
            g.fillRect(0, Math.round((i * h) / colors.length), w, Math.ceil(h / colors.length));
          });
          return c;
        },
        /** A screenshot of a UI: flat areas, text, a gradient. */
        ui(w, h) {
          const c = new OffscreenCanvas(w, h);
          const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
          g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, w, h);
          g.fillStyle = '#1f2937'; g.fillRect(0, 0, w, Math.round(h * 0.06));
          g.fillStyle = '#fff'; g.fillRect(0, Math.round(h * 0.06), Math.round(w * 0.16), h);
          const fs = Math.max(10, Math.round(h / 70));
          g.font = `${fs}px sans-serif`;
          for (let y = Math.round(h * 0.09), r = 0; y < h - fs; y += Math.round(fs * 1.9), r++) {
            if (r % 2) { g.fillStyle = '#eceff3'; g.fillRect(Math.round(w * 0.17), y - fs, Math.round(w * 0.8), Math.round(fs * 1.7)); }
            g.fillStyle = '#111';
            g.fillText(`Row ${r} - Quarterly report line item with some descriptive text ${(r * 37) % 1000}`, Math.round(w * 0.18), y);
            g.fillStyle = '#2563eb';
            g.fillText(`${((r * 7919) % 100000) / 100}`, Math.round(w * 0.8), y);
          }
          const grad = g.createLinearGradient(0, 0, w, 0);
          grad.addColorStop(0, '#3b82f6'); grad.addColorStop(1, '#8b5cf6');
          g.fillStyle = grad; g.fillRect(Math.round(w * 0.17), Math.round(h * 0.07), Math.round(w * 0.8), Math.round(h * 0.03));
          return c;
        },
        /** A photograph-like image: a smooth gradient under a layer of noise. */
        photo(w, h) {
          const c = new OffscreenCanvas(w, h);
          const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
          const grad = g.createLinearGradient(0, 0, w, h);
          grad.addColorStop(0, '#1e3a8a'); grad.addColorStop(0.5, '#f59e0b'); grad.addColorStop(1, '#064e3b');
          g.fillStyle = grad; g.fillRect(0, 0, w, h);
          const noise = new OffscreenCanvas(256, 256);
          const ng = /** @type {OffscreenCanvasRenderingContext2D} */ (noise.getContext('2d'));
          const img = ng.createImageData(256, 256);
          let s = 12345;
          for (let i = 0; i < img.data.length; i += 4) {
            s = (s * 1664525 + 1013904223) >>> 0;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = s >>> 24;
            img.data[i + 3] = 40;
          }
          ng.putImageData(img, 0, 0);
          g.fillStyle = /** @type {CanvasPattern} */ (g.createPattern(noise, 'repeat'));
          g.fillRect(0, 0, w, h);
          return c;
        },
        async b64(blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(s);
        },
        blobOf(b64, type) {
          return new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type });
        },
        /** Size and pixels [r, g, b, a] at the given points of an encoded image (any format the browser decodes). */
        async pixels(blob, points) {
          const bmp = await createImageBitmap(blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
          g.drawImage(bmp, 0, 0);
          const px = points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]);
          const dims = [bmp.width, bmp.height];
          bmp.close();
          return { dims, px };
        },
        /** SHA-256 of the RGB bytes of a canvas drawn on white: what a lossless PDF must hold. */
        async rgbHash(source) {
          const c = new OffscreenCanvas(source.width, source.height);
          const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(source, 0, 0);
          const { data } = g.getImageData(0, 0, c.width, c.height);
          const rgb = new Uint8Array((data.length / 4) * 3);
          for (let i = 0, o = 0; i < data.length; i += 4, o += 3) { rgb[o] = data[i]; rgb[o + 1] = data[i + 1]; rgb[o + 2] = data[i + 2]; }
          return [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgb))].map((b) => b.toString(16).padStart(2, '0')).join('');
        },
        /** CSS colours of a PNG screenshot along its center column, at the given fractions of the height. */
        async sampleColumn(b64, fractions) {
          const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
          g.drawImage(bmp, 0, 0);
          return fractions.map((f) => {
            const [r, gr, b] = g.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height * f), 1, 1).data;
            return `rgb(${r}, ${gr}, ${b})`;
          });
        },
      };
    });
    // Is there a PDF viewer in this Chromium? The tests that render are skipped if not.
    shown.pdf = await bytesOf(page.evaluate(async () => {
      const lab = /** @type {any} */ (window).lab;
      const { buildPdf } = await import(`${location.origin}/pdf.js`);
      return lab.b64(await buildPdf([{ source: lab.bands(40, 40, ['rgb(224, 0, 0)']), width: 40, height: 40 }]));
    }));
    viewerReady = await renderPage(shown.pdf, 1, [0.5]).then((s) => s[0] === css(RED), () => false);
  });

  after(async () => {
    await context?.close().catch(() => {});
    server?.close();
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    assert.deepEqual(errors, [], 'no error in the page');
  });

  // ---------------------------------------------------------------- encode.js

  describe('encode.js', () => {
    it('PNG, JPEG, WebP: signature, pixels, white under transparency, from a canvas of any kind or a bitmap', async () => {
      const results = await page.evaluate(async () => {
        const { encodeImage } = await import(`${location.origin}/encode.js`);
        const lab = /** @type {any} */ (window).lab;
        // 200 x 100: opaque red on the left, opaque green top right, nothing (transparent) bottom right
        const off = new OffscreenCanvas(200, 100);
        const g = /** @type {OffscreenCanvasRenderingContext2D} */ (off.getContext('2d'));
        g.fillStyle = 'rgb(255, 0, 0)'; g.fillRect(0, 0, 100, 100);
        g.fillStyle = 'rgb(0, 200, 0)'; g.fillRect(100, 0, 100, 50);
        const element = document.createElement('canvas');
        element.width = 200;
        element.height = 100;
        /** @type {CanvasRenderingContext2D} */ (element.getContext('2d')).drawImage(off, 0, 0);
        const bitmap = await createImageBitmap(off);
        const out = {};
        for (const [kind, source] of [['offscreen', off], ['element', element], ['bitmap', bitmap]]) {
          for (const format of ['png', 'jpeg', 'webp']) {
            const blob = await encodeImage(source, { format });
            out[`${kind}/${format}`] = {
              type: blob.type,
              head: [...new Uint8Array(await blob.slice(0, 12).arrayBuffer())],
              ...await lab.pixels(blob, [[50, 50], [150, 25], [150, 75]]),
            };
          }
        }
        return out;
      });
      assert.equal(Object.keys(results).length, 9);
      const ascii = (bytes) => String.fromCharCode(...bytes);
      for (const [key, r] of Object.entries(results)) {
        const format = key.split('/')[1];
        assert.equal(r.type, `image/${format}`, key);
        assert.deepEqual(r.dims, [200, 100], key);
        if (format === 'png') {
          assert.deepEqual(r.head.slice(0, 8), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], key);
          assert.deepEqual(r.px, [[255, 0, 0, 255], [0, 200, 0, 255], [0, 0, 0, 0]], `${key}: lossless, transparency kept`);
        } else if (format === 'jpeg') {
          assert.deepEqual(r.head.slice(0, 3), [0xff, 0xd8, 0xff], key);
          near(r.px[0], [255, 0, 0, 255], 24, `${key} red`);
          near(r.px[1], [0, 200, 0, 255], 24, `${key} green`);
          near(r.px[2], [255, 255, 255, 255], 4, `${key}: transparent becomes white, not black`);
        } else {
          assert.ok(ascii(r.head.slice(0, 4)) === 'RIFF' && ascii(r.head.slice(8, 12)) === 'WEBP', key);
          near(r.px[0], [255, 0, 0, 255], 24, `${key} red`);
          near(r.px[1], [0, 200, 0, 255], 24, `${key} green`);
          assert.ok(r.px[2][3] < 8, `${key}: transparency kept (alpha ${r.px[2][3]})`);
        }
      }
    });

    it('sizes follow the quality, the lossy formats beat PNG on a photograph, the quality is clamped', async () => {
      const sizes = await page.evaluate(async () => {
        const { encodeImage } = await import(`${location.origin}/encode.js`);
        const c = /** @type {any} */ (window).lab.photo(640, 480);
        const size = async (format, quality) => (await encodeImage(c, { format, quality })).size;
        return {
          png: await size('png'), pngLow: await size('png', 0.1),
          jpeg3: await size('jpeg', 0.3), jpeg9: await size('jpeg', 0.9), jpegMax: await size('jpeg', 1), jpegOver: await size('jpeg', 5),
          jpegMin: await size('jpeg', 0.1), jpegUnder: await size('jpeg', -2),
          webp3: await size('webp', 0.3), webp9: await size('webp', 0.9), webpMax: await size('webp', 1), webpOver: await size('webp', 99),
        };
      });
      assert.ok(sizes.jpeg3 < sizes.jpeg9 && sizes.jpeg9 < sizes.png, `jpeg ${sizes.jpeg3} < ${sizes.jpeg9} < png ${sizes.png}`);
      assert.ok(sizes.webp3 < sizes.webp9 && sizes.webp9 < sizes.png, `webp ${sizes.webp3} < ${sizes.webp9} < png ${sizes.png}`);
      assert.equal(sizes.jpegOver, sizes.jpegMax, 'quality 5 is quality 1');
      assert.equal(sizes.webpOver, sizes.webpMax, 'quality 99 is quality 1');
      assert.equal(sizes.jpegUnder, sizes.jpegMin, 'quality -2 is quality 0.1');
      assert.equal(sizes.pngLow, sizes.png, 'PNG is lossless: the quality does nothing');
    });

    it('refuses what it cannot encode, with an error that says why', async () => {
      const errorsSeen = await page.evaluate(async () => {
        const { encodeImage } = await import(`${location.origin}/encode.js`);
        const c = new OffscreenCanvas(10, 10);
        const attempt = (fn) => fn().then(() => 'no error', (e) => e.message);
        return [
          await attempt(() => encodeImage(c, { format: /** @type {any} */ ('avif') })),
          await attempt(() => encodeImage(new OffscreenCanvas(0, 0))),
          await attempt(() => encodeImage(new OffscreenCanvas(0, 0), { format: 'jpeg' })),
        ];
      });
      assert.match(errorsSeen[0], /unknown image format: avif/);
      assert.match(errorsSeen[1], /empty image/);
      assert.match(errorsSeen[2], /empty image/);
    });
  });

  // ---------------------------------------------------------------- pdf.js

  describe('pdf.js', () => {
    // A 800 x 20001 px page (15,000.75 pt): too tall for a reader, so `fit` cuts it in two pages.
    const tall = once(async () => bytesOf(page.evaluate(async () => {
      const lab = /** @type {any} */ (window).lab;
      const { buildPdf } = await import(`${location.origin}/pdf.js`);
      return lab.b64(await buildPdf([{ source: lab.bands(800, 20001, ['rgb(224, 0, 0)', 'rgb(0, 160, 0)', 'rgb(0, 0, 224)']), width: 800, height: 20001 }], { layout: 'fit' }));
    })));
    // 1000 x 3000 px in three bands of 1000: on A4 (factor 0.595) a band is 595 pt, so the page breaks fall inside the bands.
    const a4 = once(async () => bytesOf(page.evaluate(async () => {
      const lab = /** @type {any} */ (window).lab;
      const { buildPdf } = await import(`${location.origin}/pdf.js`);
      return lab.b64(await buildPdf([{ source: lab.bands(1000, 3000, ['rgb(224, 0, 0)', 'rgb(0, 160, 0)', 'rgb(0, 0, 224)']), width: 1000, height: 3000 }], { layout: 'a4' }));
    })));
    // Four sources of four kinds, JPEG: a bitmap, a canvas element, an OffscreenCanvas, and a transparent one.
    const mixed = once(async () => bytesOf(page.evaluate(async () => {
      const lab = /** @type {any} */ (window).lab;
      const { buildPdf } = await import(`${location.origin}/pdf.js`);
      const element = document.createElement('canvas');
      element.width = 100;
      element.height = 400;
      /** @type {CanvasRenderingContext2D} */ (element.getContext('2d')).drawImage(lab.bands(100, 400, ['rgb(0, 160, 0)']), 0, 0);
      const pages = [
        { source: await createImageBitmap(lab.bands(300, 200, ['rgb(224, 0, 0)'])), width: 300, height: 200 },
        { source: element, width: 100, height: 400 },
        { source: lab.bands(640, 480, ['rgb(0, 0, 224)']), width: 640, height: 480 },
        { source: new OffscreenCanvas(90, 90), width: 90, height: 90 }, // nothing drawn: fully transparent
      ];
      return lab.b64(await buildPdf(pages, { layout: 'fit', encoding: 'jpeg', quality: 0.8 }));
    })));

    it('fit, page too tall: cut in two equal pages that share one image, lossless, exact file layout', async () => {
      const buf = await tall();
      const { count } = readPdf(buf);
      assert.equal(count, 1 + 3 + 1 + 2 * 2, 'object 0, catalog, tree, info, ONE image, 2 pages with their content');
      const { doc, pages } = await loadPdf(buf);
      assert.equal(doc.getPageCount(), 2);
      assert.equal(doc.getProducer(), 'Obturo');
      for (const p of pages) {
        assert.deepEqual(p.box, { x: 0, y: 0, width: 600, height: 7500.375 });
        assert.deepEqual([p.width, p.height, p.filter], [800, 20001, '/FlateDecode']);
      }
      assert.equal(pages[0].image, pages[1].image, 'the same image object on both pages');
      const rgb = Buffer.from(decodePDFRawStream(pages[0].image).decode());
      assert.equal(rgb.length, 800 * 20001 * 3);
      const at = (y) => [...rgb.subarray((y * 800 + 400) * 3, (y * 800 + 400) * 3 + 3)];
      // bands of 6667 rows: red 0-6666, green 6667-13333, blue 13334-20000
      assert.deepEqual([0, 6666, 6667, 13333, 13334, 20000].map(at), [RED, RED, GREEN, GREEN, BLUE, BLUE]);
    });

    it('fit, page too tall: PDFium draws the right half of the picture on each page', async (t) => {
      if (!viewerReady) return t.skip('no PDF viewer in this Chromium');
      const buf = await tall();
      // page 1: 0 to 7500 pt, red until 5000 pt (67%), then green. page 2: green until 10,000 pt (33%), then blue.
      assert.deepEqual(await renderPage(buf, 1, [0.15, 0.5, 0.85]), [css(RED), css(RED), css(GREEN)]);
      const second = await renderPage(buf, 2, [0.15, 0.5, 0.85]);
      assert.deepEqual(second, [css(GREEN), css(BLUE), css(BLUE)]);
      assert.deepEqual(await renderPage(buf, 3, [0.15, 0.5, 0.85]), second, 'there is no third page: the viewer stays on the last');
    });

    it('a4: A4 pages cut through a picture of one image, bands break inside the pages, nothing lost', async () => {
      const buf = await a4();
      readPdf(buf);
      const { doc, pages } = await loadPdf(buf);
      assert.equal(doc.getPageCount(), 3);
      for (const p of pages) {
        assert.deepEqual(p.box, { x: 0, y: 0, width: 595, height: 842 });
        assert.deepEqual([p.width, p.height], [1000, 3000]);
      }
      assert.equal(pages[0].image, pages[2].image, 'one copy of the pixels for the three pages');
      const rgb = Buffer.from(decodePDFRawStream(pages[0].image).decode());
      const at = (y) => [...rgb.subarray((y * 1000 + 500) * 3, (y * 1000 + 500) * 3 + 3)];
      assert.deepEqual([0, 999, 1000, 1999, 2000, 2999].map(at), [RED, RED, GREEN, GREEN, BLUE, BLUE]);
    });

    it('a4: PDFium shows each page at the right offset, the end of the picture on a white page', async (t) => {
      if (!viewerReady) return t.skip('no PDF viewer in this Chromium');
      const buf = await a4();
      // 595 pt per band. page 1 (0-842): red to 595 (71%), green after. page 2 (842-1684): green to 1190 (41%), blue after.
      // page 3 (1684-2526): blue to 1785 (12%), then the white of the sheet.
      assert.deepEqual(await renderPage(buf, 1, [0.2, 0.9]), [css(RED), css(GREEN)]);
      assert.deepEqual(await renderPage(buf, 2, [0.2, 0.7]), [css(GREEN), css(BLUE)]);
      assert.deepEqual(await renderPage(buf, 3, [0.05, 0.4, 0.9]), [css(BLUE), css(WHITE), css(WHITE)]);
    });

    it('lossless: the pixels in the PDF are the pixels of the source, bit for bit, whatever the kind of source', async () => {
      const r = await page.evaluate(async () => {
        const lab = /** @type {any} */ (window).lab;
        const { buildPdf } = await import(`${location.origin}/pdf.js`);
        const ui = lab.ui(1920, 1080);
        // a transparent source: the PDF holds it on white, like the JPEG
        const clear = new OffscreenCanvas(300, 200);
        const g = /** @type {OffscreenCanvasRenderingContext2D} */ (clear.getContext('2d'));
        g.fillStyle = 'rgba(0, 0, 200, 0.5)';
        g.fillRect(50, 40, 120, 90);
        const bitmap = await createImageBitmap(ui);
        const sources = [ui, clear, bitmap];
        const pdf = await buildPdf(sources.map((source) => ({ source, width: source.width, height: source.height })));
        return { b64: await lab.b64(pdf), hashes: await Promise.all(sources.map((s) => lab.rgbHash(s))) };
      });
      const buf = Buffer.from(r.b64, 'base64');
      readPdf(buf);
      const { pages } = await loadPdf(buf);
      assert.deepEqual(pages.map((p) => p.box), [
        { x: 0, y: 0, width: 1440, height: 810 }, { x: 0, y: 0, width: 225, height: 150 }, { x: 0, y: 0, width: 1440, height: 810 },
      ]);
      pages.forEach((p, i) => assert.equal(sha256(decodePDFRawStream(p.image).decode()), r.hashes[i], `page ${i + 1}`));
      assert.equal(r.hashes[0], r.hashes[2], 'a bitmap and a canvas of the same picture');
    });

    it('a source of another size than the page is drawn scaled to it', async () => {
      const b64 = await page.evaluate(async () => {
        const lab = /** @type {any} */ (window).lab;
        const { buildPdf } = await import(`${location.origin}/pdf.js`);
        return lab.b64(await buildPdf([{ source: lab.bands(100, 50, ['rgb(224, 0, 0)']), width: 200, height: 100 }]));
      });
      const { pages } = await loadPdf(Buffer.from(b64, 'base64'));
      assert.deepEqual([pages[0].width, pages[0].height], [200, 100]);
      assert.equal(decodePDFRawStream(pages[0].image).decode().length, 200 * 100 * 3);
    });

    it('jpeg: several sources, one page each at its own size, a JPEG of the right size and colour in each', async () => {
      const buf = await mixed();
      readPdf(buf);
      const { pages } = await loadPdf(buf);
      assert.deepEqual(pages.map((p) => p.box), [
        { x: 0, y: 0, width: 225, height: 150 }, { x: 0, y: 0, width: 75, height: 300 },
        { x: 0, y: 0, width: 480, height: 360 }, { x: 0, y: 0, width: 67.5, height: 67.5 },
      ]);
      const expected = [RED, GREEN, BLUE, WHITE];
      for (const [i, p] of pages.entries()) {
        assert.equal(p.filter, '/DCTDecode');
        const jpeg = Buffer.from(p.image.contents);
        assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'starts like a JPEG');
        assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9], 'ends like a JPEG');
        const seen = await page.evaluate(({ b64 }) => {
          const lab = /** @type {any} */ (window).lab;
          return lab.pixels(lab.blobOf(b64, 'image/jpeg'), [[5, 5]]);
        }, { b64: jpeg.toString('base64') });
        assert.deepEqual(seen.dims, [p.width, p.height], `page ${i + 1}: the JPEG has the size of the image`);
        near(seen.px[0], [...expected[i], 255], 12, `page ${i + 1}: colour of the JPEG`);
      }
    });

    it('jpeg: PDFium draws the pages of the mixed document, each at its own size', async (t) => {
      if (!viewerReady) return t.skip('no PDF viewer in this Chromium');
      const buf = await mixed();
      // The viewer zooms to the widest page and stacks the others: the first page (225 x 150 pt) fills the top 40% of
      // the view, the next ones start at the top. (The last page cannot be scrolled to the top: it is not checked here;
      // its white is checked in the JPEG itself, above.)
      const expected = [[RED, 0.2], [GREEN, 0.5], [BLUE, 0.5]];
      for (const [i, [color, at]] of expected.entries()) {
        const [seen] = await renderPage(buf, i + 1, [at]);
        near(rgbOf(seen), color, 14, `page ${i + 1}`);
      }
    });

    it('jpeg is lighter than flate on a photograph, and a lower quality is lighter still', async () => {
      const s = await page.evaluate(async () => {
        const { buildPdf } = await import(`${location.origin}/pdf.js`);
        const c = /** @type {any} */ (window).lab.photo(800, 600);
        const pages = [{ source: c, width: 800, height: 600 }];
        return {
          flate: (await buildPdf(pages)).size,
          jpeg95: (await buildPdf(pages, { encoding: 'jpeg', quality: 0.95 })).size,
          jpeg50: (await buildPdf(pages, { encoding: 'jpeg', quality: 0.5 })).size,
        };
      });
      assert.ok(s.jpeg50 < s.jpeg95 && s.jpeg95 < s.flate, `jpeg 0.5: ${s.jpeg50} < jpeg 0.95: ${s.jpeg95} < flate: ${s.flate}`);
    });

    it('refuses wrong input before drawing anything', async () => {
      const messages = await page.evaluate(async () => {
        const { buildPdf } = await import(`${location.origin}/pdf.js`);
        const c = new OffscreenCanvas(10, 10);
        const page1 = { source: c, width: 10, height: 10 };
        const attempt = (fn) => fn().then(() => 'no error', (e) => e.message);
        return [
          await attempt(() => buildPdf([])),
          await attempt(() => buildPdf([page1], { layout: /** @type {any} */ ('b5') })),
          await attempt(() => buildPdf([page1], { encoding: /** @type {any} */ ('webp') })),
          await attempt(() => buildPdf([{ source: c, width: 0, height: 10 }])),
          await attempt(() => buildPdf([{ source: c, width: 10.5, height: 10 }])),
          await attempt(() => buildPdf([{ source: c, width: 20000, height: 10000 }])),
        ];
      });
      assert.match(messages[0], /at least one page/);
      assert.match(messages[1], /unknown PDF layout: b5/);
      assert.match(messages[2], /unknown PDF encoding: webp/);
      assert.match(messages[3], /invalid page size/);
      assert.match(messages[4], /invalid page size/);
      assert.match(messages[5], /too large/);
    });
  });

  // ---------------------------------------------------------------- zip.js

  describe('zip.js', () => {
    it('captures of the three formats and a PDF: names deduplicated, UTF-8, every byte back', async () => {
      const r = await page.evaluate(async () => {
        const lab = /** @type {any} */ (window).lab;
        const { encodeImage } = await import(`${location.origin}/encode.js`);
        const { buildPdf } = await import(`${location.origin}/pdf.js`);
        const { buildZip } = await import(`${location.origin}/zip.js`);
        const c = lab.ui(800, 600);
        const files = [
          { name: 'captures/example.com.png', blob: await encodeImage(c, { format: 'png' }) },
          { name: 'captures/example.com.png', blob: await encodeImage(c, { format: 'jpeg' }) },
          { name: '\u00e9t\u00e9/\u00fc \u00f1.webp', blob: await encodeImage(c, { format: 'webp' }) },
          { name: 'report.pdf', blob: await buildPdf([{ source: c, width: 800, height: 600 }], { encoding: 'jpeg' }) },
        ];
        const zip = await buildZip(files);
        return { type: zip.type, zip: await lab.b64(zip), parts: await Promise.all(files.map((f) => lab.b64(f.blob))) };
      });
      assert.equal(r.type, 'application/zip');
      const entries = readZip(Buffer.from(r.zip, 'base64'));
      assert.deepEqual(entries.map((e) => e.name), ['captures/example.com.png', 'captures/example.com-1.png', '\u00e9t\u00e9/\u00fc \u00f1.webp', 'report.pdf']);
      entries.forEach((e, i) => assert.ok(e.data.equals(Buffer.from(r.parts[i], 'base64')), e.name));
      assert.deepEqual([...entries[0].data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the PNG is stored as it was encoded');
    });

    it('50 files: all there, unique, with the right CRC-32', async () => {
      const r = await page.evaluate(async () => {
        const { buildZip } = await import(`${location.origin}/zip.js`);
        const lab = /** @type {any} */ (window).lab;
        const files = Array.from({ length: 50 }, (_, i) => {
          const bytes = new Uint8Array(100_000 + i);
          for (let o = 0; o < bytes.length; o += 65_536) crypto.getRandomValues(bytes.subarray(o, Math.min(o + 65_536, bytes.length)));
          return { name: 'shot.png', blob: new Blob([bytes]) }; // the same name 50 times
        });
        return { zip: await lab.b64(await buildZip(files)), sizes: files.map((f) => f.blob.size) };
      });
      const entries = readZip(Buffer.from(r.zip, 'base64'));
      assert.equal(entries.length, 50);
      assert.equal(new Set(entries.map((e) => e.name.toLowerCase())).size, 50);
      assert.deepEqual(entries.map((e) => e.data.length), r.sizes);
      assert.deepEqual(entries.slice(0, 3).map((e) => e.name), ['shot.png', 'shot-1.png', 'shot-2.png']);
    });
  });

  // ---------------------------------------------------------------- worker (like the service worker: no DOM)

  describe('in a worker', () => {
    it('the three engines run without a document or a window', async () => {
      const r = await page.evaluate(() => new Promise((done) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        worker.onmessage = (e) => { worker.terminate(); done(e.data); };
        worker.onerror = (e) => { worker.terminate(); done({ ok: false, error: `${e.message} (${e.filename})` }); };
        worker.postMessage('go');
      }));
      assert.equal(r.ok, true, r.error);
      assert.equal(r.noDom, true, 'the worker has no document and no window');
      assert.deepEqual(r.png, [0x89, 0x50, 0x4e, 0x47]);
      assert.deepEqual(r.jpeg, [0xff, 0xd8, 0xff]);
      assert.deepEqual(r.webp, [0x52, 0x49, 0x46, 0x46]);
      assert.deepEqual(r.pdf, [0x25, 0x50, 0x44, 0x46, 0x2d]);
      assert.deepEqual(r.zip, [0x50, 0x4b, 0x03, 0x04]);
      assert.deepEqual([r.pdfTypes, r.zipType], [['application/pdf', 'application/pdf'], 'application/zip']);
    });
  });

  // ---------------------------------------------------------------- performance (E2E_BENCH=1)

  describe('performance', { skip: !process.env.E2E_BENCH && 'set E2E_BENCH=1 to measure' }, () => {
    it('durations of the budgets', async () => {
      const lines = await page.evaluate(async () => {
        const lab = /** @type {any} */ (window).lab;
        const { encodeImage } = await import(`${location.origin}/encode.js`);
        const { buildPdf } = await import(`${location.origin}/pdf.js`);
        const { buildZip } = await import(`${location.origin}/zip.js`);
        const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
        const out = [];
        // Runs `fn` once to warm up, then `n` times: median and minimum in ms, and the size it returns.
        const measure = async (label, fn, n = 5) => {
          await fn();
          const times = [];
          let size = 0;
          for (let i = 0; i < n; i++) {
            const t = performance.now();
            size = (await fn()).size;
            times.push(performance.now() - t);
          }
          out.push(`${label.padEnd(46)} median ${median(times).toFixed(0).padStart(5)} ms   min ${Math.min(...times).toFixed(0).padStart(5)} ms   ${(size / 1024).toFixed(0).padStart(7)} KB`);
        };
        const ui4k = lab.ui(3840, 2160), photo4k = lab.photo(3840, 2160);
        for (const [name, c] of [['4K UI screenshot', ui4k], ['4K photograph', photo4k]]) {
          for (const format of ['png', 'jpeg', 'webp']) await measure(`encode ${name} ${format}`, () => encodeImage(c, { format }));
        }
        const bitmap = await createImageBitmap(ui4k);
        await measure('encode 4K UI screenshot png (from a bitmap)', () => encodeImage(bitmap, { format: 'png' }));
        bitmap.close();
        const ui = lab.ui(1920, 1080), photo = lab.photo(1920, 1080);
        const twenty = (source) => Array.from({ length: 20 }, () => ({ source, width: 1920, height: 1080 }));
        await measure('pdf 20 pages 1080p UI, flate', () => buildPdf(twenty(ui)), 3);
        await measure('pdf 20 pages 1080p UI, jpeg 0.92', () => buildPdf(twenty(ui), { encoding: 'jpeg' }), 3);
        await measure('pdf 20 pages 1080p photograph, flate', () => buildPdf(twenty(photo)), 3);
        await measure('pdf 20 pages 1080p photograph, jpeg 0.92', () => buildPdf(twenty(photo), { encoding: 'jpeg' }), 3);
        await measure('pdf 1 page 4K UI, flate', () => buildPdf([{ source: ui4k, width: 3840, height: 2160 }]));
        const png = await encodeImage(ui, { format: 'png' });
        await measure('zip 50 x PNG 1080p UI', () => buildZip(Array.from({ length: 50 }, (_, i) => ({ name: `shot-${i}.png`, blob: png }))));
        const raw = new Blob([crypto.getRandomValues(new Uint8Array(65_536)), new Uint8Array(2 * 1024 * 1024 - 65_536)]);
        await measure('zip 50 x 2 MB', () => buildZip(Array.from({ length: 50 }, (_, i) => ({ name: `f${i}.bin`, blob: raw }))));
        return out;
      });
      console.log(`\n${lines.join('\n')}\n`);
    });
  });
});
