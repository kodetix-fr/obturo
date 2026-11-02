// The beautify panel of the editor: the controls of the look (background, padding, corners, shadow, frame), in a column next to the
// stage, which shows the result as they move. Imported on first use (editor.js), never at startup. It reads and changes the look of
// the displayed version through the context that the editor gives (`context()`: { style, apply }), and keeps nothing of it once closed.
import { applyDom, h, setAria } from './dom-i18n.js';
import { DEFAULT_BEAUTIFY, GRADIENTS, PADDING, RADIUS, normalizeBeautify } from './beautify-pure.js';
import { PALETTE } from './mask-pure.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
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

/** The panel is open (the editor leaves the keyboard to it). */
export const isOpen = () => opened;

const segment = (name, labelledBy, items) => h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': labelledBy },
  ...Object.entries(items).map(([value, key]) => h('label', {}, h('input', { type: 'radio', name, value }), h('span', { 'data-i18n': key }))));

const segmentField = (name, key, items) => h('div', { class: 'be-field' }, h('span', { id: `${name}Label`, class: 'be-h', 'data-i18n': key }), segment(name, `${name}Label`, items));

const sliderField = (id, key, { min, max, step }) => h('div', { class: 'be-field' },
  h('div', { class: 'be-line' }, h('span', { id: `${id}Label`, class: 'be-h', 'data-i18n': key }), h('output', { id: `${id}Out`, class: 'be-out', for: id })),
  h('input', { type: 'range', id, min, max, step, 'aria-labelledby': `${id}Label` }));

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
    h('div', { class: 'be-field' },
      h('span', { id: 'beBgLabel', class: 'be-h', 'data-i18n': 'be.bg' }),
      h('div', { class: 'swatches', role: 'radiogroup', 'aria-labelledby': 'beBgLabel' },
        swatch('none', '', { key: 'prop.none' }),
        ...PALETTE.map(({ key, hex }) => swatch(hex, hex, { key })),
        ...GRADIENTS.map(([a, b], i) => swatch(`g${i}`, `linear-gradient(135deg, ${a}, ${b})`, { n: i + 1 })))),
    h('label', { class: 'be-custom' }, h('input', { type: 'color', id: 'beColor' }), h('span', { 'data-i18n': 'prop.color.custom' })));
  const root = h('div', { id: 'bePop', class: 'be-pop', role: 'dialog', tabindex: '-1', 'data-i18n-aria': 'be.title', hidden: true },
    h('h2', { class: 'be-title', 'data-i18n': 'be.title' }),
    h('label', { class: 'be-on' }, h('input', { type: 'checkbox', id: 'beOn', role: 'switch' }), h('span', { 'data-i18n': 'be.on' })),
    h('fieldset', { id: 'beControls', class: 'be-controls' },
      bg,
      sliderField('bePadding', 'be.padding', PADDING),
      sliderField('beRadius', 'be.radius', RADIUS),
      segmentField('beShadow', 'be.shadow', SHADOW_KEYS),
      segmentField('beFrame', 'be.frame', FRAME_KEYS)));

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
  bg.addEventListener('input', (e) => { // the free color shows on the stage as it is dragged, and is kept when it is let go
    if (e.target.id !== 'beColor') return;
    working.bg = { type: 'color', color: e.target.value };
    turnOn();
    pickBackground();
    commit(false);
  });
  for (const [id, field] of [['bePadding', 'padding'], ['beRadius', 'radius']]) {
    const input = root.querySelector(`#${id}`);
    input.addEventListener('input', () => { working[field] = Number(input.value); turnOn(); showValues(); commit(false); }); // shown on the stage while the slider moves
    input.addEventListener('change', () => commit()); // kept (history, saving) when it is let go
  }
  for (const [name, field] of [['beShadow', 'shadow'], ['beFrame', 'frame']]) {
    root.querySelector(`[name="${name}"]`).closest('.seg').addEventListener('change', (e) => { working[field] = e.target.value; turnOn(); commit(); });
  }
  document.body.append(root);
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
  let chosen = false;
  for (const input of panel.querySelectorAll('input[name="beBg"]')) chosen = (input.checked = input.value === value) || chosen;
  if (bg.type === 'color') $('beColor').value = bg.color;
  panel.querySelector('.be-custom').toggleAttribute('data-on', bg.type === 'color' && !chosen);
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

// Applies the look to the displayed version (or removes it). `final`: the change is done, so it is a history step, it is saved, and
// the look is remembered as the one to offer next; otherwise the stage only follows a control that is still moving.
function commit(final = true) {
  if (!context) return;
  working = normalizeBeautify(working);
  if (final && on) lastStyle = structuredClone(working);
  context.apply(on ? working : null, final);
}

function close(restoreFocus = false) {
  if (!opened) return;
  opened = false;
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
    opened = true;
    $('beautify').setAttribute('aria-expanded', 'true');
    $('beOn').focus();

    // Closing: Escape, a click or a focus anywhere else.
    const outside = (e) => { if (!panel.contains(e.target) && !$('beautify').contains(e.target)) close(); };
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
 * @param {() => { style: () => any, apply: (style: any, final?: boolean) => void } | null} options.context
 */
export function toggle(options) {
  if (opened) close(true);
  else openPanel(options);
}
