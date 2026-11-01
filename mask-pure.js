// Pure logic of the two ways to hide an area: the solid fill (its colors) and the soft blur (its maths). No DOM, no Fabric,
// testable with `node --test`.
//
// The soft blur keeps the guarantee of the pixelation: the area is first reduced to ONE value per block (the exact mean of the
// pixels of the block), and only that small image is enlarged smoothly. What is drawn depends on the block means and on
// nothing else, so the detail inside a block is destroyed exactly as a mosaic of the same block size destroys it. A Gaussian
// blur of a few pixels keeps much more than that, and can be partly undone on text.

/** Smallest and largest block, in px: below 16 the detail of small text survives. Shared by the pixelation and the blur. */
export const BLOCK_RANGE = { min: 16, max: 120 };

/** The color of a solid fill when nothing says otherwise: an object saved before the colors existed has no choice recorded. */
export const DEFAULT_FILL = '#000000';

/**
 * The swatches of EVERY color of the editor (line, text, text background, solid fill, highlighter): black first (the default of the
 * solid fill), then white, gray and a few accents; a free color comes beside them. `key` names the color in locales/.
 */
export const PALETTE = [
  { key: 'prop.color.black', hex: '#000000' },
  { key: 'prop.color.white', hex: '#ffffff' },
  { key: 'prop.color.gray', hex: '#808080' },
  { key: 'prop.color.blue', hex: '#2563eb' },
  { key: 'prop.color.red', hex: '#e53935' },
  { key: 'prop.color.yellow', hex: '#ffeb3b' },
  { key: 'prop.color.green', hex: '#43a047' },
  { key: 'prop.color.orange', hex: '#fb8c00' },
  { key: 'prop.color.pink', hex: '#ec407a' },
];

/**
 * An OPAQUE color as `#rrggbb`, or null. A solid fill hides: it is never see-through, so a color that carries any
 * transparency (`#rrggbbaa` with aa below ff, `#rgba`, rgba(), a name, anything unknown) is refused, not approximated.
 * @param {unknown} value
 * @returns {string | null}
 */
export function solidColor(value) {
  if (typeof value !== 'string') return null;
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join(''); // #rgb, #rgba
  if (hex.length === 8) {
    if (hex.slice(6) !== 'ff') return null;
    hex = hex.slice(0, 6);
  }
  return `#${hex}`;
}

/**
 * Number of blocks across and down for a w x h px area: whole blocks of AT LEAST `block` px (the leftover is shared between them,
 * never a sliver smaller than the block), one block at the very least.
 * @param {number} w
 * @param {number} h
 * @param {number} block
 */
export function tilePlan(w, h, block) {
  return { cols: Math.max(1, Math.floor(w / block)), rows: Math.max(1, Math.floor(h / block)) };
}

/**
 * The part of the image under an area given in document px: whole pixels, rounded OUTWARD (a sliver of a pixel at the edge is
 * covered, never left clear) and clipped to the image. Null if the area misses the image.
 * @param {{ x: number, y: number, w: number, h: number }} area
 * @param {number} imgW
 * @param {number} imgH
 */
export function regionBox({ x, y, w, h }, imgW, imgH) {
  const x0 = Math.max(0, Math.floor(x + 1e-6)), y0 = Math.max(0, Math.floor(y + 1e-6));
  const x1 = Math.min(imgW, Math.ceil(x + w - 1e-6)), y1 = Math.min(imgH, Math.ceil(y + h - 1e-6));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Exact mean of every block of a w x h RGBA image cut into cols x rows blocks: the sum of the pixels of the block divided by their
 * number, per channel, rounded. Block edges are at round(i * w / cols), so the blocks differ by one pixel at most. The image of
 * cols x rows px that comes out is all that survives of the area.
 * @param {ArrayLike<number>} rgba w * h * 4 values (the data of an ImageData)
 * @param {number} w
 * @param {number} h
 * @param {number} cols
 * @param {number} rows
 * @returns {Uint8ClampedArray<ArrayBuffer>} cols * rows * 4 values
 */
export function blockAverages(rgba, w, h, cols, rows) {
  const out = new Uint8ClampedArray(cols * rows * 4);
  const colOf = new Uint16Array(w); // block column of every pixel column
  const xEdge = Array.from({ length: cols + 1 }, (_, i) => Math.round((i * w) / cols));
  for (let c = 0; c < cols; c++) colOf.fill(c, xEdge[c], xEdge[c + 1]);
  const sums = new Float64Array(cols * 4);
  for (let r = 0, y = 0; r < rows; r++) {
    const yEnd = Math.round(((r + 1) * h) / rows);
    const rowCount = yEnd - y;
    sums.fill(0);
    for (; y < yEnd; y++) {
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        const s = colOf[x] * 4;
        sums[s] += rgba[i];
        sums[s + 1] += rgba[i + 1];
        sums[s + 2] += rgba[i + 2];
        sums[s + 3] += rgba[i + 3];
      }
    }
    for (let c = 0; c < cols; c++) {
      const count = rowCount * (xEdge[c + 1] - xEdge[c]);
      for (let k = 0; k < 4; k++) out[(r * cols + c) * 4 + k] = Math.round(sums[c * 4 + k] / count);
    }
  }
  return out;
}
