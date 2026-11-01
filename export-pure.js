// Pure logic of the export interface (export-ui.js, export-batch.js): no DOM, no chrome.*, tested with node --test.
// What decides which formats exist, which options count, how an error is explained to the user,
// which shots a grouped export takes and under which limits, and the scheduler of the live size estimate.
import { FORMATS, suggestedFilename } from './encode.js';

/** The formats of an image file (the ZIP of images offers these); `pdf` is the fourth download format. */
export const IMAGE_FORMATS = /** @type {const} */ (['png', 'jpeg', 'webp']);

/** @param {string} format */
export const isLossy = (format) => format === 'jpeg' || format === 'webp';

/** Does the quality setting change the output: a JPEG or WebP image, or a PDF whose pictures are JPEG. */
export const usesQuality = (/** @type {string} */ format, /** @type {string} */ pdfEncoding) => isLossy(format) || (format === 'pdf' && pdfEncoding === 'jpeg');

/** File extension of a download format. @param {string} format */
export const extensionOf = (format) => (format === 'pdf' ? 'pdf' : FORMATS[/** @type {'png'} */ (format)].ext);

// --- Live estimate of the size of a JPEG or WebP ---

export const ESTIMATE_DELAY_MS = 250; // after the last move of the quality slider
// ponytail: the image is rendered once, whole, at the first move of the slider (as heavy as the render of the download), so none is
// shown above 36 million pixels (a full page is at most 32, a scaled-up output can reach 100); render only the band at the source (a
// parameter of the export context of the editor) to remove that first render and that ceiling.
export const ESTIMATE_MAX_PIXELS = 36e6;
export const canEstimate = (/** @type {number} */ w, /** @type {number} */ h) => w * h <= ESTIMATE_MAX_PIXELS;

// Encoding a whole 4K image as JPEG takes 0.3 s and 0.7 s as WebP, a full page 0.45 s and 2 s (measured, Chromium 143): the
// estimate encodes at most this many pixels, a band of the image, and multiplies the size by the ratio.
// ponytail: one band taken in the middle, so the size of a page whose top and bottom compress very differently is off by that much (the estimate shows "~"); take two or three bands if people complain.
export const ESTIMATE_BAND_PIXELS = 4e6;

/**
 * The part of an image that the estimate encodes: the whole image up to ESTIMATE_BAND_PIXELS, else a band of full width taken
 * from the middle. `k` is what the size of the band is multiplied by: 1 when the band is the whole image (the estimate is then
 * the size of the download, not an extrapolation).
 * @param {number} w
 * @param {number} h
 * @returns {{ y: number, h: number, k: number }}
 */
export function estimateBand(w, h) {
  if (!(w >= 1 && h >= 1) || w * h <= ESTIMATE_BAND_PIXELS) return { y: 0, h, k: 1 };
  const rows = Math.max(1, Math.floor(ESTIMATE_BAND_PIXELS / w));
  return { y: Math.floor((h - rows) / 2), h: rows, k: h / rows };
}

/**
 * Runs `run` for the latest value only: a request waits `delay` ms for a newer one, a run in progress is never started
 * twice (the newest request goes right after it), and only the result of the newest request is delivered. `cancel` drops
 * the timer and whatever is in flight. Timers are injectable for the tests.
 * @template V, R
 * @param {object} options
 * @param {(value: V, stale: () => boolean) => Promise<R> | R} options.run `stale()` tells a long run that its result will be dropped.
 * @param {(result: R, value: V) => void} options.onResult
 * @param {(error: unknown, value: V) => void} [options.onError]
 * @param {number} [options.delay]
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(timer: any) => void} [options.clearTimer]
 */
export function createLatest({ run, onResult, onError = () => {}, delay = ESTIMATE_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  /** @type {V | undefined} */
  let value;
  let seq = 0; // number of the newest request
  let running = false;
  let again = false; // a run is due as soon as the one in progress ends
  let closed = false;

  function start() {
    timer = null;
    if (closed) return;
    if (running) { again = true; return; }
    running = true;
    const mine = seq;
    const v = /** @type {V} */ (value);
    const stale = () => closed || mine !== seq;
    Promise.resolve().then(() => run(v, stale)).then(
      (result) => { if (!stale()) onResult(result, v); },
      (error) => { if (!stale()) onError(error, v); },
    ).finally(() => {
      running = false;
      if (again && !closed) { again = false; start(); }
    });
  }

  return {
    /** @param {V} v */
    request(v) {
      if (closed) return;
      value = v;
      seq++;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(start, delay);
    },
    cancel() {
      closed = true;
      seq++;
      again = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    get running() { return running; },
  };
}

// --- Errors ---

/**
 * What went wrong in an export, for the message shown to the user.
 * - `tooLarge`: the output does not fit the browser (canvas, memory, PDF page, ZIP);
 * - `encoder`: the browser refused the format (it answered with another one);
 * - `unreadable`: the source image cannot be decoded (or was closed under us);
 * - `other`: anything else.
 * @param {unknown} error
 * @returns {'tooLarge' | 'encoder' | 'unreadable' | 'other'}
 */
export function classifyExportError(error) {
  const e = /** @type {{ message?: unknown, name?: unknown } | null | undefined} */ (error);
  const text = String(e?.message ?? error ?? '');
  if (/cannot encode image\//i.test(text)) return 'encoder';
  if (/too large|too big|too many|2D context unavailable|allocation|invalid (typed )?array length|out of memory|could not encode/i.test(text)) return 'tooLarge';
  if (e?.name === 'InvalidStateError' || e?.name === 'EncodingError' || /could not be decoded|unreadable/i.test(text)) return 'unreadable';
  return 'other';
}

// --- Grouped export ---

// ponytail: 200 captures an export, 256 MiB of output at most (the captures after that are reported as "limit reached"). The
// encoded pages and files are kept until the single download is built, and the flate PDF is the heaviest: 5 MB a page for 1080p
// photographs (raw RGB deflated, photographs barely shrink), a tenth of that for screenshots. Peak memory of the browser, measured
// on Chromium 143 with runBatch (one capture rendered at a time, so it grows with the output more than with the count): 20
// captures of 1080p +230 MB as ZIP or PDF of screenshots, +300 MB as a flate PDF of photographs (the file is 106 MB), the
// +180 MB of 20 pages measured for pdf.js alone included; 4K: +550 MB for 5 captures, +850 MB for 20 (about 100 MB of pixels at
// a time, and what Chrome keeps of the canvases it freed). Stream the ZIP to a file (File System Access) and write the PDF page
// by page if people need more.
export const MAX_ITEMS = 200;
export const MAX_OUTPUT_BYTES = 256 * 1024 ** 2;

/** The version a shot displays, or null when it displays its original. @param {{ versions?: any[], active: number }} shot */
export function displayedVersion(shot) {
  return shot.active >= 0 ? shot.versions?.[shot.active] ?? null : null;
}

/**
 * How many of these shots are edited yet display their original (the "Original" button of the editor was the last choice): a
 * grouped export takes each capture as it is displayed, so these go out without their changes, and the dialog says so.
 * @param {Array<{ versions?: any[], active: number }>} shots
 */
export const countShownAsOriginal = (shots) => shots.filter((s) => s.versions?.length && displayedVersion(s) === null).length;

/**
 * The shots of a grouped export, in the order of the captures (ids only grow), and the ids that no longer exist.
 * @template {{ id: number }} S
 * @param {number[]} ids
 * @param {S[]} rows
 * @returns {{ items: S[], missing: number[] }}
 */
export function planBatch(ids, rows) {
  const wanted = [...new Set(ids)].filter(Number.isInteger).toSorted((a, b) => a - b);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    items: wanted.flatMap((id) => byId.get(id) ?? []),
    missing: wanted.filter((id) => !byId.has(id)),
  };
}

/**
 * Name of the single file of a grouped export: `obturo_<date>_<time>.zip` (or `.pdf`).
 * @param {'zip' | 'pdf'} output
 * @param {number} [at]
 */
export const batchFilename = (output, at = Date.now()) => suggestedFilename({ url: 'https://obturo/', createdAt: at }, output); // the host of that address is the stem

/**
 * Name of a capture inside the archive, and for a single download: the template of the settings. The file of the group itself
 * keeps `obturo_<date>_<time>` (batchFilename), it holds many captures.
 * @param {Parameters<typeof suggestedFilename>[0]} shot
 * @param {string} format
 * @param {string} [template]
 */
export const imageFilename = (shot, format, template) => suggestedFilename(shot, extensionOf(format), template);

/**
 * What the dialog of a grouped export starts with, from the stored settings. The output is a PDF when the default format is
 * a PDF, a ZIP of images otherwise.
 * @param {{ downloadFormat: string, downloadQuality: number, pdfLayout: string, pdfEncoding: string }} s
 * @returns {{ output: 'zip' | 'pdf', format: 'png' | 'jpeg' | 'webp', quality: number, layout: string, encoding: string }}
 */
export function batchDefaults(s) {
  const pdf = s.downloadFormat === 'pdf';
  return {
    output: pdf ? 'pdf' : 'zip',
    format: /** @type {'png' | 'jpeg' | 'webp'} */ (pdf ? 'png' : s.downloadFormat),
    quality: s.downloadQuality, layout: s.pdfLayout, encoding: s.pdfEncoding,
  };
}
