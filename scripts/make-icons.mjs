// Generates icons/icon{16,32,48,128}.png: a shutter (6-blade diaphragm), and icons/notrace{16,32}.png: the same in violet, which the
// service worker puts on the toolbar while the no-trace mode is on (the mode must not be forgotten).
// Deterministic and dependency-free: supersampled rendering, PNG written by hand.
// Usage: node scripts/make-icons.mjs   (Node >= 22.2 for zlib.crc32)
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BLUE = [37, 99, 235];     // disc: readable on a light and on a dark toolbar
const LIGHT = [191, 219, 254];  // blades
const WHITE = [255, 255, 255];  // aperture
const VIOLET = [124, 58, 237];       // the no-trace variant: disc (readable on a light and on a dark toolbar)
const VIOLET_LIGHT = [221, 214, 254]; // and blades
const N = 8;                    // N x N supersampling per pixel

/** Distance from the point (x, y) to the segment [p, q]. @param {number} x @param {number} y @param {number[]} p @param {number[]} q */
const segDist = (x, y, [px, py], [qx, qy]) => {
  const dx = qx - px, dy = qy - py;
  const t = Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (px + t * dx), y - (py + t * dy));
};

// Returns the color at the point (x, y) in px, or null if transparent.
function sampler(S, disc, blade) {
  const c = S / 2;
  // 128 px: 96 px of drawing + 16 px of transparent margin per side (Web Store recommendation)
  const R = (S === 128 ? 0.375 : 0.47) * S;
  const a = 0.45 * R;
  const hex = [...Array(6)].map((_, k) => {
    const t = ((-90 + 60 * k) * Math.PI) / 180;
    return [c + a * Math.cos(t), c + a * Math.sin(t)];
  });
  // each side of the hexagon extended up to the disc: the blades
  const blades = S < 32 ? [] : hex.map((v, k) => {
    const w = hex[(k + 1) % 6];
    const dx = w[0] - v[0], dy = w[1] - v[1], l = Math.hypot(dx, dy);
    return [v, [v[0] + (dx / l) * 2 * R, v[1] + (dy / l) * 2 * R]];
  });
  const hw = (S * 0.035) / 2;
  const inHex = (x, y) => {
    let s = 0;
    for (let k = 0; k < 6; k++) {
      const v = hex[k], w = hex[(k + 1) % 6];
      const cr = Math.sign((w[0] - v[0]) * (y - v[1]) - (w[1] - v[1]) * (x - v[0]));
      if (cr && s && cr !== s) return false;
      s = s || cr;
    }
    return true;
  };
  return (x, y) => {
    if (Math.hypot(x - c, y - c) > R) return null;
    if (inHex(x, y)) return WHITE;
    return blades.some(([p, q]) => segDist(x, y, p, q) <= hw) ? blade : disc;
  };
}

function render(S, disc = BLUE, blade = LIGHT) {
  const f = sampler(S, disc, blade);
  const px = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const col = f(x + (i + 0.5) / N, y + (j + 0.5) / N);
        if (col) { r += col[0]; g += col[1]; b += col[2]; n++; }
      }
      if (!n) continue;
      px.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round((255 * n) / (N * N))], (y * S + x) * 4);
    }
  }
  return px;
}

const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

// Indexed PNG (palette + tRNS).
// ponytail: channels quantized to 16 levels, enough for the 3 colors and their edge gradients (the worst error is
// printed), and the palette is capped at 256 entries, otherwise it throws; use a real quantizer if the design gets
// more colors.
function encode(S, px) {
  const q = (v) => Math.round(v / 17) * 17;
  const pal = new Map();
  let maxErr = 0;
  const raw = Buffer.alloc((S + 1) * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      const c = px[o + 3] ? [q(px[o]), q(px[o + 1]), q(px[o + 2]), q(px[o + 3])] : [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) maxErr = Math.max(maxErr, Math.abs(c[k] - px[o + k]));
      const key = c.join();
      if (!pal.has(key)) pal.set(key, [pal.size, c]);
      raw[y * (S + 1) + 1 + x] = pal.get(key)[0];
    }
  }
  if (pal.size > 256) throw new Error(`palette too large: ${pal.size}`);
  const entries = [...pal.values()].map(([, c]) => c);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr.set([8, 3, 0, 0, 0], 8); // 8 bits, indexed color
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(entries.flatMap((c) => c.slice(0, 3)))),
    chunk('tRNS', Buffer.from(entries.map((c) => c[3]))),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, colors: pal.size, maxErr };
}

mkdirSync('icons', { recursive: true });
/** @type {Array<[string, number, number[], number[]]>} name, size, disc, blades */
const OUTPUTS = [
  ...[16, 32, 48, 128].map((S) => /** @type {[string, number, number[], number[]]} */ ([`icon${S}`, S, BLUE, LIGHT])),
  ...[16, 32].map((S) => /** @type {[string, number, number[], number[]]} */ ([`notrace${S}`, S, VIOLET, VIOLET_LIGHT])), // the toolbar only: 16 and 32 px
];
for (const [name, S, disc, blade] of OUTPUTS) {
  const px = render(S, disc, blade);
  const { png, colors, maxErr } = encode(S, px);
  const rgba = Buffer.concat([...Array(S)].map((_, y) => Buffer.concat([Buffer.from([0]), px.subarray(y * S * 4, (y + 1) * S * 4)])));
  writeFileSync(`icons/${name}.png`, png);
  console.log(`${name}.png: ${png.length} bytes, ${colors} colors, max error ${maxErr}/255 (raw RGBA compressed: ${deflateSync(rgba, { level: 9 }).length} bytes)`);
}
