// The color and the strength of the highlighter. A highlighter is multiplied with the image under it (shapes.js: Highlight), so dark
// text stays dark and the white of the page takes the color. Its color is any color of the editor (mask-pure.js: PALETTE, or a free one).
// No DOM, no Fabric.
import { solidColor } from './mask-pure.js';

/** The color of the next highlighter when nothing else was chosen: the yellow of the palette. */
export const DEFAULT_HIGHLIGHT = '#ffeb3b';

// ponytail: a fixed strength. A highlighter that multiplied at full strength with black would HIDE what is under it, and the hiding is the
// solid fill's job, so it is never opaque: at 0.6 even black leaves the text 40 % readable, and a light color is the pen of a real highlighter.
// Make it a setting if people want a stronger or a paler pen.
export const HIGHLIGHT_OPACITY = 0.6;

/** An opaque `#rrggbb` color, or the default: whatever is stored, a color is what comes out. @param {unknown} value */
export const highlightColor = (value) => solidColor(value) ?? DEFAULT_HIGHLIGHT;
