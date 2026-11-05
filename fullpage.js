// Injected by sw.js (activeTab) before a full-page capture: drives the page (which element scrolls, scrolling, fixed elements).
// begin() describes the elements that scroll, sw.js picks one (pickScroller, fullpage-pure.js), aim() takes it as the target, go() scrolls it
// and waits for the page to settle (settle()); the fixed and sticky elements are looked for again at every tile (findFloating()).
// ponytail: scrollers inside an iframe are not seen and the iframe is captured as it shows; inject fullpage.js in the frames (allFrames) and drive the one that scrolls.
// ponytail: one target per capture; a page made of several scrolling columns gives the dominant one only; capture the columns in turn and put them side by side.
// ponytail: a target whose box moves while it scrolls (collapsing header) stops the capture (sw.js); follow the box tile by tile.
// ponytail: settle() waits for images that load and CSS animations that end, in view; a page that renders or fades in by script (requestAnimationFrame, timers) is not seen, that is what the wait of the settings is for; watch the DOM until it is quiet.
// ponytail: fixed and sticky elements inside a closed shadow root are not found and repeat on every tile (open shadow roots are walked).
(() => {
  window.__obturoFull?.end(); // recovery after a crash: put the page back in order first

  const WATCHDOG_MS = 15_000; // with no new call from the service worker for this long, the page restores itself
  const FRAME_WAIT_MS = 500; // max wait for two frames: requestAnimationFrame does not fire if the window is hidden
  const SETTLE_MS = 120; // lets lazy loading and sticky elements settle after a scroll
  const BUSY_MS = 1500; // the most a tile waits for the images in view to load and the animations in view to end (after SETTLE_MS)
  // Where scrollers are looked for: 1/6, 1/2 and 5/6 of each side of the window. A box that shows MIN_SHARE of the window
  // (fullpage-pure.js) holds one of these 9 points, so nothing that matters is missed, and the cost does not depend on the size of the DOM.
  const PROBES = [1 / 6, 1 / 2, 5 / 6];

  const root = document.documentElement;
  const scroller = document.scrollingElement || root;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

  let active = false, cancelled = false, scrollY0, timer;
  let scrollPins = []; // scroll styles forced on the document and on the target (smooth, snap)
  let floating = []; // fixed and sticky elements, hidden or put back in place depending on the tile
  let found = []; // the elements begin() described, in the same order
  let target = null; // what aim() chose: the document (el null) or a scroller
  let opts = { wait: 0, fixed: 'edges' }; // the settings of this capture, from begin(): wait = extra ms after each scroll; fixed = 'edges' | 'hide'

  // During the capture, the user must not scroll the page under our feet (Escape cancels).
  const block = (e) => e.preventDefault();
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') cancelled = true;
    else if (SCROLL_KEYS.has(e.key)) e.preventDefault();
  };
  /** @type {Array<[string, EventListener]>} */
  const LISTENERS = [['wheel', block], ['touchmove', block], ['keydown', onKey]];

  // If the service worker disappears midway, the page puts itself back in order.
  const armWatchdog = () => { clearTimeout(timer); timer = setTimeout(end, WATCHDOG_MS); };

  // A style forced on an element, with its original value and priority so everything can be restored.
  const override = (e, prop, val) => ({
    e, prop, val, prev: e.style.getPropertyValue(prop), prio: e.style.getPropertyPriority(prop),
  });
  const setOverride = (o, on) => {
    if (on) o.e.style.setProperty(o.prop, o.val, 'important');
    else if (o.prev) o.e.style.setProperty(o.prop, o.prev, o.prio);
    else o.e.style.removeProperty(o.prop);
  };
  // scroll-behavior smooth: scrolling would animate and the position read at capture time would be wrong;
  // scroll-snap: the browser would snap the element back to a snap point after each scroll.
  const pin = (e) => [override(e, 'scroll-behavior', 'auto'), override(e, 'scroll-snap-type', 'none')];

  // What scrolls: the document, or an element inside it. box: where its content shows in the window (CSS px); max: how far it scrolls.
  const whole = () => ({
    el: null,
    y0: scrollY,
    box: () => ({ x: 0, y: 0, w: scroller.clientWidth, h: scroller.clientHeight }),
    max: () => scroller.scrollHeight - scroller.clientHeight,
    get: () => scrollY,
    set: (y) => scrollTo(scrollX, y),
  });
  const inside = (el) => ({
    el,
    y0: el.scrollTop,
    box: () => {
      const r = el.getBoundingClientRect();
      return { x: r.left + el.clientLeft, y: r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight };
    },
    max: () => el.scrollHeight - el.clientHeight,
    get: () => el.scrollTop,
    set: (y) => { el.scrollTop = y; },
  });

  // The element as a candidate (client box in the window, scroll range), or null if it does not scroll vertically.
  // Horizontal scrolling alone leaves scrollHeight = clientHeight; text fields scroll their own text, not a page.
  function describe(e, bodyIsViewport) {
    const tag = e.tagName;
    if (e === root || e === scroller || (e === document.body && bodyIsViewport)) return null;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return null;
    const max = e.scrollHeight - e.clientHeight;
    if (!(max > 0) || !e.clientWidth || !e.clientHeight) return null;
    const overflow = getComputedStyle(e).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + e.clientLeft, y: r.top + e.clientTop, w: e.clientWidth, h: e.clientHeight, max };
  }

  // The elements that scroll under the probe points: hit tests only (the stack of elements at a point, covered ones included,
  // those clipped away or off screen excluded), open shadow roots followed. Nothing walks the whole DOM.
  function scan(bodyIsViewport) {
    const done = new Set();
    const cands = [];
    for (const fx of PROBES) {
      for (const fy of PROBES) {
        /** @type {Array<Document | ShadowRoot>} */
        const roots = [document]; // a shadow root met on the way is appended and searched in turn
        const seen = new Set();
        for (const r of roots) {
          for (const e of r.elementsFromPoint(fx * innerWidth, fy * innerHeight)) {
            if (seen.has(e)) continue;
            seen.add(e);
            if (e.shadowRoot) roots.push(e.shadowRoot);
            if (done.has(e)) continue;
            done.add(e);
            const c = describe(e, bodyIsViewport);
            if (c) { found.push(e); cands.push(c); }
          }
        }
      }
    }
    return cands;
  }

  // The visible share of the window (0 to 1) of the biggest frame: what a frame shows is captured as it shows, never scrolled.
  function frameShare() {
    let best = 0;
    for (const f of document.querySelectorAll('iframe, frame')) {
      const r = f.getBoundingClientRect();
      const w = Math.min(innerWidth, r.right) - Math.max(0, r.left), h = Math.min(innerHeight, r.bottom) - Math.max(0, r.top);
      if (w > 0 && h > 0) best = Math.max(best, (w * h) / (innerWidth * innerHeight));
    }
    return best;
  }

  /** @param {{ wait?: number, fixed?: string }} [o] */
  function begin(o) {
    document.getElementById('obturo-notice')?.remove(); // the message of the last capture (notice.js) must not be in this image
    opts = { wait: Math.min(5000, Math.max(0, Number(o?.wait) || 0)), fixed: o?.fixed === 'hide' ? 'hide' : 'edges' };
    active = true;
    cancelled = false;
    scrollY0 = scrollY;
    target = null;
    found = [];
    scrollPins = [root, document.body].filter(Boolean).flatMap(pin);
    for (const o of scrollPins) setOverride(o, true);
    for (const [type, fn] of LISTENERS) addEventListener(type, fn, { capture: true, passive: false });
    armWatchdog();
    // When the root does not set `overflow`, the one of the body is the one of the window (the body itself then scrolls nothing).
    const bodyIsViewport = getComputedStyle(root).overflowY === 'visible';
    const viewport = getComputedStyle(bodyIsViewport && document.body ? document.body : root).overflowY;
    return {
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      doc: { user: viewport !== 'hidden' && viewport !== 'clip', max: scroller.scrollHeight - scroller.clientHeight },
      frame: frameShare(),
      cands: scan(bodyIsViewport),
    };
  }

  // Takes the element that sw.js picked (index in the list of begin(), -1 = the document) as the target.
  function aim(i) {
    if (!active) throw new Error('restored');
    armWatchdog();
    const el = i >= 0 ? found[i] : null;
    if (i >= 0 && !el?.isConnected) throw new Error('scroller gone');
    target = el ? inside(el) : whole();
    if (el) {
      const pins = pin(el);
      for (const o of pins) setOverride(o, true);
      scrollPins.push(...pins);
    }
    floating = [];
    return { box: target.box(), max: target.max(), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio };
  }

  // `node` is `outer` or inside it, through the shadow roots (a shadow root has no parent, its host is the way up).
  const within = (outer, node) => {
    for (let n = /** @type {any} */ (node); n; n = n.parentNode ?? n.host) if (n === outer) return true;
    return false;
  };
  // Every element under `root`, the open shadow roots met on the way included.
  function* allElements(root) {
    for (const e of root.querySelectorAll('*')) {
      yield e;
      if (e.shadowRoot) yield* allElements(e.shadowRoot);
    }
  }

  // The fixed and sticky elements that would repeat on every tile, in the state the page is in NOW (a header that turns fixed once
  // the page has scrolled is only seen after the scroll): all of them for the document; for a scroller, the ones inside it and the
  // fixed ones that cover it (what is elsewhere is not in the image).
  function findFloating() {
    const el = target.el, b = target.box();
    const list = [];
    if (!document.body) return list;
    for (const e of allElements(document.body)) {
      const pos = getComputedStyle(e).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      if (el && within(e, el)) continue; // the target is inside it (an app shell fixed to the window): hiding it would hide the target
      const r = e.getBoundingClientRect();
      if (el && !within(el, e) && !(r.right > b.x && r.left < b.x + b.w && r.bottom > b.y && r.top < b.y + b.h)) continue;
      const sticky = pos === 'sticky';
      // anchored at the bottom of the box: visible on the last tile only
      const bottom = !sticky && r.top + r.height / 2 > b.y + b.h / 2;
      // sticky: back to its natural place, fixed: hidden
      list.push({ ...override(e, sticky ? 'position' : 'visibility', sticky ? 'static' : 'hidden'), sticky, bottom });
    }
    return list;
  }

  // Is the override of a floating element on for this tile? A sticky element goes back to its place on every tile but the first. A
  // fixed element at the top shows on the 1st tile only, one at the bottom on the last tile only (footer), otherwise they would
  // repeat on every tile; with the 'hide' setting no fixed element shows at all.
  const hides = (o, phase) => (o.sticky ? phase !== 'first'
    : opts.fixed === 'hide' || phase === 'mid' || (phase === 'first' ? o.bottom : !o.bottom));

  const inWindow = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

  // What a scroll set going that is still running, in view: images that load (lazy loading) and animations that end (fade-ins).
  // Endless animations and the ones tied to the scroll are not waited for.
  function pending() {
    const busy = [];
    for (const img of document.images) {
      if (img.complete || !(img.currentSrc || img.src) || !inWindow(img.getBoundingClientRect())) continue;
      busy.push(new Promise((done) => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }));
    }
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running' || a.timeline !== document.timeline) continue;
      const end = a.effect?.getComputedTiming().endTime;
      const at = /** @type {KeyframeEffect} */ (a.effect)?.target;
      if (end === Infinity || Number(end) - Number(a.currentTime ?? 0) > BUSY_MS) continue; // endless, or too long to wait for (a loading shimmer)
      if (!(at instanceof Element) || !inWindow(at.getBoundingClientRect())) continue;
      busy.push(a.finished.catch(() => {}));
    }
    return busy;
  }

  // After a scroll: two frames, SETTLE_MS, then what pending() sees until it sees nothing (BUSY_MS at most), then the wait the user chose.
  async function settle() {
    await Promise.race([nextFrame().then(nextFrame), sleep(FRAME_WAIT_MS)]);
    await sleep(SETTLE_MS);
    const until = performance.now() + BUSY_MS;
    for (let round = 0; round < 3; round++) { // what ends can start something else (an image loads, then fades in)
      const busy = pending();
      if (!busy.length) break;
      await Promise.race([Promise.allSettled(busy), sleep(Math.max(0, until - performance.now()))]);
      if (performance.now() >= until) break;
      await Promise.race([nextFrame(), sleep(FRAME_WAIT_MS)]);
    }
    if (opts.wait) await sleep(opts.wait);
  }

  // phase: 'first' | 'mid' | 'last' (see hides). The page is put back as it is before every scroll, so what floats is looked for in the
  // state it has at the new position.
  async function go(y, phase) {
    // The watchdog may have restored the page: do not hide it again, the SW must give up.
    if (!active || !target) throw new Error('restored');
    if (target.el && !target.el.isConnected) throw new Error('scroller gone');
    armWatchdog();
    for (const o of floating) setOverride(o, false);
    floating = [];
    target.set(y);
    await settle();
    if (!active || !target) throw new Error('restored');
    floating = findFloating();
    for (const o of floating) setOverride(o, hides(o, phase));
    await Promise.race([nextFrame().then(nextFrame), sleep(FRAME_WAIT_MS)]); // what was hidden is no longer painted
    if (!active || !target) throw new Error('restored');
    // ACTUAL position: the browser clamps the last tile. vh: the SW detects a resize or a zoom change along the way.
    // max: the content may have grown (lazy loading). box: where the target is, the SW checks that it did not move.
    return { y: target.get(), cancelled, vh: innerHeight, max: target.max(), box: target.box() };
  }

  // How far the target scrolls now: the SW looks once more after the last tile, what that tile triggers often arrives later.
  function size() {
    if (!active || !target) throw new Error('restored');
    armWatchdog();
    return { max: target.max() };
  }

  function end() {
    clearTimeout(timer);
    if (active) {
      active = false;
      for (const o of floating) setOverride(o, false);
      if (target?.el) target.el.scrollTop = target.y0;
      scrollTo(scrollX, scrollY0);
      for (const o of scrollPins) setOverride(o, false); // after the scrolls, otherwise an animated return or a snap back to a snap point
      for (const [type, fn] of LISTENERS) removeEventListener(type, fn, true);
      floating = []; scrollPins = []; found = []; target = null; // no reference to the page left behind
    }
    return true;
  }

  window.__obturoFull = { begin, aim, go, size, end };
})();
