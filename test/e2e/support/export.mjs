// Helpers for the export tests (export-ui.e2e.mjs): reading what a download produced (image, PDF, ZIP), driving the format
// menu and the dialog of the grouped export, and a few lines of the database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from 'pdf-lib';
import { poll } from './editor.mjs';

// ---------------------------------------------------------------- what a download holds

const hex = (buf, from, to) => buf.subarray(from, to).toString('hex');

/** The signature of each format, checked on the first bytes of a file. */
export const isFormat = {
  png: (buf) => hex(buf, 0, 4) === '89504e47',
  jpeg: (buf) => hex(buf, 0, 3) === 'ffd8ff',
  webp: (buf) => buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP',
  pdf: (buf) => buf.toString('latin1', 0, 5) === '%PDF-',
  zip: (buf) => hex(buf, 0, 4) === '504b0304',
};

/** Decodes any image the browser reads (PNG, JPEG, WebP): { width, height, data } with data = RGBA. */
export async function decodeImage(page, buf, type = 'image/png') {
  const out = await page.evaluate(async ({ b64, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { width: bmp.width, height: bmp.height, data: btoa(bin) };
  }, { b64: buf.toString('base64'), type });
  return { width: out.width, height: out.height, data: Buffer.from(out.data, 'base64') };
}

export const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** The pages of a PDF as pdf-lib reads them: [{ width, height (the MediaBox, in points), filter, imageWidth, imageHeight }]. */
export async function readPdf(buf) {
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  return doc.getPages().map((page) => {
    const image = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)?.lookup(PDFName.of('Im0'), PDFStream);
    assert.ok(image, 'every page draws an image');
    const box = page.getMediaBox();
    return {
      width: Math.round(box.width * 1000) / 1000, height: Math.round(box.height * 1000) / 1000,
      filter: String(image.dict.get(PDFName.of('Filter'))),
      imageWidth: image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
      imageHeight: image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(),
    };
  });
}

/** Entries of a ZIP, read the way an extractor does (central directory, CRC-32 checked by zlib): [{ name, data }]. */
export function readZip(buf) {
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'end of central directory');
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const data = buf.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    assert.equal(crc32(data), crc, 'CRC-32');
    entries.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLength), data });
    p += 46 + nameLength;
  }
  return entries;
}

// ---------------------------------------------------------------- driving the page

/** Runs `trigger` (a click...) and returns the file that the browser downloads: { buf, name }. */
export async function downloadAfter(page, trigger, timeout = 20_000) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), trigger()]);
  return { buf: readFileSync(await dl.path()), name: dl.suggestedFilename() };
}

/** The settings as stored. */
export const stored = (page) => page.evaluate(async () => (await import(`${location.origin}/settings.js`)).getSettings());

export const openMenu = async (page) => {
  await page.click('#downloadMenu');
  await page.waitForSelector('#dlPop:not([hidden])');
};
export const closeMenu = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#dlPop', { state: 'hidden' });
};

/** Chooses a format in the menu, waits until it is stored, closes the menu. */
export async function chooseFormat(page, format) {
  await openMenu(page);
  await page.click(`#dlPop label.dl-opt:has(input[value="${format}"])`);
  await poll(async () => (await stored(page)).downloadFormat === format, { what: `${format} stored` });
  await poll(async () => (await page.locator('#downloadFmt').textContent()) === { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', pdf: 'PDF' }[format], { what: 'the format on the button' });
  await closeMenu(page);
}

/** Opens the dialog of the grouped export for these ids, as the selection bar of the library does. */
export async function openBatch(page, ids) {
  await page.evaluate(async (ids) => (await import(`${location.origin}/export-ui.js`)).openBatchExport(ids), ids);
  await page.waitForSelector('#exportDialog[open]');
}

/** The grouped export ends (done or canceled): the Close button shows. */
export const batchDone = (page, timeout = 60_000) => page.waitForSelector('#exportDialog[data-state="done"]', { timeout });

export const closeBatch = async (page) => {
  await page.click('#exClose');
  await page.waitForSelector('#exportDialog', { state: 'hidden' });
};

// ---------------------------------------------------------------- database

/** Replaces the original of a shot by these bytes (null removes it), leaving the row: a shot whose image is damaged. */
export const setOriginal = (page, id, bytes) => page.evaluate(async ({ id, bytes }) => {
  const conn = await new Promise((ok, ko) => { const r = indexedDB.open('obturo'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const tx = conn.transaction('originals', 'readwrite');
  if (bytes === null) tx.objectStore('originals').delete(id);
  else tx.objectStore('originals').put(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), id);
  await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); });
  conn.close();
}, { id, bytes });
