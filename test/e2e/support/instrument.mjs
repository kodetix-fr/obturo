// Instrumentation injected before any script of every page (via context.addInitScript, so also in the pages of the
// extension). This function is serialized and run in the browser: it must not use any variable of the module.
//
// - window.__csp: violations of the content security policy;
// - window.__c: resource counters (bitmaps opened and closed, object URLs created and revoked) and a log of the
//   decodes, for leak and first-render measurements (npm run bench);
// - window.__uiReady: instant when the editor becomes usable (fieldset#ui enabled again);
// - window.__failDb: simulated database failure. true = every transaction fails, 'write' = only writes
//   fail. sessionStorage.failDb makes it active from page load.
export function instrument() {
  const w = window;
  w.__csp = [];
  addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`));

  w.__c = { bmp: 0, bmpClosed: 0, urls: 0, revoked: 0, urlLive: new Set(), calls: [] };
  const createImageBitmap = w.createImageBitmap.bind(w);
  w.createImageBitmap = (...args) => {
    w.__c.bmp++;
    const options = args[args.length - 1];
    w.__c.calls.push({
      at: performance.now(),
      resize: !!(options && typeof options === 'object' && 'resizeWidth' in options),
      crop: args.length > 3,
    });
    return createImageBitmap(...args);
  };
  const close = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function () {
    w.__c.bmpClosed++;
    return close.call(this);
  };
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = createObjectURL(blob);
    w.__c.urls++;
    w.__c.urlLive.add(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    w.__c.revoked++;
    w.__c.urlLive.delete(url);
    return revokeObjectURL(url);
  };

  addEventListener('DOMContentLoaded', () => {
    const ui = /** @type {HTMLFieldSetElement | null} */ (document.getElementById('ui'));
    if (!ui) return;
    new MutationObserver(() => {
      if (!ui.disabled && !w.__uiReady) w.__uiReady = performance.now();
    }).observe(ui, { attributes: true });
  });

  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    let fail = w.__failDb;
    try {
      fail ||= !!sessionStorage.getItem('failDb');
    } catch {
      // no sessionStorage: only the variable counts
    }
    if (fail && (fail !== 'write' || args[1] === 'readwrite')) throw new DOMException('simulated failure', 'QuotaExceededError');
    return transaction.apply(this, args);
  };
}
