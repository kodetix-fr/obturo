import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTIMATE_BAND_PIXELS, ESTIMATE_MAX_PIXELS, IMAGE_FORMATS, MAX_ITEMS, MAX_OUTPUT_BYTES, batchDefaults, batchFilename, canEstimate, classifyExportError,
  countShownAsOriginal, createLatest, displayedVersion, estimateBand, extensionOf, imageFilename, isLossy, planBatch, usesQuality,
} from './export-pure.js';
import { DEFAULT_SETTINGS } from './settings.js';

test('formats: which are lossy, which use the quality, which extension', () => {
  assert.deepEqual([...IMAGE_FORMATS], ['png', 'jpeg', 'webp']);
  assert.deepEqual(['png', 'jpeg', 'webp', 'pdf'].map(isLossy), [false, true, true, false]);
  assert.equal(usesQuality('png', 'jpeg'), false, 'PNG is lossless whatever the PDF setting says');
  assert.equal(usesQuality('jpeg', 'flate'), true);
  assert.equal(usesQuality('webp', 'flate'), true);
  assert.equal(usesQuality('pdf', 'flate'), false);
  assert.equal(usesQuality('pdf', 'jpeg'), true);
  assert.deepEqual(['png', 'jpeg', 'webp', 'pdf'].map(extensionOf), ['png', 'jpg', 'webp', 'pdf']);
});

test('canEstimate: the estimate encodes the real image, so it has a ceiling', () => {
  assert.equal(canEstimate(1920, 1080), true);
  assert.equal(canEstimate(3840, 2160), true);
  assert.equal(canEstimate(1920, 16384), true, 'a full page of 31 million pixels');
  assert.equal(canEstimate(10000, 10000), false);
  assert.equal(ESTIMATE_MAX_PIXELS >= 32e6, true, 'at least the largest capture the extension takes');
});

test('estimateBand: the whole image up to 4 million pixels, else a band of full width from the middle and the ratio to scale by', () => {
  assert.equal(ESTIMATE_BAND_PIXELS, 4e6);
  // small enough: the whole image, not an extrapolation
  assert.deepEqual(estimateBand(1920, 1080), { y: 0, h: 1080, k: 1 });
  assert.deepEqual(estimateBand(2000, 2000), { y: 0, h: 2000, k: 1 }, 'exactly 4 million pixels');
  // bigger: a band of at most 4 million pixels, centered, k = rows of the image / rows of the band
  for (const [w, h] of [[3840, 2160], [1904, 16384], [1920, 16384], [3824, 8000], [16384, 16384], [20000, 5000]]) {
    const band = estimateBand(w, h);
    assert.ok(band.h >= 1 && band.h * w <= ESTIMATE_BAND_PIXELS, `${w}x${h}: a band of ${band.h} rows`);
    assert.ok(band.h * w > ESTIMATE_BAND_PIXELS - w, `${w}x${h}: the band is as tall as the budget allows`);
    assert.ok(band.y >= 0 && band.y + band.h <= h, `${w}x${h}: inside the image`);
    assert.ok(Math.abs(band.y - (h - band.h - band.y)) <= 1, `${w}x${h}: centered`);
    assert.ok(Math.abs(band.k * band.h - h) < 1e-9 && band.k > 1, `${w}x${h}: k scales the band back to the image`);
  }
  assert.deepEqual(estimateBand(3840, 2160), { y: 559, h: 1041, k: 2160 / 1041 });
  // nothing to cut, or nothing sensible: whole, k = 1
  assert.deepEqual(estimateBand(0, 0), { y: 0, h: 0, k: 1 });
  assert.deepEqual(estimateBand(NaN, 10), { y: 0, h: 10, k: 1 });
});

test('canEstimate and estimateBand: the ceiling of the estimate is above the largest full page', () => {
  assert.ok(ESTIMATE_MAX_PIXELS > ESTIMATE_BAND_PIXELS * 4);
  assert.equal(canEstimate(1904, 16384), true);
});

// --- createLatest, with a clock the test drives ---

function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id; },
    clearTimer: (t) => timers.delete(t),
    /** Moves the clock and fires the timers that fall due, in order. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}
const settle = () => new Promise((done) => setImmediate(done));

test('createLatest: a burst of requests runs once, with the last value, after the delay', async () => {
  const c = clock();
  const ran = [], got = [];
  const q = createLatest({ delay: 100, setTimer: c.setTimer, clearTimer: c.clearTimer, run: (v) => { ran.push(v); return v * 2; }, onResult: (r, v) => got.push([v, r]) });
  q.request(1);
  c.advance(60);
  q.request(2);
  c.advance(60);
  q.request(3);
  c.advance(99);
  await settle();
  assert.deepEqual(ran, [], 'still waiting for a newer value');
  c.advance(1);
  await settle();
  assert.deepEqual(ran, [3]);
  assert.deepEqual(got, [[3, 6]]);
});

test('createLatest: a request during a run waits for it, then the newest value runs; the stale result is dropped', async () => {
  const c = clock();
  const ran = [], got = [];
  /** @type {Array<() => void>} */
  const finish = [];
  const q = createLatest({
    delay: 10, setTimer: c.setTimer, clearTimer: c.clearTimer,
    run: (v, stale) => new Promise((done) => { ran.push(v); finish.push(() => done(`${v}${stale() ? ' stale' : ''}`)); }),
    onResult: (r) => got.push(r),
  });
  q.request('a');
  c.advance(10);
  await settle();
  assert.deepEqual(ran, ['a']);
  assert.equal(q.running, true);
  q.request('b');
  c.advance(10); // the timer fires while 'a' is running: nothing starts twice
  await settle();
  assert.deepEqual(ran, ['a'], 'one run at a time');
  finish[0]();
  await settle();
  assert.deepEqual(got, [], 'the result of a is stale: b was requested after it started');
  assert.deepEqual(ran, ['a', 'b'], 'b runs right after');
  finish[1]();
  await settle();
  assert.deepEqual(got, ['b']);
  assert.equal(q.running, false);
});

test('createLatest: cancel drops the timer and the run in flight, and nothing starts afterwards', async () => {
  const c = clock();
  const got = [], failed = [];
  let finish;
  const q = createLatest({
    delay: 10, setTimer: c.setTimer, clearTimer: c.clearTimer,
    run: () => new Promise((done) => { finish = done; }), onResult: (r) => got.push(r), onError: (e) => failed.push(e),
  });
  q.request(1);
  c.advance(10);
  await settle();
  q.request(2); // would run after the first
  q.cancel();
  assert.equal(c.pending, 0, 'the timer is gone');
  finish('late');
  await settle();
  assert.deepEqual(got, []);
  q.request(3);
  assert.equal(c.pending, 0, 'a cancelled scheduler accepts nothing');
  c.advance(1000);
  await settle();
  assert.deepEqual([got, failed], [[], []]);
});

test('createLatest: an error of the latest run is reported, one of a stale run is not, and the next run still happens', async () => {
  const c = clock();
  const got = [], failed = [];
  const q = createLatest({
    delay: 5, setTimer: c.setTimer, clearTimer: c.clearTimer,
    run: (v) => (v === 'bad' ? Promise.reject(new Error('boom')) : v), onResult: (r) => got.push(r), onError: (e) => failed.push(/** @type {Error} */ (e).message),
  });
  q.request('bad');
  c.advance(5);
  await settle();
  assert.deepEqual(failed, ['boom']);
  q.request('ok');
  c.advance(5);
  await settle();
  assert.deepEqual(got, ['ok']);
  q.request('bad');
  c.advance(5);
  q.request('ok2'); // the failing run is stale by now
  await settle();
  assert.deepEqual(failed, ['boom'], 'no report for a stale run');
  c.advance(5);
  await settle();
  assert.deepEqual(got, ['ok', 'ok2']);
});

test('createLatest: the real timers work too', async () => {
  const got = [];
  const q = createLatest({ delay: 5, run: (v) => v + 1, onResult: (r) => got.push(r) });
  q.request(1);
  q.request(10);
  for (let waited = 0; !got.length && waited < 5000; waited += 10) await new Promise((done) => setTimeout(done, 10));
  await new Promise((done) => setTimeout(done, 50)); // a stale run, if there was one, would have answered by now
  assert.deepEqual(got, [11]);
});

// --- Errors ---

test('classifyExportError: the messages of encode.js, pdf.js and zip.js, and of the browser', () => {
  const kind = (m, name) => classifyExportError(Object.assign(new Error(m), name ? { name } : {}));
  assert.equal(kind('the browser could not encode 20000x20000 px as image/png (image too large?)'), 'tooLarge');
  assert.equal(kind('image too large for the browser'), 'tooLarge');
  assert.equal(kind('image too large for a PDF page'), 'tooLarge');
  assert.equal(kind('2D context unavailable'), 'tooLarge');
  assert.equal(kind('too many files for a zip without ZIP64'), 'tooLarge');
  assert.equal(kind('zip too big for a zip without ZIP64'), 'tooLarge');
  assert.equal(kind('Array buffer allocation failed'), 'tooLarge');
  assert.equal(kind('the browser cannot encode image/webp'), 'encoder');
  assert.equal(kind('The source image could not be decoded.', 'InvalidStateError'), 'unreadable');
  assert.equal(kind('Failed to execute drawImage', 'InvalidStateError'), 'unreadable', 'a closed bitmap');
  assert.equal(kind('anything', 'EncodingError'), 'unreadable');
  assert.equal(kind('cannot encode an empty image'), 'other');
  assert.equal(kind('boom'), 'other');
  for (const odd of [undefined, null, 'text', 42, {}]) assert.equal(typeof classifyExportError(odd), 'string');
  assert.equal(classifyExportError('image too large'), 'tooLarge', 'a thrown string');
});

// --- Grouped export ---

test('limits of a grouped export are written down', () => {
  assert.equal(MAX_ITEMS, 200);
  assert.equal(MAX_OUTPUT_BYTES, 256 * 1024 * 1024);
});

test('displayedVersion: the active version, or null for the original', () => {
  const v = [{ name: 'V1' }, { name: 'V2' }];
  assert.equal(displayedVersion({ versions: v, active: 1 }), v[1]);
  assert.equal(displayedVersion({ versions: v, active: 0 }), v[0]);
  assert.equal(displayedVersion({ versions: v, active: -1 }), null);
  assert.equal(displayedVersion({ versions: [], active: -1 }), null);
  assert.equal(displayedVersion({ versions: v, active: 9 }), null, 'an index out of range is the original');
  assert.equal(displayedVersion({ versions: undefined, active: 0 }), null);
});

test('countShownAsOriginal: only the edited captures that display their original are counted', () => {
  const v = [{ name: 'V1' }, { name: 'V2' }];
  const shots = [
    { versions: v, active: -1 },        // edited, shows the original: exported without its changes
    { versions: v, active: 1 },         // edited, shows V2
    { versions: [], active: -1 },       // never edited
    { versions: undefined, active: -1 }, // a row without versions
    { versions: [v[0]], active: -1 },   // edited, shows the original
    { versions: v, active: 9 },         // an index out of range reads as the original
  ];
  assert.equal(countShownAsOriginal(shots), 3);
  assert.equal(countShownAsOriginal([]), 0);
  assert.equal(countShownAsOriginal(shots.slice(1, 4)), 0);
});

test('planBatch: capture order, no duplicate, the missing ids reported', () => {
  const rows = [{ id: 3 }, { id: 1 }, { id: 7 }, { id: 5 }];
  assert.deepEqual(planBatch([7, 1, 3, 3, 1], rows), { items: [{ id: 1 }, { id: 3 }, { id: 7 }], missing: [] });
  assert.deepEqual(planBatch([5, 2, 9, 1], rows), { items: [{ id: 1 }, { id: 5 }], missing: [2, 9] });
  assert.deepEqual(planBatch([], rows), { items: [], missing: [] });
  assert.deepEqual(planBatch(/** @type {any} */ ([1.5, NaN, '3', null, 3]), rows), { items: [{ id: 3 }], missing: [] }, 'only integers count');
});

test('file names: the capture date for an image, obturo_<date> for the single file of a group', () => {
  const at = new Date(2026, 9, 2, 14, 5, 9).getTime();
  assert.equal(imageFilename({ url: 'https://app.example.test/x', createdAt: at }, 'jpeg'), 'app.example.test_2026-10-02_14-05-09.jpg');
  assert.equal(imageFilename({ url: 'https://app.example.test/x', createdAt: at }, 'pdf'), 'app.example.test_2026-10-02_14-05-09.pdf');
  assert.equal(imageFilename({ url: '', createdAt: at }, 'png'), 'capture_2026-10-02_14-05-09.png');
  assert.equal(imageFilename({ url: 'https://app.example.test/x', title: 'Home', createdAt: at }, 'webp', '{title} {date}'), 'Home 2026-10-02.webp', 'the template of the settings');
  const named = { url: 'https://app.example.test/x', createdAt: at, versions: [{ name: 'V1' }, { name: 'Before the fix' }], active: 1 };
  assert.equal(imageFilename(named, 'png'), 'app.example.test_2026-10-02_14-05-09_Before the fix.png', 'a version the person named');
  assert.equal(imageFilename({ ...named, active: 0 }, 'png'), 'app.example.test_2026-10-02_14-05-09.png', 'V1 is not a name');
  assert.equal(imageFilename({ ...named, active: -1 }, 'png'), 'app.example.test_2026-10-02_14-05-09.png', 'the original has none');
  assert.equal(imageFilename({ ...named, versions: [{ name: 'a/b:c' }], active: 0 }, 'png'), 'app.example.test_2026-10-02_14-05-09_a-b-c.png', 'nothing Windows forbids');
  assert.equal(batchFilename('zip', at), 'obturo_2026-10-02_14-05-09.zip');
  assert.equal(batchFilename('pdf', at), 'obturo_2026-10-02_14-05-09.pdf');
  assert.match(batchFilename('zip'), /^obturo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/);
});

test('batchDefaults: a PDF default gives a PDF, anything else a ZIP of that image format', () => {
  assert.deepEqual(batchDefaults(DEFAULT_SETTINGS), { output: 'zip', format: 'png', quality: 0.9, layout: 'fit', encoding: 'flate' });
  assert.deepEqual(batchDefaults({ ...DEFAULT_SETTINGS, downloadFormat: 'webp', downloadQuality: 0.4 }), { output: 'zip', format: 'webp', quality: 0.4, layout: 'fit', encoding: 'flate' });
  assert.deepEqual(batchDefaults({ ...DEFAULT_SETTINGS, downloadFormat: 'pdf', pdfLayout: 'a4', pdfEncoding: 'jpeg' }), { output: 'pdf', format: 'png', quality: 0.9, layout: 'a4', encoding: 'jpeg' });
});
