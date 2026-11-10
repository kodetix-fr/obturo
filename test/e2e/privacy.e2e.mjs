// The promise "no data leaves the computer", checked in the browser: the content security policy of the manifest must stop every
// kind of request that an extension page or the service worker could make, and the pages of the extension must make none.
// How: a local server logs everything it receives (requests, upgrades, new connections). One channel at a time (fetch, XHR, WebSocket, EventSource, beacon,
// image, stylesheet, font, media, object, worker, prefetch, preconnect, frame, form, importScripts) is tried from a page of the test site (the control: the server MUST see
// the connection, or the counter proves nothing), then from the pages of the extension and from the service worker (it must see
// none). A failure names the channel that got through. Navigation (a tab, a window, a change of address) is the one thing the policy does not
// stop: the last test says so, and manifest.test.js lists the only places where the code opens or navigates.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { launchExtension } from './support/browser.mjs';
import { sleep } from './support/capture.mjs';

/**
 * Starts one request toward `url` by the channel `name` (without a name: the names of the channels). Written for a page and for a
 * worker: what a worker lacks (a document, XMLHttpRequest, EventSource) throws and counts as not started.
 * @param {[string, string?]} args
 */
function tryChannel([url, name]) {
  const frame = () => { const f = document.createElement('iframe'); f.src = `${url}/f`; document.body.append(f); };
  const link = (rel, href) => { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.append(l); };
  const attempts = {
    fetch: () => fetch(url, { mode: 'no-cors' }),
    xhr: () => { const x = new XMLHttpRequest(); x.open('GET', url); x.send(); },
    websocket: () => new WebSocket(url.replace('http', 'ws')),
    eventsource: () => new EventSource(url),
    beacon: () => navigator.sendBeacon(url, 'x'),
    image: () => { const i = new Image(); i.src = `${url}/i.png`; },
    stylesheet: () => link('stylesheet', `${url}/s.css`),
    prefetch: () => link('prefetch', `${url}/p`),
    preconnect: () => link('preconnect', url),
    font: () => new FontFace('probe', `url(${url}/f.woff2)`).load(),
    media: () => { const a = new Audio(); a.src = `${url}/a.mp3`; a.load(); },
    object: () => { const o = document.createElement('object'); o.data = `${url}/o`; document.body.append(o); },
    worker: () => new Worker(`${url}/w.js`),
    frame,
    form: () => { // the answer goes into a frame of its own, so that the page the test drives stays where it is
      const sink = document.createElement('iframe'); sink.name = 'sink'; document.body.append(sink);
      const f = document.createElement('form'); f.action = `${url}/post`; f.method = 'post'; f.target = 'sink'; document.body.append(f); f.submit();
    },
    importScripts: () => self.importScripts(`${url}/w.js`),
  };
  if (name === undefined) return Object.keys(attempts);
  try {
    Promise.resolve(attempts[name]()).catch(() => {});
  } catch { /* blocked, or not available here */ }
  return null;
}

describe('privacy: the extension cannot reach a network', () => {
  let h, server, url, log, names;

  before(async () => {
    log = [];
    server = createServer((req, res) => {
      log.push(`request ${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }).end('<!doctype html><title>test site</title>');
    });
    server.on('upgrade', (req, socket) => { log.push(`upgrade ${req.url}`); socket.destroy(); });
    server.on('connection', () => log.push('connection'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    h = await launchExtension({ hook: true, instrumented: false });
    names = await h.sw.evaluate(tryChannel, [url]);
  });
  after(async () => {
    await h?.close();
    await new Promise((done) => { server?.closeAllConnections(); server?.close(done); });
  });

  /** The channels (among `names`) by which `run` made the server receive a connection. */
  const leaks = async (run) => {
    const found = [];
    for (const name of names) {
      const from = log.length;
      await run(name);
      await sleep(500); // a request is asynchronous
      if (log.length > from) found.push(`${name}: ${log.slice(from).join(', ')}`);
    }
    return found;
  };

  it('control: from an ordinary page, the attempts do reach the server', async () => {
    const page = await h.context.newPage();
    await page.goto(`${url}/`);
    const reached = await leaks((name) => page.evaluate(tryChannel, [url, name]));
    // prefetch and preconnect are the browser's to make (idle, speculative) and importScripts is for workers: not required. The others must be seen.
    assert.deepEqual(names.filter((n) => !['prefetch', 'preconnect', 'importScripts'].includes(n) && !reached.some((r) => r.startsWith(`${n}:`))), [], 'channels the counter does not see: the test would pass whatever the policy says');
    await page.close();
  });

  it('a page of the extension: every channel is blocked, the server sees nothing', async () => {
    const page = await h.context.newPage();
    const violations = [];
    await page.exposeFunction('__violation', (d) => violations.push(d));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.__violation(e.effectiveDirective)));
    for (const path of ['library.html', 'popup.html', 'chooser.html']) {
      await page.goto(h.url(path));
      // Known gap, not ours to close: the browser opens a bare connection ahead of its policy check for <link rel="preconnect"> and
      // for the navigation of a frame (the frame itself is blocked: no request follows). The code has neither: manifest.test.js fails
      // on them. Anything else that got through, and any request at all, is a hole in the policy.
      const reached = (await leaks((name) => page.evaluate(tryChannel, [url, name]))).filter((r) => !/^(preconnect|frame): connection(, connection)*$/.test(r));
      assert.deepEqual(reached, [], `${path}: channels that reached the server`);
    }
    // The reason is the policy, and not a closed port: the browser reported the violation of each directive.
    for (const directive of ['connect-src', 'img-src', 'style-src', 'frame-src', 'form-action']) {
      assert.ok(violations.some((v) => v.startsWith(directive)), `no violation of ${directive} (got ${[...new Set(violations)].join(', ')})`);
    }
    await page.close();
  });

  it('the service worker: every channel is blocked, the server sees nothing', async () => {
    assert.deepEqual(await leaks((name) => h.sw.evaluate(tryChannel, [url, name])), [], 'channels that reached the server');
  });

  it('navigation is not stopped by the policy, which is why manifest.test.js lists every place the code may open a tab', async () => {
    const page = await h.context.newPage();
    await page.goto(h.url('popup.html'));
    const reached = async (what, open) => {
      const from = log.length;
      await open();
      await sleep(500);
      assert.ok(log.length > from, `${what}: the server saw nothing, the browser now stops it: the sentence of PRIVACY.md can say so`);
    };
    await reached('window.open from a page of the extension', () => page.evaluate((u) => { window.open(u); }, url));
    await reached('chrome.tabs.create from the service worker', () => h.sw.evaluate((u) => chrome.tabs.create({ url: u, active: false }), url));
    await reached('a change of address of a page of the extension', () => page.evaluate((u) => { location.href = u; }, url));
    for (const open of h.context.pages()) await open.close().catch(() => {});
  });

  it('opening the library and the popup makes no request but to the extension itself', async () => {
    for (const path of ['library.html', 'popup.html', 'chooser.html']) {
      const page = await h.context.newPage();
      const requests = [];
      page.on('request', (r) => requests.push(r.url()));
      await page.goto(h.url(path), { waitUntil: 'load' });
      await sleep(1000);
      assert.ok(requests.length > 3, `${path}: the page loaded its own files`);
      assert.deepEqual(requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u)), [], `${path}: a request outside the extension`);
      await page.close();
    }
  });
});
