// Injected by sw.js (activeTab) after sensitive.js when "Hide sensitive text" is on: covers in black what sensitive.js finds in the text of the page,
// for the length of one image. apply() searches again before every image (a full page loads content as it scrolls), clear() puts the page back.
// The cover is the CSS Custom Highlight API: no node is added, no text changes, and it follows a panel that scrolls.
// ponytail: only the text of the document and of open shadow roots is searched, block by block; images, canvases, frames, closed shadow DOM and the value of a field are not seen. Inject in the frames (allFrames) when they matter.
(() => {
  window.__obturoRedact?.clear(); // recovery after a crash

  const NAME = 'obturo-redact';
  const SHEET = `::highlight(${NAME}){background-color:#000;color:#000;text-shadow:none;text-decoration:none}`;
  const BUDGET_MS = 400; // the search for one image: past it, the text left is not looked at, and result() says so
  const MAX_NODES = 200_000;
  const WATCHDOG_MS = 15_000; // with no new call from the service worker for this long, the page restores itself
  const FRAME_WAIT_MS = 150; // max wait for two frames: requestAnimationFrame does not fire if the window is hidden
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA']);
  const INLINE = new Set(['inline', 'contents']);
  const { find } = globalThis.__obturoSensitive;

  const seen = new Set(); // what an image showed (text node and offset), counted once across the images of a full page
  const ids = new WeakMap();
  /** @type {WeakMap<Element, Element>} */
  let blocks = new WeakMap(); // block of an element, for one search: styles can change between two images
  let nextId = 0, incomplete = false, timer;
  /** @type {{ sheet: CSSStyleSheet, roots: Set<Document | ShadowRoot> } | null} */
  let cover = null;
  /** @type {Range[] | null} */
  let selected = null; // what the person had selected, put back by clear()
  /** @type {Map<Element, string | null>} */
  const painted = new Map(); // SVG text takes its color from `fill`, which a highlight cannot set: its element is painted black for the length of the image, with the style attribute it had

  const idOf = (node) => ids.get(node) ?? (ids.set(node, ++nextId), nextId);
  const shown = (range, box) => {
    for (const b of range.getClientRects()) {
      if (b.width > 0 && b.height > 0 && b.right > box.x && b.left < box.x + box.w && b.bottom > box.y && b.top < box.y + box.h) return true;
    }
    return false;
  };
  const frames = () => new Promise((done) => {
    const late = setTimeout(done, FRAME_WAIT_MS);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(late); done(undefined); }));
  });

  /** The element that lays out the text of `el`: inline elements are part of the text around them. @param {Element} el @returns {Element} */
  const blockOf = (el) => {
    let block = blocks.get(el);
    if (!block) {
      block = INLINE.has(getComputedStyle(el).display) && el.parentElement ? blockOf(el.parentElement) : el;
      blocks.set(el, block);
    }
    return block;
  };
  /** @param {Text} node */
  const visible = (node) => node.parentElement?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ?? true;
  /** Index of the part that holds position `pos`. @param {number[]} starts */
  const partAt = (starts, pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  /** The ranges to hide, and the roots they are in; the ones that `box` (the part of the window an image shows) contains are counted. */
  function search(box) {
    const deadline = performance.now() + BUDGET_MS;
    blocks = new WeakMap();
    const ranges = [];
    const found = new Set();
    const svgText = new Set();
    const roots = [document]; // grows while it is walked: open shadow roots are added
    let nodes = 0;
    /** @type {Text[]} */
    let run = []; // the text nodes of one block, one after the other: a value split by the markup is found across them
    let runBlock;
    let lineBreak = false;

    const scan = (/** @type {Document | ShadowRoot} */ root) => {
      if (!run.length) return;
      const starts = [];
      let text = '';
      for (const n of run) { starts.push(text.length); text += n.data; }
      for (const hit of text.length < 6 ? [] : find(text)) {
        const first = partAt(starts, hit.start), last = partAt(starts, hit.end - 1);
        const range = new Range();
        range.setStart(run[first], hit.start - starts[first]);
        range.setEnd(run[last], hit.end - starts[last]);
        ranges.push(range);
        found.add(root);
        for (let i = first; i <= last; i++) if (run[i].parentElement instanceof SVGElement) svgText.add(run[i].parentElement);
        if (shown(range, box) && visible(run[first])) seen.add(`${idOf(run[first])}:${hit.start - starts[first]}`);
      }
      run = [];
    };

    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: /** @param {any} n */ (n) => n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
          : SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT
            : (n.tagName === 'BR' && (lineBreak = true), n.shadowRoot && roots.push(n.shadowRoot), NodeFilter.FILTER_SKIP),
      });
      for (let n = /** @type {Text | null} */ (walker.nextNode()); n; n = /** @type {Text | null} */ (walker.nextNode())) {
        if (++nodes > MAX_NODES || (nodes % 256 === 0 && performance.now() > deadline)) {
          incomplete = true;
          scan(root);
          return { ranges, found, svgText };
        }
        const block = n.parentElement ? blockOf(n.parentElement) : root;
        if (lineBreak || block !== runBlock) scan(root);
        lineBreak = false;
        runBlock = block;
        run.push(n);
      }
      scan(root);
      runBlock = undefined;
    }
    return { ranges, found, svgText };
  }

  /** The browser paints a selection over the cover: a selection that touches covered text is lifted for the length of the image. @param {Range[]} ranges */
  function liftSelection(ranges) {
    const selection = getSelection();
    if (selected || !selection || selection.isCollapsed || !ranges.some((r) => selection.containsNode(r.startContainer, true))) return;
    selected = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i));
    selection.removeAllRanges();
  }

  /** Covers the sensitive text in view and waits for it to be painted. @param {{ x: number, y: number, w: number, h: number }} [region] The part of the window an image keeps (an area); the whole window by default. */
  async function apply(region) {
    clearTimeout(timer);
    timer = setTimeout(clear, WATCHDOG_MS);
    document.getElementById('obturo-notice')?.remove(); // the note of the previous capture must not be in this image
    const { ranges, found, svgText } = search(region ?? { x: 0, y: 0, w: innerWidth, h: innerHeight });
    if (!ranges.length) return void CSS.highlights.delete(NAME);
    for (const el of svgText) {
      if (painted.has(el)) continue;
      painted.set(el, el.getAttribute('style'));
      /** @type {SVGElement} */ (el).style.setProperty('fill', '#000', 'important');
    }
    cover ??= { sheet: new CSSStyleSheet(), roots: new Set() };
    cover.sheet.replaceSync(SHEET);
    for (const root of found) {
      if (cover.roots.has(root)) continue;
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, cover.sheet];
      cover.roots.add(root);
    }
    CSS.highlights.set(NAME, new Highlight(...ranges));
    liftSelection(ranges);
    await frames();
  }

  /** Puts the page back as it was. Idempotent. */
  function clear() {
    clearTimeout(timer);
    CSS.highlights.delete(NAME);
    if (selected) {
      const selection = getSelection();
      selection?.removeAllRanges();
      for (const range of selected) selection?.addRange(range);
      selected = null;
    }
    for (const [el, style] of painted) {
      if (style === null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
    painted.clear();
    if (!cover) return;
    for (const root of cover.roots) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== cover.sheet);
    cover = null;
  }

  window.__obturoRedact = { apply, clear, result: () => ({ hidden: seen.size, incomplete }) };
})();
