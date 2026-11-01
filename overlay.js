// Injected on demand by sw.js (activeTab): select an area with the mouse.
(() => {
  if (document.getElementById('obturo-overlay')) return;

  const MIN_SIZE = 5; // px: a smaller selection is ignored (accidental click)

  const box = document.createElement('div');
  box.id = 'obturo-overlay';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;background:rgba(0,0,0,.25)';
  const sel = document.createElement('div');
  // the box-shadow darkens the whole viewport except the selection
  const SEL = 'position:absolute;display:block;border:1px solid #fff;box-shadow:0 0 0 100vmax rgba(0,0,0,.45);';
  sel.style.cssText = 'display:none';
  box.append(sel);

  let x0, y0, last, frame = 0;
  const rectOf = (e) => ({
    x: Math.min(x0, e.clientX), y: Math.min(y0, e.clientY),
    w: Math.abs(e.clientX - x0), h: Math.abs(e.clientY - y0),
  });

  // One style write per frame, and no layout read during the drag:
  // only the last pointer position is kept.
  const draw = () => {
    frame = 0;
    const r = rectOf(last);
    sel.style.cssText = `${SEL}left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
  };

  const finish = (r) => {
    cancelAnimationFrame(frame);
    const edit = box.dataset.edit === '1'; // "capture and edit": set by sw.js after the injection, read before the box goes
    box.remove();
    removeEventListener('keydown', onKey, true);
    if (!r || r.w < MIN_SIZE || r.h < MIN_SIZE) return;
    // 2 frames so the overlay is gone from the rendering before the SW captures
    requestAnimationFrame(() => requestAnimationFrame(() => chrome.runtime.sendMessage({
      type: 'area', rect: r, vw: innerWidth, vh: innerHeight, url: location.href, title: document.title, edit,
    })));
  };
  const onKey = (e) => { if (e.key === 'Escape') finish(null); };

  box.onpointerdown = (e) => {
    if (e.button) return; // only the main button (or touch) starts the selection
    box.setPointerCapture(e.pointerId);
    x0 = e.clientX; y0 = e.clientY;
    last = e;
    box.style.background = 'none';
    frame ||= requestAnimationFrame(draw);
  };
  box.onpointermove = (e) => {
    if (x0 == null) return;
    last = e;
    frame ||= requestAnimationFrame(draw);
  };
  box.onpointerup = (e) => { if (x0 != null && !e.button) finish(rectOf(e)); };
  box.onpointercancel = () => finish(null); // the browser takes the gesture over (touch gesture, etc.)

  addEventListener('keydown', onKey, true);
  document.documentElement.append(box);
})();
