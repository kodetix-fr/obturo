// The beautify panel of the editor: a preview of the result and the controls of the look (background, padding, corners, shadow,
// frame). Imported on first use (editor.js), never at startup. It reads and changes the look of the displayed version through the
// context that the editor gives (`context()`: { style, apply, preview }), and keeps nothing of it once closed.
import { applyDom, h, setAria } from './dom-i18n.js';
import { DEFAULT_BEAUTIFY, GRADIENTS, PADDING, RADIUS, normalizeBeautify } from './beautify-pure.js';
import { PALETTE } from './mask-pure.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const PREVIEW = { width: 288, height: 168 };
const SHADOW_KEYS = { none: 'prop.none', soft: 'be.shadow.soft', strong: 'be.shadow.strong' };
const FRAME_KEYS = { none: 'prop.none', window: 'be.frame.window' };

let stylesheet = null;
/** beautify.css, loaded when the panel first opens. */
const loadStyles = () => stylesheet ??= new Promise((done) => {
  const link = h('link', { rel: 'stylesheet', href: new URL('beautify.css', import.meta.url).href });
  link.onload = link.onerror = () => done(undefined); // a missing stylesheet must not block the panel
  document.head.append(link);
});

let panel = null; // the root element, built on first use
let context = null; // what the editor gave for this opening
let working = DEFAULT_BEAUTIFY; // the look being edited
let on = false; // the displayed version has a look
let lastStyle = null; // the look applied last: offered when it is turned on for another version (this page only)
let opened = false;
let opening = false;
let stopListening = null;
let frame = 0;

/** The panel is open (the editor leaves the keyboard to it). */
export const isOpen = () => opened;

const segment = (name, labelledBy, items) => h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': labelledBy },
  ...Object.entries(items).map(([value, key]) => h('label', {}, h('input', { type: 'radio', name, value }), h('span', { 'data-i18n': key }))));

function slider(id, key, { min, max, step }) {
  return [
    h('div', { class: 'be-line' }, h('span', { id: `${id}Label`, class: 'be-h', 'data-i18n': key }), h('output', { id: `${id}Out`, class: 'be-out', for: id })),
    h('input', { type: 'range', id, min, max, step, 'aria-labelledby': `${id}Label` }),
  ];
}

/**
 * One chip of the background control. `background`: its color; `names`: its translated name (`key`, or `n` for the gradient of that number).
 * @param {string} value
 * @param {string} background
 * @param {{ key?: string, n?: number }} names
 */
function swatch(value, background, { key, n }) {
  const input = h('input', { type: 'radio', name: 'beBg', value, 'data-i18n-label': key });
  if (n) setAria(input, 'be.gradient', { n });
  return h('label', { class: value === 'none' ? 'sw none' : 'sw' }, input, h('span', background ? { style: `background:${background}` } : {}));
}

function build() {
  const bg = h('div', { class: 'be-bg' },
    h('input', { type: 'color', id: 'beColor', 'data-i18n-label': 'prop.color.custom' }),
    h('div', { class: 'swatches', role: 'radiogroup', 'aria-labelledby': 'beBgLabel' },
      swatch('none', '', { key: 'prop.none' }),
      ...PALETTE.map(({ key, hex }) => swatch(hex, hex, { key })),
      ...GRADIENTS.map(([a, b], i) => swatch(`g${i}`, `linear-gradient(135deg, ${a}, ${b})`, { n: i + 1 }))));
  const root = h('div', { id: 'bePop', class: 'be-pop', role: 'dialog', tabindex: '-1', 'data-i18n-aria': 'be.title', hidden: true },
    h('div', { class: 'be-preview' }, h('canvas', { id: 'bePreview', role: 'img', 'data-i18n-aria': 'be.preview' })),
    h('label', { class: 'be-on' }, h('input', { type: 'checkbox', id: 'beOn', role: 'switch' }), h('span', { 'data-i18n': 'be.on' })),
    h('fieldset', { id: 'beControls', class: 'be-controls' },
      h('div', { class: 'be-line' }, h('span', { id: 'beBgLabel', class: 'be-h', 'data-i18n': 'be.bg' })),
      bg,
      ...slider('bePadding', 'be.padding', PADDING),
      ...slider('beRadius', 'be.radius', RADIUS),
      h('div', { class: 'be-line' }, h('span', { id: 'beShadowLabel', class: 'be-h', 'data-i18n': 'be.shadow' }), segment('beShadow', 'beShadowLabel', SHADOW_KEYS)),
      h('div', { class: 'be-line' }, h('span', { id: 'beFrameLabel', class: 'be-h', 'data-i18n': 'be.frame' }), segment('beFrame', 'beFrameLabel', FRAME_KEYS))));

  root.querySelector('#beOn').addEventListener('change', (e) => {
    on = e.target.checked;
    $('beControls').classList.toggle('be-off', !on);
    commit();
  });
  bg.addEventListener('change', (e) => {
    const { id, name, value } = e.target;
    if (id === 'beColor') working.bg = { type: 'color', color: value };
    else if (name === 'beBg') working.bg = value === 'none' ? { type: 'none' } : value.startsWith('g') ? { type: 'gradient', index: Number(value.slice(1)) } : { type: 'color', color: value };
    else return;
    turnOn();
    pickBackground();
    commit();
  });
  bg.addEventListener('input', (e) => { // the free color follows the pointer in the preview and is applied when it is let go
    if (e.target.id !== 'beColor') return;
    working.bg = { type: 'color', color: e.target.value };
    turnOn();
    pickBackground();
    drawPreview();
  });
  for (const [id, field] of [['bePadding', 'padding'], ['beRadius', 'radius']]) {
    const input = root.querySelector(`#${id}`);
    input.addEventListener('input', () => { working[field] = Number(input.value); turnOn(); showValues(); drawPreview(); }); // the preview follows the slider
    input.addEventListener('change', commit); // the version changes when it is let go
  }
  for (const [name, field] of [['beShadow', 'shadow'], ['beFrame', 'frame']]) {
    root.querySelector(`[name="${name}"]`).closest('.seg').addEventListener('change', (e) => { working[field] = e.target.value; turnOn(); commit(); });
  }
  $('beWrap').append(root);
  applyDom(root);
  setAria(root, 'be.title'); // applyDom only translates what is inside
  return root;
}

/** A control used while the look is off turns it on: the controls are never dead. */
function turnOn() {
  if (on) return;
  on = true;
  $('beOn').checked = true;
  $('beControls').classList.remove('be-off');
}

function pickBackground() {
  const { bg } = working;
  const value = bg.type === 'none' ? 'none' : bg.type === 'gradient' ? `g${bg.index}` : bg.color;
  for (const input of panel.querySelectorAll('input[name="beBg"]')) input.checked = input.value === value;
  if (bg.type === 'color') $('beColor').value = bg.color;
}

function showValues() {
  $('bePaddingOut').textContent = `${working.padding} px`;
  $('beRadiusOut').textContent = `${working.radius} px`;
}

/** The controls follow `working` and `on`. */
function reflect() {
  $('beOn').checked = on;
  $('beControls').classList.toggle('be-off', !on);
  pickBackground();
  $('bePadding').value = String(working.padding);
  $('beRadius').value = String(working.radius);
  for (const input of panel.querySelectorAll('input[name="beShadow"]')) input.checked = input.value === working.shadow;
  for (const input of panel.querySelectorAll('input[name="beFrame"]')) input.checked = input.value === working.frame;
  showValues();
}

// The preview shows what the editor would export: the look when it is on, the capture as it is when it is off.
function drawPreview() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (!opened || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const picture = context.preview(on ? normalizeBeautify(working) : null, PREVIEW.width * ratio, PREVIEW.height * ratio);
    const view = $('bePreview');
    view.width = picture.width;
    view.height = picture.height;
    view.style.width = `${picture.width / ratio}px`;
    view.getContext('2d').drawImage(picture, 0, 0);
    picture.width = picture.height = 0;
  });
}

// Applies the look to the displayed version (or removes it), and remembers it as the one to offer next.
function commit() {
  if (!context) return;
  working = normalizeBeautify(working);
  if (on) lastStyle = structuredClone(working);
  context.apply(on ? working : null);
  drawPreview();
}

function close(restoreFocus = false) {
  if (!opened) return;
  opened = false;
  cancelAnimationFrame(frame);
  panel.hidden = true;
  $('beautify').setAttribute('aria-expanded', 'false');
  stopListening?.();
  stopListening = null;
  context = null;
  if (restoreFocus) $('beautify').focus();
}

async function openPanel(options) {
  if (opened || opening) return;
  opening = true;
  try {
    await loadStyles();
    context = options.context();
    if (!context) return;
    panel ??= build();
    const current = context.style();
    on = !!current;
    working = structuredClone(current ?? lastStyle ?? DEFAULT_BEAUTIFY);
    reflect();
    panel.hidden = false;
    panel.style.left = '0';
    const over = panel.getBoundingClientRect().right - (window.innerWidth - 8); // the button of a narrow window may be near the right edge
    if (over > 0) panel.style.left = `${-over}px`;
    opened = true;
    $('beautify').setAttribute('aria-expanded', 'true');
    drawPreview();
    $('beOn').focus();

    // Closing: Escape, a click or a focus anywhere else.
    const wrap = $('beWrap');
    const outside = (e) => { if (!wrap.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('keydown', key, true);
    stopListening = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  } finally {
    opening = false;
  }
}

/**
 * Opens the panel of the Beautify button, or closes it.
 * @param {object} options
 * @param {() => { style: () => any, apply: (style: any) => void, preview: (style: any, width: number, height: number) => HTMLCanvasElement } | null} options.context
 */
export function toggle(options) {
  if (opened) close(true);
  else openPanel(options);
}
