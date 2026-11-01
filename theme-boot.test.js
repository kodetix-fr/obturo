import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { listRuntimeFiles } from './scripts/package.mjs';
import { writeAppearance } from './settings.js';

// theme-boot.js is a plain script that runs in the <head> of library.html: it is run here in a context that has the two globals
// it uses, a document and a localStorage.
const source = readFileSync(new URL('./theme-boot.js', import.meta.url), 'utf8');

/** @param {() => string | null} read What localStorage.getItem answers (or throws). @returns {string | undefined} The data-theme left on <html>. */
function boot(read) {
  const root = { dataset: /** @type {Record<string, string>} */ ({}) };
  vm.runInNewContext(source, { document: { documentElement: root }, localStorage: { getItem: () => read() }, JSON });
  return root.dataset.theme;
}

test('theme-boot: an explicit theme is put on <html>, "auto" and anything else leaves the system to decide', () => {
  assert.equal(boot(() => JSON.stringify({ language: 'fr', theme: 'dark' })), 'dark');
  assert.equal(boot(() => JSON.stringify({ language: 'en', theme: 'light' })), 'light');
  assert.equal(boot(() => JSON.stringify({ language: 'en', theme: 'auto' })), undefined);
  assert.equal(boot(() => JSON.stringify({ theme: 'pink' })), undefined);
  assert.equal(boot(() => JSON.stringify({})), undefined);
  assert.equal(boot(() => JSON.stringify(null)), undefined);
});

test('theme-boot: no copy, a damaged copy or no localStorage never throws and sets nothing', () => {
  assert.equal(boot(() => null), undefined, 'first visit');
  assert.equal(boot(() => '{not json'), undefined);
  assert.equal(boot(() => '"dark"'), undefined, 'a string is not a record');
  assert.equal(boot(() => { throw new Error('storage blocked'); }), undefined);
});

test('theme-boot reads the copy that settings.js writes (the key is the same one)', () => {
  /** @type {Record<string, string>} */
  const store = {};
  const globals = /** @type {any} */ (globalThis);
  const saved = globals.localStorage;
  globals.localStorage = { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] ?? null };
  try {
    writeAppearance({ language: 'fr', theme: 'dark' });
    assert.equal(Object.keys(store).length, 1);
    assert.equal(boot(() => store[Object.keys(store)[0]]), 'dark');
    // and it is the key that theme-boot.js reads, not another one
    assert.match(source, new RegExp(`getItem\\('${Object.keys(store)[0].replace('.', '\\.')}'\\)`));
    writeAppearance({ language: 'en', theme: 'auto' });
    assert.equal(boot(() => store[Object.keys(store)[0]]), undefined);
  } finally {
    globals.localStorage = saved;
  }
});

test('library.html: theme-boot.js and db-warm.js are plain external scripts before the stylesheet, nothing is inline', () => {
  const html = readFileSync(new URL('./library.html', import.meta.url), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 3 && scripts.every((attrs) => /\bsrc="[^"]+"/.test(attrs)), 'a script without src would be refused by the CSP');
  const at = (needle) => head.indexOf(needle);
  assert.ok(at('<script src="theme-boot.js">') > 0, 'theme-boot.js is in the head, as a classic script');
  assert.ok(at('<script src="theme-boot.js">') < at('<link rel="stylesheet"'), 'before the stylesheet, so that the first style calculation has the theme');
  assert.doesNotMatch(head, /<script[^>]*\btype="module"[^>]*src="theme-boot\.js"/, 'a module would wait for the others');
});

test('every local file that library.html names is in the package', () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const shipped = new Set(listRuntimeFiles(root));
  const html = readFileSync(new URL('./library.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const named = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((f) => !/^[a-z]+:/.test(f));
  assert.ok(named.includes('theme-boot.js') && named.includes('db-warm.js') && named.includes('library.css'));
  assert.deepEqual(named.filter((f) => !shipped.has(f)), [], 'named by library.html but not in the package');
});
