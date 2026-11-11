// The mouse of the editor: the gesture that draws a shape, a text, a marker or an emoji with the armed tool.
import { BlurRegion, Highlight, Spot, applyShape, hasShape } from './shapes.js';
import { pathLength, simplify } from './shape-pure.js';
import * as panel from './panel.js';

const MIN_DRAG_PX = 6; // a shorter drag (in screen px) is a simple click: nothing is drawn
const FREE_STEP_PX = 2; // a free path takes a point every 2 screen px at least
const FREE_TOLERANCE_PX = 1.5; // and is simplified to what a line drawn within 1.5 screen px of it replaces
const MIN_AREA_PX = 3; // a free area narrower than this (in image px) is a line: nothing is drawn

/**
 * @typedef {object} MouseHost What the editor lends to the mouse.
 * @property {() => any} canvas The Fabric canvas, null while the editor closes.
 * @property {() => boolean} ready A shot is open and its canvas exists.
 * @property {() => string} tool The armed tool.
 * @property {() => boolean} cropping A crop is being adjusted.
 * @property {() => number} zoom Screen px per document px.
 * @property {(tool: string, p: { x: number, y: number }) => any} make A new object of the tool, at its start.
 * @property {(obj: any, path: number[][]) => void} freeDraw
 * @property {(o: any) => void} adopt Gives an object the handles of the editor.
 * @property {(objs: any[]) => void} drop Removes objects that were never kept.
 * @property {() => void} ensureVersion
 * @property {() => void} commit
 * @property {(p: { x: number, y: number }) => void} addText
 * @property {(p: { x: number, y: number }) => void} addMarker
 * @property {(p: { x: number, y: number }) => void} addEmoji
 */

/** @param {MouseHost} host */
export function createMouse(host) {
  let drawing = null;

  // A point of the document at the precision the saved version keeps (two decimals), so that what is drawn is what is reloaded.
  const pt = (o) => { const p = host.canvas().getScenePoint(o.e); return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }; };

  function down(o) {
    const tool = host.tool();
    if (!host.ready() || tool === 'select' || tool === 'pen' || host.cropping()) return; // the pen is Fabric's own drawing mode
    const p = pt(o);
    if (tool === 'text') { drawing = { start: p, text: true }; return; }
    if (tool === 'marker') { drawing = { start: p, marker: true }; return; }
    if (tool === 'emoji') { drawing = { start: p, emoji: true }; return; }
    const obj = host.make(tool, p); // the version is only created at the end of the gesture, if the object really exists
    host.canvas().add(obj);
    drawing = { obj, start: p, path: panel.shape(tool) === 'free' && hasShape(obj) ? [[p.x, p.y]] : null };
  }

  function move(o) {
    const canvas = host.canvas();
    if (!canvas || !drawing?.obj) return;
    const tool = host.tool();
    const { obj, start: s, path } = drawing, p = pt(o);
    if (path) { // a free shape: a point every few pixels, the box grows with the path
      const [lx, ly] = path[path.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * host.zoom() < FREE_STEP_PX) return;
      path.push([p.x, p.y]);
      host.freeDraw(obj, path);
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
    const canvas = host.canvas();
    if (!canvas) return;
    const live = canvas.getObjects().filter((o) => o instanceof BlurRegion && o.live);
    for (const o of live) o.live = false;
    if (live.length) canvas.requestRenderAll();
  }

  // While a blurred region is moved or resized it shows a cheap preview (see BlurRegion): only the release recomputes it.
  const setLive = (target) => { for (const o of target?.getObjects?.() ?? [target]) if (o instanceof BlurRegion) o.live = true; };

  function up(o) {
    release();
    const canvas = host.canvas();
    if (!drawing || !canvas) return;
    const { obj, start: s, text, marker, emoji, path } = drawing;
    drawing = null;
    if (text) { host.ensureVersion(); host.addText(s); return; }
    if (marker) { host.ensureVersion(); host.addMarker(s); return; }
    if (emoji) { host.ensureVersion(); host.addEmoji(s); return; }
    const z = host.zoom();
    let tooSmall;
    if (path) { // a free shape: simplified, and it needs some length (and, for an area, some width and height)
      const kept = simplify(path, Math.max(0.5, FREE_TOLERANCE_PX / z));
      if (kept.length >= 2) host.freeDraw(obj, kept);
      tooSmall = kept.length < 2 || pathLength(kept) * z < MIN_DRAG_PX || (!(obj instanceof Highlight) && Math.min(obj.width, obj.height) < MIN_AREA_PX);
    } else {
      tooSmall = Math.hypot(pt(o).x - s.x, pt(o).y - s.y) * z < MIN_DRAG_PX;
    }
    if (tooSmall) { // simple click: nothing drawn, no version created
      host.drop([obj]);
      canvas.requestRenderAll();
      return;
    }
    obj.setCoords();
    host.adopt(obj);
    host.ensureVersion(); // first object really added: V1 is born here (and protects the shot from eviction)
    if (obj instanceof Spot) canvas.sendObjectToBack(obj); // under the annotations: the shade must not dim them
    host.commit(); // the tool stays armed for the next one, until Escape or a click on Select
  }

  return { down, move, up, release, setLive, cancel() { drawing = null; } };
}
