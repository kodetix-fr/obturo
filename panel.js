// The controls of library.html (tools, style, versions, crop, scale, zoom): what the editor shows there, and the
// events it receives from them. This module reads and writes the DOM; it keeps no editor state and hands over to the
// actions the editor gives it (bindControls). It knows the annotation objects, to reflect and apply their style.
import { IText } from './vendor/fabric.min.mjs';
import { Arrow, BlurRegion, Emoji, Highlight, Marker, PixelRegion, Spot, applyShape, hasShape, isOutlined, isSolid } from './shapes.js';
import { cleanEnds, cleanShape, shapeOf } from './shape-pure.js';
import { EMOJIS, cleanEmoji } from './emoji-pure.js';
import { DEFAULT_FILL, PALETTE, solidColor } from './mask-pure.js';
import { cleanSide, markerDiameter } from './marker-pure.js';
import { highlightColor } from './highlight-pure.js';
import { outputSize, MAX_NAME, MAX_SIDE, MAX_PIXELS } from './versions.js';
import { styleOf } from './beautify-pure.js';
import { clamp } from './pure.js';
import { formatNumber, t } from './i18n.js';
import { FORMAT_NAMES } from './settings.js';
import { applyDom, setAria, setI18n } from './dom-i18n.js';
import { dom } from './dom.js';

const TEXT_SIZE = { min: 8, max: 400, fallback: 16 }; // text size as typed (bounds of #size in library.html)
const AUTO_SIZE = { min: 16, max: 120 }; // text and block size proposed on opening, depending on the image
const BLUR_DIVISOR = 36; // the blur block proposed on opening is 1 / 36 of the short side of the image (the pixelation: 1 / 45): a smoother blur needs a bit more
const STROKE_MIN = 3; // px, minimum stroke width
const STROKE_DIVISOR = 320; // the stroke follows the image width (1 px per 320 px), before the thin / medium / thick setting
const FLASH_MS = 1300; // how long the temporary label of the copy button (the confirmation) stays

// ---------- values read from the panel (for the next objects) ----------

// Every color is one control (swatches and a free color); the free color input always holds the one in use, which is what is read here.
export const color = () => dom.color.value;
export const pixelBlock = () => Number(dom.block.value);
export const blurBlock = () => Number(dom.blur.value);
/** Color of the next highlighter (the yellow when nothing else was chosen). */
export const highlightPick = () => highlightColor(dom.hlColor.value);
/** Background of the next text: '' for none (the "None" swatch is checked), else the color in use. */
export const textBackground = () => (/** @type {HTMLInputElement | null} */ (dom.bgSwatches.querySelector('input:checked'))?.value === '' ? '' : dom.bgColor.value);
/** Color of the next solid fill: always opaque (a value with transparency is never kept), black when nothing else was chosen. */
export const fillColor = () => solidColor(dom.flatColor.value) ?? DEFAULT_FILL;

// The last colors and blur strength, kept by this browser for the next captures. Only a convenience: without localStorage
// (blocked, private window) they last until the page closes.
const MEMORY_KEY = 'obturo.tools';
function recall() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY)) ?? {}; } catch { return {}; }
}
function remember(patch) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...recall(), ...patch })); } catch { /* the choice lasts until the page closes */ }
}
let blurChoice = Number(recall().blur) || 0; // the strength the person chose; 0 = none yet, the opening proposes one from the image

// The stroke setting is a group of radios (thin / medium / thick).
const thickness = () => Number(/** @type {HTMLInputElement | null} */ (dom.thick.querySelector('input:checked'))?.value ?? 1);

/** Stroke width for an image of width `docWidth`, following the thin / medium / thick setting. */
export const strokeWidth = (docWidth) => Math.round(Math.max(STROKE_MIN, docWidth / STROKE_DIVISOR) * thickness());

/** Diameter of the next numbered marker for an image of width `docWidth`: the stroke setting (thin / medium / thick) is its size. */
export const markerSize = (docWidth) => markerDiameter(docWidth, thickness());

// The ends of the next arrow, and the emoji of the next one placed: chosen in the style bar, kept for the next captures.
let endsChoice = cleanEnds(recall().ends);
let emojiChoice = cleanEmoji(recall().emoji);
/** The ends of the next arrow: a head at the end, none (a line) or a head at both ends. */
export const arrowEnds = () => endsChoice;
/** The emoji of the next one placed. */
export const emoji = () => emojiChoice;
/** Font size of the next emoji for an image of width `docWidth`. */
export const emojiSize = (docWidth) => markerDiameter(docWidth, 1.2);

// The shape of the next area, per tool: the rectangle for the outline, the solid fill, the highlighter, the spotlight, the pixelation, the blur.
const SHAPE_TOOLS = ['rect', 'flat', 'highlight', 'spot', 'pixel', 'blur'];
const shapeChoice = { ...recall().shapes };
/** The shape that the next area of this tool takes. @param {string} tool */
export const shape = (tool) => cleanShape(shapeChoice[tool]);
/** The tool that draws a rectangle of Fabric of this kind. */
const toolOf = (o) => (isSolid(o) ? 'flat' : o instanceof Highlight ? 'highlight' : o instanceof Spot ? 'spot' : o instanceof PixelRegion ? 'pixel' : o instanceof BlurRegion ? 'blur' : 'rect');
const showShape = (s) => { for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (dom.shapePick.querySelectorAll('input'))) r.checked = r.value === s; };

const isPressed = (button) => button.getAttribute('aria-pressed') === 'true';

/** Fabric options of a new text, from the panel. */
export const textStyle = () => ({
  fontSize: Number(dom.size.value),
  fontFamily: dom.font.value,
  fill: color(),
  fontWeight: isPressed(dom.bold) ? 'bold' : 'normal',
  fontStyle: isPressed(dom.italic) ? 'italic' : 'normal',
  underline: isPressed(dom.underline),
  backgroundColor: textBackground(),
});

// ---------- what the editor shows ----------

/** Opening of a W x H px shot: enables the controls and proposes a text and block size scaled to the image. */
export function enable(W, H) {
  dom.size.value = String(clamp(Math.round(W / 50), AUTO_SIZE.min, AUTO_SIZE.max));
  dom.block.value = String(clamp(Math.round(Math.min(W, H) / 45), AUTO_SIZE.min, AUTO_SIZE.max));
  dom.blur.value = String(clamp(blurChoice || Math.round(Math.min(W, H) / BLUR_DIVISOR), AUTO_SIZE.min, AUTO_SIZE.max));
  dom.ui.disabled = false;
  dom.stageMsg.hidden = true;
}

/** Closing of the shot. */
export function disable() {
  dom.ui.disabled = true;
  dom.versions.replaceChildren();
  setI18n(dom.outNote);
}

/** Active tool. */
export function showTool(tool) {
  for (const b of dom.tools) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
}

/** Shows `hex` in a color control: the free color holds it, and the swatch that has it is checked (none for another color; '' is "None"). */
function showColor(box, custom, hex) {
  if (hex) custom.value = hex;
  for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll('input'))) radio.checked = radio.value === hex;
}
const showLine = (hex) => showColor(dom.lineSwatches, dom.color, hex);
const showEnds = (ends) => { for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (dom.endsPick.querySelectorAll('input'))) r.checked = r.value === ends; };
const showEmoji = (glyph) => { for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (dom.emojiPick.querySelectorAll('input'))) r.checked = r.value === glyph; };
const showSide = (side) => { for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (dom.sidePick.querySelectorAll('input'))) r.checked = r.value === side; };
const showBackground = (hex) => showColor(dom.bgSwatches, dom.bgColor, hex);
const showHighlight = (hex) => showColor(dom.hlSwatches, dom.hlColor, hex);
/** The fill color, and the icon of the tool, which shows the color of the next fill. */
function showFill(hex) {
  showColor(dom.swatches, dom.flatColor, hex);
  dom.tools.find((b) => b.dataset.tool === 'flat')?.style.setProperty('--fill', hex);
}

/** The settings shown follow the selected object (or the active tool when nothing is selected). */
export function showSelection(o, tool) {
  const isEmoji = o instanceof Emoji, isText = o instanceof IText && !isEmoji, isPixel = o instanceof PixelRegion, isBlur = o instanceof BlurRegion, isFlat = isSolid(o), isMarker = o instanceof Marker;
  const isHighlight = o instanceof Highlight, isSpot = o instanceof Spot;
  const kind = o ? (isEmoji ? 'emoji' : isText ? 'text' : isPixel ? 'pixel' : isBlur ? 'blur' : isFlat ? 'flat' : isMarker ? 'marker' : isHighlight ? 'highlight' : isSpot ? 'spot' : 'line') : tool;
  setI18n(dom.thickLabel, kind === 'marker' ? 'prop.size' : 'prop.stroke'); // the same three choices: the width of a line, the size of a marker
  dom.lineProps.hidden = ['pixel', 'blur', 'flat', 'highlight', 'spot', 'emoji'].includes(kind);
  dom.strokeField.hidden = kind === 'text'; // a text has no stroke
  dom.markerProps.hidden = !isMarker; // the legend is the one of a marker that is selected
  dom.emojiProps.hidden = kind !== 'emoji';
  dom.endProps.hidden = !(o ? o instanceof Arrow : tool === 'arrow');
  if (kind === 'emoji') showEmoji(o ? o.text : emojiChoice);
  if (!dom.endProps.hidden) showEnds(o ? cleanEnds(o.ends) : endsChoice);
  dom.highlightProps.hidden = kind !== 'highlight';
  dom.spotProps.hidden = kind !== 'spot';
  dom.textProps.hidden = kind !== 'text';
  dom.flatProps.hidden = kind !== 'flat';
  dom.pixelProps.hidden = kind !== 'pixel';
  dom.blurProps.hidden = kind !== 'blur';
  const shaped = o ? hasShape(o) : SHAPE_TOOLS.includes(tool); // an object that has no shape (an arrow, a text, a marker) hides the choice
  dom.shapeProps.hidden = !shaped;
  if (shaped) showShape(o ? shapeOf(o) : shape(tool));
  // a free shape is drawn, not chosen: it cannot be given to an area that is not one (the others can be given to a free one)
  /** @type {HTMLInputElement} */ (dom.shapePick.querySelector('input[value="free"]')).disabled = !!o && hasShape(o) && shapeOf(o) !== 'free';
  dom.del.disabled = !o;
  if (isText) {
    if ([...dom.font.options].some((x) => x.value === o.fontFamily)) dom.font.value = o.fontFamily;
    dom.size.value = String(Math.round(o.fontSize));
    dom.bold.setAttribute('aria-pressed', String(o.fontWeight === 'bold'));
    dom.italic.setAttribute('aria-pressed', String(o.fontStyle === 'italic'));
    dom.underline.setAttribute('aria-pressed', String(!!o.underline));
    showBackground(solidColor(o.backgroundColor) ?? '');
    showLine(solidColor(o.fill) ?? color());
  } else if (isPixel) {
    dom.block.value = o.block;
  } else if (isBlur) {
    dom.blur.value = o.block;
  } else if (isFlat) {
    showFill(solidColor(o.fill) ?? DEFAULT_FILL);
  } else if (isHighlight) {
    showHighlight(highlightColor(o.fill));
  } else if (isMarker) {
    showSide(cleanSide(o.side));
    showLine(solidColor(o.fill) ?? color());
  } else if (o && isOutlined(o)) {
    showLine(solidColor(o.stroke) ?? color());
  }
}

/** Version buttons: the original, then each version, the displayed one pressed. */
export function showVersions(shot) {
  const button = (name, i) => { // no name = the original, whose label is translated
    const b = document.createElement('button');
    b.type = 'button';
    if (name) b.textContent = name;
    else setI18n(b, 'ver.original');
    b.dataset.i = String(i);
    b.setAttribute('aria-pressed', String(shot.active === i));
    if (i >= 0) { b.dataset.i18nTitle = 'ver.rename.tip'; b.title = t('ver.rename.tip'); }
    return b;
  };
  dom.versions.replaceChildren(button(null, -1), ...shot.versions.map((v, i) => button(v.name, i)));
  dom.delVersion.disabled = shot.active < 0;
}

let lastOutput = null; // arguments of the last showOutput, to draw it again when the language changes

/**
 * Output size and scale of the displayed version (`version` absent = the original). `capped`: the scale was brought
 * back to the output ceiling.
 */
export function showOutput(version, W, H, capped) {
  lastOutput = [version, W, H, capped];
  const crop = version?.crop ?? { w: W, h: H };
  const scale = version?.scale ?? 1;
  const size = outputSize(W, H, version);
  if (capped) setI18n(dom.outNote, 'out.capped', { pct: Math.floor(scale * 100), side: formatNumber(MAX_SIDE), mpix: formatNumber(MAX_PIXELS / 1e6) });
  else setI18n(dom.outNote);
  dom.scalePct.value = String(Math.round(scale * 100));
  dom.scaleW.value = String(Math.floor(crop.w * scale + 1e-6));
  setI18n(dom.out, 'out.size', { w: size.w, h: size.h });
  dom.cropClear.disabled = !version?.crop;
  dom.beautify.toggleAttribute('data-on', !!styleOf(version));
}

/** The language changed: redraws what holds a number formatted for the previous one (applyDom did the rest). */
export function relocalize() {
  if (lastOutput && !dom.ui.disabled) showOutput(...lastOutput);
}

/** The format that a click on Download produces, written beside its label (export). @param {string} format a key of FORMAT_NAMES */
export function showFormat(format) {
  dom.downloadFmt.textContent = FORMAT_NAMES[format] ?? '';
}

/** Undo / redo availability. */
export function showHistory(history) {
  dom.undo.disabled = !history.canUndo;
  dom.redo.disabled = !history.canRedo;
}

/** `editing`: a crop is in progress (Apply and Cancel appear in the style bar, the crop tool shows as pressed). */
export function showCropButtons(editing) {
  dom.crop.setAttribute('aria-pressed', String(editing));
  dom.cropGroup.hidden = !editing;
}

export function showZoom(z) {
  setI18n(dom.zoomLabel, 'zoom.value', { n: Math.round(z * 100) });
}

let flashTimer;
/** Briefly replaces the label of the copy button with `key` (the confirmation); on a narrow window the label shows for the occasion. */
export function flashCopy(key) {
  dom.copy.dataset.flash = '1';
  setI18n(dom.copyLabel, key);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    delete dom.copy.dataset.flash;
    setI18n(dom.copyLabel, 'act.copy');
  }, FLASH_MS);
}

/**
 * The swatches of a color control: native radios (the arrows move between them), one chip per color, named by the key of the palette.
 * `none` puts "None" first (a radio whose value is '').
 * @param {HTMLElement} box @param {string} name @param {{ key: string, hex: string }[]} palette @param {boolean} [none]
 */
function buildSwatches(box, name, palette, none = false) {
  for (const { key, hex } of none ? [{ key: 'prop.none', hex: '' }, ...palette] : palette) {
    const label = document.createElement('label');
    label.className = hex ? 'sw' : 'sw none';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = hex;
    radio.dataset.i18nLabel = key;
    const chip = document.createElement('span');
    if (hex) chip.style.background = hex;
    label.append(radio, chip);
    box.append(label);
  }
  applyDom(box);
}

// ---------- what the editor receives ----------

/**
 * Wires the controls to the editor's actions. Call it once: the page has a single editor.
 * `actions.restyle(fn)` applies `fn` to the selected object and returns true if there is one.
 */
export function bindControls(actions) {
  const { ready } = actions;

  for (const b of dom.tools) b.addEventListener('click', () => ready() && actions.setTool(b.dataset.tool));
  dom.versions.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-i]'));
    if (b && ready() && b.getAttribute('aria-pressed') !== 'true') actions.showVersion(Number(b.dataset.i)); // the displayed one: nothing to load again
  });
  // A version is renamed where its pill is: a double click, or F2 on the focused pill.
  const rename = (/** @type {HTMLElement} */ pill) => {
    const i = Number(pill.dataset.i);
    const input = document.createElement('input');
    input.className = 'pill-name';
    input.maxLength = MAX_NAME;
    input.value = pill.textContent ?? '';
    setAria(input, 'ver.rename');
    let finished = false;
    const finish = (/** @type {boolean} */ keep) => {
      if (finished) return;
      finished = true;
      if (keep) actions.nameVersion(i, input.value);
      else actions.showVersions();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the editor's shortcuts are not for this field
      if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    pill.replaceWith(input);
    input.focus();
    input.select();
  };
  dom.versions.addEventListener('dblclick', (e) => {
    const under = document.elementFromPoint(e.clientX, e.clientY); // the first click can have rebuilt the pills
    const b = /** @type {HTMLElement | null} */ (under?.closest('button[data-i]') ?? null);
    if (b && ready() && Number(b.dataset.i) >= 0) rename(b);
  });
  dom.versions.addEventListener('keydown', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-i]'));
    if (e.key === 'F2' && b && ready() && Number(b.dataset.i) >= 0) { e.preventDefault(); rename(b); }
  });
  dom.newVersion.addEventListener('click', () => ready() && actions.newVersion());
  dom.delVersion.addEventListener('click', () => ready() && actions.removeVersion());

  dom.crop.addEventListener('click', () => ready() && actions.enterCrop());
  dom.cropOk.addEventListener('click', () => ready() && actions.exitCrop(true));
  dom.cropCancel.addEventListener('click', () => ready() && actions.exitCrop(false));
  dom.cropClear.addEventListener('click', () => ready() && actions.clearCrop());

  // The typed value is read HERE, before the editor creates V1 (which resets the fields to 100 %).
  dom.scalePct.addEventListener('change', () => ready() && actions.setScale(Number(dom.scalePct.value) / 100));
  dom.scaleW.addEventListener('change', () => ready() && actions.setOutputWidth(Number(dom.scaleW.value)));
  dom.fit.addEventListener('click', () => actions.fit());
  dom.actual.addEventListener('click', () => actions.actualSize());

  dom.undo.addEventListener('click', () => ready() && actions.step(-1));
  dom.redo.addEventListener('click', () => ready() && actions.step(1));
  dom.del.addEventListener('click', () => ready() && actions.deleteSelection());
  dom.copy.addEventListener('click', () => ready() && actions.copyImage());
  dom.download.addEventListener('click', () => ready() && actions.downloadImage());
  dom.downloadMenu.addEventListener('click', () => ready() && actions.downloadMenu());
  dom.beautify.addEventListener('click', () => ready() && actions.beautifyMenu());
  dom.stamp.addEventListener('click', () => ready() && actions.addStamp());

  // Style: the preview follows the typing ('input'); history and saving follow the validation ('change').
  const live = (el, fn) => el.addEventListener('input', () => actions.restyle(fn));
  const done = (el) => el.addEventListener('change', () => { if (actions.hasSelection()) actions.commit(); });
  const toggle = (button, fn) => button.addEventListener('click', () => {
    const next = !isPressed(button);
    button.setAttribute('aria-pressed', String(next));
    if (actions.restyle((o) => o instanceof IText && fn(o, next))) actions.commit();
  });

  // Colors: the swatches and the free color of a control all set ONE color, kept for the next objects and applied to the selected one.
  // The preview follows a free color as it is dragged ('input'); history and saving follow the choice (`final`).
  /** @param {HTMLElement} box @param {HTMLInputElement} custom @param {(value: string, final: boolean) => void} set */
  const wire = (box, custom, set) => {
    box.addEventListener('change', (e) => set(/** @type {HTMLInputElement} */ (e.target).value, true));
    custom.addEventListener('input', () => set(custom.value, false));
    custom.addEventListener('change', () => set(custom.value, true));
  };
  const setLine = (value, final) => {
    const hex = solidColor(value);
    if (!hex) return;
    showLine(hex);
    if (final) remember({ line: hex });
    const hit = actions.restyle((o) => {
      if (o instanceof IText || o instanceof Marker) o.set('fill', hex);
      else if (isOutlined(o)) o.set('stroke', hex);
    });
    if (hit && final) actions.commit();
  };
  buildSwatches(dom.lineSwatches, 'lineSwatch', PALETTE);
  showLine(solidColor(recall().line) ?? color());
  wire(dom.lineSwatches, dom.color, setLine);
  dom.thick.addEventListener('change', () => { // 'change' of a radio bubbles up to the group
    if (actions.restyle((o) => {
      if (o instanceof Marker) o.resize(actions.markerSize()); // the disc changes size around its center
      else if (isOutlined(o)) o.set('strokeWidth', actions.strokeWidth());
    })) actions.commit();
  });
  live(dom.font, (o) => o instanceof IText && o.set('fontFamily', dom.font.value));
  done(dom.font);
  live(dom.size, (o) => o instanceof IText && o.set('fontSize', clamp(Number(dom.size.value) || TEXT_SIZE.fallback, TEXT_SIZE.min, TEXT_SIZE.max)));
  done(dom.size);
  toggle(dom.bold, (o, on) => o.set('fontWeight', on ? 'bold' : 'normal'));
  toggle(dom.italic, (o, on) => o.set('fontStyle', on ? 'italic' : 'normal'));
  toggle(dom.underline, (o, on) => o.set('underline', on));
  // The background of a text: "None" first (its value is ''), then the same swatches. Choosing a color is enough: no box to tick.
  const setBackground = (value, final) => {
    const hex = value === '' ? '' : solidColor(value);
    if (hex === null) return;
    showBackground(hex);
    if (final) remember({ bg: hex });
    if (actions.selection() instanceof IText) {
      actions.restyle((o) => o.set('backgroundColor', hex));
      if (final) actions.commit();
    }
  };
  buildSwatches(dom.bgSwatches, 'bgSwatch', PALETTE, true);
  showBackground(recall().bg === undefined ? '' : solidColor(recall().bg) ?? '');
  wire(dom.bgSwatches, dom.bgColor, setBackground);
  live(dom.block, (o) => o instanceof PixelRegion && o.set('block', pixelBlock()));
  done(dom.block);

  // Blur: the preview follows the slider (the object is `live`: a cheap preview), the exact blur is computed when it is released.
  live(dom.blur, (o) => {
    if (!(o instanceof BlurRegion)) return;
    o.set('block', blurBlock());
    o.live = true;
  });
  dom.blur.addEventListener('change', () => {
    blurChoice = blurBlock();
    remember({ blur: blurChoice });
    actions.release();
    if (actions.selection() instanceof BlurRegion) actions.commit();
  });

  // The shape: for the next area of the tool, and for the selected one (its corner radii are the whole of its shape).
  dom.shapePick.addEventListener('change', (e) => {
    const s = cleanShape(/** @type {HTMLInputElement} */ (e.target).value);
    const sel = actions.selection();
    const tool = sel ? (hasShape(sel) ? toolOf(sel) : null) : actions.tool();
    if (tool) { shapeChoice[tool] = s; remember({ shapes: shapeChoice }); }
    if (sel && hasShape(sel)) {
      actions.restyle((o) => applyShape(o, s));
      actions.commit();
    }
  });

  // The ends of an arrow: for the next one, and for the selected one.
  showEnds(endsChoice);
  dom.endsPick.addEventListener('change', (e) => {
    endsChoice = cleanEnds(/** @type {HTMLInputElement} */ (e.target).value);
    remember({ ends: endsChoice });
    if (actions.selection() instanceof Arrow) {
      actions.restyle((o) => o.set('ends', endsChoice));
      actions.commit();
    }
  });

  // The emoji: one radio per emoji of the list; the choice is for the next one placed, and for the selected emoji.
  for (const glyph of EMOJIS) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'emoji';
    radio.value = glyph;
    const face = document.createElement('span');
    face.textContent = glyph;
    label.append(radio, face);
    dom.emojiPick.append(label);
  }
  showEmoji(emojiChoice);
  dom.emojiPick.addEventListener('change', (e) => {
    emojiChoice = cleanEmoji(/** @type {HTMLInputElement} */ (e.target).value);
    remember({ emoji: emojiChoice });
    if (actions.selection() instanceof Emoji) {
      actions.restyle((o) => o.set('text', emojiChoice));
      actions.commit();
    }
  });

  // A marker: its text is typed on the image (the button, a double click on it or Enter); the side of the text is chosen here, and a choice
  // is final: the editor no longer moves the text to the left when it leaves the image, but a side that would leave it is not given.
  dom.legendEdit.addEventListener('click', () => actions.editMarker());
  dom.sidePick.addEventListener('change', (e) => {
    const side = cleanSide(/** @type {HTMLInputElement} */ (e.target).value);
    actions.setMarkerSide(side);
  });

  // Highlighter.
  const setHighlight = (value, final) => {
    const hex = solidColor(value);
    if (!hex) return;
    showHighlight(hex);
    if (final) remember({ highlight: hex });
    if (actions.selection() instanceof Highlight) {
      actions.restyle((o) => o.set('fill', hex));
      if (final) actions.commit();
    }
  };
  buildSwatches(dom.hlSwatches, 'hlSwatch', PALETTE);
  showHighlight(highlightColor(recall().highlight));
  wire(dom.hlSwatches, dom.hlColor, setHighlight);

  // Solid fill. A color with transparency is refused (the fill keeps the one it has).
  buildSwatches(dom.swatches, 'fillSwatch', PALETTE);
  const stored = solidColor(recall().fill);
  showFill(stored ?? fillColor());
  const setFill = (value, final) => {
    const hex = solidColor(value);
    if (!hex) { showFill(fillColor()); return; }
    showFill(hex);
    if (final) remember({ fill: hex });
    if (isSolid(actions.selection())) {
      actions.restyle((o) => o.set('fill', hex));
      if (final) actions.commit();
    }
  };
  wire(dom.swatches, dom.flatColor, setFill);
}
