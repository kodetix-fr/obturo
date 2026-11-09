// The downloads of the library: the format menu behind the Download button of the editor (format, quality with a live
// estimate of the size, PDF options), the single download itself, and the dialog of the grouped export.
//
// Loaded on first use (editor.js for the button, the library for the grouped export), never at startup. The encoders
// (encode.js, pdf.js, zip.js) and the grouped engine (export-batch.js) are imported when an export needs them, and the
// stylesheet of the menu and the dialog (export.css) when one of them opens: none of it is on the way to the first paint.
//
// A single export renders the VERSION DISPLAYED by the editor (the context the editor hands over), then encodes it. The
// original goes out untouched as a PNG. "Copy image" stays a PNG, it is not handled here.
import { DEFAULT_SETTINGS, DOWNLOAD_FORMATS, FORMAT_NAMES, PDF_ENCODINGS, PDF_LAYOUTS, getSettings } from './settings.js';
import { fmtBytes, pluralKey, t } from './i18n.js';
import { getShots } from './db.js';
import { applyDom, byId as $, h, icon, setAria, setI18n } from './dom-i18n.js';
import {
  ESTIMATE_DELAY_MS, IMAGE_FORMATS, MAX_ITEMS, batchDefaults, canEstimate, classifyExportError, countShownAsOriginal, createLatest,
  estimateBand, imageFilename, isLossy, usesQuality,
} from './export-pure.js';

// ponytail: the URL of a download is revoked after a fixed 10 s, long enough for the browser to start it (an anchor click reports nothing back); chrome.downloads would say when, at the cost of a permission.
const REVOKE_DELAY_MS = 10_000;

/**
 * What the editor hands over for a single export, built at the moment of the call (the displayed version, a crop in
 * progress abandoned).
 * @typedef {object} ExportContext
 * @property {import('./db.js').Shot} shot The capture (its address and date name the file).
 * @property {Blob} original Its original PNG.
 * @property {boolean} edited A version is displayed (otherwise the original is).
 * @property {{ w: number, h: number }} size Size in pixels of the displayed version once cropped and scaled.
 * @property {number} [scale] Its output scale (1 = 100 %); the editor gives it for the size of the format menu.
 * @property {number} [width] Its output width in pixels (the crop, scaled); same.
 * @property {() => HTMLCanvasElement | ImageBitmap} source The displayed version: a canvas that belongs to the caller, or for
 *   the original the bitmap of the editor, which the caller must use before the next await (it is closed with the capture).
 *
 * The editor builds it with `passive` set when the caller only looks (the size shown in the menu, the estimate): a crop in
 * progress or a text being typed are then left alone, whereas an export abandons the crop, as it always did.
 * @typedef {(passive?: boolean) => ExportContext | null} ContextFn
 */

const valueOf = (/** @type {Event} */ e) => /** @type {HTMLInputElement} */ (e.target).value;

let stylesheet = null;
/** export.css, loaded when a menu or a dialog opens. */
const loadStyles = () => stylesheet ??= new Promise((done) => {
  const link = h('link', { rel: 'stylesheet', href: new URL('export.css', import.meta.url).href });
  link.onload = link.onerror = () => done(undefined); // a missing stylesheet must not block the export
  document.head.append(link);
});

function saveBlob(blob, name) {
  const link = h('a', { href: URL.createObjectURL(blob), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), REVOKE_DELAY_MS);
}

const isBitmap = (x) => typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap;
/** Gives the pixels of a canvas back; a bitmap belongs to the editor, it is left alone. */
const release = (picture) => { if (picture && !isBitmap(picture)) picture.width = picture.height = 0; };
/**
 * What the estimate encodes, in a canvas that survives the editor moving on: the picture itself if it is a canvas small enough,
 * else a canvas of its own, the bitmap of an original copied or a band of a big picture cut (estimateBand). The pixels of a canvas
 * that is not kept are given back right away.
 * @param {HTMLCanvasElement | ImageBitmap} picture
 * @returns {{ canvas: HTMLCanvasElement, k: number }} `k`: the factor from the size of that canvas to the size of the picture
 */
function takeBand(picture) {
  const { width, height } = picture;
  const band = estimateBand(width, height);
  if (band.k === 1 && !isBitmap(picture)) return { canvas: /** @type {HTMLCanvasElement} */ (picture), k: 1 };
  const canvas = h('canvas', { width, height: band.h });
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(picture, 0, band.y, width, band.h, 0, 0, width, band.h); // the encoder reads it back once
  release(picture);
  return { canvas, k: band.k };
}

// ---------- texts ----------

// The keys are written out (and not built from the format) so that i18n.test.js can see them.
const HINTS = { png: 'dl.hint.png', jpeg: 'dl.hint.jpeg', webp: 'dl.hint.webp', pdf: 'dl.hint.pdf' };
const LAYOUT_KEYS = { fit: 'dl.layout.fit', a4: 'dl.layout.paper' };
const ENCODING_KEYS = { flate: 'dl.encoding.flate', jpeg: 'dl.encoding.jpeg' };
const ERROR_KEYS = { tooLarge: 'msg.exportFailed', encoder: 'export.err.encoder', unreadable: 'export.err.unreadable', other: 'export.err.generic' };
const CAUSE_KEYS = {
  gone: 'export.cause.gone', limit: 'export.cause.limit', tooLarge: 'export.cause.tooLarge', encoder: 'export.cause.encoder',
  unreadable: 'export.cause.unreadable', other: 'export.cause.other',
};

// ---------- shared controls ----------

/**
 * A group of radios drawn as a segmented control (library.css).
 * @param {string} name
 * @param {string} labelledBy id of the element that names the group
 * @param {Array<{ value: string, key?: string, text?: string }>} items `key`: a translated text, `text`: a proper name.
 */
function segment(name, labelledBy, items) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': labelledBy },
    ...items.map(({ value, key, text }) => h('label', {},
      h('input', { type: 'radio', name, value }),
      h('span', key ? { 'data-i18n': key } : { text }))));
}

/** Checks the radio of the group `root` that has this value. @param {Element} root @param {string} value */
function pick(root, value) {
  for (const input of root.querySelectorAll('input')) input.checked = input.value === value;
}

/** A quality slider with the value written beside it. @param {string} id */
function quality(id) {
  const input = h('input', { type: 'range', id, min: '0.1', max: '1', step: '0.05', 'aria-labelledby': `${id}Label` });
  const out = h('output', { class: 'dl-pct', for: id });
  /** @param {number} q */
  const show = (q) => {
    input.value = String(q);
    const text = t('dl.quality.value', { n: Math.round(q * 100) });
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
  };
  return { input, out, show };
}

// ---------- the single download ----------

let busy = false;
/** The editor shows that an export is running (the button, and a status for assistive technology). The page of actions after a capture exports too, without these elements. */
function setBusy(on) {
  busy = on;
  document.getElementById('split')?.toggleAttribute('data-busy', on);
  document.getElementById('download')?.setAttribute('aria-busy', String(on));
  const status = document.getElementById('dlStatus');
  if (status) setI18n(status, on ? 'dl.busy' : undefined);
}

/**
 * The file of a single export.
 * @param {ContextFn} context
 * @param {{ downloadFormat: string, downloadQuality: number, pdfLayout: string, pdfEncoding: string, filenameTemplate: string }} s
 * @returns {Promise<{ blob: Blob, name: string } | null>} null when the editor has nothing open any more
 */
async function produce(context, s) {
  const format = s.downloadFormat;
  // The engines first: from the moment the context is built, nothing may be awaited before the encoder has read the pixels
  // (the bitmap of an original is closed with its capture).
  const pdf = format === 'pdf' ? await import('./pdf.js') : null;
  const encode = pdf ? null : (await import('./encode.js')).encodeImage;
  const ctx = context();
  if (!ctx) return null;
  const name = imageFilename(ctx.shot, format, s.filenameTemplate);
  if (format === 'png' && !ctx.edited) return { blob: ctx.original, name }; // the original is exported as it is
  const picture = ctx.source();
  try {
    if (pdf) {
      const pages = [{ source: picture, width: ctx.size.w, height: ctx.size.h }];
      const options = /** @type {{ layout: 'fit' | 'a4', encoding: 'flate' | 'jpeg' }} */ ({ layout: s.pdfLayout, encoding: s.pdfEncoding });
      return { blob: await pdf.buildPdf(pages, { ...options, quality: s.downloadQuality }), name };
    }
    return { blob: await encode(picture, { format: /** @type {'png' | 'jpeg' | 'webp'} */ (format), quality: s.downloadQuality }), name };
  } finally {
    release(picture);
  }
}

/**
 * Downloads the displayed version in the stored format (or in `settings`). One export at a time; a failure is explained
 * through `warn` and leaves the interface as it was.
 * @param {object} options
 * @param {ContextFn} options.context
 * @param {(key: string) => void} options.warn Shows a message (a key of the dictionaries).
 * @param {Partial<{ downloadFormat: string, downloadQuality: number, pdfLayout: string, pdfEncoding: string }>} [options.settings] The choices of the menu, over the stored settings (the name template is always the stored one).
 * @returns {Promise<{ blob: Blob, name: string } | null>} the file that was handed to the browser, null when nothing was (nothing open, a failure, an export already running)
 */
export async function download({ context, warn, settings }) {
  if (busy) return null;
  closeMenu();
  setBusy(true);
  try {
    const out = await produce(context, { ...await getSettings().catch(() => DEFAULT_SETTINGS), ...settings });
    if (out) saveBlob(out.blob, out.name);
    return out;
  } catch (e) {
    console.error('Obturo: export failed', e);
    warn(ERROR_KEYS[classifyExportError(e)]);
    return null;
  } finally {
    setBusy(false);
  }
}

// ---------- the format menu ----------

/** @type {Record<string, any> | null} */
let menu = null; // the elements of the menu, built on first opening
let menuOpen = false;
let menuOpening = false;
let menuDefaults = '';
const choice = { format: 'png', quality: 0.9, layout: 'fit', encoding: 'flate' };
// ponytail: the live estimate covers JPEG and WebP only (a light PDF shows no size, its pages are encoded one by one); the PDF would need a run of buildPdf per move of the slider.
/**
 * The live estimate. Nothing is computed when the menu opens: `asked` turns true at the first move of the quality slider (and
 * the estimate then follows the format too), `bytes` is null until one arrives, `pending` while one is due or running, `approx`
 * when it is extrapolated from a band of the image (estimateBand), `band` is that band, kept until the menu closes.
 */
const estimate = { asked: false, bytes: null, approx: false, pending: false, failed: false, band: null, latest: null, size: { w: 0, h: 0 } };
let menuOptions = null; // { context, warn, setScale, setOutputWidth } of the opening
let stopListening = null;

// A language change (dom-i18n.js sets <html lang>) redraws what holds a formatted number: sizes and percentages.
let watchingLanguage = false;
function watchLanguage() {
  if (watchingLanguage) return;
  watchingLanguage = true;
  new MutationObserver(() => {
    if (menuOpen) renderEstimate();
    if (box?.dialog.open) box.pct.show(Number(box.pct.input.value));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

function buildMenu() {
  watchLanguage();
  const pct = quality('dlQuality');
  const refs = {
    formats: h('div', { class: 'dl-formats', role: 'radiogroup', 'aria-labelledby': 'dlFormatLabel' },
      ...DOWNLOAD_FORMATS.map((f) => h('label', { class: 'dl-opt' },
        h('input', { type: 'radio', name: 'dlFormat', value: f }),
        h('span', { class: 'dl-name', text: FORMAT_NAMES[f] }),
        h('span', { class: 'dl-hint', 'data-i18n': HINTS[f] }),
        icon('check')))),
    qualityRow: h('div', { class: 'dl-sec' },
      h('div', { class: 'dl-line' }, h('span', { id: 'dlQualityLabel', class: 'dl-h', 'data-i18n': 'dl.quality' }), pct.out),
      pct.input,
      h('p', { class: 'dl-est', hidden: true, 'aria-live': 'polite' }, h('span', { 'data-i18n': 'dl.estimate' }), ' ', h('strong', { id: 'dlEstimate' }))),
    pdfRow: h('div', { class: 'dl-sec', hidden: true },
      h('div', { class: 'dl-line' }, h('span', { id: 'dlLayoutLabel', class: 'dl-h', 'data-i18n': 'dl.layout' }),
        segment('dlLayout', 'dlLayoutLabel', PDF_LAYOUTS.map((value) => ({ value, key: LAYOUT_KEYS[value] })))),
      h('div', { class: 'dl-line' }, h('span', { id: 'dlEncodingLabel', class: 'dl-h', 'data-i18n': 'dl.encoding' }),
        segment('dlEncoding', 'dlEncodingLabel', PDF_ENCODINGS.map((value) => ({ value, key: ENCODING_KEYS[value] }))))),
    scale: h('input', { type: 'number', id: 'scalePct', min: '1', max: '1000', step: '1', value: '100' }),
    width: h('input', { type: 'number', id: 'scaleW', min: '1', max: '20000', step: '1', value: '0' }),
    go: h('button', { type: 'button', class: 'btn primary', onclick: () => go() }, icon('download'), h('span', { id: 'dlGoLabel' })),
    pct,
  };
  refs.sizeRow = h('div', { class: 'dl-sec' },
    h('p', { id: 'dlSizeLabel', class: 'dl-h', 'data-i18n': 'dl.size' }),
    h('div', { class: 'dl-fields', role: 'group', 'aria-labelledby': 'dlSizeLabel' },
      h('label', { class: 'field' }, h('span', { class: 'fl', 'data-i18n': 'out.scale' }), refs.scale, h('span', { class: 'unit', text: '%' })),
      h('label', { class: 'field' }, h('span', { class: 'fl', 'data-i18n': 'out.width' }), refs.width, h('span', { class: 'unit', text: 'px' }))));
  refs.estimateLine = refs.qualityRow.querySelector('.dl-est');
  refs.estimateValue = refs.qualityRow.querySelector('#dlEstimate');
  refs.layout = refs.pdfRow.querySelector('[role="radiogroup"]');
  refs.encoding = refs.pdfRow.querySelectorAll('[role="radiogroup"]')[1];
  refs.root = h('div', { id: 'dlPop', class: 'dl-pop', role: 'dialog', tabindex: '-1', hidden: true },
    h('div', { class: 'dl-sec' }, h('p', { id: 'dlFormatLabel', class: 'dl-h', 'data-i18n': 'dl.format' }), refs.formats),
    refs.sizeRow, refs.pdfRow, refs.qualityRow,
    h('div', { class: 'dl-foot' }, refs.go));

  refs.formats.addEventListener('change', (e) => {
    choice.format = valueOf(e);
    syncMenu();
    requestEstimate(); // only if the slider has already asked for an estimate
  });
  pct.input.addEventListener('input', () => {
    choice.quality = Number(pct.input.value);
    pct.show(choice.quality);
    estimate.asked = true; // the first move of the slider starts the estimate
    requestEstimate();
  });
  refs.scale.addEventListener('change', () => { menuOptions.setScale(Number(refs.scale.value) / 100); resized(); });
  refs.width.addEventListener('change', () => { menuOptions.setOutputWidth(Number(refs.width.value)); resized(); });
  refs.layout.addEventListener('change', (e) => { choice.layout = valueOf(e); });
  refs.encoding.addEventListener('change', (e) => { choice.encoding = valueOf(e); syncMenu(); });
  $('split').append(refs.root);
  applyDom(refs.root);
  setAria(refs.root, 'dl.options'); // applyDom only translates what is inside
  return refs;
}

/** The menu hangs from the right edge of the button, which can sit anywhere in a narrow window: it is moved back inside, and scrolls if it is taller than the room below. @param {HTMLElement} root */
function keepInside(root) {
  const margin = 8;
  root.style.right = '0px';
  root.style.maxHeight = '';
  const box = root.getBoundingClientRect();
  const shift = box.left < margin ? margin - box.left : Math.min(0, innerWidth - margin - box.right);
  if (shift) root.style.right = `${-shift}px`;
  root.style.maxHeight = `${Math.max(160, innerHeight - box.top - margin)}px`;
}

/** The scale and the width of the menu show those of the displayed version. @param {ExportContext} ctx */
function showSize(ctx) {
  menu.scale.value = String(Math.round((ctx.scale ?? 1) * 100));
  menu.width.value = String(ctx.width ?? ctx.size.w);
}

/** The scale or the width changed: the size, and the estimate that depends on it, are worked out again. */
function resized() {
  const ctx = menuOptions.context(true);
  if (!ctx) return;
  estimate.size = ctx.size;
  release(estimate.band?.canvas);
  estimate.band = null;
  estimate.bytes = null;
  showSize(ctx);
  requestEstimate();
}

/** The elements of the menu follow `choice`. */
function syncMenu() {
  const m = menu;
  pick(m.formats, choice.format);
  pick(m.layout, choice.layout);
  pick(m.encoding, choice.encoding);
  m.pct.show(choice.quality);
  m.qualityRow.hidden = !usesQuality(choice.format, choice.encoding);
  m.estimateLine.hidden = !isLossy(choice.format);
  m.pdfRow.hidden = choice.format !== 'pdf';
  setI18n(m.root.querySelector('#dlGoLabel'), 'dl.go', { format: FORMAT_NAMES[choice.format] });
  renderEstimate();
}

function renderEstimate() {
  if (!menu) return;
  const el = menu.estimateValue;
  el.dataset.stale = estimate.pending && estimate.bytes !== null ? '1' : '';
  el.dataset.idle = canEstimate(estimate.size.w, estimate.size.h) && !estimate.asked ? '1' : '';
  if (!canEstimate(estimate.size.w, estimate.size.h)) el.textContent = t('dl.estimate.none');
  else if (estimate.failed) el.textContent = '-';
  else if (!estimate.asked) el.textContent = t('dl.estimate.idle');
  else if (estimate.bytes === null) el.textContent = t('dl.estimate.busy');
  else el.textContent = t(estimate.approx ? 'dl.estimate.approx' : 'dl.estimate.value', { size: fmtBytes(estimate.bytes) });
  menu.pct.show(choice.quality);
}

/**
 * Asks for a new estimate (after the pause that follows the last move of the slider): the real image, really encoded, or a band of
 * it for a big one. Does nothing until the slider has moved once: opening the menu to download costs no estimate.
 */
function requestEstimate() {
  if (!menuOpen || !estimate.asked || !isLossy(choice.format) || !canEstimate(estimate.size.w, estimate.size.h)) { renderEstimate(); return; }
  estimate.pending = true;
  estimate.failed = false;
  renderEstimate();
  estimate.latest.request({ format: choice.format, quality: choice.quality });
}

function startEstimator() {
  estimate.asked = false;
  estimate.bytes = null;
  estimate.approx = false;
  estimate.failed = false;
  estimate.pending = false;
  estimate.latest = createLatest({
    delay: ESTIMATE_DELAY_MS,
    run: async ({ format, quality }, stale) => {
      const { encodeImage } = await import('./encode.js');
      if (stale()) return null;
      if (!estimate.band) { // rendered once per opening of the menu, whatever the quality: only what is encoded is kept until it closes
        const ctx = menuOptions.context(true);
        if (!ctx) return null;
        estimate.band = takeBand(ctx.source());
      }
      const { canvas, k } = estimate.band;
      return { bytes: (await encodeImage(canvas, { format, quality })).size * k, approx: k > 1 };
    },
    onResult: (result) => {
      if (result) { estimate.bytes = result.bytes; estimate.approx = result.approx; }
      estimate.pending = false;
      renderEstimate();
    },
    onError: (e) => { console.error('Obturo: size estimate failed', e); estimate.failed = true; estimate.pending = false; renderEstimate(); },
  });
}

function stopEstimator() {
  estimate.latest?.cancel();
  estimate.latest = null;
  release(estimate.band?.canvas); // an encoding in flight has already read the pixels
  estimate.band = null;
}

/** The "Download" button of the menu: the choices are already stored, the export takes them as they are. */
function go() {
  const options = menuOptions;
  closeMenu(true);
  download({ ...options, settings: { downloadFormat: choice.format, downloadQuality: choice.quality, pdfLayout: choice.layout, pdfEncoding: choice.encoding } });
}

function closeMenu(restoreFocus = false) {
  if (!menuOpen) return;
  menuOpen = false;
  menu.root.hidden = true;
  $('downloadMenu').setAttribute('aria-expanded', 'false');
  stopEstimator();
  stopListening?.();
  stopListening = null;
  if (restoreFocus) $('downloadMenu').focus();
}

async function openMenu(options) {
  if (menuOpen || menuOpening) return;
  menuOpening = true;
  try {
    await loadStyles();
    const ctx = options.context(true);
    if (!ctx) return;
    const s = await getSettings().catch(() => DEFAULT_SETTINGS);
    menuOptions = options;
    const defaults = JSON.stringify([s.downloadFormat, s.downloadQuality, s.pdfLayout, s.pdfEncoding]);
    if (defaults !== menuDefaults) { // the choices of the menu stay as they were until the Settings say something else; they never write there
      menuDefaults = defaults;
      Object.assign(choice, { format: s.downloadFormat, quality: s.downloadQuality, layout: s.pdfLayout, encoding: s.pdfEncoding });
    }
    estimate.size = ctx.size;
    menu ??= buildMenu();
    showSize(ctx);
    startEstimator();
    syncMenu();
    menu.root.hidden = false;
    keepInside(menu.root);
    menuOpen = true;
    $('downloadMenu').setAttribute('aria-expanded', 'true');
    (menu.root.querySelector('input[name="dlFormat"]:checked') ?? menu.root).focus();

    // Closing: Escape, a click or a focus anywhere else.
    const split = $('split');
    const outside = (e) => { if (!split.contains(e.target)) closeMenu(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('keydown', key, true);
    stopListening = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  } finally {
    menuOpening = false;
  }
}

/**
 * Opens the format menu of the Download button, or closes it.
 * @param {object} options
 * @param {ContextFn} options.context
 * @param {(key: string) => void} options.warn
 * @param {(scale: number) => void} options.setScale
 * @param {(px: number) => void} options.setOutputWidth
 */
export function toggleMenu(options) {
  if (menuOpen) closeMenu(true);
  else openMenu(options);
}

/** The menu is open (the editor leaves the keyboard to it). */
export const isMenuOpen = () => menuOpen;

// ---------- the grouped export ----------

// ponytail: the grouped export always takes the version each capture displays; "the originals" as a second choice, and a
// choice of the version by name, are one radio away in buildDialog and one `displayedVersion` in export-batch.js if people ask.
/** @type {Record<string, any> | null} */
let box = null; // the dialog and its elements, built on first opening
let batchDefaultsSeen = '';
const run = { ids: [], controller: null, state: 'setup', template: undefined }; // template: the name template of the settings, read when the dialog opens

function buildDialog() {
  watchLanguage();
  const pct = quality('exQuality');
  const refs = {
    dialog: null,
    count: h('p', { class: 'ex-count' }),
    countRunning: h('p', { class: 'ex-count' }),
    output: segment('exOutput', 'exOutputLabel', [{ value: 'zip', key: 'export.output.zip' }, { value: 'pdf', key: 'export.output.pdf' }]),
    format: segment('exFormat', 'exFormatLabel', IMAGE_FORMATS.map((value) => ({ value, text: FORMAT_NAMES[value] }))),
    layout: segment('exLayout', 'exLayoutLabel', PDF_LAYOUTS.map((value) => ({ value, key: LAYOUT_KEYS[value] }))),
    encoding: segment('exEncoding', 'exEncodingLabel', PDF_ENCODINGS.map((value) => ({ value, key: ENCODING_KEYS[value] }))),
    pct,
    warning: h('p', { class: 'ex-warn', role: 'alert', hidden: true }),
    shownAsOriginal: h('p', { class: 'ex-asis', hidden: true }), // edited captures that display their original: exported without their changes
    progress: h('progress', { max: '1', value: '0', 'aria-labelledby': 'exProgressText' }),
    progressText: h('p', { id: 'exProgressText', class: 'ex-progress-text', role: 'status' }),
    summary: h('p', { id: 'exSummary', class: 'ex-summary', role: 'status' }),
    cause: h('p', { class: 'ex-cause', hidden: true }),
    failures: h('ul', { id: 'exFailures', class: 'ex-fails', hidden: true }),
    cancel: h('button', { type: 'button', id: 'exCancel', class: 'btn' }, h('span', { 'data-i18n': 'export.cancel' })),
    start: h('button', { type: 'button', id: 'exStart', class: 'btn primary' }, icon('download'), h('span', { 'data-i18n': 'export.start' })),
    close: h('button', { type: 'button', id: 'exClose', class: 'btn primary' }, h('span', { 'data-i18n': 'common.close' })),
  };
  const row = (labelId, key, ...controls) => h('div', { class: 'row' }, h('span', { id: labelId, 'data-i18n': key }), ...controls);
  refs.rows = {
    format: row('exFormatLabel', 'export.format', refs.format),
    quality: h('div', { class: 'row' }, h('span', { id: 'exQualityLabel', 'data-i18n': 'dl.quality' }), h('span', { class: 'dl-slider' }, pct.input, pct.out)),
    layout: row('exLayoutLabel', 'dl.layout', refs.layout),
    encoding: row('exEncodingLabel', 'dl.encoding', refs.encoding),
  };
  refs.setup = h('div', { class: 'ex-part' },
    refs.count,
    row('exOutputLabel', 'export.output', refs.output),
    refs.rows.format, refs.rows.layout, refs.rows.encoding, refs.rows.quality,
    h('p', { class: 'ex-note', 'data-i18n': 'export.version' }),
    refs.shownAsOriginal,
    refs.warning);
  refs.running = h('div', { class: 'ex-part', hidden: true }, refs.countRunning, refs.progress, refs.progressText);
  refs.done = h('div', { class: 'ex-part', hidden: true }, refs.summary, refs.cause, refs.failures);
  refs.dialog = h('dialog', { id: 'exportDialog', class: 'ex-dlg', 'aria-labelledby': 'exTitle' },
    h('header', { class: 'dlg-head' },
      h('h2', { id: 'exTitle', 'data-i18n': 'export.title' }),
      h('button', { type: 'button', class: 'btn icon ghost', 'data-i18n-label': 'common.close', onclick: () => requestClose() }, icon('x'))),
    h('div', { class: 'dlg-body' }, refs.setup, refs.running, refs.done),
    h('footer', { class: 'dlg-foot' }, refs.cancel, refs.start, refs.close));

  refs.output.addEventListener('change', (e) => { syncDialog(); e.stopPropagation(); });
  refs.format.addEventListener('change', () => syncDialog());
  pct.input.addEventListener('input', () => pct.show(Number(pct.input.value)));
  refs.encoding.addEventListener('change', () => syncDialog());
  refs.cancel.addEventListener('click', () => requestClose());
  refs.close.addEventListener('click', () => refs.dialog.close());
  refs.start.addEventListener('click', () => start());
  refs.dialog.addEventListener('cancel', (e) => { // Escape
    if (run.state === 'running') { e.preventDefault(); run.controller?.abort(); }
  });
  refs.dialog.addEventListener('close', () => {
    run.controller?.abort();
    run.state = 'setup';
  });
  document.body.append(refs.dialog);
  applyDom(refs.dialog);
  return refs;
}

/** Cancel: stops a running export, closes otherwise. */
function requestClose() {
  if (run.state === 'running') run.controller?.abort();
  else box.dialog.close();
}

const chosen = (root) => /** @type {HTMLInputElement | null} */ (root.querySelector('input:checked'))?.value ?? '';

/** The dialog shows the rows that belong to the output and the format chosen. */
function syncDialog() {
  const b = box;
  const pdf = chosen(b.output) === 'pdf';
  const encoding = chosen(b.encoding);
  b.rows.format.hidden = pdf;
  b.rows.layout.hidden = b.rows.encoding.hidden = !pdf;
  b.rows.quality.hidden = !usesQuality(pdf ? 'pdf' : chosen(b.format), encoding);
}

/** Shows one of the three parts of the dialog and the buttons that go with it. @param {'setup' | 'running' | 'done'} state */
function showState(state) {
  const b = box;
  run.state = state;
  b.setup.hidden = state !== 'setup';
  b.running.hidden = state !== 'running';
  b.done.hidden = state !== 'done';
  b.start.hidden = state !== 'setup';
  b.cancel.hidden = state === 'done';
  b.close.hidden = state !== 'done';
  b.dialog.dataset.state = state;
}

const countKey = (n) => pluralKey(n, 'export.count.one', 'export.count.other');

async function start() {
  const b = box;
  const pdf = chosen(b.output) === 'pdf';
  const options = /** @type {import('./export-batch.js').BatchOptions} */ ({
    ids: run.ids, output: pdf ? 'pdf' : 'zip', format: chosen(b.format) || 'png', quality: Number(b.pct.input.value),
    layout: chosen(b.layout) || 'fit', encoding: chosen(b.encoding) || 'flate', template: run.template,
  });
  run.controller = new AbortController();
  showState('running');
  setI18n(b.progressText, 'export.progress', { done: 1, total: run.ids.length });
  b.progress.value = 0;
  b.cancel.focus();
  let result = null;
  let failure = null;
  try {
    const { runBatch } = await import('./export-batch.js');
    result = await runBatch({
      ...options, signal: run.controller.signal,
      onProgress: ({ done, total }) => {
        b.progress.value = total ? done / total : 0;
        setI18n(b.progressText, 'export.progress', { done: Math.min(done + 1, total), total });
      },
    });
  } catch (e) {
    console.error('Obturo: grouped export failed', e);
    failure = classifyExportError(e);
  }
  showState('done');
  b.failures.replaceChildren();
  b.failures.hidden = b.cause.hidden = true;
  b.dialog.dataset.outcome = 'error';
  if (failure) {
    setI18n(b.summary, 'export.failed');
    setI18n(b.cause, CAUSE_KEYS[failure]);
    b.cause.hidden = false;
  } else if (result.canceled) {
    b.dialog.dataset.outcome = 'canceled';
    setI18n(b.summary, 'export.canceled');
  } else {
    b.dialog.dataset.outcome = result.failed.length ? 'partial' : 'ok';
    if (result.blob) saveBlob(result.blob, result.name);
    setI18n(b.summary, result.exported ? 'export.done' : 'export.none', { done: result.exported, total: result.total });
    if (result.failed.length) {
      b.failures.replaceChildren(...result.failed.map(({ name, cause }) =>
        h('li', {}, h('span', { class: 'ex-name', text: name }), ' - ', h('span', { 'data-i18n': CAUSE_KEYS[cause] }))));
      applyDom(b.failures);
      b.failures.hidden = false;
    }
  }
  b.close.focus();
}

/**
 * Opens the dialog of the grouped export for these shots: ZIP of images or multipage PDF, each capture as it is displayed.
 * Nothing is written to the history. The single file is downloaded when the export ends.
 * @param {number[]} ids
 */
export async function openBatchExport(ids) {
  const list = [...new Set(ids)].filter(Number.isInteger);
  if (!list.length || box?.dialog.open) return;
  await loadStyles();
  const tooMany = list.length > MAX_ITEMS;
  const [s, rows] = await Promise.all([
    getSettings().catch(() => DEFAULT_SETTINGS),
    tooMany ? [] : getShots(list).catch(() => []), // an unreadable database is reported by the export itself
  ]);
  box ??= buildDialog();
  const d = batchDefaults(s);
  run.ids = list;
  run.template = s.filenameTemplate;
  if (JSON.stringify(d) !== batchDefaultsSeen) { // the choices of the dialog stay as they were until the Settings say something else
    batchDefaultsSeen = JSON.stringify(d);
    pick(box.output, d.output);
    pick(box.format, d.format);
    pick(box.layout, d.layout);
    pick(box.encoding, d.encoding);
    box.pct.show(d.quality);
  }
  setI18n(box.count, countKey(list.length), { n: list.length });
  setI18n(box.countRunning, countKey(list.length), { n: list.length });
  const asIs = countShownAsOriginal(rows);
  setI18n(box.shownAsOriginal, asIs ? pluralKey(asIs, 'export.asShown.one', 'export.asShown.other') : undefined, { n: asIs });
  box.shownAsOriginal.hidden = !asIs;
  setI18n(box.warning, tooMany ? 'export.limit' : undefined, { max: MAX_ITEMS });
  box.warning.hidden = !tooMany;
  box.start.disabled = tooMany;
  showState('setup');
  syncDialog();
  box.dialog.showModal();
  (tooMany ? box.cancel : box.start).focus();
}
