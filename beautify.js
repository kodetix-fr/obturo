// Draws a capture with its beautify look: the backdrop, the shadow, the window (bar and rounded corners) and the capture. Every
// consumer goes through it (output.js: the editor exports, the grouped export, the thumbnails, the preview), from the geometry of
// beautify-pure.js, so that they agree to the pixel.
import { GRADIENTS, layout } from './beautify-pure.js';

const BAR = { fill: '#eceef2', line: '#d5d9e0', dots: ['#ff5f57', '#febc2e', '#28c840'] };

/**
 * @param {{ x: number, y: number, w: number, h: number }} bar
 * @param {CanvasRenderingContext2D} ctx
 */
function drawBar(ctx, bar) {
  ctx.fillStyle = BAR.fill;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.fillStyle = BAR.line;
  ctx.fillRect(bar.x, bar.y + bar.h - 1, bar.w, 1);
  BAR.dots.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bar.x + bar.h * (0.7 + 0.5 * i), bar.y + bar.h / 2, bar.h * 0.17, 0, 2 * Math.PI);
    ctx.fill();
  });
}

/**
 * The capture inside its look, on a new canvas that belongs to the caller. `k` reduces the look (padding, bar, corners, shadow) for a
 * capture that was itself reduced by the same factor.
 * @param {HTMLCanvasElement} source The capture, cropped and scaled.
 * @param {import('./beautify-pure.js').Beautify} style
 * @param {number} [k]
 * @returns {HTMLCanvasElement}
 */
export function drawBeautified(source, style, k = 1) {
  const l = layout(source.width, source.height, style, k);
  const out = document.createElement('canvas');
  out.width = l.w;
  out.height = l.h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
  const { bg } = style;
  if (bg.type === 'color') {
    ctx.fillStyle = bg.color;
  } else if (bg.type === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, l.w, l.h);
    gradient.addColorStop(0, GRADIENTS[bg.index][0]);
    gradient.addColorStop(1, GRADIENTS[bg.index][1]);
    ctx.fillStyle = gradient;
  }
  if (bg.type !== 'none') ctx.fillRect(0, 0, l.w, l.h);

  const outline = () => {
    ctx.beginPath();
    ctx.roundRect(l.win.x, l.win.y, l.win.w, l.win.h, l.radius);
  };
  if (l.shadow) { // casts from a white window; the capture covers it
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${l.shadow.alpha})`;
    ctx.shadowBlur = l.shadow.blur;
    ctx.shadowOffsetY = l.shadow.dy;
    ctx.fillStyle = '#fff';
    outline();
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  outline();
  ctx.clip();
  if (l.bar) drawBar(ctx, l.bar);
  ctx.drawImage(source, l.shot.x, l.shot.y);
  ctx.restore();
  return out;
}
