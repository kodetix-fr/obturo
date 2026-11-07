// Obturo's own Fabric objects. None holds pixels in its serialization:
// the pixelated and the blurred regions reread the original image (source.img) to draw themselves.
import { FabricObject, IText, Path, Rect, classRegistry } from './vendor/fabric.min.mjs';
import { EMOJI_FONT, cleanEmoji } from './emoji-pure.js';
import { blockAverages, regionBox, tilePlan } from './mask-pure.js';
import { boxLeft, cleanLegend, cleanSide, discCenterX, legendBox, legendFontSize, markerFontSize, markerInk } from './marker-pure.js';
import { DEFAULT_HIGHLIGHT, HIGHLIGHT_OPACITY } from './highlight-pure.js';
import { SPOT_SHADE } from './spot-pure.js';
import { DEFAULT_ENDS, cleanEnds, shapeOf, shapeRadii } from './shape-pure.js';

// Decoded original image (ImageBitmap), full resolution. Set by the editor when a shot is opened.
export const source = { img: null };

// Width of a text in a font, measured on a canvas that is never drawn (the legend of a marker sets the width of its box from it).
let ruler = null;
const measure = (font, text) => {
  ruler ??= new OffscreenCanvas(1, 1).getContext('2d');
  ruler.font = font;
  return ruler.measureText(text).width;
};

/**
 * Adds to the current path of `ctx` the shape of a w x h box at (x, y) with corner radii rx, ry: a rectangle (no radius), an ellipse
 * (radii of half the sides) or a rounded rectangle. The rectangles, rounded or not, of Fabric and this are the same box.
 */
export function tracePath(ctx, x, y, w, h, rx = 0, ry = 0) {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0 && ry > 0)) ctx.rect(x, y, w, h);
  else if (rx >= w / 2 - 1e-6 && ry >= h / 2 - 1e-6) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(x, y, w, h, { x: rx, y: ry });
}

/** Adds a free path to the current path of `ctx`: `pts` are fractions of a w x h box centered on the origin (the space of an object). */
function tracePoly(ctx, pts, w, h, close) {
  for (let i = 0; i < pts.length; i += 2) {
    const x = (pts[i] - 0.5) * w, y = (pts[i + 1] - 0.5) * h;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  if (close) ctx.closePath();
}

/**
 * Gives `o` (a rectangle of Fabric, or one of ours) the shape `shape` in its box: its corner radii are the whole of it, and it has no
 * points. A free shape is drawn, not chosen: asking for one changes nothing.
 * @param {any} o @param {string} shape
 */
export function applyShape(o, shape) {
  if (shape === 'free') return;
  o.set({ ...shapeRadii(shape, o.width, o.height), pts: [] });
}

/** Draws with `draw` inside the shape of `o` (the object space: centered, unscaled box); a rectangle needs no clip. */
function clipped(ctx, o, draw) {
  const free = shapeOf(o) === 'free';
  if (!free && !(o.rx > 0 && o.ry > 0)) { draw(); return; }
  ctx.save();
  ctx.beginPath();
  if (free) tracePoly(ctx, o.pts, o.width, o.height, true);
  else tracePath(ctx, -o.width / 2, -o.height / 2, o.width, o.height, o.rx, o.ry);
  ctx.clip();
  draw();
  ctx.restore();
}

const HEAD_ANGLE = 0.45; // rad: half-opening of the arrow head
const headLength = (strokeWidth) => strokeWidth * 4 + 8; // px

// A head with its tip at (x, y), pointing along angle `a`.
function arrowHead(ctx, x, y, a, len) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - len * Math.cos(a - HEAD_ANGLE), y - len * Math.sin(a - HEAD_ANGLE));
  ctx.lineTo(x - len * Math.cos(a + HEAD_ANGLE), y - len * Math.sin(a + HEAD_ANGLE));
  ctx.closePath();
  ctx.fill();
}

// Arrow: a width x height box that goes from the top-left corner to the bottom-right one; flipX / flipY give the direction.
// `ends`: a head at the end ('end'), none, a plain line ('none'), or a head at both ends ('both').
export class Arrow extends FabricObject {
  static type = 'Arrow';

  constructor(options) {
    super({ objectCaching: false, stroke: '#e53935', strokeWidth: 6, ends: DEFAULT_ENDS, ...options });
    this.ends = cleanEnds(this.ends);
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'ends']);
  }

  _render(ctx) {
    // Drawn in the scaled space: stroke width and head do not distort when resizing.
    const sx = this.scaleX || 1, sy = this.scaleY || 1;
    const w = this.width * sx, h = this.height * sy;
    const a = Math.atan2(h, w), len = headLength(this.strokeWidth);
    const x = w / 2, y = h / 2;
    const ends = cleanEnds(this.ends);
    const tail = ends === 'both' ? len * 0.5 : 0, tip = ends === 'none' ? 0 : len * 0.5; // the line stops inside a head
    ctx.save();
    ctx.scale(1 / sx, 1 / sy);
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = this.stroke;
    ctx.beginPath();
    ctx.moveTo(-x + Math.cos(a) * tail, -y + Math.sin(a) * tail);
    ctx.lineTo(x - Math.cos(a) * tip, y - Math.sin(a) * tip);
    ctx.stroke();
    if (ends !== 'none') arrowHead(ctx, x, y, a, len);
    if (ends === 'both') arrowHead(ctx, -x, -y, a + Math.PI, len);
    ctx.restore();
  }
}

// An emoji placed on the image: a text of one emoji that is sized and moved like any object, and never typed into (its glyph is picked in the
// style bar). Drawn by the color emoji font of the system, so it looks as it does there.
export class Emoji extends IText {
  static type = 'Emoji';

  constructor(text, options) {
    super(cleanEmoji(text), { fontFamily: EMOJI_FONT, editable: false, ...options });
  }
}

// Numbered marker: a disc with a number, to mark the steps of a procedure on an image, and an optional LEGEND, a short text in a pill
// beside the disc ("1  Open the menu"). The height is the diameter of the disc, the width is the disc plus its legend: the box that
// is selected, moved and resized holds both, and with no legend it is a square (width = height). A color (`fill`, the disc and the pill),
// a number (`n`: the smallest free one when it is placed, see marker-pure.js, and whatever is typed after), a legend (`label`, '' for none)
// and the side of the disc where the legend is (`side`; `sideAuto`: nobody chose it yet, so the editor puts it on the left if it would leave
// the image on the right). It stays a circle: only the corner handles resize it, and the editor bakes the scale into the size after a resize
// (bakeScale). The number and the legend are written in white, or near black on a light color, inside a ring of the same ink, so that the
// marker stands out on any background. The DISC stays where it is when the legend grows, changes side or goes away: it is what was clicked.
// `editing` ('n' or 'label', not saved) hides that text while it is typed in a field on top of it (marker-edit.js).
export class Marker extends FabricObject {
  static type = 'Marker';

  constructor(options) {
    super({ objectCaching: false, fill: '#e53935', width: 40, height: 40, n: 1, label: '', side: 'right', sideAuto: true, ...options });
    this.setControlsVisibility({ mtr: false, ml: false, mr: false, mt: false, mb: false });
    this.side = cleanSide(this.side);
    this.editing = null;
    this.fit(); // the width of a saved marker follows the legend as it is measured here, not as it was where it was saved
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'n', 'label', 'side', 'sideAuto']);
  }

  // The pill of the legend for the current size, or null with no legend. Measured with the font that draws it.
  _legend() {
    if (!this.label) return null;
    const d = this.height;
    const font = `600 ${legendFontSize(d)}px Arial, Helvetica, sans-serif`;
    const textWidth = measure(font, this.label);
    return { font, textWidth, ...legendBox(d, textWidth) };
  }

  // What the box holds beside the disc: the gap and the pill, nothing with no legend.
  _footprint() {
    const pill = this._legend();
    return pill ? pill.gap + pill.width : 0;
  }

  /**
   * Sets the width from the diameter and the legend, around the disc, which does not move. The height is what the width was made for.
   * @param {number} [cx] Where the center of the disc is; by default where the old width and left put it (the old width is the disc and the old legend).
   */
  fit(cx = discCenterX(this.left, this.height, this.width - this.height, cleanSide(this.side))) {
    const d = this.height, footprint = this._footprint();
    this.set({ width: d + footprint, left: boxLeft(cx, d, footprint, cleanSide(this.side)) });
  }

  /** Sets the legend (cleaned: one line, 60 characters at most) and the width that goes with it. @param {unknown} text */
  setLegend(text) {
    this.set('label', cleanLegend(text));
    this.fit();
  }

  /** Puts the legend on the other side of the disc, which stays. @param {'right' | 'left'} side */
  setSide(side) {
    const d = this.height;
    const cx = discCenterX(this.left, d, this.width - d, cleanSide(this.side));
    this.side = cleanSide(side);
    this.set('left', boxLeft(cx, d, this.width - d, this.side));
  }

  /** Sets the diameter of the disc, which keeps its center. @param {number} d */
  resize(d) {
    const old = this.height, cx = discCenterX(this.left, old, this.width - old, cleanSide(this.side)), cy = this.top + old / 2;
    this.set({ height: d, top: cy - d / 2 });
    this.fit(cx);
  }

  /** After a resize with the mouse: the scale becomes the size (the disc stays a circle: the mean of both scales), around the disc. */
  bakeScale() {
    const side = cleanSide(this.side);
    const w = this.width * this.scaleX, h = this.height * this.scaleY, discW = this.height * this.scaleX;
    const cx = side === 'left' ? this.left + w - discW / 2 : this.left + discW / 2, cy = this.top + h / 2;
    const d = Math.max(1, Math.round(this.height * Math.sqrt(this.scaleX * this.scaleY)));
    this.set({ height: d, scaleX: 1, scaleY: 1, top: cy - d / 2 });
    this.fit(cx);
  }

  /**
   * The disc and the pill in the document, for a marker that is not being resized. `slot` is where the legend is, or would be (a pill
   * with room for `minText` px of text) when there is none yet: the place of the field in which it is typed.
   * @param {number} [minText]
   */
  parts(minText = 0) {
    const d = this.height, r = d / 2, side = cleanSide(this.side);
    const pill = this._legend();
    const cx = discCenterX(this.left, d, pill ? pill.gap + pill.width : 0, side), cy = this.top + r;
    const box = pill ?? { ...legendBox(d, minText), font: '', textWidth: minText };
    const w = pill ? pill.width : box.width;
    const x = side === 'left' ? cx - r - box.gap - w : cx + r + box.gap;
    return { disc: { cx, cy, r }, pill: pill && { x, y: cy - pill.height / 2, w, h: pill.height, padX: pill.padX, font: pill.font }, slot: { x, y: cy - box.height / 2, w, h: box.height, padX: box.padX, font: `600 ${legendFontSize(d)}px Arial, Helvetica, sans-serif`, gap: box.gap } };
  }

  /** What a point of the document is on: the number ('n'), the legend ('label') or nothing. @param {{ x: number, y: number }} p @returns {'n' | 'label' | null} */
  partAt(p) {
    const { disc, pill } = this.parts();
    if (Math.hypot(p.x - disc.cx, p.y - disc.cy) <= disc.r) return 'n';
    if (pill && p.x >= pill.x && p.x <= pill.x + pill.w && p.y >= pill.y && p.y <= pill.y + pill.h) return 'label';
    return null;
  }

  _render(ctx) {
    // Drawn in the space of the object, which Fabric has centered and scaled: a resize in progress scales the number with the disc.
    const d = this.height, r = d / 2, ink = markerInk(this.fill), side = cleanSide(this.side);
    const cx = side === 'left' ? this.width / 2 - r : -this.width / 2 + r; // the disc is at one end of the box, the legend at the other
    const fill = typeof this.fill === 'string' ? this.fill : '#e53935';
    const ring = Math.max(1.5, d * 0.06);
    const pill = this._legend();
    if (pill) {
      const x = side === 'left' ? cx - r - pill.gap - pill.width : cx + r + pill.gap;
      ctx.beginPath();
      ctx.roundRect(x, -pill.height / 2, pill.width, pill.height, pill.height / 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(x + ring / 2, -pill.height / 2 + ring / 2, pill.width - ring, pill.height - ring, (pill.height - ring) / 2);
      ctx.lineWidth = ring;
      ctx.strokeStyle = ink;
      ctx.stroke();
      if (this.editing !== 'label') {
        ctx.fillStyle = ink;
        ctx.font = pill.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.label, x + pill.padX, 0);
      }
    }
    ctx.beginPath();
    ctx.arc(cx, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, 0, r - ring / 2, 0, Math.PI * 2);
    ctx.lineWidth = ring;
    ctx.strokeStyle = ink;
    ctx.stroke();
    if (this.editing === 'n') return;
    const size = markerFontSize(d, this.n);
    ctx.fillStyle = ink;
    ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(this.n), cx, size * 0.36); // the digits are about 0.72 em tall: the baseline is 0.36 em below the middle
  }
}

// Highlighter: a movable / resizable rectangle whose color is MULTIPLIED with the image under it, as a highlighter pen does: dark
// text stays dark, the white of the page takes the color. The blend is the object's own (globalCompositeOperation), so the editor, the
// exports and the thumbnails all draw it the same way. On a dark background a multiplied color hardly shows: that is a pen's way too.
// It is never fully opaque (HIGHLIGHT_OPACITY): whatever its color, the image under it stays readable. A highlighter saved before
// that was a light color at full strength, and keeps its own opacity (the JSON says 1).
export class Highlight extends Rect {
  static type = 'Highlight';

  constructor(options) {
    super({ objectCaching: false, fill: DEFAULT_HIGHLIGHT, opacity: HIGHLIGHT_OPACITY, strokeWidth: 0, globalCompositeOperation: 'multiply', lockRotation: true, pts: [], brush: 24, ...options });
    this.setControlVisible('mtr', false);
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'pts', 'brush']);
  }

  // A FREE highlighter is a pen stroke: the points (as fractions of the box, which holds the width of the pen all around) are joined, in
  // one stroke, `brush` px wide. One stroke, so it multiplies once where it crosses itself.
  _render(ctx) {
    if (shapeOf(/** @type {any} */ (this)) !== 'free') { super._render(ctx); return; }
    ctx.beginPath();
    tracePoly(ctx, this.pts, this.width, this.height, false);
    ctx.lineWidth = this.brush;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = typeof this.fill === 'string' ? this.fill : DEFAULT_HIGHLIGHT;
    ctx.stroke();
  }
}

// Spotlight: dims everything but the area of this rectangle, to draw the eye to it. The object is its bright area (movable, resizable);
// the shade is painted over the WHOLE image, with a hole for it. Several spotlights make one shade with a hole each: the first of
// them paints it for all (a shade per object would dim the hole of the others). The editor sends a new spotlight to the back, so
// that what is drawn after it, and over it, is not dimmed.
// ponytail: the hiding regions (pixelation, blur) read the original image, not the shade: one that is outside the bright area shows
// undimmed pixels in the dimmed part; hide with a solid fill, or draw it before the spotlight, if that matters.
export class Spot extends Rect {
  static type = 'Spot';

  constructor(options) {
    super({ objectCaching: false, fill: 'transparent', strokeWidth: 0, lockRotation: true, pts: [], ...options });
    this.setControlVisible('mtr', false);
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'pts']);
  }

  // It paints outside of its own box: it is not skipped for being off screen (a spotlight whose area was scrolled out of view
  // still dims the rest).
  isOnScreen() {
    return true;
  }

  _render(ctx) {
    const { img } = source;
    const host = this.canvas ?? this.group?.canvas;
    if (!img || !host) return;
    const spots = host.getObjects().filter((o) => o instanceof Spot);
    if (spots[0] !== this) return;
    // The areas are in the document (absolute, even inside a multiple selection); they are drawn in the space of THIS object, which Fabric
    // has already centered and scaled. Each clip is the image without one area (a rectangle, a rounded one or an ellipse): clips add up
    // as an intersection, which is the image without ANY of the areas, so the shade is painted once and an overlap is bright once.
    const c0 = this.getCenterPoint();
    const sx = this.scaleX || 1, sy = this.scaleY || 1;
    const X = (x) => (x - (c0.x - (this.width * sx) / 2)) / sx - this.width / 2;
    const Y = (y) => (y - (c0.y - (this.height * sy) / 2)) / sy - this.height / 2;
    const [ix, iy, iw, ih] = [X(0), Y(0), img.width / sx, img.height / sy];
    ctx.save();
    for (const sp of spots) {
      const c = sp.getCenterPoint(), w = sp.width * sp.scaleX, h = sp.height * sp.scaleY;
      ctx.beginPath();
      ctx.rect(ix, iy, iw, ih);
      if (shapeOf(sp) === 'free') {
        for (let i = 0; i < sp.pts.length; i += 2) {
          const x = X(c.x - w / 2 + sp.pts[i] * w), y = Y(c.y - h / 2 + sp.pts[i + 1] * h);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
      } else {
        tracePath(ctx, X(c.x - w / 2), Y(c.y - h / 2), w / sx, h / sy, ((sp.rx ?? 0) * sp.scaleX) / sx, ((sp.ry ?? 0) * sp.scaleY) / sy);
      }
      ctx.clip('evenodd');
    }
    ctx.fillStyle = SPOT_SHADE;
    ctx.fillRect(ix, iy, iw, ih);
    ctx.restore();
  }
}

// Pixelated region: a movable / resizable rectangle that shows the original image under it in big blocks.
// The content depends on the position, so no Fabric object cache (it would follow the object with the old pixels):
// the pixelated tile is cached here and recomputed only when the area or the block size changes,
// so never during a pan or a zoom.
export class PixelRegion extends Rect {
  static type = 'PixelRegion';

  constructor(options) {
    super({ objectCaching: false, fill: 'transparent', strokeWidth: 0, block: 24, lockRotation: true, pts: [], ...options });
    this.setControlVisible('mtr', false);
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'block', 'pts']);
  }

  _render(ctx) {
    const { img } = source;
    if (!img) return;
    // Area of the document under the object (angle always 0). getCenterPoint gives absolute coordinates,
    // even when the object is moved along with others in a multiple selection (left/top are relative to the group there).
    const sw = this.width * this.scaleX, sh = this.height * this.scaleY;
    const c = this.getCenterPoint();
    const x = c.x - sw / 2, y = c.y - sh / 2;
    const key = `${x}|${y}|${sw}|${sh}|${this.block}`;
    if (this._key !== key) {
      // HTMLCanvasElement and not OffscreenCanvas: measured ~40 ms per frame with several objects, against 0.3 ms.
      const tile = (this._tile ??= document.createElement('canvas'));
      tile.width = Math.max(1, Math.round(sw / this.block));
      tile.height = Math.max(1, Math.round(sh / this.block));
      const g = tile.getContext('2d');
      g.imageSmoothingQuality = 'high'; // averages the pixels of a block instead of sampling a single one
      g.drawImage(img, x, y, sw, sh, 0, 0, tile.width, tile.height);
      this._key = key;
    }
    ctx.imageSmoothingEnabled = false; // enlargement in sharp blocks
    clipped(ctx, this, () => ctx.drawImage(this._tile, -this.width / 2, -this.height / 2, this.width, this.height));
  }
}

// Soft blur: a movable / resizable rectangle that shows the original image under it as a smooth, irreversible blur.
// The area is reduced to one exact mean per block (mask-pure.js: blockAverages), and that small image is enlarged with the
// browser's high quality (bicubic) smoothing: what is drawn depends on the block means only, as for the pixelation.
//
// Two costs, kept apart:
//  - the exact tile ("settle") reads the pixels of the area: a few milliseconds for 800 x 400 px. It is computed when the area
//    or the block changes and the object is at rest, so on opening, after a mouse release, an undo, an export; and kept
//    (never during a pan, a zoom, or a move: those only redraw the small tile);
//  - during a gesture (`live`, set by the editor on the displayed canvas only) the object shows a cheap preview, the area
//    reduced by the browser, so it keeps following the image under it at 60 frames per second without touching a pixel.
// Both are tiny canvases (a pixel per block); the full-size result never exists.
export class BlurRegion extends Rect {
  static type = 'BlurRegion';

  constructor(options) {
    // live (not saved): a gesture is in progress, show the cheap preview
    super({ objectCaching: false, fill: 'transparent', strokeWidth: 0, block: 32, lockRotation: true, live: false, pts: [], ...options });
    this.setControlVisible('mtr', false);
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'block', 'pts']);
  }

  // The part of the image under the object and the grid of blocks cut in it; null if the object misses the image.
  _plan(img) {
    const sw = this.width * this.scaleX, sh = this.height * this.scaleY;
    const c = this.getCenterPoint(); // absolute, even inside a multiple selection (left / top are relative to the group there)
    const area = { x: c.x - sw / 2, y: c.y - sh / 2, w: sw, h: sh };
    const box = regionBox(area, img.width, img.height);
    if (!box) return null;
    return { area, box, ...tilePlan(box.w, box.h, this.block), key: `${box.x}|${box.y}|${box.w}|${box.h}|${this.block}` };
  }

  // ponytail: the exact tile reads the whole area in one getImageData (a blur over a whole 1920 x 16384 full page is 126 MB of RGBA
  // for a moment); read it in bands of rows, one block row at a time, if that peak ever matters.
  /** The exact tile of the current area (a canvas of one pixel per block), computed if the area, the block or the image changed. */
  settle() {
    const { img } = source;
    const plan = img && this._plan(img);
    if (!plan) return null;
    if (this._exactKey !== plan.key || this._exactImg !== img) {
      const { box, cols, rows } = plan;
      // HTMLCanvasElement, as for the pixelation (OffscreenCanvas measured much slower in the render loop).
      const scratch = document.createElement('canvas');
      scratch.width = box.w;
      scratch.height = box.h;
      const g = scratch.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h); // 1:1 on whole pixels: nothing is resampled
      const { data } = g.getImageData(0, 0, box.w, box.h);
      scratch.width = scratch.height = 0; // gives the pixels back now
      const tile = (this._exact ??= document.createElement('canvas'));
      tile.width = cols;
      tile.height = rows;
      tile.getContext('2d').putImageData(new ImageData(blockAverages(data, box.w, box.h, cols, rows), cols, rows), 0, 0);
      this._exactKey = plan.key;
      this._exactImg = img;
    }
    return { canvas: this._exact, ...plan };
  }

  // The cheap preview of a gesture: the browser reduces the area (averaging the pixels of each block) into the same grid.
  _preview(img) {
    const plan = this._plan(img);
    if (!plan) return null;
    const { box, cols, rows } = plan;
    const tile = (this._previewTile ??= document.createElement('canvas'));
    tile.width = cols; // resizing clears it: it is redrawn just below
    tile.height = rows;
    const g = tile.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, cols, rows);
    return { canvas: tile, ...plan };
  }

  _render(ctx) {
    const { img } = source;
    if (!img) return;
    const host = this.canvas ?? this.group?.canvas;
    const shown = this.live && ctx === host?.getContext() ? this._preview(img) : this.settle();
    if (!shown) return;
    const { box, area } = shown;
    // The box (whole pixels, outward) in the space of the object, which Fabric has already scaled and centered.
    const sx = this.scaleX || 1, sy = this.scaleY || 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high'; // bicubic enlargement: no steps between blocks
    clipped(ctx, this, () => ctx.drawImage(shown.canvas, (box.x - area.x) / sx - this.width / 2, (box.y - area.y) / sy - this.height / 2, box.w / sx, box.h / sy));
  }

  dispose() {
    for (const k of ['_exact', '_previewTile']) if (this[k]) this[k].width = this[k].height = 0; // the small canvases go back now
    this._exact = this._previewTile = this._exactKey = this._exactImg = null;
    super.dispose();
  }
}

// A free area drawn by hand, for the outline and the solid fill: a Rect whose box holds a polygon (`pts`, as fractions of the box: it is
// resized with it). Without points it is the rectangle it was, so a free shape that is given another shape (the choice of the style bar)
// becomes a plain rectangle, rounded or an ellipse, drawn by Fabric.
export class Lasso extends Rect {
  static type = 'Lasso';

  constructor(options) {
    super({ objectCaching: false, pts: [], ...options });
  }

  toObject(extra = []) {
    return super.toObject([...extra, 'pts']);
  }

  _render(ctx) {
    if (shapeOf(/** @type {any} */ (this)) !== 'free') { super._render(ctx); return; }
    ctx.beginPath();
    tracePoly(ctx, this.pts, this.width, this.height, true);
    this._renderPaintInOrder(ctx);
  }
}

// A plain rectangle: not one of the rectangles of Obturo that have a meaning of their own.
const isPlainRect = (o) => o instanceof Rect && !(o instanceof PixelRegion) && !(o instanceof BlurRegion) && !(o instanceof Highlight) && !(o instanceof Spot);

// Every rectangle can take a shape (rectangle, rounded, ellipse): the plain ones, the hiding regions, the highlighter and the spotlight.
export const hasShape = (o) => o instanceof Rect;

// Objects whose color is the stroke color: arrow, pen stroke and hollow rectangle (neither a hiding region nor a solid fill).
export const isOutlined = (o) => o instanceof Arrow || o instanceof Path || (isPlainRect(o) && !o.fill);

// A solid fill is a plain rectangle with a color (`fill`) and no object cache; an object saved before the colors existed is
// black, its fill being '#000'. Its color is always opaque (mask-pure.js: solidColor).
export const isSolid = (o) => isPlainRect(o) && !!o.fill;

classRegistry.setClass(Lasso);
classRegistry.setClass(Arrow);
classRegistry.setClass(Emoji);
classRegistry.setClass(Marker);
classRegistry.setClass(Highlight);
classRegistry.setClass(Spot);
classRegistry.setClass(PixelRegion);
classRegistry.setClass(BlurRegion);
