// Beautify: the look that a version can give its capture (a background, a padding, rounded corners, a shadow, a window bar) and the
// geometry that the editor, the exports and the thumbnails share. Pure functions, testable with `node --test`.
// Sizes are in pixels of the OUTPUT: `k` scales them for a reduced drawing (a thumbnail, the preview).

/**
 * @typedef {{ type: 'none' } | { type: 'color', color: string } | { type: 'gradient', index: number }} Background
 * @typedef {{ bg: Background, padding: number, radius: number, shadow: 'none' | 'soft' | 'strong', frame: 'none' | 'window' }} Beautify
 */

/** Two stops of a diagonal gradient, from the top left to the bottom right. */
export const GRADIENTS = [
  ['#6366f1', '#a855f7'],
  ['#06b6d4', '#3b82f6'],
  ['#f97316', '#ec4899'],
  ['#10b981', '#06b6d4'],
  ['#334155', '#0f172a'],
  ['#fde68a', '#fca5a5'],
];

export const PADDING = { min: 0, max: 128, step: 4 };
export const RADIUS = { min: 0, max: 48, step: 2 };
export const SHADOWS = Object.freeze({ none: null, soft: { blur: 24, dy: 8, alpha: 0.25 }, strong: { blur: 40, dy: 16, alpha: 0.45 } });
export const BAR_HEIGHT = 36;

export const DEFAULT_BEAUTIFY = /** @type {Beautify} */ (Object.freeze({ bg: { type: 'gradient', index: 0 }, padding: 48, radius: 12, shadow: 'soft', frame: 'none' }));

const snap = (n, { min, max, step }, fallback) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n / step) * step)) : fallback);

/**
 * A style read from storage or from the panel: every field valid, or the default of that field. null for anything that is not an object.
 * @param {unknown} value
 * @returns {Beautify | null}
 */
export function normalizeBeautify(value) {
  if (!value || typeof value !== 'object') return null;
  const v = /** @type {any} */ (value);
  const d = DEFAULT_BEAUTIFY;
  const bg = v.bg;
  return {
    bg: bg?.type === 'none' ? { type: 'none' }
      : bg?.type === 'color' && /^#[0-9a-f]{6}$/i.test(bg.color) ? { type: 'color', color: bg.color.toLowerCase() }
        : bg?.type === 'gradient' && Number.isInteger(bg.index) && bg.index >= 0 && bg.index < GRADIENTS.length ? { type: 'gradient', index: bg.index }
          : { ...d.bg },
    padding: snap(v.padding, PADDING, d.padding),
    radius: snap(v.radius, RADIUS, d.radius),
    shadow: typeof v.shadow === 'string' && Object.hasOwn(SHADOWS, v.shadow) ? v.shadow : d.shadow,
    frame: v.frame === 'window' ? 'window' : 'none',
  };
}

/** The style of a version, validated; null when the version has none. @param {{ beautify?: unknown } | null | undefined} version */
export const styleOf = (version) => normalizeBeautify(version?.beautify);

/**
 * What the style adds around a capture: `x` and `y` in total, `pad` on each side, `bar` on top (the window bar).
 * @param {Beautify | null} style
 * @param {number} [k]
 */
export function extraOf(style, k = 1) {
  if (!style) return { x: 0, y: 0, pad: 0, bar: 0 };
  const pad = Math.round(style.padding * k);
  const bar = style.frame === 'window' ? Math.max(1, Math.round(BAR_HEIGHT * k)) : 0;
  return { x: 2 * pad, y: 2 * pad + bar, pad, bar };
}

/** Size of the image once the capture (w x h) is framed. @param {number} w @param {number} h @param {Beautify | null} style @param {number} [k] */
export function framedSize(w, h, style, k = 1) {
  const e = extraOf(style, k);
  return { w: w + e.x, h: h + e.y };
}

/**
 * Where everything goes for a capture of w x h px: the whole image, the window (bar and capture), the bar, the capture, the radius
 * of the corners (never more than half the shortest side) and the shadow.
 * @param {number} w @param {number} h @param {Beautify} style @param {number} [k]
 */
export function layout(w, h, style, k = 1) {
  const { pad, bar, x, y } = extraOf(style, k);
  const win = { x: pad, y: pad, w, h: h + bar };
  const shadow = SHADOWS[style.shadow];
  return {
    w: w + x,
    h: h + y,
    win,
    bar: bar ? { x: pad, y: pad, w, h: bar } : null,
    shot: { x: pad, y: pad + bar, w, h },
    radius: Math.min(Math.round(style.radius * k), Math.floor(Math.min(win.w, win.h) / 2)),
    shadow: shadow && { blur: Math.round(shadow.blur * k), dy: Math.round(shadow.dy * k), alpha: shadow.alpha },
  };
}
