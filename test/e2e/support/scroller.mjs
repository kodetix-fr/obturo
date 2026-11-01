// Test pages whose content scrolls in a panel instead of the document, and the checks of what a full-page capture of them
// gives. Every page is made of the same content, so that the image proves what it must at the pixel:
// - a graduated ruler in the 8 leftmost px: the color of a row gives its position in the content (order, no hole, no duplicate);
// - bands of 250 px, each with its own color (the number of a band is readable from its color);
// - optionally a sticky header (blue), which must appear once, at the top.
// Around the content (outside the panel, so never in the image): a red bar and a grey side. Over the panel: a yellow toast at
// the top, a green footer at the bottom (fixed): once each, at the top and at the bottom of the image.
import { once } from 'node:events';
import { createServer } from 'node:http';

export const BAND = 250;
// Where the panel starts in the window (CSS px), and how far from the right edge it ends (not the whole width: at a display scale
// of 2 a full-width panel of 5,000 px is over the 32 Mpx of a capture). The toast sits just inside that edge.
export const PANE = { top: 48, left: 120, edge: '40%', right: 'calc(40% + 10px)' };

/** Color of band number `i`. */
export const bandColor = (i) => [40 + ((i * 37) % 200), 40 + ((i * 91) % 200), 40 + ((i * 151) % 200)];

// The ruler, the bands and the snap points are drawn as far as `reach` (the content shows as much of them as its height says): a
// canvas must not be taller than the 16,384 device px of a texture, or the ruler would show seams.
const bands = (reach) => Array.from({ length: Math.ceil(reach / BAND) }, (_, i) => `<div class=band style="top:${i * BAND}px;background:rgb(${bandColor(i)})"></div>`).join('');
// Snap points every 1,000 px, in the content (clipped with it): a scroll that is not told to ignore them lands on one.
const snaps = (reach) => Array.from({ length: Math.ceil(reach / 1000) }, (_, i) => `<div class=snap style="top:${i * 1000}px"></div>`).join('');

// The ruler and the content, for a content of `h` px.
const contentHtml = (h, { sticky, reach = h }) => `<div id=content style="height:${h}px">
<canvas id=ruler width=8 height=${reach}></canvas>${bands(reach)}${snaps(reach)}${sticky ? '<header id=head>sticky header</header>' : ''}
</div>`;

const rulerScript = (reach) => `
const c = document.getElementById('ruler').getContext('2d'), img = c.createImageData(8, ${reach});
for (let y = 0; y < ${reach}; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; img.data[i] = (y >> 8) & 255; img.data[i+1] = y & 255; img.data[i+2] = 128; img.data[i+3] = 255; }
c.putImageData(img, 0, 0);
window.__ready = true;`;

const CSS = `
html, body { margin:0; height:100%; font:20px sans-serif }
#bar { position:fixed; top:0; left:0; right:0; height:${PANE.top}px; background:#c01c28; z-index:9 }
#side { position:fixed; top:${PANE.top}px; left:0; width:${PANE.left}px; bottom:0; background:#555; z-index:9 }
#toast { position:fixed; top:${PANE.top + 12}px; right:${PANE.right}; width:100px; height:40px; background:#f5c211; z-index:9 }
#foot { position:fixed; bottom:0; left:${PANE.left + 20}px; right:0; height:50px; background:#26a269; z-index:9 }
#content { position:relative; overflow:clip }
#ruler { position:absolute; left:0; top:0; width:8px; image-rendering:pixelated }
.band { position:absolute; left:40px; width:200px; height:${BAND}px }
#head { position:sticky; top:0; height:60px; margin-left:20px; background:#1a5fb4; color:#fff; z-index:5 }
.snap { position:absolute; left:0; width:10px; height:1000px; scroll-snap-align:start }
.panel { position:absolute; overflow-y:auto; scroll-behavior:smooth; scroll-snap-type:y mandatory }`;

// `ruler`: how many rows the ruler has (0 = none)
const page = (title, css, body, script = '', ruler = 0) => `<!doctype html><html><head><meta charset=utf-8><title>${title}</title><style>${CSS}${css}</style></head><body>${body}<script>${ruler ? rulerScript(ruler) : 'window.__ready = true;'}${script}</script></body></html>`;

/**
 * The pages, by name. `opts` comes from the query string.
 * - shell: an application shell: the window does not scroll (overflow hidden), a panel does, with 5,000 px of content. A fixed
 *   bar and side around it, a toast and a footer over it. sticky=1: a sticky header in the panel. root=fixed: the shell is itself
 *   fixed to the window. collapse=1: the panel moves up as it scrolls. shrink=<px>: the content gets that short once it has
 *   scrolled 2,000 px. tall=<px>: the panel reaches that many px below the window, with a border.
 * - nested: the panel has a little to scroll, and in it a list of 6,000 px that scrolls on its own.
 * - grow: the content starts short and grows when the bottom is reached (lazy loading): delay = ms between the scroll and
 *   the growth, step = px added, three times. (The ruler and the bands are drawn up to 16,000 px, the limit of a texture.)
 * - sideways: nothing scrolls vertically; a block scrolls sideways only, and a text area scrolls its text.
 * - doc: the document scrolls (2,600 px); a small box scrolls too. A sticky header, a toast, a footer.
 * The corpus of difficult pages (what the web applications of the study do; each page is the same content, so the same checks apply):
 * - fade: the bands of a panel are drawn once they are in view, and fade in over 700 ms (CSS transition; js=1: a timer 1,200 ms after
 *   they came into view, then they appear at once: nothing a page can be asked about).
 * - lazyimg: the bands are images, loaded when they come into view; the server answers after `delay` ms (/img/<n>.svg).
 * - virtual: a virtualized list (Slack, Jira, a grid): only the bands near the window exist, drawn `delay` ms after the scroll stops.
 * - headroom: the document scrolls (3,000 px); its header is over the top of the content, and turns position:fixed once the page
 *   has scrolled by 100 px (a "sticky on scroll" script): at the first tile it is not fixed.
 * - shadow: the document scrolls (2,600 px); a toast and a footer are fixed, inside the open shadow root of a web component.
 * - frame: nothing scrolls, a frame holds the page (4,000 px of its own).
 * - locked: the document overflows (3,000 px) and the user cannot scroll it (a dialog open over a page): a script still can.
 * - tall: the document scrolls, `h` px high (a plain gradient).
 */
const PAGES = {
  shell: ({ sticky, root, collapse, shrink, tall }) => page('Test page', `
    html, body { overflow:hidden } #app { position:${root === 'fixed' ? 'fixed' : 'absolute'}; top:0; left:0; right:0; bottom:${tall ? -Number(tall) : 0}px }
    #pane { top:${PANE.top}px; left:${PANE.left}px; right:${PANE.edge}; bottom:0${tall ? '; border:6px solid #f0f' : ''} }`,
  `<div id=app><div id=bar></div><div id=side></div><div id=toast></div><div id=foot></div>
    <div id=pane class=panel>${contentHtml(5000, { sticky: sticky === '1' })}</div></div>`,
  `const pane = document.getElementById('pane');
    ${collapse === '1' ? `pane.addEventListener('scroll', () => { pane.style.top = Math.max(0, ${PANE.top} - pane.scrollTop / 20) + 'px'; });` : ''}
    ${shrink ? `let shrunk = false;
    pane.addEventListener('scroll', () => {
      if (shrunk || pane.scrollTop < 2000) return;
      shrunk = true;
      setTimeout(() => { document.getElementById('content').style.height = '${Number(shrink)}px'; window.__h = ${Number(shrink)}; }, 60);
    });` : ''}`, 5000),

  nested: () => page('Test page', `
    html, body { overflow:hidden }
    #pane { top:${PANE.top}px; left:${PANE.left}px; right:0; bottom:0 }
    #list { top:100px; left:60px; width:1200px; height:700px }`,
  `<div id=bar></div><div id=side></div>
    <div id=pane class=panel><div style="position:relative;height:1300px">
      <div id=list class=panel>${contentHtml(6000, { sticky: true })}</div>
    </div></div>`, '', 6000),

  grow: ({ delay = '60', step = '1500', start = '3000' }) => page('Test page', `
    html, body { overflow:hidden }
    #pane { top:${PANE.top}px; left:${PANE.left}px; right:${PANE.edge}; bottom:0 }`,
  `<div id=bar></div><div id=side></div><div id=toast></div><div id=foot></div>
    <div id=pane class=panel>${contentHtml(Number(start), { sticky: false, reach: Math.min(Number(start) + 3 * Number(step), 16000) })}</div>`, `
    const pane = document.getElementById('pane'), content = document.getElementById('content');
    let h = ${Number(start)}, grown = 0, pending = false;
    pane.addEventListener('scroll', () => {
      if (pending || grown >= 3 || pane.scrollTop + pane.clientHeight < h - 10) return;
      pending = true;
      setTimeout(() => { h += ${Number(step)}; content.style.height = h + 'px'; grown++; pending = false; window.__h = h; }, ${Number(delay)});
    });
    window.__h = h;`, Math.min(Number(start) + 3 * Number(step), 16000)),

  sideways: () => page('Test page', `
    html, body { overflow:hidden }
    #wide { position:absolute; top:100px; left:100px; width:1400px; height:700px; overflow-x:auto; background:#eee }
    #wide div { width:5000px; height:100%; background:linear-gradient(90deg, #ccc, #999) }
    #text { position:absolute; top:100px; left:1550px; width:300px; height:700px }`,
  `<div id=wide><div></div></div><textarea id=text></textarea>`, `document.getElementById('text').value = 'line\\n'.repeat(400);`),

  fade: ({ js }) => page('Test page', `
    html, body { overflow:hidden }
    #pane { top:${PANE.top}px; left:${PANE.left}px; right:${PANE.edge}; bottom:0 }
    .band { opacity:0 } .band.in { opacity:1${js === '1' ? '' : '; transition:opacity 700ms linear'} }`,
  `<div id=bar></div><div id=side></div><div id=pane class=panel>${contentHtml(5000, { sticky: false })}</div>`, `
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting || e.target.classList.contains('seen')) return;
      e.target.classList.add('seen');
      ${js === '1' ? "setTimeout(() => e.target.classList.add('in'), 1200)" : "e.target.classList.add('in')"};
    }), { root: document.getElementById('pane') });
    document.querySelectorAll('.band').forEach((b) => io.observe(b));`, 5000),

  lazyimg: ({ delay = '600' }) => page('Test page', `
    html, body { overflow:hidden }
    #pane { top:${PANE.top}px; left:${PANE.left}px; right:${PANE.edge}; bottom:0 }`,
  `<div id=bar></div><div id=side></div><div id=pane class=panel><div id=content style="height:5000px">
    <canvas id=ruler width=8 height=5000></canvas>${Array.from({ length: 5000 / BAND }, (_, i) => `<img class=band data-src="/img/${i}.svg?delay=${Number(delay)}" alt="" style="top:${i * BAND}px">`).join('')}
    </div></div>`, `
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting && !e.target.src) e.target.src = e.target.dataset.src;
    }), { root: document.getElementById('pane') });
    document.querySelectorAll('img.band').forEach((b) => io.observe(b));`, 5000),

  virtual: ({ delay = '1200' }) => page('Test page', `
    html, body { overflow:hidden }
    #pane { top:${PANE.top}px; left:${PANE.left}px; right:${PANE.edge}; bottom:0 }`,
  `<div id=bar></div><div id=side></div><div id=pane class=panel><div id=content style="height:5000px"><canvas id=ruler width=8 height=5000></canvas></div></div>`, `
    const pane = document.getElementById('pane'), content = document.getElementById('content'), drawn = new Map();
    const colors = ${JSON.stringify(Array.from({ length: 5000 / BAND }, (_, i) => `rgb(${bandColor(i)})`))};
    function render() { // the bands near the window exist, the others are removed
      const from = Math.floor(pane.scrollTop / ${BAND}) - 1, to = Math.ceil((pane.scrollTop + pane.clientHeight) / ${BAND}) + 1;
      for (const [i, el] of drawn) if (i < from || i > to) { el.remove(); drawn.delete(i); }
      for (let i = Math.max(0, from); i <= Math.min(colors.length - 1, to); i++) {
        if (drawn.has(i)) continue;
        const d = document.createElement('div');
        d.className = 'band'; d.style.top = i * ${BAND} + 'px'; d.style.background = colors[i];
        content.append(d); drawn.set(i, d);
      }
    }
    let timer;
    pane.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(render, ${Number(delay)}); });
    render();`, 5000),

  headroom: () => page('Test page', `
    body { height:3000px; position:relative } #content { height:3000px }
    #head { position:absolute; top:0; left:20px; right:0; height:60px; background:#1a5fb4; z-index:5 } #head.stuck { position:fixed }`,
  `<header id=head>header</header>${contentHtml(3000, { sticky: false })}`, `
    addEventListener('scroll', () => document.getElementById('head').classList.toggle('stuck', scrollY > 100));`, 3000),

  shadow: () => page('Test page', `
    body { height:2600px; position:relative } #content { height:2600px }`,
  `${contentHtml(2600, { sticky: false })}<x-widget></x-widget>`, `
    customElements.define('x-widget', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>#toast{position:fixed;top:60px;right:10px;width:100px;height:40px;background:#f5c211;z-index:9}'
          + '#foot{position:fixed;bottom:0;left:140px;right:0;height:50px;background:#26a269;z-index:9}</style><div id=toast></div><div id=foot></div>';
      }
    });`, 2600),

  frame: () => page('Test page', `
    html, body { overflow:hidden } iframe { position:absolute; inset:0; width:100%; height:100%; border:0 }`,
  `<iframe srcdoc="<body style='margin:0'><div style='height:4000px;background:linear-gradient(#26a269,#1a5fb4)'></div></body>"></iframe>`),

  locked: () => page('Test page', `
    body { overflow:hidden; height:3000px; position:relative } #content { height:3000px }`,
  contentHtml(3000, { sticky: false }), '', 3000),

  tall: ({ h = '18000' }) => page('Test page', `
    body { height:${Number(h)}px; background:repeating-linear-gradient(#ddd 0 100px, #999 100px 200px) }`,
  `<div id=big></div>`),

  doc: () => page('Test page', `
    body { height:2600px; position:relative } #content { height:2600px }
    #bar { left:auto; right:0; width:200px; height:40px } #toast { right:10px }
    #small { position:absolute; top:480px; left:900px; width:300px; height:200px; overflow-y:auto; background:#fed }
    #small div { height:1000px }`,
  `<div id=bar></div><div id=toast></div><div id=foot></div>${contentHtml(2600, { sticky: true })}<div id=small><div></div></div>`, '', 2600),
};

/** Local server of the pages: GET /s/<name>.html?<options>. */
export async function startScrollSite() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const img = /^\/img\/(\d+)\.svg$/.exec(url.pathname)?.[1]; // a band as an image, late: ?delay=<ms>
    if (img !== undefined) {
      const [r, g, b] = bandColor(Number(img));
      setTimeout(() => res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${BAND}"><rect width="200" height="${BAND}" fill="rgb(${r},${g},${b})"/></svg>`), Number(url.searchParams.get('delay')) || 0);
      return;
    }
    const name = /^\/s\/(\w+)\.html$/.exec(url.pathname)?.[1];
    const build = name && Object.hasOwn(PAGES, name) ? PAGES[name] : null;
    if (!build) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(build(Object.fromEntries(url.searchParams)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  return { origin, close: () => new Promise((done) => server.close(done)) };
}

// ---------------------------------------------------------------- reading the image

/** Pixel columns and points of the original of the last shot (flat RGBA / [r, g, b, a]). Runs in the service worker. */
export const shotPixels = (sw, { columns = [], points = [] }) => sw.evaluate(async ({ columns, points }) => {
  const blob = await __t.db.getOriginal((await __t.db.queryShots({ limit: 1 })).items[0].id); // the most recent
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const out = {
    w: bitmap.width,
    h: bitmap.height,
    columns: columns.map((x) => Array.from(g.getImageData(x, 0, 1, bitmap.height).data)),
    points: points.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data)),
  };
  bitmap.close();
  return out;
}, { columns, points });

const near = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/** Runs of a color along a column (flat RGBA): how many separate runs, the first and last row. */
export function runs(col, color, tol = 40) {
  let count = 0, inRun = false, first = null, last = null;
  for (let i = 0; i < col.length / 4; i++) {
    const hit = near(col.slice(i * 4, i * 4 + 3), color, tol);
    if (hit && !inRun) { count++; first ??= i; }
    if (hit) last = i;
    inRun = hit;
  }
  return { count, first, last };
}

const BLUE = [26, 95, 180], YELLOW = [245, 194, 17], GREEN = [38, 162, 105], RED = [192, 28, 40];

/**
 * What the image of a panel must be (`shot`: its size; `dpr`: display scale; `contentH`: the height of the content in CSS px).
 * Reads three columns (the ruler, the middle of the content, the right edge) and one point per band.
 */
export async function verifyPanel(sw, shot, { dpr, contentH }) {
  const { w: W, h: H } = shot;
  const xs = [2, Math.round(300 * dpr), W - Math.round(60 * dpr)];
  const nBands = Math.floor(contentH / BAND);
  const points = Array.from({ length: nBands }, (_, i) => [Math.round(100 * dpr), Math.round((i * BAND + BAND / 2) * dpr)]);
  const { columns: [ruler, mid, edge], points: probe } = await shotPixels(sw, { columns: xs, points: points.filter(([, y]) => y < H) });
  const at = (col, i) => col.slice(i * 4, i * 4 + 3);

  // The scale of the image is its height over the content: dpr at an integer scale, and at a fractional one the ratio of the
  // image to the window (which sw.js uses too, as the page cannot say better than a whole number of CSS px): up to half a row
  // per tile away from dpr. A row is then right to the nearest one.
  const tolerance = Number.isInteger(dpr) ? 0 : 1;
  const badRows = [];
  for (let i = 0; i < H; i++) {
    const [r, g] = at(ruler, i);
    const want = Math.min(Math.floor(((i + 0.5) * contentH) / H), contentH - 1);
    // At a fractional scale the browser filters the ruler where its color jumps (the low byte wraps): not the capture's doing
    if (tolerance && (want & 255) >= 254 || tolerance && (want & 255) <= 1) continue;
    if (Math.abs(((r << 8) | g) - want) > tolerance) badRows.push(i);
  }
  const badBands = probe.map((p, i) => (near(p, [...bandColor(i), 255], 6) ? null : i)).filter((i) => i !== null);
  return {
    W, H, badRows: badRows.length, firstBadRow: badRows[0] ?? null, badBands, bands: probe.length,
    header: runs(mid, BLUE), red: runs(mid, RED), redEdge: runs(edge, RED),
    toast: runs(edge, YELLOW), foot: runs(mid, GREEN),
  };
}
