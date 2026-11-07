// Shot editor (Fabric.js). Loaded by a dynamic import() AFTER the first render of the library.
//
// Performance choices (measured, see docs/ARCHITECTURE.md):
//  - the canvas is the size of the SCREEN, never that of the image: zoom and scroll = a view matrix;
//  - the original image is drawn in before:render from an ImageBitmap (not a Fabric object);
//  - renderOnAddRemove = false, everything goes through requestRenderAll (batched per frame);
//  - history and saving = JSON of objects, never pixels; the original is never rewritten.
//
// Layout: this file is the controller (canvas, drawing tools, versions, crop, saving). The controls of
// library.html are in panel.js, the history in history.js, the rendering of images (export, thumbnail)
// in output.js, the Fabric objects specific to Obturo in shapes.js.
import { Canvas, IText, Rect, ActiveSelection, PencilBrush, util } from './vendor/fabric.min.mjs';
import { Arrow, BlurRegion, Emoji, Highlight, Lasso, Marker, PixelRegion, Spot, applyShape, hasShape, source } from './shapes.js';
import { freeGeometry, pathLength, shapeOf, simplify } from './shape-pure.js';
import { autoSide, closeGaps, fitSide, nextMarkerNumber } from './marker-pure.js';
import { editMarker } from './marker-edit.js';
import { stampFontSize, stampText } from './stamp-pure.js';
import { turnedBitmap } from './turn.js';
import { cleanTurn, turnPoint, turnPts, turnRect } from './turn-pure.js';
import { createVersion, deleteVersion, pickVersion, renameVersion, clampCrop, scaleForWidth, capScale, outputSize } from './versions.js';
import { extraOf, layout, normalizeBeautify, styleOf } from './beautify-pure.js';
import { paintBackdrop } from './beautify.js';
import { fitView, clampView, zoomAt, panBy } from './view.js';
import { createSaver } from './saver.js';
import { createHistory } from './history.js';
import { editorSync, renderCanvas, renderPng, renderThumb } from './output.js';
import { getSettings } from './settings.js';
import { clamp } from './pure.js';
import { versionsKey } from './thumb-pure.js';
import { getLanguage, t } from './i18n.js';
import { setAria } from './dom-i18n.js';
import * as panel from './panel.js';

// Evaluated after Fabric (static import above): used to check that it only arrives AFTER the first render of the strip.
performance.mark('obturo:editor-loaded');

const MIN_DRAG_PX = 6; // a shorter drag (in screen px) is a simple click: nothing is drawn
const FREE_STEP_PX = 2; // a free path takes a point every 2 screen px at least
const FREE_TOLERANCE_PX = 1.5; // and is simplified to what a line drawn within 1.5 screen px of it replaces
const PEN_DIVISOR = 60; // a free highlighter is a pen of 1 / 60 of the width of the image, at least 12 px
const MIN_AREA_PX = 3; // a free area narrower than this (in image px) is a line: nothing is drawn
const WHEEL_ZOOM_RATE = 0.0015; // Ctrl + wheel: the zoom is exp(-delta * rate)
const CROP_SHADE = 'rgba(0,0,0,.55)'; // what is outside the crop
const SCALE_RANGE = { min: 0.01, max: 10 }; // output scale as typed: 1 % to 1000 %
const MIN_FONT = 6; // a text or an emoji shrunk with the mouse stops here

/**
 * @param {object} options
 * @param {HTMLElement} options.stage Container of the canvas.
 * @param {(id: number, patch: Partial<import('./db.js').Shot>) => Promise<boolean>} options.onSave Writes `patch` = { versions, active };
 *   `false` = the shot no longer exists.
 * @param {(id: number, thumb: Blob, key: string) => Promise<unknown>} [options.onThumb] Writes the thumbnail of what was just saved
 *   (`key`: versionsKey of that state, which the database checks before it writes).
 * @param {() => void} [options.onGone] The shot no longer exists.
 * @param {(shot: import('./db.js').Shot) => void} [options.onVersions] The number of versions changed.
 * @param {(key: string, vars?: Record<string, string | number>) => void} [options.onError] Message to display: a key of
 *   the dictionaries, so that the banner follows the language.
 */
export function createEditor({ stage, onSave, onThumb, onGone, onVersions, onError }) {
  let holder, backdrop, canvas, bitmap, raw, original, shot, W = 0, H = 0;
  let tool = 'select', view = { z: 1, tx: 0, ty: 0 }, fitMode = true;
  let ticket = 0, loadSeq = 0, cropBox = null, drawing = null, frameTurn = 0;
  let pressed = false; // the mouse button is down on the canvas: a gesture is in progress
  /** @type {{ close: (keep?: boolean) => void, place: () => void } | null} */
  let markerEdit = null; // the field in which the number or the legend of a marker is typed, on top of it (marker-edit.js)
  /** @type {Marker | null} */
  let markerEditTarget = null;
  let chain = Promise.resolve(); // open / close run one at a time: two clicks in quick succession do not trample each other
  const history = createHistory();

  const cur = () => shot?.versions[shot.active];
  const ready = () => !!(shot && canvas); // false while a shot is opening or closing
  const selected = () => { const o = canvas?.getActiveObject(); return o && !o.isCrop ? o : null; };
  const warn = (key, vars) => onError?.(key, vars);
  const serial = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

  // Before changing state: abandons a crop in progress and validates a text being edited (which is then committed
  // into the version that is still displayed).
  function endPendingEdit() {
    closeMarkerEdit(true);
    exitCrop(false);
    canvas.discardActiveObject();
  }

  // ---------- rendering ----------

  // Background: the original image, with the current view matrix. Also used by the export (which replaces the matrix).
  // A render that is already scheduled can land during closing: canvas and bitmap are then null.
  function drawBase({ ctx }) {
    if (!canvas || !bitmap) return;
    const v = canvas.viewportTransform;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();
  }

  const cropNow = () => cropBox
    ? { x: cropBox.left, y: cropBox.top, w: cropBox.width * cropBox.scaleX, h: cropBox.height * cropBox.scaleY }
    : cur()?.crop;

  // Darkens what is outside the crop. Only on the displayed canvas: never in the export.
  function drawCrop({ ctx }) {
    if (!canvas) return;
    const r = cropNow();
    if (!r || ctx !== canvas.getContext() || lookOf()) return; // with a look, what is outside the crop is not shown at all
    const v = canvas.viewportTransform;
    const x = r.x * v[0] + v[4], y = r.y * v[3] + v[5], w = r.w * v[0], h = r.h * v[3];
    ctx.save();
    ctx.fillStyle = CROP_SHADE;
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  // The look of the displayed version, while the stage shows it: the capture (the crop, or the whole image), the look and the part of
  // the document that the view keeps in sight (the capture and the look around it, in document px: the look is in output px).
  // null when the version has none, and while a crop is edited (the whole image shows then).
  function lookOf() {
    const v = ready() && !cropBox ? cur() : null;
    const style = styleOf(v);
    if (!v || !style) return null;
    const area = v.crop ?? { x: 0, y: 0, w: W, h: H };
    const { pad, bar } = extraOf(style);
    const padding = pad / v.scale, header = bar / v.scale;
    return { style, area, scale: v.scale, box: { x: area.x - padding, y: area.y - header - padding, w: area.w + 2 * padding, h: area.h + header + 2 * padding } };
  }

  // The look is drawn BEHIND the canvas, by the code that draws it in the exports, from the same geometry at the scale of the view; the
  // canvas is clipped to the capture, with the rounded corners of the window. Nothing of the capture moves, so the pointer
  // coordinates, the zoom, the pan and the objects are the ones they always were.
  function paintLook() {
    if (!backdrop || !canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.width, h = canvas.height;
    if (backdrop.width !== Math.round(w * ratio) || backdrop.height !== Math.round(h * ratio)) {
      backdrop.width = Math.round(w * ratio);
      backdrop.height = Math.round(h * ratio);
    }
    const ctx = /** @type {CanvasRenderingContext2D} */ (backdrop.getContext('2d'));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backdrop.width, backdrop.height);
    const look = lookOf();
    if (!look) {
      canvas.lowerCanvasEl.style.clipPath = '';
      return;
    }
    const cap = { x: view.tx + look.area.x * view.z, y: view.ty + look.area.y * view.z, w: look.area.w * view.z, h: look.area.h * view.z };
    const l = layout(cap.w, cap.h, look.style, view.z / look.scale); // output px -> screen px
    ctx.setTransform(ratio, 0, 0, ratio, (cap.x - l.shot.x) * ratio, (cap.y - l.shot.y) * ratio);
    paintBackdrop(ctx, l, look.style);
    const top = l.bar ? 0 : l.radius; // under a bar the capture starts square
    canvas.lowerCanvasEl.style.clipPath = `inset(${cap.y}px ${w - cap.x - cap.w}px ${h - cap.y - cap.h}px ${cap.x}px round ${top}px ${top}px ${l.radius}px ${l.radius}px)`;
  }

  function setView(v) {
    view = v;
    markerEdit?.place(); // the field of a marker follows the zoom and the pan
    canvas.setViewportTransform([v.z, 0, 0, v.z, v.tx, v.ty]);
    paintLook();
    canvas.requestRenderAll();
    panel.showZoom(v.z);
  }

  const viewBox = () => lookOf()?.box;
  const refit = () => { fitMode = true; setView(fitView(canvas.width, canvas.height, W, H, viewBox())); };

  // The look, the crop or the scale changed: so did the part of the image that must stay in sight, and the look to draw.
  function relayoutLook() {
    if (!canvas) return;
    setView(fitMode ? fitView(canvas.width, canvas.height, W, H, viewBox()) : clampView(view, canvas.width, canvas.height, W, H, viewBox()));
  }

  function actualSize() {
    if (!canvas) return;
    fitMode = false;
    setView(zoomAt(view, 1 / view.z, canvas.width / 2, canvas.height / 2, canvas.width, canvas.height, W, H, viewBox()));
  }

  function onWheel({ e }) {
    if (!canvas) return;
    e.preventDefault();
    e.stopPropagation();
    fitMode = false;
    const { width: cw, height: ch } = canvas;
    if (e.ctrlKey || e.metaKey) setView(zoomAt(view, Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), e.offsetX, e.offsetY, cw, ch, W, H, viewBox()));
    else setView(panBy(view, e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY, cw, ch, W, H, viewBox()));
  }

  // ---------- objects ----------

  const adopt = (o) => o.set({
    cornerSize: 11, cornerStyle: 'circle', transparentCorners: false, cornerColor: '#fff',
    cornerStrokeColor: '#2563eb', borderColor: '#2563eb', borderScaleFactor: 2, touchCornerSize: 28,
  });

  // canvas.toObject() normalizes the objects of a multiple selection (absolute coordinates); the crop box is excluded.
  // objectCaching is not serialized by default: without it the flat read back from the JSON would get its cache back,
  // and its blurry edges.
  const objects = () => canvas.toObject(['objectCaching', 'stamp']).objects;

  // After a resize: the scale is baked into the size (for text: the font size) so nothing is stretched.
  function bake(o) {
    if (o instanceof ActiveSelection) return;
    if (o instanceof IText) o.set({ fontSize: Math.max(MIN_FONT, Math.round(o.fontSize * o.scaleY)), scaleX: 1, scaleY: 1 });
    else if (o instanceof Marker) o.bakeScale(); // a disc stays a disc: the diameter follows the scale (the mean of both, if shift made them differ), the legend follows
    else if (o instanceof Rect) { // the shape is kept: its corner radii follow the new size
      const shape = shapeOf(o);
      o.set({ width: o.width * o.scaleX, height: o.height * o.scaleY, scaleX: 1, scaleY: 1 });
      applyShape(o, shape);
    }
    o.setCoords();
  }

  function make(t, p) {
    const base = { left: p.x, top: p.y, width: 0, height: 0 };
    const free = panel.shape(t) === 'free'; // drawn by hand: the points come with the mouse (freeDraw)
    if (t === 'rect') return new (free ? Lasso : Rect)({ ...base, fill: '', stroke: panel.color(), strokeWidth: panel.strokeWidth(W), strokeUniform: true });
    // No object cache for the solid fill: its cached bitmap is resampled when zooming and lets up to 83/255 of the image
    // underneath show through on pixels that are nevertheless 100 % covered. A fill is there to hide: it must be exact.
    // Its color is the one of the panel (black by default), always opaque.
    if (t === 'flat') return new (free ? Lasso : Rect)({ ...base, fill: panel.fillColor(), strokeWidth: 0, objectCaching: false, opacity: 1 });
    if (t === 'highlight') return new Highlight({ ...base, fill: panel.highlightPick(), brush: Math.max(12, Math.round(W / PEN_DIVISOR)) });
    if (t === 'spot') return new Spot(base);
    if (t === 'pixel') return new PixelRegion({ ...base, block: panel.pixelBlock() });
    if (t === 'blur') return new BlurRegion({ ...base, block: panel.blurBlock(), live: true }); // live: a cheap preview until the mouse is released
    return new Arrow({ ...base, stroke: panel.color(), strokeWidth: panel.strokeWidth(W), ends: panel.arrowEnds() });
  }

  // The box and the points of a free shape follow the path drawn so far (a pen stroke has the width of the pen all around it).
  function freeDraw(obj, path) {
    const { left, top, width, height, pts } = freeGeometry(path, obj instanceof Highlight ? obj.brush / 2 : 0);
    obj.set({ left, top, width, height, pts });
  }

  function addText(p) {
    const text = new IText(t('editor.text'), { left: p.x, top: p.y, ...panel.textStyle() });
    adopt(text);
    canvas.add(text);
    canvas.setActiveObject(text);
    setTool('select');
    text.enterEditing();
    text.selectAll();
    canvas.requestRenderAll();
  }

  // A click places the emoji of the style bar, centered on the point; the tool stays armed for the next one.
  function addEmoji(p) {
    const emoji = new Emoji(panel.emoji(), { fontSize: panel.emojiSize(W), fill: panel.color() });
    emoji.set({ left: p.x - emoji.width / 2, top: p.y - emoji.height / 2 });
    adopt(emoji);
    canvas.add(emoji);
    canvas.requestRenderAll();
    commit();
  }

  // The address of the page and the date of the capture, as a text at the bottom left of the image (or of the crop): a text like any other.
  // One per version: a second press selects it. With Hide sensitive text on, the query of the address (tokens, e-mails) stays out of it.
  async function addStamp() {
    if (!ready()) return;
    const { redactSensitive } = await getSettings().catch(() => ({ redactSensitive: true }));
    if (!ready()) return;
    setTool('select');
    const known = canvas.getObjects().find((o) => o.stamp);
    if (known) {
      canvas.setActiveObject(known);
      reveal(known);
      canvas.requestRenderAll();
      return;
    }
    ensureVersion();
    const area = cur().crop ?? { x: 0, y: 0, w: W, h: H };
    const when = new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }).format(shot.createdAt);
    const text = new IText(stampText(shot.url, when, { query: !redactSensitive }), { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 100, fill: '#000000', backgroundColor: '#ffffff', stamp: true });
    const fontSize = stampFontSize(area.w, text.width / 100);
    const margin = Math.round(fontSize * 0.6);
    text.set({ fontSize });
    text.set({ left: area.x + margin, top: area.y + area.h - text.height - margin });
    adopt(text);
    canvas.add(text);
    canvas.setActiveObject(text);
    reveal(text);
    canvas.requestRenderAll();
    commit();
  }

  // Pans the view so that an object placed out of sight shows (the stamp, at the bottom of a very tall capture, or off to the side of a zoomed one).
  function reveal(o) {
    const left = view.tx + o.left * view.z, right = left + o.width * (o.scaleX || 1) * view.z;
    const top = view.ty + o.top * view.z, bottom = top + o.height * (o.scaleY || 1) * view.z;
    const dx = right > canvas.width ? canvas.width - 16 - right : left < 0 ? 16 - left : 0;
    const dy = bottom > canvas.height ? canvas.height - 16 - bottom : top < 0 ? 16 - top : 0;
    if (!dx && !dy) return;
    fitMode = false;
    setView(panBy(view, dx, dy, canvas.width, canvas.height, W, H, viewBox()));
  }

  // A pen stroke is over (Fabric drew it): it becomes an object of the version, with the width kept as it is when it is resized.
  function onPath({ path }) {
    if (!canvas) return;
    path.set({ strokeUniform: true, objectCaching: false });
    adopt(path);
    ensureVersion();
    canvas.requestRenderAll();
    commit();
  }

  // Objects that leave the canvas: a blurred region gives its small canvases back now, not at the next garbage collection.
  function drop(objs) {
    canvas.remove(...objs);
    for (const o of objs) if (o instanceof BlurRegion) o.dispose();
  }

  // A click places the next marker, centered on the point, and the tool stays: the steps are placed one click after the other.
  // The new marker is selected and a field is open on its legend, on the image: a text typed now is its legend, and a click elsewhere on the
  // image places the next step (the field is then simply left empty).
  function addMarker(p) {
    const d = panel.markerSize(W);
    const n = nextMarkerNumber(canvas.getObjects().filter((o) => o instanceof Marker).map((o) => o.n));
    const marker = new Marker({ left: p.x - d / 2, top: p.y - d / 2, width: d, height: d, fill: panel.color(), n });
    adopt(marker);
    canvas.add(marker);
    canvas.setActiveObject(marker);
    canvas.requestRenderAll();
    commit();
    openMarkerEdit(marker, 'label');
  }

  // Types the number or the legend of a marker in a field on top of it (marker-edit.js). The marker changes as it is typed, quietly (a save,
  // no step of the history); when the field closes the history gets one step if the text changed, and a legend that nobody placed and that
  // leaves the image on the right goes to the left of the disc.
  function openMarkerEdit(marker, part) {
    closeMarkerEdit(true);
    if (!canvas || !canvas.getObjects().includes(marker)) return;
    if (selected() !== marker) canvas.setActiveObject(marker);
    markerEditTarget = marker;
    markerEdit = editMarker({
      host: holder, marker, part, view: () => view,
      onLive: () => {
        canvas.requestRenderAll();
        if (cur()) { cur().objects = objects(); saver.schedule(); }
      },
      onDone: (changed) => {
        markerEdit = markerEditTarget = null;
        if (!canvas) return;
        const side = marker.side;
        if (part === 'label' && marker.sideAuto && marker.label) marker.setSide(autoSide(marker.parts().disc.cx, marker.height, marker.width - marker.height, W));
        marker.setCoords();
        canvas.requestRenderAll();
        if (changed || marker.side !== side) commit();
        else if (cur()) { cur().objects = objects(); saver.schedule(); } // (what was typed and put back is saved as it is again)
      },
      onUndo: (delta) => step(delta),
    });
  }

  function closeMarkerEdit(keep = true) {
    markerEdit?.close(keep);
  }

  async function loadObjects(arr) {
    const mine = ++loadSeq;
    const objs = await util.enlivenObjects(JSON.parse(JSON.stringify(arr))); // copy: enliven must not touch the model
    if (mine !== loadSeq || !canvas) return;
    canvas.discardActiveObject();
    drop(canvas.getObjects());
    objs.forEach(adopt);
    canvas.add(...objs);
    canvas.requestRenderAll();
  }

  // ---------- turn ----------

  function labelCanvas() {
    setAria(canvas.upperCanvasEl, 'editor.canvas', { title: shot.title || t('editor.untitled'), w: W, h: H });
  }

  // The image of the displayed version is the original turned as many quarter turns as the version says; the size of the document follows it.
  function installFrame(next, quarter) {
    if (bitmap !== raw) bitmap.close();
    bitmap = next;
    frameTurn = quarter;
    source.img = next;
    W = next.width;
    H = next.height;
    labelCanvas();
  }

  async function setFrame(turn) {
    const quarter = cleanTurn(turn), base = raw;
    if (!base || quarter === frameTurn) return;
    const next = await turnedBitmap(base, quarter);
    if (raw !== base || quarter !== cleanTurn(cur()?.turn)) { // the shot was closed, or another version shown, while it was drawn
      if (next !== base) next.close();
      return;
    }
    installFrame(next, quarter);
  }

  // An object after a quarter turn clockwise of an image `h` px high. A rectangle that is not tilted (an outline, a solid fill, a free area,
  // a hiding region, the highlighter, the spotlight) stays upright: its box turns. A marker stays upright too, its disc goes where the turn
  // takes it. Anything else turns with the image.
  function turnObject(o, h) {
    const to = turnPoint(o.getCenterPoint().x, o.getCenterPoint().y, h);
    if (o instanceof Marker) {
      const { disc } = o.parts();
      const c = turnPoint(disc.cx, disc.cy, h);
      o.set({ top: c.y - o.height / 2 });
      o.fit(c.x);
      if (o.sideAuto && o.label) o.setSide(autoSide(c.x, o.height, o.width - o.height, h));
    } else if (o instanceof Rect && !o.angle) {
      o.set({ width: o.height, height: o.width, rx: o.ry, ry: o.rx });
      if (o.pts) o.set({ pts: turnPts(o.pts) });
      o.setPositionByOrigin(to, 'center', 'center');
    } else {
      o.set({ angle: ((o.angle || 0) + 90) % 360 });
      o.setPositionByOrigin(to, 'center', 'center');
    }
    o.setCoords();
  }

  // A quarter turn clockwise of the whole capture: the image, the crop and what is drawn on it, which keeps its place on it. What the person
  // was doing stays: the zoom (the middle of the view turns with the image), the selected object, a crop box that is not applied yet.
  async function rotate() {
    if (!ready()) return;
    const picked = selected();
    const box = cropBox && { x: cropBox.left, y: cropBox.top, w: cropBox.width * cropBox.scaleX, h: cropBox.height * cropBox.scaleY };
    endPendingEdit();
    ensureVersion();
    const v = cur(), base = raw, quarter = (cleanTurn(v.turn) + 1) % 4;
    const next = await turnedBitmap(base, quarter);
    if (raw !== base || cur() !== v) {
      if (next !== base) next.close();
      return;
    }
    const h = H;
    const middle = fitMode ? null : turnPoint((canvas.width / 2 - view.tx) / view.z, (canvas.height / 2 - view.ty) / view.z, h);
    for (const o of canvas.getObjects()) { bake(o); turnObject(o, h); }
    v.crop = turnRect(v.crop, h);
    v.turn = quarter;
    installFrame(next, quarter);
    if (middle) setView(clampView({ z: view.z, tx: canvas.width / 2 - middle.x * view.z, ty: canvas.height / 2 - middle.y * view.z }, canvas.width, canvas.height, W, H, viewBox()));
    else refit();
    syncOutput();
    syncPanel();
    commit();
    if (box) enterCrop(turnRect(box, h));
    else if (picked && canvas.getObjects().includes(picked)) canvas.setActiveObject(picked);
  }

  function deleteSelection() {
    const objs = canvas?.getActiveObjects().filter((o) => !o.isCrop) ?? [];
    if (!objs.length) return;
    canvas.discardActiveObject();
    drop(objs);
    const removed = objs.filter((o) => o instanceof Marker).map((o) => o.n);
    if (removed.length) { // the steps that follow come down: 1, 2, 3 again
      const markers = canvas.getObjects().filter((o) => o instanceof Marker);
      const numbers = closeGaps(markers.map((m) => m.n), removed);
      markers.forEach((m, i) => m.set({ n: numbers[i], dirty: true }));
    }
    canvas.requestRenderAll();
    commit();
  }

  // ---------- mouse ----------

  const pt = (o) => canvas.getScenePoint(o.e);

  function onDown(o) {
    if (!ready() || tool === 'select' || tool === 'pen' || cropBox) return; // the pen is Fabric's own drawing mode
    const p = pt(o);
    if (tool === 'text') { drawing = { start: p, text: true }; return; }
    if (tool === 'marker') { drawing = { start: p, marker: true }; return; }
    if (tool === 'emoji') { drawing = { start: p, emoji: true }; return; }
    const obj = make(tool, p); // the version is only created at the end of the gesture, if the object really exists
    canvas.add(obj);
    drawing = { obj, start: p, path: panel.shape(tool) === 'free' && hasShape(obj) ? [[p.x, p.y]] : null };
  }

  function onMove(o) {
    if (!canvas || !drawing?.obj) return;
    const { obj, start: s, path } = drawing, p = pt(o);
    if (path) { // a free shape: a point every few pixels, the box grows with the path
      const [lx, ly] = path[path.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * view.z < FREE_STEP_PX) return;
      path.push([p.x, p.y]);
      freeDraw(obj, path);
      canvas.requestRenderAll();
      return;
    }
    const box = { left: Math.min(s.x, p.x), top: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) };
    obj.set(tool === 'arrow' ? { ...box, flipX: p.x < s.x, flipY: p.y < s.y } : box);
    if (hasShape(obj)) applyShape(obj, panel.shape(tool));
    canvas.requestRenderAll();
  }

  // A gesture is over (mouse released, slider let go): the blurred regions compute their exact blur at the next frame, once.
  function release() {
    if (!canvas) return;
    const live = canvas.getObjects().filter((o) => o instanceof BlurRegion && o.live);
    for (const o of live) o.live = false;
    if (live.length) canvas.requestRenderAll();
  }

  // While a blurred region is moved or resized it shows a cheap preview (see BlurRegion): only the release recomputes it.
  const setLive = (target) => { for (const o of target?.getObjects?.() ?? [target]) if (o instanceof BlurRegion) o.live = true; };

  function onUp(o) {
    pressed = false;
    release();
    if (!drawing || !canvas) return;
    const { obj, start: s, text, marker, emoji, path } = drawing;
    drawing = null;
    if (text) { ensureVersion(); addText(s); return; }
    if (marker) { ensureVersion(); addMarker(s); return; }
    if (emoji) { ensureVersion(); addEmoji(s); return; }
    let tooSmall;
    if (path) { // a free shape: simplified, and it needs some length (and, for an area, some width and height)
      const kept = simplify(path, Math.max(0.5, FREE_TOLERANCE_PX / view.z));
      if (kept.length >= 2) freeDraw(obj, kept);
      tooSmall = kept.length < 2 || pathLength(kept) * view.z < MIN_DRAG_PX || (!(obj instanceof Highlight) && Math.min(obj.width, obj.height) < MIN_AREA_PX);
    } else {
      tooSmall = Math.hypot(pt(o).x - s.x, pt(o).y - s.y) * view.z < MIN_DRAG_PX;
    }
    if (tooSmall) { // simple click: nothing drawn, no version created
      drop([obj]);
      canvas.requestRenderAll();
      return;
    }
    obj.setCoords();
    adopt(obj);
    ensureVersion(); // first object really added: V1 is born here (and protects the shot from eviction)
    if (obj instanceof Spot) canvas.sendObjectToBack(obj); // under the annotations: the shade must not dim them
    commit(); // the tool stays armed for the next one, until Escape or a click on Select
  }

  // ---------- tools and settings ----------

  const syncPanel = () => panel.showSelection(selected(), tool);

  // The pen is the drawing mode of Fabric, which takes the mouse itself; a crop in progress keeps it.
  const syncDrawingMode = () => { if (canvas) canvas.isDrawingMode = tool === 'pen' && !cropBox; };

  function setTool(t) {
    closeMarkerEdit(true);
    tool = t;
    panel.showTool(t);
    if (canvas) {
      syncDrawingMode();
      const sel = t === 'select';
      canvas.skipTargetFind = !sel;
      canvas.selection = sel;
      canvas.defaultCursor = sel ? 'default' : 'crosshair';
      if (!sel) canvas.discardActiveObject();
      canvas.requestRenderAll();
    }
    syncPanel();
  }

  // Applies `fn` to the selected object (the panel is also the default setting for the next objects).
  function restyle(fn) {
    const o = selected();
    if (!o) return false;
    fn(o);
    o.setCoords();
    canvas.requestRenderAll();
    return true;
  }

  // ---------- versions, history, saving ----------

  const apply = (s) => { shot.versions = s.versions; shot.active = s.active; };

  // Output size: capped (16,384 px per side, 100 million pixels), beyond that the browser can no longer export.
  function syncOutput() {
    const v = cur();
    let capped = false;
    if (v) {
      const area = v.crop ?? { w: W, h: H };
      const r = capScale(area.w, area.h, v.scale, styleOf(v));
      v.scale = r.scale;
      capped = r.capped;
    }
    panel.showOutput(v, W, H, capped);
    relayoutLook();
  }

  const snapshot = () => {
    const v = cur();
    return JSON.stringify([v.objects, v.crop, v.scale, v.beautify ?? null, cleanTurn(v.turn)]);
  };
  const syncHistory = () => panel.showHistory(history);

  function pushHistory() {
    history.push(snapshot());
    syncHistory();
  }

  function resetHistory() {
    history.reset(cur() ? snapshot() : undefined);
    syncHistory();
  }

  // End of a user action: the model follows the canvas, one history step, deferred saving.
  function commit() {
    const v = cur();
    if (!v || !canvas) return;
    v.objects = objects();
    pushHistory();
    saver.schedule();
  }

  // Adds a version (copy of the displayed state, or blank from the original) and shows it.
  function addVersion() {
    apply(createVersion(shot));
    panel.showVersions(shot);
    resetHistory();
    syncOutput();
    onVersions?.(shot);
    saver.schedule();
  }

  // The first modification of the original creates V1: the original stays intact.
  function ensureVersion() {
    if (shot.active >= 0) return;
    addVersion();
  }

  function newVersion() {
    endPendingEdit();
    addVersion();
  }

  async function show(i, save = true) {
    endPendingEdit();
    apply(pickVersion(shot, i));
    panel.showVersions(shot);
    await setFrame(cur()?.turn);
    await loadObjects(cur()?.objects ?? []);
    resetHistory();
    syncOutput();
    syncPanel();
    if (save) saver.schedule();
  }

  // The side of the text of a marker, chosen by hand: a side that would leave the image is not given while the other one fits.
  function setMarkerSide(side) {
    const marker = selected();
    if (!(marker instanceof Marker)) return;
    marker.setSide(fitSide(side, marker.parts().disc.cx, marker.height, marker.width - marker.height, W));
    marker.sideAuto = false;
    marker.setCoords();
    canvas.requestRenderAll();
    syncPanel();
    commit();
  }

  function nameVersion(i, name) {
    if (!ready() || !shot.versions[i]) return;
    apply(renameVersion(shot, i, name));
    panel.showVersions(shot);
    onVersions?.(shot);
    saver.schedule();
  }

  async function removeVersion() {
    if (shot.active < 0) return;
    const { confirmDialog } = await import('./history-dialogs.js'); // the same dialog as the history and the strip
    if (!(await confirmDialog({ title: t('ver.confirmDelete', { name: cur().name }), ok: t('hist.del.ok') }))) return;
    if (!ready()) return; // the shot was closed while the dialog was open
    // A text being edited is validated HERE, while the version to delete is still the active one:
    // otherwise its content would be written into the remaining version.
    endPendingEdit();
    apply(deleteVersion(shot, shot.active));
    await show(shot.active, false);
    onVersions?.(shot);
    saver.schedule();
  }

  async function step(delta) {
    endPendingEdit();
    const snap = cur() && history.step(delta);
    if (!snap) return;
    const [objs, crop, scale, beautify, turn = 0] = JSON.parse(snap);
    Object.assign(cur(), { objects: objs, crop, scale, beautify, turn });
    await setFrame(turn);
    await loadObjects(objs);
    syncOutput();
    syncHistory();
    saver.schedule();
  }

  function setScale(scale) {
    ensureVersion();
    cur().scale = clamp(scale || 1, SCALE_RANGE.min, SCALE_RANGE.max);
    syncOutput();
    commit();
  }

  function setOutputWidth(px) {
    const target = px || W;
    ensureVersion();
    cur().scale = scaleForWidth(cur().crop?.w ?? W, target);
    syncOutput();
    commit();
  }

  // The beautify look of the displayed version, null to turn it off. Like any other change, the first one to an original creates V1.
  // Not `final`: a control of the panel is still moving, the stage follows and nothing is kept yet.
  function setBeautify(style, final = true) {
    ensureVersion();
    cur().beautify = normalizeBeautify(style);
    syncOutput();
    if (final) commit();
  }

  // ---------- crop ----------

  function enterCrop(rect) {
    if (!shot || cropBox) return;
    setTool('select');
    canvas.discardActiveObject();
    const r = rect ?? cur()?.crop ?? { x: 0, y: 0, w: W, h: H };
    cropBox = new Rect({ left: r.x, top: r.y, width: r.w, height: r.h, fill: 'rgba(0,0,0,0)', strokeWidth: 0, lockRotation: true });
    cropBox.isCrop = cropBox.excludeFromExport = true;
    adopt(cropBox);
    cropBox.setControlVisible('mtr', false);
    for (const o of canvas.getObjects()) o.set({ selectable: false, evented: false });
    canvas.add(cropBox);
    canvas.setActiveObject(cropBox);
    relayoutLook(); // the whole image shows while the crop is edited
    panel.showCropButtons(true);
    canvas.requestRenderAll();
  }

  function exitCrop(ok) {
    if (!cropBox) return;
    const r = { x: cropBox.left, y: cropBox.top, w: cropBox.width * cropBox.scaleX, h: cropBox.height * cropBox.scaleY };
    canvas.discardActiveObject();
    canvas.remove(cropBox);
    cropBox = null;
    for (const o of canvas.getObjects()) o.set({ selectable: true, evented: true });
    panel.showCropButtons(false);
    syncDrawingMode();
    if (ok) {
      ensureVersion();
      cur().crop = clampCrop(r, W, H);
      syncOutput();
      commit();
    } else {
      relayoutLook();
    }
    canvas.requestRenderAll();
  }

  function clearCrop() {
    if (!cur()?.crop) return;
    cur().crop = null;
    syncOutput();
    commit();
    canvas.requestRenderAll();
  }

  // ---------- export, copy, saving ----------

  async function renderBlob() {
    const v = cur();
    if (!v) return original; // the original is exported as is, without re-encoding
    endPendingEdit();
    return renderPng(canvas, v, W, H);
  }

  async function copyImage() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderBlob() })]);
      panel.flashCopy('act.copied');
    } catch (e) {
      console.error('Obturo: copy failed', e);
      panel.flashCopy('act.copyFailed');
    }
  }

  // ---------- download ----------
  // The format menu, the encoders and the download itself are in export-ui.js, imported on first use: nothing of them loads
  // with the editor. It receives the context below, built at the moment it needs the pixels.

  let exportUi = null; // the module, once imported
  let exportLoad = null;
  const loadExportUi = () => exportLoad ??= import('./export-ui.js').then((m) => (exportUi = m)).catch((e) => { exportLoad = null; throw e; });

  /** What an export needs to know about the displayed version (see ExportContext in export-ui.js); null if nothing is open. @param {boolean} [passive] */
  function exportContext(passive = false) {
    if (!ready()) return null;
    if (!passive) endPendingEdit(); // an export abandons a crop in progress, looking at the size or estimating does not
    const v = cur(), s = shot, blob = original, bmp = bitmap;
    return {
      shot: s, original: blob, edited: !!v, size: outputSize(W, H, v),
      source: () => (v ? renderCanvas(canvas, v, W, H) : bmp),
    };
  }

  async function downloadImage() {
    try {
      await (await loadExportUi()).download({ context: exportContext, warn });
    } catch (e) {
      console.error('Obturo: export failed', e);
      warn('export.err.generic');
    }
  }

  async function downloadMenu() {
    try {
      (await loadExportUi()).toggleMenu({ context: exportContext, warn });
    } catch (e) {
      console.error('Obturo: download menu', e);
      warn('export.err.generic');
    }
  }

  // ---------- beautify ----------
  // The panel is in beautify-ui.js, imported on first use. It reads and changes the look of the displayed version through the context below.

  let beautifyUi = null; // the module, once imported
  let beautifyLoad = null;
  const loadBeautifyUi = () => beautifyLoad ??= import('./beautify-ui.js').then((m) => (beautifyUi = m)).catch((e) => { beautifyLoad = null; throw e; });

  /** The look of the displayed version and how to change it; null if nothing is open. */
  function beautifyContext() {
    if (!ready()) return null;
    endPendingEdit();
    return {
      style: () => styleOf(cur()),
      apply: setBeautify,
    };
  }

  async function beautifyMenu() {
    try {
      (await loadBeautifyUi()).toggle({ context: beautifyContext });
    } catch (e) {
      console.error('Obturo: beautify panel', e);
      warn('be.err');
    }
  }

  // The format shown on the button follows the settings (the menu, the settings dialog, another tab).
  const showFormat = () => getSettings().then((s) => panel.showFormat(s.downloadFormat)).catch(() => {});
  showFormat();
  const bus = new BroadcastChannel('obturo');
  bus.onmessage = ({ data }) => { if (data?.type === 'settings-changed') showFormat(); };

  // Saving, in two writers that never wait for each other.
  //  - The versions go first, alone, in a short transaction, SAVE_DELAY_MS after the last change. A page that closes or reloads
  //    gives a write that starts then only a few milliseconds, and loses it often (measured); a person closes a tab 100 ms after
  //    the last gesture at the earliest, so by then the versions are already in the database. The closing page only has to finish
  //    what is under way.
  //  - The thumbnail follows THUMB_DELAY_MS later, in a transaction of its own that checks the shot still has the state it was
  //    rendered from. Rendering it costs more than writing the versions, and it never delays them.
  const SAVE_DELAY_MS = 60; // coalesces the writes of one gesture (a text typed key by key)
  const THUMB_DELAY_MS = 400; // after the versions are written: about as long after the last change as before, so a burst makes one thumbnail

  async function persist() {
    const s = shot;
    if (!s) return true;
    if (!(await onSave(s.id, { versions: s.versions, active: s.active }))) return false;
    thumbs.schedule();
    return true;
  }

  async function persistThumb() {
    const s = shot;
    if (!s || !canvas) return;
    if (saver.pending) return; // the versions of this state are not in the database yet: their write schedules the thumbnail when it lands
    if (pressed) { setTimeout(() => thumbs.schedule(), THUMB_DELAY_MS); return; } // a gesture is in progress: try again after it (scheduling here would loop the saver)
    const key = versionsKey(s);
    const blob = await renderThumb(canvas, cur(), W, H).catch(() => null); // draws now, from the state the key describes
    if (!blob) return;
    try {
      await onThumb?.(s.id, blob, key);
    } catch (e) {
      console.error('Obturo: thumbnail not saved', e); // the versions are safe: a thumbnail that fails is not a failed save
    }
  }

  const saver = createSaver({
    write: persist,
    delay: SAVE_DELAY_MS,
    onGone: () => onGone?.(),
    onError: (e) => {
      console.error('Obturo: save failed', e);
      warn('msg.saveFailed');
    },
  });
  const thumbs = createSaver({ write: persistThumb, delay: THUMB_DELAY_MS, onError: (e) => console.error('Obturo: thumbnail not saved', e) });

  editorSync.flush = () => saver.flush(); // a grouped export reads what is on screen

  // ---------- lifecycle ----------

  function mount() {
    holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;inset:0';
    backdrop = document.createElement('canvas'); // the beautify look, under the canvas (paintLook)
    backdrop.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    backdrop.setAttribute('aria-hidden', 'true');
    const el = document.createElement('canvas');
    holder.append(backdrop, el);
    stage.append(holder);
    canvas = new Canvas(el, {
      width: stage.clientWidth, height: stage.clientHeight,
      renderOnAddRemove: false, preserveObjectStacking: true, uniformScaling: false, stopContextMenu: true,
    });
    // Accessibility: a single announced element (the one that receives the mouse), not its twin.
    canvas.upperCanvasEl.setAttribute('role', 'img');
    labelCanvas(); // re-translated by applyDom
    canvas.lowerCanvasEl.setAttribute('aria-hidden', 'true');
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.on('mouse:down:before', () => { // the stroke that starts takes the color and the width of the style bar
      if (tool !== 'pen' || !canvas.freeDrawingBrush) return;
      canvas.freeDrawingBrush.color = panel.color();
      canvas.freeDrawingBrush.width = panel.strokeWidth(W);
    });
    canvas.on('path:created', onPath);
    canvas.on('before:render', drawBase);
    canvas.on('after:render', drawCrop);
    canvas.on('mouse:down', () => { pressed = true; });
    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);
    canvas.on('mouse:wheel', onWheel);
    canvas.on('object:moving', ({ target }) => { closeMarkerEdit(true); setLive(target); });
    canvas.on('object:scaling', ({ target }) => { closeMarkerEdit(true); setLive(target); });
    const selectionChanged = () => {
      if (markerEdit && selected() !== markerEditTarget) closeMarkerEdit(true); // another object, or none: the field is done
      syncPanel();
    };
    canvas.on('selection:created', selectionChanged);
    canvas.on('selection:updated', selectionChanged);
    canvas.on('selection:cleared', selectionChanged);
    // Double click on a marker: the number if it is the disc, the legend if it is the text. Not while a tool is drawing.
    canvas.on('mouse:dblclick', ({ target, e }) => {
      if (tool !== 'select' || !(target instanceof Marker)) return;
      openMarkerEdit(target, target.partAt(canvas.getScenePoint(e)) ?? 'label');
    });
    canvas.on('object:modified', ({ target: o }) => {
      if (!o || !canvas) return;
      bake(o);
      canvas.requestRenderAll();
      if (!o.isCrop) commit();
    });
    canvas.on('text:changed', () => { if (cur() && canvas) { cur().objects = objects(); saver.schedule(); } });
    canvas.on('text:editing:exited', ({ target: t }) => {
      if (!canvas) return;
      if (!t.text.trim()) canvas.remove(t);
      commit();
    });
  }

  // A more recent open cancels the earlier ones still queued: only the last click counts.
  function open(s, blob) {
    const mine = ++ticket;
    return serial(async () => {
      if (mine !== ticket) return;
      await closeNow();
      if (mine !== ticket) return;
      const bmp = await createImageBitmap(blob);
      if (mine !== ticket) { bmp.close(); return; }
      shot = s; original = blob; raw = bitmap = bmp; frameTurn = 0; W = bmp.width; H = bmp.height;
      source.img = bmp;
      mount();
      panel.enable(W, H);
      setTool('select');
      refit();
      await show(shot.active, false);
    });
  }

  const close = () => { ticket++; return serial(closeNow); };

  async function closeNow() {
    if (!shot) return;
    loadSeq++;
    try {
      endPendingEdit(); // a text being edited is validated (and committed) while everything still exists
      await saver.flush().catch(() => {});
      // The final write failed (the saver's message talks about changes kept "on screen", but the shot is closing):
      if (saver.pending) warn('msg.closeSaveFailed');
      await thumbs.flush().catch(() => {}); // the thumbnail of what was just saved, while the canvas still exists
    } finally {
      const c = canvas;
      canvas = null; // renders that are already scheduled find a null canvas and stop
      try { await c.dispose(); } catch (e) { console.error('Obturo: dispose', e); }
      holder.remove();
      holder = backdrop = null;
      if (bitmap !== raw) bitmap.close();
      raw.close();
      raw = bitmap = null;
      source.img = null;
      shot = original = null;
      history.reset();
      drawing = null;
      panel.disable();
    }
  }

  // ---------- document listeners (set once: the page has a single editor) ----------

  panel.bindControls({
    ready, setTool, showVersion: show, newVersion, removeVersion, nameVersion, setMarkerSide, showVersions: () => panel.showVersions(shot), enterCrop, exitCrop, clearCrop, setScale, setOutputWidth,
    fit: () => canvas && refit(), actualSize, step, deleteSelection, copyImage, downloadImage, downloadMenu, beautifyMenu, addStamp, rotate,
    restyle, editMarker: () => { const o = selected(); if (o instanceof Marker) openMarkerEdit(o, 'label'); }, tool: () => tool, hasSelection: () => !!selected(), selection: selected, release, commit, strokeWidth: () => panel.strokeWidth(W), markerSize: () => panel.markerSize(W),
  });

  document.addEventListener('keydown', (e) => {
    if (!ready() || /** @type {Element} */ (e.target).closest?.('input:not([type="radio"]):not([type="range"]), select, textarea') || canvas.getActiveObject()?.isEditing) return; // radios and sliders (swatches, stroke, strength) leave Delete and Ctrl+Z to the editor
    if (document.querySelector('dialog[open]') || exportUi?.isMenuOpen?.() || beautifyUi?.isOpen?.()) return; // a modal dialog (settings), the format menu or the beautify panel has the keyboard
    const k = e.key.toLowerCase();
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelection(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); step(-1); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); step(1); }
    else if (k === 'enter' && selected() instanceof Marker) { e.preventDefault(); openMarkerEdit(/** @type {Marker} */ (selected()), 'label'); }
    else if (k === 'escape') { if (cropBox) exitCrop(false); else setTool('select'); }
  });

  new ResizeObserver(() => {
    if (!canvas) return;
    canvas.setDimensions({ width: stage.clientWidth, height: stage.clientHeight });
    setView(fitMode ? fitView(canvas.width, canvas.height, W, H, viewBox()) : clampView(view, canvas.width, canvas.height, W, H, viewBox()));
  }).observe(stage);

  // The versions are written first; the caller that waits (the history view) gets the thumbnail too.
  const flush = async () => {
    await saver.flush();
    await thumbs.flush();
  };

  return { open, close, flush, relocalize: panel.relocalize };
}
