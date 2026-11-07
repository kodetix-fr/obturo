import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MSG_REF, listRuntimeFiles, localize, readLocales } from './scripts/package.mjs';
import { MENU } from './gestures.js';
import enSw from './locales/en.sw.js';
import SW_TEXTS from './locales/sw.js';
import { LANGUAGES } from './languages.js';

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const manifest = read('./manifest.json');
const locales = readLocales(fileURLToPath(new URL('.', import.meta.url)));

// The promise made to users: no warning at install time. Any added permission is discussed first
// (CONTRIBUTING.md), justified in docs/store-listing.md and docs/PRIVACY.md, then changed HERE.
test('permissions: exactly activeTab, scripting and contextMenus', () => {
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'contextMenus']);
});

test('no site access, no optional permission, no declared content script', () => {
  for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources']) {
    assert.equal(manifest[key], undefined, key);
  }
});

// The promise "no data leaves the computer" is enforced by the browser, not only stated: the policy of the extension pages and of
// the service worker allows no request outside the extension (no connect-src, images only from the extension, a data: or a blob:
// URL). test/e2e/privacy.e2e.mjs proves that the browser applies it.
test('content security policy: no request outside the extension, no remote script, image, frame or form target', () => {
  const policy = manifest.content_security_policy;
  assert.deepEqual(Object.keys(policy), ['extension_pages'], 'a sandbox policy would be another page that needs its own proof');
  const directives = Object.fromEntries(policy.extension_pages.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives, {
    'default-src': ["'none'"], 'script-src': ["'self'"], 'object-src': ["'none'"], 'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'], 'connect-src': ["'none'"], 'frame-src': ["'none'"], 'form-action': ["'none'"], 'base-uri': ["'none'"],
  });
});

// A policy does not stop the connections that a browser opens ahead of its checks: a resource hint (<link rel="preconnect">) or the
// navigation of a frame. The code has neither.
// Own code only (vendor/ is covered by the policy above, in the browser). Comments are dropped: they explain why fetch() is NOT used.
test('no network API and no remote address in the code of the extension', () => {
  const code = (file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
  const files = listRuntimeFiles(fileURLToPath(new URL('.', import.meta.url))).filter((f) => /\.(js|html)$/.test(f) && !f.startsWith('vendor/'));
  assert.ok(files.includes('sw.js') && files.includes('library.js') && files.includes('popup.html'), 'the scan reads the real files');
  const allowed = new Set(['http://www.w3.org/2000/svg', 'https://obturo/', 'https://kodetix.fr/soutenir', 'https://chromewebstore.google.com/detail', 'https://github.com/kodetix-fr/obturo/issues']); // the SVG namespace and the placeholder of batchFilename (not fetched), the pages opened by a click on a link (support, store reviews and publisher, issues)
  for (const file of files) {
    const text = code(file);
    assert.doesNotMatch(text, /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|RTCPeerConnection|WebTransport)\b/, `${file}: a network API`);
    assert.doesNotMatch(text, /\brel\s*[=:]\s*['"]?(preconnect|dns-prefetch|prefetch|prerender)/, `${file}: a resource hint`);
    assert.doesNotMatch(text, /<(iframe|frame|object|embed)\b|createElement\(\s*['"](iframe|frame|object|embed)['"]/, `${file}: a frame or an embedded object`);
    assert.deepEqual((text.match(/https?:\/\/[^\s'"`)<>]+/g) ?? []).filter((u) => !allowed.has(u)), [], `${file}: a remote address`);
  }
});

// The no-trace mode turns the icon violet (sw.js: setIcon): the files the worker names must be in the package, and not the usual ones.
test('the violet icons of the no-trace mode exist, are PNG files of the right size, and differ from the usual ones', () => {
  const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  for (const size of [16, 32]) {
    const file = `icons/notrace${size}.png`;
    assert.ok(source.includes(`'${file}'`), `${file} is named by sw.js`);
    const bytes = readFileSync(new URL(`./${file}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} is a PNG`);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [size, size], `${file}: ${size} x ${size} px`);
    assert.notDeepEqual(bytes, readFileSync(new URL(`./icons/icon${size}.png`, import.meta.url)), `${file} is not the usual icon`);
  }
});

test('Chrome 116 minimum (chrome.runtime.getContexts, used to reactivate the library tab)', () => {
  assert.equal(manifest.minimum_chrome_version, '116');
});

test('the manifest version matches the one in package.json', () => {
  assert.equal(manifest.version, read('./package.json').version);
});

test('texts: default_locale en, one _locales folder per language of the extension, every __MSG_key__ defined in every language', () => {
  assert.equal(manifest.default_locale, 'en');
  // Chrome names a folder with an underscore (pt_BR) where the extension and the browser say pt-BR
  assert.deepEqual(Object.keys(locales).sort(), Object.keys(LANGUAGES).map((code) => code.replace('-', '_')).sort());
  const keys = [...new Set([...JSON.stringify(manifest).matchAll(MSG_REF)].map((m) => m[1]))];
  assert.ok(keys.length >= 9, 'name, description, title and the commands go through __MSG_key__');
  for (const [lang, messages] of Object.entries(locales)) {
    for (const key of keys) assert.equal(typeof messages[key]?.message, 'string', `${lang}: ${key}`);
    // no dead message either: what is translated is used
    assert.deepEqual(Object.keys(messages).sort(), [...keys].sort(), `${lang}: keys of messages.json and of the manifest differ`);
  }
});

test('texts: the name starts with Obturo and fits 75 characters, the description 132, in each language', () => {
  for (const [lang, messages] of Object.entries(locales)) {
    const m = localize(manifest, messages);
    assert.ok(m.name.startsWith('Obturo') && m.name.length <= 75, `${lang}: name "${m.name}"`);
    assert.ok(m.description.length > 0 && m.description.length <= 132, `${lang}: description of ${m.description.length} characters`);
    assert.ok(m.action.default_title.startsWith('Obturo'), lang);
    assert.doesNotMatch(JSON.stringify(m), MSG_REF, `${lang}: an __MSG_ was left unresolved`);
  }
});

test('commands: four suggested keys (Chrome limit), the "edit" ones and the element ones have none, each has a description', () => {
  const entries = Object.entries(manifest.commands);
  assert.equal(entries.filter(([, c]) => c.suggested_key).length, 4, 'Chrome admits at most 4 suggested shortcuts');
  assert.deepEqual(entries.filter(([, c]) => !c.suggested_key).map(([name]) => name).sort(),
    ['capture-area-edit', 'capture-element', 'capture-element-edit', 'capture-full-edit', 'capture-visible-edit']);
  for (const [name, c] of entries) assert.match(c.description, /^__MSG_\w+__$/, name);
});

test('every command of the manifest is an entry of the icon menu', () => {
  const leaves = MENU.flatMap((d) => d.children ?? [d]).map((d) => d.id);
  for (const name of Object.keys(manifest.commands)) assert.ok(leaves.includes(name), `${name} is not in the menu`);
});

// The service worker sets the tooltip of the icon in the language chosen in the settings (the manifest's follows the browser's
// language only): the two must say the same thing in a given language, or the tooltip would change when the setting does.
test('the tooltip set by the service worker is the one of the manifest, in each language', () => {
  for (const [lang, sw] of Object.entries({ en: enSw, ...SW_TEXTS })) {
    assert.equal(sw['sw.actionTitle'], locales[lang.replace('-', '_')].actionTitle.message, lang);
  }
});

test('the French texts of the manifest address the reader as "tu", never "vous"', () => {
  for (const [key, { message }] of Object.entries(locales.fr)) {
    assert.doesNotMatch(message, /\b(vous|vos|votre|[a-zé]+ez)\b/i, `fr ${key}: "${message}"`);
  }
});

// A left click opens the popup (popup.html); action.onClicked never fires then, so the worker must not rely on it.
test('action: a left click opens popup.html, and the worker no longer listens to action.onClicked', () => {
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.doesNotMatch(readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), /action\.onClicked/);
});

test('texts: the tooltip is just "Obturo" (a click opens a menu, it no longer captures)', () => {
  for (const [lang, messages] of Object.entries(locales)) assert.equal(messages.actionTitle.message, 'Obturo', lang);
});
