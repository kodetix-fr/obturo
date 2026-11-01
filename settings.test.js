import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTURE_DELAYS } from './gestures.js';
import {
  AFTER_CAPTURE, DEFAULT_SETTINGS, DOWNLOAD_FORMATS, FULL_PAGE_FIXED, FULL_PAGE_WAITS, MAX_NAME_TEMPLATE, PDF_ENCODINGS, PDF_LAYOUTS, cleanShotIds, normalizeSettings, notifySettingsChanged, readAppearance, writeAppearance,
} from './settings.js';
import { DEFAULT_NAME_TEMPLATE } from './encode.js';

test('the maxlength of the file name template in library.html is MAX_NAME_TEMPLATE', () => {
  const html = readFileSync(new URL('library.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`<input[^>]*name="filenameTemplate"[^>]*maxlength="${MAX_NAME_TEMPLATE}"`));
});

const g = /** @type {any} */ (globalThis);

// Receives what the other contexts would receive: the next message of the channel.
function nextMessage() {
  const rx = new BroadcastChannel('obturo');
  return new Promise((done) => { rx.onmessage = (e) => { rx.close(); done(e.data); }; });
}

test('notifySettingsChanged: the channel gets the message, and without the chrome API nothing else is needed', async () => {
  assert.equal(typeof g.chrome, 'undefined');
  const received = nextMessage();
  notifySettingsChanged();
  assert.deepEqual(await received, { type: 'settings-changed' });
});

test('notifySettingsChanged: a runtime message too, to wake a stopped service worker', async () => {
  const sent = [];
  g.chrome = { runtime: { sendMessage: (m) => { sent.push(m); return Promise.resolve(); } } };
  try {
    const received = nextMessage();
    notifySettingsChanged();
    assert.deepEqual(await received, { type: 'settings-changed' });
    assert.deepEqual(sent, [{ type: 'settings-changed' }]);
  } finally {
    delete g.chrome;
  }
});

test('notifySettingsChanged: no receiver, a reloaded extension or an older API never throws', async () => {
  const cases = [
    { runtime: { sendMessage: () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) } },
    { runtime: { sendMessage: () => { throw new Error('Extension context invalidated.'); } } },
    { runtime: { sendMessage: () => undefined } },
    { runtime: {} },
    {},
  ];
  for (const chrome of cases) {
    g.chrome = chrome;
    try {
      const received = nextMessage();
      assert.doesNotThrow(() => notifySettingsChanged());
      assert.deepEqual(await received, { type: 'settings-changed' });
      await new Promise((done) => setImmediate(done)); // lets a rejected promise surface if it was left unhandled
    } finally {
      delete g.chrome;
    }
  }
});

// A minimal localStorage, as the pages of the extension have it.
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, data };
}

test('appearance copy: written, read back validated, null when there is none', () => {
  g.localStorage = fakeStorage();
  try {
    assert.equal(readAppearance(), null, 'no copy yet');
    writeAppearance({ language: 'fr', theme: 'dark' });
    assert.deepEqual(readAppearance(), { language: 'fr', theme: 'dark', noTrace: false, captureDelay: 0 });
    assert.deepEqual(JSON.parse(g.localStorage.data.get('obturo.appearance')), { language: 'fr', theme: 'dark', noTrace: false, captureDelay: 0 });
    writeAppearance({ language: 'en', theme: 'auto', noTrace: true, captureDelay: 5 }); // what the popup shows at once, with no database
    assert.deepEqual(readAppearance(), { language: 'en', theme: 'auto', noTrace: true, captureDelay: 5 });
  } finally {
    delete g.localStorage;
  }
});

test('appearance copy: a corrupted or foreign value never breaks the page', () => {
  for (const raw of ['not json', '"text"', '42', 'null', '{"language":"klingon","theme":"pink"}']) {
    g.localStorage = fakeStorage({ 'obturo.appearance': raw });
    try {
      const copy = readAppearance();
      if (raw === '{"language":"klingon","theme":"pink"}') assert.deepEqual(copy, { language: DEFAULT_SETTINGS.language, theme: DEFAULT_SETTINGS.theme, noTrace: false, captureDelay: 0 });
      else assert.equal(copy, null, raw);
    } finally {
      delete g.localStorage;
    }
  }
});

test('appearance copy: without localStorage (service worker) or when it throws, nothing is thrown', () => {
  assert.equal(typeof g.localStorage, 'undefined');
  assert.equal(readAppearance(), null);
  assert.doesNotThrow(() => writeAppearance({ language: 'en', theme: 'light' }));
  g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  try {
    assert.equal(readAppearance(), null);
    assert.doesNotThrow(() => writeAppearance({ language: 'en', theme: 'light' }));
  } finally {
    delete g.localStorage;
  }
});

// The PDF options of the download (export-ui.js): a stored value that is not one of pdf.js's choices never gets through.
test('normalizeSettings: the PDF layout and encoding', () => {
  assert.equal(DEFAULT_SETTINGS.pdfLayout, 'fit');
  assert.equal(DEFAULT_SETTINGS.pdfEncoding, 'flate');
  for (const pdfLayout of PDF_LAYOUTS) assert.equal(normalizeSettings({ pdfLayout }).pdfLayout, pdfLayout);
  for (const pdfEncoding of PDF_ENCODINGS) assert.equal(normalizeSettings({ pdfEncoding }).pdfEncoding, pdfEncoding);
  for (const junk of ['letter', 'A4', '', null, undefined, 4, {}, ['a4'], 'constructor', '__proto__']) {
    assert.equal(normalizeSettings({ pdfLayout: junk }).pdfLayout, 'fit', String(junk));
    assert.equal(normalizeSettings({ pdfEncoding: junk }).pdfEncoding, 'flate', String(junk));
  }
  assert.deepEqual(normalizeSettings({ pdfLayout: 'a4', pdfEncoding: 'jpeg', language: 'fr' }), { ...DEFAULT_SETTINGS, pdfLayout: 'a4', pdfEncoding: 'jpeg', language: 'fr' });
});

// The full page (sw.js, fullpage.js): the wait after a scroll is one of the choices of the dialog, the fixed elements one of two ways.
test('normalizeSettings: the no-trace mode is a boolean, off by default', () => {
  assert.equal(DEFAULT_SETTINGS.noTrace, false);
  assert.equal(normalizeSettings({ noTrace: true }).noTrace, true);
  assert.equal(normalizeSettings({ noTrace: false }).noTrace, false);
  for (const junk of ['true', 1, 0, null, undefined, {}, [true], 'yes']) assert.equal(normalizeSettings({ noTrace: junk }).noTrace, false, String(junk));
});

test('normalizeSettings: the delay before a capture is one of the choices, none by default', () => {
  assert.equal(DEFAULT_SETTINGS.captureDelay, 0);
  assert.deepEqual(CAPTURE_DELAYS, [0, 3, 5, 10]);
  for (const captureDelay of CAPTURE_DELAYS) assert.equal(normalizeSettings({ captureDelay }).captureDelay, captureDelay);
  for (const junk of [1, 4, -3, 11, '3', '', null, undefined, 3.5, NaN, {}, [3]]) assert.equal(normalizeSettings({ captureDelay: junk }).captureDelay, 0, String(junk));
});

test('normalizeSettings: the full-page wait and the fixed elements', () => {
  assert.deepEqual([DEFAULT_SETTINGS.fullPageWait, DEFAULT_SETTINGS.fullPageFixed], [0, 'edges']);
  assert.deepEqual(FULL_PAGE_WAITS, [0, 500, 1000, 2000]);
  for (const fullPageWait of FULL_PAGE_WAITS) assert.equal(normalizeSettings({ fullPageWait }).fullPageWait, fullPageWait);
  for (const fullPageFixed of FULL_PAGE_FIXED) assert.equal(normalizeSettings({ fullPageFixed }).fullPageFixed, fullPageFixed);
  for (const junk of [-1, 1, 750, 3000, 99999, NaN, Infinity, '500', null, undefined, {}, [500]]) assert.equal(normalizeSettings({ fullPageWait: junk }).fullPageWait, 0, String(junk));
  for (const junk of ['show', 'Hide', '', null, undefined, 1, {}, ['hide'], 'constructor', '__proto__']) assert.equal(normalizeSettings({ fullPageFixed: junk }).fullPageFixed, 'edges', String(junk));
});

test('normalizeSettings: the download format and quality choices are the ones the export offers', () => {
  assert.deepEqual(DOWNLOAD_FORMATS, ['png', 'jpeg', 'webp', 'pdf']);
  for (const downloadFormat of DOWNLOAD_FORMATS) assert.equal(normalizeSettings({ downloadFormat }).downloadFormat, downloadFormat);
  assert.equal(normalizeSettings({ downloadFormat: 'gif' }).downloadFormat, 'png');
  for (const q of [0.1, 0.5, 1]) assert.equal(normalizeSettings({ downloadQuality: q }).downloadQuality, q);
  for (const q of [0, 0.09, 1.01, NaN, Infinity, '0.5', null]) assert.equal(normalizeSettings({ downloadQuality: q }).downloadQuality, 0.9, String(q));
});

test('normalizeSettings: what happens after a capture is ask or copy, ask (the default) for anything else', () => {
  assert.deepEqual(AFTER_CAPTURE, ['ask', 'copy', 'save']);
  assert.equal(DEFAULT_SETTINGS.afterCapture, 'ask', 'a window asks what to do with a capture, until the person chooses to copy it');
  for (const afterCapture of AFTER_CAPTURE) assert.equal(normalizeSettings({ afterCapture }).afterCapture, afterCapture);
  for (const junk of ['both', 'Copy', '', null, undefined, 1, {}, ['copy'], 'constructor']) assert.equal(normalizeSettings({ afterCapture: junk }).afterCapture, 'ask', String(junk));
});

test('normalizeSettings: the file name template is any text of 1 to 80 characters, the default for the rest; encode.js has the same default', () => {
  assert.equal(DEFAULT_SETTINGS.filenameTemplate, DEFAULT_NAME_TEMPLATE, 'settings.js repeats the default of encode.js so that the service worker does not load it');
  for (const filenameTemplate of ['{date}', 'Screenshot {date} {time}', 'x'.repeat(80), 'no word at all', '{nope}']) assert.equal(normalizeSettings({ filenameTemplate }).filenameTemplate, filenameTemplate);
  for (const junk of ['', ' ', ' \t ', 'x'.repeat(81), 7, null, undefined, {}, ['{date}']]) assert.equal(normalizeSettings({ filenameTemplate: junk }).filenameTemplate, DEFAULT_NAME_TEMPLATE, String(junk));
});

// The shots the library holds open are published next to the settings; whatever is stored there, only whole numbers get through.
test('cleanShotIds: a short list of positive whole numbers, nothing else', () => {
  assert.deepEqual(cleanShotIds([3, 7]), [3, 7]);
  assert.deepEqual(cleanShotIds([]), []);
  assert.deepEqual(cleanShotIds([3, '4', 5.5, NaN, null, undefined, -1, 0, {}, [6], 8]), [3, 8], 'ids start at 1');
  for (const junk of [undefined, null, 'x', 12, {}, { 0: 3, length: 1 }]) assert.deepEqual(cleanShotIds(junk), [], String(junk));
  assert.equal(cleanShotIds(Array.from({ length: 100 }, (_, i) => i + 1)).length, 8, 'a handful at most: a tab holds one or two');
});
