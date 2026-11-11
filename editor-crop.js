// The crop of the editor: a box over the whole image that the person adjusts, applied to the displayed version when confirmed.
import { Rect } from './vendor/fabric.min.mjs';
import { clampCrop } from './versions.js';
import * as panel from './panel.js';

const CROP_SHADE = 'rgba(0,0,0,.55)'; // what is outside the crop

/**
 * @typedef {object} CropHost What the editor lends to the crop.
 * @property {() => any} canvas The Fabric canvas, null while the editor closes.
 * @property {() => boolean} ready A shot is open and its canvas exists.
 * @property {() => string} tool The armed tool.
 * @property {() => { w: number, h: number }} size The size of the image shown.
 * @property {() => import('./versions.js').Version | undefined} version The displayed version.
 * @property {() => boolean} looked The displayed version has a look around its capture.
 * @property {(o: any) => void} adopt Gives an object the handles of the editor.
 * @property {(tool: string) => void} setTool
 * @property {() => void} relayoutLook
 * @property {() => void} syncDrawingMode
 * @property {() => void} ensureVersion
 * @property {() => void} syncOutput
 * @property {() => void} commit
 */

/** @param {CropHost} host */
export function createCrop(host) {
  let box = null;

  /** The rectangle being adjusted, in document px, or null. */
  const editing = () => box && { x: box.left, y: box.top, w: box.width * box.scaleX, h: box.height * box.scaleY };

  /** What the displayed canvas shows as the capture: the rectangle being adjusted, else the crop of the version. */
  const shown = () => editing() ?? host.version()?.crop;

  // Darkens what is outside the crop. Only on the displayed canvas: never in the export.
  function draw({ ctx }) {
    const canvas = host.canvas();
    if (!canvas) return;
    const r = shown();
    if (!r || ctx !== canvas.getContext() || host.looked()) return; // with a look, what is outside the crop is not shown at all
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

  function enter(from) {
    if (!host.ready() || box) return;
    const canvas = host.canvas();
    host.setTool('select');
    canvas.discardActiveObject();
    const size = host.size();
    const r = from ?? host.version()?.crop ?? { x: 0, y: 0, w: size.w, h: size.h };
    box = new Rect({ left: r.x, top: r.y, width: r.w, height: r.h, fill: 'rgba(0,0,0,0)', strokeWidth: 0, lockRotation: true });
    box.isCrop = box.excludeFromExport = true;
    host.adopt(box);
    box.setControlVisible('mtr', false);
    for (const o of canvas.getObjects()) o.set({ selectable: false, evented: false });
    canvas.add(box);
    canvas.setActiveObject(box);
    host.relayoutLook(); // the whole image shows while the crop is edited
    panel.showCropButtons(true);
    canvas.requestRenderAll();
  }

  function exit(ok) {
    if (!box) return;
    const r = editing();
    const canvas = host.canvas();
    canvas.discardActiveObject();
    canvas.remove(box);
    box = null;
    for (const o of canvas.getObjects()) o.set({ selectable: true, evented: true });
    panel.showCropButtons(false);
    panel.showTool(host.tool());
    host.syncDrawingMode();
    if (ok) {
      host.ensureVersion();
      const size = host.size();
      /** @type {import('./versions.js').Version} */ (host.version()).crop = clampCrop(r, size.w, size.h);
      host.syncOutput();
      host.commit();
    } else {
      host.relayoutLook();
    }
    canvas.requestRenderAll();
  }

  function clear() {
    const version = host.version();
    if (!version?.crop) return;
    version.crop = null;
    host.syncOutput();
    host.commit();
    host.canvas().requestRenderAll();
  }

  return { get active() { return box !== null; }, editing, shown, draw, enter, exit, clear };
}
