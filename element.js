// Injected on demand by sw.js (activeTab): pick an element of the page. The page stays live (its hover styles and menus keep working),
// a box follows the pointer, and a click sends the box of the element as an area to capture, like the selection of overlay.js does.
(() => {
  if (document.getElementById('obturo-element')) return;

  const MIN_SIZE = 5; // px: a smaller element is ignored, as a smaller area is

  const box = document.createElement('div');
  box.id = 'obturo-element';
  box.style.cssText = 'all:initial;display:none;position:fixed;z-index:2147483647;box-sizing:border-box;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.18)';

  let x = -1, y = -1, frame = 0; // the last position of the pointer
  let el = null; // the element in the box
  let manual = false; // chosen with Alt+Arrow: a scroll keeps it, the pointer takes it back
  const left = []; // the elements left by Alt+ArrowUp, for Alt+ArrowDown to come back through

  // The part of the element that is in the window: what a capture of the tab can show.
  const rectOf = (node) => {
    const r = node.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
    return { x: x0, y: y0, w: Math.min(innerWidth, r.right) - x0, h: Math.min(innerHeight, r.bottom) - y0 };
  };

  const show = (node) => {
    el = node;
    const r = node && rectOf(node);
    if (!r || r.w < 1 || r.h < 1) {
      box.style.display = 'none';
      return;
    }
    Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };

  const pick = () => {
    frame = 0;
    show(manual ? el : document.elementFromPoint(x, y)); // the box has no pointer events: it is never the element under the pointer
  };
  const schedule = () => { frame ||= requestAnimationFrame(pick); };

  const done = new AbortController();
  const finish = (r) => {
    cancelAnimationFrame(frame);
    const edit = box.dataset.edit === '1'; // "capture and edit": set by sw.js after the injection, read before the box goes
    box.remove();
    done.abort();
    if (!r) return;
    // 2 frames so the box is gone from the rendering before the SW captures
    requestAnimationFrame(() => requestAnimationFrame(() => chrome.runtime.sendMessage({
      type: 'area', rect: r, vw: innerWidth, vh: innerHeight, url: location.href, title: document.title, edit,
    })));
  };

  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const on = (type, fn, passive = false) => addEventListener(type, fn, { capture: true, passive, signal: done.signal });

  on('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    manual = false;
    left.length = 0;
    schedule();
  }, true);
  on('scroll', schedule, true);
  on('resize', schedule, true);
  // The press and the release of a click that picks the element are the page's no more than the click is: a button under it is not pressed.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) on(type, (e) => { if (!e.button) stop(e); });
  on('click', (e) => {
    if (e.button) return;
    stop(e);
    const r = el && rectOf(el);
    if (r && r.w >= MIN_SIZE && r.h >= MIN_SIZE) finish(r);
  });
  on('keydown', (e) => {
    if (e.key === 'Escape') {
      stop(e);
      finish(null);
      return;
    }
    if (!e.altKey || !el || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    stop(e);
    if (e.key === 'ArrowUp') {
      if (!el.parentElement) return;
      left.push(el);
      manual = true;
      show(el.parentElement);
      return;
    }
    const child = left.pop() ?? [...el.children].find((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!child) return;
    manual = true;
    show(child);
  });

  document.documentElement.append(box);
})();
