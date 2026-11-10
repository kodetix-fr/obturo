// The stitching of a full page: the canvas that the tiles are pasted into, one decoded tile at a time. Pure canvas work, nothing here talks to
// the browser or to the page; sw.js takes the tiles and calls it.
import { cropRect } from './pure.js';
import { canvasSize, tileDest } from './fullpage-pure.js';

/**
 * A canvas for the stitching. willReadFrequently: a canvas kept in the memory of the worker instead of the GPU process,
 * where its 2D canvas lives otherwise. MEASURED (Chromium 143, headless, software GL: no hardware GPU, so the figures are an
 * order of magnitude, not a promise): for a 31 Mpx page the GPU process grows by 597 MB (1080p tiles) or 681 MB (4K tiles)
 * without it, by 53 and 197 MB with it; all processes together +858 -> +463 MB (1080p) and +935 -> +623 MB (4K); the duration
 * goes from 10.0 to 9.6 s (1080p, the 550 ms per tile dominates) and from 5.9 to 2.5 s (4K, the PNG encoding no longer
 * reads the canvas back from the GPU). pdf.js does the same for its readbacks.
 */
function openCanvas(w, h) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high'; // only useful when the scale falls back
  return { canvas, ctx };
}

/**
 * Stitches the tiles of a full page into an OffscreenCanvas, one decoded tile at a time. The geometry comes from the
 * first tile (size of the captured image relative to the window); the following tiles must have the same size. Of each
 * tile, only the part that shows the target (the whole window for the document, the box of a scroller) is kept.
 * @param {ImageBitmap} first First tile (not closed here; only its dimensions are used).
 * @param {{ vis: import('./versions.js').Rect, vw: number, vh: number, inner: boolean }} m What is scrolled and where it shows (a Target of sw.js).
 * @param {number} covered Height covered, in CSS px.
 */
export function createStitcher(first, m, covered) {
  const { width, height } = first; // read right away: once closed, a bitmap is 0 x 0 px
  const sy = height / m.vh; // image px per CSS px
  const crop = cropRect(m.vis, m.vw, m.vh, width, height); // the target in a tile, without the scrollbar, in image px
  if (crop.w < 1 || crop.h < 1) throw new Error('scrolled area outside the window');
  let size = canvasSize(covered, crop.w, sy); // where the page is planned to end; the canvas is as tall only once a tile needs it
  let { canvas, ctx } = openCanvas(size.w, size.h);
  let end = Infinity; // first canvas row not covered yet (nothing is pasted at the start)

  // The same pixels in a canvas of another height, the old one freed at once. For the rare cases only (the target grew, or
  // ended sooner than planned): the old and the new canvas live together for the duration of the copy.
  const resize = (h) => {
    const next = openCanvas(size.w, h);
    next.ctx.drawImage(canvas, 0, 0);
    canvas.width = canvas.height = 0;
    ({ canvas, ctx } = next);
  };

  return {
    /** Pastes a tile taken at the ACTUAL scroll position `y` (CSS px), then closes its bitmap. */
    paste(bmp, y) {
      if (bmp.width !== width || bmp.height !== height) {
        bmp.close();
        throw new Error('window size changed during the capture');
      }
      // +1 row: covers rounding, the next tile paints over it. Not for a scroller: that row is outside its box, another content
      const srcRows = Math.min(bmp.height - crop.y, crop.h + (m.inner ? 0 : 1));
      const d = tileDest(y, sy, srcRows, size.k, end, size.h);
      if (d.dy + d.dh > canvas.height && canvas.height < size.h) resize(size.h); // the page grew since the canvas was made
      ctx.drawImage(bmp, crop.x, crop.y, crop.w, srcRows, 0, d.dy, size.w, d.dh);
      bmp.close();
      end = d.dy + d.dh;
    },
    /**
     * Plans for `covered` CSS px (the target grew). Refused (false) if the scale would change: the capture then stops at the
     * size it had, which keeps the top of the page at full resolution, as a page cut at MAX_TILES.
     * ponytail: growth is followed while the scale of the canvas stays the same, past that the page is cut where it is; redraw the canvas at the new scale to go on.
     */
    extend(covered) {
      const next = canvasSize(covered, crop.w, sy);
      if (next.k !== size.k || next.w !== size.w) return false;
      size = next;
      return true;
    },
    /** Encodes the final PNG, then frees the pixel memory of the canvas right away. */
    async finish() {
      const used = Math.min(end, size.h, canvas.height);
      if (canvas.height - used > 2) resize(used); // the target ended sooner than planned: no blank rows at the bottom
      const out = { blob: await canvas.convertToBlob({ type: 'image/png' }), w: size.w, h: canvas.height, k: size.k };
      canvas.width = canvas.height = 0;
      return out;
    },
  };
}
