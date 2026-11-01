// The in-place editor of a numbered marker: a field laid over the number (or over the legend, which it also makes room for when there is
// none yet), drawn like the thing it edits (the color of the marker, its ring, its font scaled with the zoom), so that the text is typed
// where it will be. Enter keeps it, Esc puts the old text back, leaving the field (a click elsewhere) keeps it. While typing, the marker
// changes live (the editor redraws and saves quietly); the history gets ONE step when the field closes, if the text changed.
// The field belongs to `host`, the element of the canvas: it is placed in its coordinates, from the view (zoom and pan) that the editor
// gives, and follows it (place()).
import { cleanMarkerNumber, markerFontSize, markerInk } from './marker-pure.js';

const MIN_LEGEND_EM = 1.6; // the room given to a legend that is still empty, in diameters of the disc

/**
 * @param {object} o
 * @param {HTMLElement} o.host
 * @param {import('./shapes.js').Marker} o.marker
 * @param {'n' | 'label'} o.part The number or the legend.
 * @param {() => { z: number, tx: number, ty: number }} o.view
 * @param {() => void} o.onLive The marker changed while typing.
 * @param {(changed: boolean) => void} o.onDone The field is gone; `changed`: its text is not the one it started with.
 * @param {(delta: -1 | 1) => void} [o.onUndo] Ctrl+Z (-1) or Ctrl+Y (1) in a field that is empty: the editor does it, the field is closed first.
 * @returns {{ close: (keep?: boolean) => void, place: () => void }}
 */
export function editMarker({ host, marker, part, view, onLive, onDone, onUndo }) {
  const startN = marker.n, startLabel = marker.label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'marker-edit';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = part === 'n' ? 3 : 60;
  if (part === 'n') input.inputMode = 'numeric';
  input.value = part === 'n' ? String(startN) : startLabel;
  marker.editing = part;
  host.append(input);
  let done = false;

  /** Puts the field where the number or the legend is, as big as it is, in the colors of the marker. */
  function place() {
    const { z, tx, ty } = view();
    const d = marker.height, ring = Math.max(1.5, d * 0.06), ink = markerInk(marker.fill);
    const parts = marker.parts(d * MIN_LEGEND_EM);
    const box = part === 'n'
      ? { x: parts.disc.cx - parts.disc.r, y: parts.disc.cy - parts.disc.r, w: d, h: d, font: `700 ${markerFontSize(d, Number(input.value) || startN)}px Arial, Helvetica, sans-serif`, pad: 0, radius: d / 2, align: 'center' }
      : { x: parts.slot.x, y: parts.slot.y, w: parts.slot.w, h: parts.slot.h, font: parts.slot.font, pad: parts.slot.padX, radius: parts.slot.h / 2, align: 'left' };
    const s = input.style;
    s.left = `${box.x * z + tx}px`;
    s.top = `${box.y * z + ty}px`;
    s.width = `${box.w * z}px`;
    s.height = `${box.h * z}px`;
    s.font = box.font.replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Number(size) * z}px`);
    s.padding = `0 ${Math.max(0, box.pad - ring) * z}px`;
    s.border = `${ring * z}px solid ${ink}`;
    s.borderRadius = `${box.radius * z}px`;
    s.background = typeof marker.fill === 'string' ? marker.fill : '#e53935';
    s.color = ink;
    s.textAlign = box.align;
  }

  /** Applies what is typed to the marker, as far as it is valid. */
  function apply() {
    if (part === 'n') {
      input.value = input.value.replace(/\D/g, '').slice(0, 3);
      const n = cleanMarkerNumber(input.value);
      if (n) marker.n = n;
    } else {
      marker.setLegend(input.value);
    }
    marker.setCoords();
    place();
    onLive();
  }

  /** @param {boolean} keep Keep what was typed (else the text it started with comes back). */
  function finish(keep) {
    if (done) return;
    done = true;
    input.removeEventListener('blur', onBlur);
    if (!keep) {
      if (part === 'n') marker.n = startN;
      else marker.setLegend(startLabel);
    } else if (part === 'n' && !cleanMarkerNumber(input.value)) {
      marker.n = startN; // nothing valid typed (empty, 0): the number it had
    }
    marker.editing = null;
    marker.setCoords();
    input.remove();
    onDone(part === 'n' ? marker.n !== startN : marker.label !== startLabel);
  }

  const onBlur = () => finish(true);
  input.addEventListener('input', apply);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the keys of the editor (Delete, Esc, undo...) are not for the page behind the field
    const k = e.key.toLowerCase();
    if (k === 'enter') { e.preventDefault(); finish(true); }
    else if (k === 'escape') { e.preventDefault(); finish(false); }
    else if ((e.ctrlKey || e.metaKey) && !input.value && (k === 'z' || k === 'y')) {
      e.preventDefault(); // an empty field has nothing to undo: the step before it does (the marker that was just placed, say)
      finish(false);
      onUndo?.(k === 'y' || e.shiftKey ? 1 : -1);
    }
  });

  place();
  input.focus();
  input.select();
  return { close: (keep = true) => finish(keep), place };
}
