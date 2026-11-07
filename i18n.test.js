import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LANGUAGES, fmtBytes, formatDate, formatNumber, getLanguage, hasLanguage, keysFor, loadLanguage, plural, pluralForm, pluralKey, resolveLanguage, setLanguage, splitBytes, t } from './i18n.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';
import SW_TEXTS from './locales/sw.js';
import POPUP_TEXTS from './locales/popup.js';

// Every language of the extension, whole (locales/<code>.js) and part by part, and loaded into i18n.js for the tests of t().
const CODES = Object.keys(LANGUAGES);
const PARTS = /** @type {const} */ (['ui', 'sw', 'popup', 'history', 'export', 'chooser']);
/** @type {Record<string, Record<string, string>>} */
const whole = {};
/** @type {Record<string, Record<typeof PARTS[number], Record<string, string>>>} */
const parts = {};
for (const code of CODES) {
  whole[code] = (await import(`./locales/${code}.js`)).default;
  parts[code] = /** @type {any} */ ({});
  for (const part of PARTS) parts[code][part] = (await import(`./locales/${code}.${part}.js`)).default;
  assert.equal(await loadLanguage(code), code, `${code} loads`);
}
const en = whole.en, fr = whole.fr;
const enUi = parts.en.ui, enExport = parts.en.export, enHistory = parts.en.history, enPopup = parts.en.popup, enChooser = parts.en.chooser;
/** The other languages, compared with English. */
const OTHERS = CODES.filter((code) => code !== 'en');

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('resolveLanguage: explicit choice, then the browser language (exact, another region, bare language), then English', () => {
  assert.equal(resolveLanguage('fr', 'en-US'), 'fr');
  assert.equal(resolveLanguage('auto', 'fr-FR'), 'fr');
  assert.equal(resolveLanguage('auto', 'fr_CA'), 'fr');
  assert.equal(resolveLanguage('auto', 'de-DE'), 'de');
  assert.equal(resolveLanguage('auto', 'pt-BR'), 'pt-BR');
  assert.equal(resolveLanguage('auto', 'pt_BR'), 'pt-BR', 'an underscore reads as a hyphen');
  assert.equal(resolveLanguage('auto', 'pt-PT'), 'pt-BR', 'a region that is not translated takes the translated region of its language');
  assert.equal(resolveLanguage('auto', 'pt'), 'pt-BR');
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLanguage('auto', 'zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveLanguage('auto', 'zh-TW'), 'zh-CN', 'until a traditional Chinese exists');
  assert.equal(resolveLanguage('auto', 'es-419'), 'es');
  assert.equal(resolveLanguage('auto', 'ID'), 'id', 'case does not matter');
  assert.equal(resolveLanguage('auto', 'nl'), 'en');
  assert.equal(resolveLanguage('auto'), 'en');
  assert.equal(resolveLanguage('constructor', 'fr'), 'fr', 'a prototype key is not a language');
  assert.equal(resolveLanguage(/** @type {any} */ (5), 'fr'), 'fr', 'a setting that is not a string');
});

test('setLanguage ignores an unknown language; loadLanguage answers English for one', async () => {
  assert.equal(setLanguage('fr'), 'fr');
  assert.equal(getLanguage(), 'fr');
  assert.equal(setLanguage('klingon'), 'en');
  assert.equal(getLanguage(), 'en');
  assert.equal(await loadLanguage('klingon'), 'en');
  assert.equal(hasLanguage('klingon'), false);
  assert.equal(hasLanguage('ja'), true);
});

test('t: variables, English fallback, then the key itself', () => {
  setLanguage('en');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(t('no.such.key', { n: 1 }), 'no.such.key');
  assert.equal('{n} of {total}'.replace(/\{(\w+)\}/g, (m, k) => ({ n: 2, total: 5 })[k] ?? m), '2 of 5');
});

test('locales: same keys in every language, same placeholders, no empty text, no key in two parts, every language has its _locales folder', () => {
  for (const code of OTHERS) {
    const dict = whole[code];
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), `keys differ between en and ${code}`);
    for (const key of Object.keys(en)) {
      assert.equal(placeholders(dict[key]), placeholders(en[key]), `${code}: placeholders differ for ${key}`);
      assert.ok(en[key].trim() && dict[key].trim(), `${code}: empty text for ${key}`);
      assert.doesNotMatch(dict[key], /[\u2013\u2014]/, `${code} ${key}: an em or en dash (plain hyphens only)`);
    }
    for (const part of PARTS) assert.deepEqual(Object.keys(parts[code][part]), Object.keys(parts.en[part]), `${code}: keys or order of the ${part} part differ from English`);
  }
  for (const code of CODES) {
    for (const [i, a] of PARTS.entries()) {
      for (const b of PARTS.slice(i + 1)) {
        const both = Object.keys(parts[code][a]).filter((k) => Object.hasOwn(parts[code][b], k));
        assert.deepEqual(both, [], `${code}: keys present in both the ${a} and the ${b} parts`);
      }
    }
    assert.ok(readdirSync(new URL('_locales', import.meta.url)).includes(code.replace('-', '_')), `${code}: no _locales folder for the manifest`);
  }
  assert.deepEqual(Object.keys(LANGUAGES).sort(), ['de', 'en', 'es', 'fr', 'id', 'ja', 'pt-BR', 'ru', 'zh-CN']);
  assert.deepEqual(Object.keys(SW_TEXTS).sort(), [...OTHERS].sort(), 'locales/sw.js carries the sw part of every language but English');
  for (const code of OTHERS) assert.deepEqual(SW_TEXTS[code], parts[code].sw, `locales/sw.js: the sw part of ${code}`);
});

test('normalizeSettings: defaults, valid values kept, invalid ones replaced', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('nope'), DEFAULT_SETTINGS);
  const ok = { language: 'fr', theme: 'dark', retentionDays: 365, maxBytes: 0, downloadFormat: 'webp', downloadQuality: 0.5, pdfLayout: 'a4', pdfEncoding: 'jpeg', afterCapture: 'copy', filenameTemplate: '{date} {title}', fullPageWait: 1000, fullPageFixed: 'hide', noTrace: true, captureDelay: 10, redactSensitive: true };
  assert.deepEqual(normalizeSettings(ok), ok);
  const bad = normalizeSettings({ language: 'klingon', theme: 'pink', retentionDays: -1, maxBytes: 1.5, downloadFormat: 'bmp', downloadQuality: 7, pdfLayout: 'letter', pdfEncoding: 'lzw', afterCapture: 'both', filenameTemplate: '  ', fullPageWait: 750, fullPageFixed: 'show', noTrace: 'yes', captureDelay: 4, extra: 1 });
  assert.deepEqual(bad, DEFAULT_SETTINGS);
  assert.equal(Object.hasOwn(bad, 'extra'), false);
  assert.equal(normalizeSettings({ language: 'constructor' }).language, 'auto');
});

test('t: variables are replaced in both languages, an unknown variable is left as is', () => {
  setLanguage('en');
  assert.equal(t('out.size', { w: 1600, h: 900 }), 'Output: 1600 × 900 px');
  assert.equal(t('out.size', { w: 1 }), 'Output: 1 × {h} px');
  setLanguage('fr');
  assert.equal(t('out.size', { w: 1600, h: 900 }), 'Sortie\u00a0: 1600\u00a0×\u00a0900\u00a0px');
  assert.equal(t('zoom.value', { n: 66 }), '66\u00a0%');
  setLanguage('en');
  assert.equal(t('zoom.value', { n: 66 }), '66%');
});

test('formatNumber and formatDate follow the language in use', () => {
  const at = Date.UTC(2026, 9, 2, 12, 0);
  setLanguage('en');
  assert.equal(formatNumber(16384), '16,384');
  assert.match(formatDate(at), /Oct/);
  setLanguage('fr');
  assert.match(formatNumber(16384), /^16\s384$/);
  assert.match(formatDate(at), /oct/);
  setLanguage('en');
});

test('splitBytes: the unit that reads best, one decimal below 100, decimal multiples', () => {
  assert.deepEqual(splitBytes(0), { value: 0, unit: 'B' });
  assert.deepEqual(splitBytes(999), { value: 999, unit: 'B' });
  assert.deepEqual(splitBytes(1000), { value: 1, unit: 'KB' });
  assert.deepEqual(splitBytes(1500), { value: 1.5, unit: 'KB' });
  assert.deepEqual(splitBytes(340 * 1000 ** 2), { value: 340, unit: 'MB' });
  assert.deepEqual(splitBytes(1.2 * 1000 ** 3), { value: 1.2, unit: 'GB' });
  assert.deepEqual(splitBytes(12.34 * 1000 ** 2), { value: 12.3, unit: 'MB' });
  assert.deepEqual(splitBytes(2 * 1000 ** 3), { value: 2, unit: 'GB' });
  assert.deepEqual(splitBytes(5 * 1000 ** 4), { value: 5, unit: 'TB' });
  assert.deepEqual(splitBytes(10 * 1000 ** 5), { value: 10000, unit: 'TB' }, 'nothing above TB');
});

test('splitBytes: a value that rounds up to 1000 moves to the next unit; junk is zero', () => {
  assert.deepEqual(splitBytes(1000 ** 2 - 1), { value: 1, unit: 'MB' });
  assert.deepEqual(splitBytes(999.96 * 1000), { value: 1, unit: 'MB' });
  assert.deepEqual(splitBytes(-5), { value: 0, unit: 'B' });
  assert.deepEqual(splitBytes(NaN), { value: 0, unit: 'B' });
  assert.deepEqual(splitBytes(undefined), { value: 0, unit: 'B' });
});

test('fmtBytes: the number and the unit follow the language, joined by a no-break space', () => {
  setLanguage('en');
  assert.equal(fmtBytes(1.2 * 1000 ** 3), `1.2${String.fromCharCode(160)}GB`);
  assert.equal(fmtBytes(188_416), `188${String.fromCharCode(160)}KB`);
  setLanguage('fr');
  assert.equal(fmtBytes(1.2 * 1000 ** 3), `1,2${String.fromCharCode(160)}Go`);
  setLanguage('en');
});

test('pluralForm: French counts 0 and 1 as singular, English only 1, and a count above 1 is never singular', () => {
  assert.equal(pluralForm('en', 1), 'one');
  assert.equal(pluralForm('en', 0), 'other');
  assert.equal(pluralForm('en', 2), 'other');
  assert.equal(pluralForm('fr', 0), 'one');
  assert.equal(pluralForm('fr', 1), 'one');
  assert.equal(pluralForm('fr', 2), 'other');
  assert.equal(pluralForm('ru', 1), 'one');
  for (const n of [0, 2, 5, 11, 21, 31, 101, 191]) assert.equal(pluralForm('ru', n), 'other', `ru ${n}`);
  assert.equal(pluralForm('not a language tag', 1), 'one');
});

test('pluralKey and plural follow the language in use', () => {
  setLanguage('en');
  assert.equal(pluralKey(0, 'hist.count.one', 'hist.count.other'), 'hist.count.other');
  assert.equal(plural(5000, 'hist.count.one', 'hist.count.other'), '5,000 captures');
  setLanguage('fr');
  assert.equal(pluralKey(0, 'hist.count.one', 'hist.count.other'), 'hist.count.one');
  assert.match(plural(5000, 'hist.count.one', 'hist.count.other'), /^5\s000 captures$/);
  setLanguage('en');
});

test('formatDate: the year appears only for a date that is not of the current year', () => {
  const now = new Date(2026, 9, 2, 12, 0).getTime();
  const thisYear = new Date(2026, 0, 5, 15, 15).getTime();
  const lastYear = new Date(2025, 11, 31, 23, 59).getTime();
  const nextYear = new Date(2027, 0, 1, 0, 0).getTime();
  for (const lang of ['en', 'fr']) {
    setLanguage(lang);
    assert.doesNotMatch(formatDate(thisYear, now), /\d{4}/, `${lang}: this year, no year`);
    assert.match(formatDate(lastYear, now), /2025/, `${lang}: last year`);
    assert.match(formatDate(nextYear, now), /2027/, `${lang}: a date in the future too`);
    assert.notEqual(formatDate(lastYear, now), formatDate(new Date(2024, 11, 31, 23, 59).getTime(), now), `${lang}: two years apart read differently`);
  }
  setLanguage('en');
  assert.match(formatDate(thisYear, now), /Jan/);
  assert.doesNotMatch(formatDate(Date.now()), /\d{4}/, 'now: the current year is left out');
});

// "1 captures": a counted noun after a number that can be 1. Plurals go in '.one' / '.other' pairs (see the history), or the text
// is worded without any (a label before the number).
test('locales: no text puts a counted noun after a number that can be 1, outside the plural pairs', () => {
  const counted = /\{n\}\s+(captures?|results?|résultats?|days?|jours?|items?|files?|fichiers?)\b|\(\{n\}\s/i;
  const allowed = new Set(['hist.sel.all']); // "Select all {n} results" is only shown when there are more than the ones selected
  for (const [lang, dict] of [['en', en], ['fr', fr]]) {
    for (const [key, text] of Object.entries(dict)) {
      if (/\.(one|other)$/.test(key) || allowed.has(key)) continue;
      assert.doesNotMatch(text, counted, `${lang} ${key}: "${text}"`);
    }
  }
});

test('locales: the French addresses the reader as "tu" everywhere, never "vous"', () => {
  const formal = /\b(vous|vos|votre|[a-zéèê]+ez)\b/gi; // "vous", "vos", "votre", the imperatives in -ez (Capturez, Choisissez)
  const allowed = new Set(['chez', 'assez', 'nez', 'rez']);
  for (const [key, text] of Object.entries(fr)) {
    const hits = (text.match(formal) ?? []).filter((w) => !allowed.has(w.toLowerCase()));
    assert.deepEqual(hits, [], `fr ${key}: "${text}"`);
  }
});

// Typos in a key show up on screen as the key itself; this finds them before. Every literal that looks like a key of the
// interface dictionary ('strip.open') in the sources of the library must exist, and every key must be used somewhere.
test('interface keys: every key used by the code or the page exists, every key is used', () => {
  const sources = ['library.html', 'library.js', 'panel.js', 'editor.js', 'mask-pure.js', 'highlight-pure.js', 'settings-ui.js', 'about-ui.js', 'dom-i18n.js', 'export-ui.js', 'beautify-ui.js', 'history-view.js', 'history-dialogs.js', 'history-settings.js', 'import.js', 'popup.js', 'popup.html'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
  const namespaces = new Set(Object.keys(enUi).map((k) => k.split('.')[0]));
  const used = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/['"]([a-z]+(?:\.[A-Za-z]+)+)['"]/g)) {
      if (namespaces.has(m[1].split('.')[0]) && !m[1].endsWith('.js')) used.add(m[1]); // 'settings.js' is a file, not a key
    }
  }
  const missing = [...used].filter((k) => !Object.hasOwn(en, k));
  assert.deepEqual(missing, [], 'keys used by the code but missing from the dictionaries');
  const unused = Object.keys(enUi).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], 'keys of locales/*.ui.js used nowhere');
});

// export: the texts of the downloads (locales/*.export.js) are checked against the files that use them.
test('export texts: every key used, every key used exists', () => {
  const sources = ['library.html', 'export-ui.js', 'settings-ui.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
  const namespaces = new Set(Object.keys(enExport).map((k) => k.split('.')[0]));
  const used = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/['"]([a-z]+(?:\.[A-Za-z]+)+)['"]/g)) {
      if (namespaces.has(m[1].split('.')[0]) && !/\.(js|css)$/.test(m[1])) used.add(m[1]);
    }
  }
  assert.deepEqual([...used].filter((k) => !Object.hasOwn(en, k)), [], 'keys used by the downloads but missing from the dictionaries');
  assert.deepEqual(Object.keys(enExport).filter((k) => !used.has(k)), [], 'keys of locales/*.export.js used nowhere');
});

// history: the texts of the history (locales/*.history.js) are checked against the files that use them.
test('history texts: plurals complete in every language, every key used, every key used exists', () => {
  for (const key of Object.keys(enHistory)) assert.ok(/^hist\.[a-z]+(\.[A-Za-z]+)*$/.test(key), `${key}: letters only, so that the next test can find it in the sources`);
  // A plural is an 'x.one' and 'x.other' pair, and its 'x.other' takes {n} in every language. In the history every such key is a
  // plural; elsewhere a lone '.one' or '.other' is a choice ('settings.full.wait.one' is "1 s", 'sw.full.fail.other' is a cause).
  for (const key of Object.keys(en)) {
    const m = /^(.*)\.(one|other)$/.exec(key);
    if (!m) continue;
    const pair = Object.hasOwn(en, `${m[1]}.${m[2] === 'one' ? 'other' : 'one'}`);
    if (Object.hasOwn(enHistory, key)) assert.ok(pair, `${key} has no twin`);
    if (pair && m[2] === 'other') for (const code of CODES) assert.match(whole[code][key], /\{n\}/, `${code}: ${key} takes {n}`);
  }
  const sources = ['library.html', 'library.js', 'i18n.js', 'editor.js', 'history-view.js', 'history-dialogs.js', 'history-settings.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
  const used = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/['"](hist(?:\.[A-Za-z]+)+)['"]/g)) used.add(m[1]);
  }
  assert.deepEqual([...used].filter((k) => !Object.hasOwn(en, k)), [], 'keys used by the history but missing from the dictionaries');
  assert.deepEqual(Object.keys(enHistory).filter((k) => !used.has(k)), [], 'keys of locales/*.history.js used nowhere');
});

test('library.html: no visible text of its own, every marked element has a key', () => {
  const html = readFileSync(new URL('library.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<body>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  // Text between tags: only symbols are allowed (units, the brand, glyphs of the style buttons), never a sentence.
  const texts = [...body.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  const allowed = new Set(['Obturo', '%', 'px', 'B', 'I', 'U']);
  assert.deepEqual(texts.filter((x) => !allowed.has(x)), [], 'text written in library.html instead of locales/');
});

// popup: the texts of the popup (locales/*.popup.js), and the script tags of popup.html. The rows reuse the 'menu.*' texts of the
// icon menu (locales/*.sw.js), which gestures.test.js checks one by one.
test('popup texts: every key used, every key used exists, no text in popup.html', () => {
  for (const key of Object.keys(enPopup)) assert.ok(/^popup(\.[A-Za-z]+)+$/.test(key), `${key}: letters and dots only, so that the next check can find it in the source`);
  const source = ['popup.js', 'popup-notice.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const used = new Set([...source.matchAll(/['"`](popup(?:\.[A-Za-z]+)+)['"`]/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((k) => !Object.hasOwn(en, k)), [], 'keys used by popup.js but missing from the dictionaries');
  assert.deepEqual(Object.keys(enPopup).filter((k) => !used.has(k)), [], 'keys of locales/*.popup.js used nowhere');
  const html = readFileSync(new URL('popup.html', import.meta.url), 'utf8');
  const texts = [...html.replace(/<!--.*?-->/gs, '').replace(/<(script|style|symbol)\b.*?<\/\1>/gs, '').matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.deepEqual(texts.filter((x) => x !== 'Obturo'), [], 'text written in popup.html instead of locales/');
});

test('popup.html loads theme-boot.js before the first paint and popup.js as a module', () => {
  const html = readFileSync(new URL('popup.html', import.meta.url), 'utf8');
  assert.ok(/<script src="theme-boot\.js"><\/script>/.test(html) && /<script type="module" src="popup\.js"><\/script>/.test(html), 'theme-boot.js before the first paint, popup.js as a module');
});

test('popup.js loads the sw and popup parts of every language of the extension, statically, and nothing else', () => {
  const source = readFileSync(new URL('popup.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from '\.\/locales\/(.+)';/gm)].map((m) => m[1]), ['popup.js'], 'one module gathers the texts of the popup');
  const code = source.replace(/\/\/.*$/gm, '');
  assert.ok(!code.replace("import('./popup-notice.js')", '').includes('import('), 'no import() on demand: it came too late on a cold start');
  assert.ok(code.indexOf("import('./popup-notice.js')") > code.indexOf("'obturo:popup-painted'"), 'the notice (dot, request for a review) comes after the first paint');
  assert.deepEqual(Object.keys(POPUP_TEXTS).sort(), [...CODES].sort(), 'locales/popup.js carries every language');
  for (const code of CODES) assert.deepEqual(POPUP_TEXTS[code], { ...parts[code].sw, ...parts[code].popup }, `locales/popup.js: the texts of ${code}`);
  assert.ok(source.includes("'obturo.appearance'"), 'the key of the copy of settings.js');
  assert.ok(readFileSync(new URL('settings.js', import.meta.url), 'utf8').includes("const APPEARANCE_KEY = 'obturo.appearance'"));
});

// chooser: the texts of the window that asks what to do with a capture (locales/*.chooser.js), checked against chooser.js and chooser.html.
test('chooser texts: every key used, every key used exists, no text in chooser.html', () => {
  for (const key of Object.keys(enChooser)) assert.ok(/^chooser\.[A-Za-z]+$/.test(key), `${key}: letters only, so that the next check can find it in the source`);
  const html = readFileSync(new URL('chooser.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('chooser.js', import.meta.url), 'utf8');
  const used = new Set([...(source + html).matchAll(/['"`](chooser\.[A-Za-z]+)['"`]/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((k) => !Object.hasOwn(en, k) && !/^chooser.(css|js)$/.test(k)), [], 'keys used by the window but missing from the dictionaries (its own files excepted)');
  assert.deepEqual(Object.keys(enChooser).filter((k) => !used.has(k)), [], 'keys of locales/*.chooser.js used nowhere');
  const texts = [...html.replace(/<!--.*?-->/gs, '').replace(/<(script|style|symbol)\b.*?<\/\1>/gs, '').matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.deepEqual(texts.filter((x) => !['Obturo', 'PNG', 'JPEG', 'WebP', 'PDF'].includes(x)), [], 'text written in chooser.html instead of locales/ (the names of the formats excepted)');
  assert.ok(/<script src="theme-boot\.js"><\/script>/.test(html) && /<script type="module" src="chooser\.js"><\/script>/.test(html), 'theme-boot.js before the first paint, chooser.js as a module');
});

test('keysFor: a Mac reads Cmd for Ctrl and Cmd+Shift+Z for redo, other systems read the text as it is', () => {
  assert.equal(keysFor('Undo (Ctrl+Z)', true), 'Undo (Cmd+Z)');
  assert.equal(keysFor('Redo (Ctrl+Y)', true), 'Redo (Cmd+Shift+Z)');
  assert.equal(keysFor('Rückgängig (Strg+Z)', true), 'Rückgängig (Cmd+Z)');
  assert.equal(keysFor('paste one with Ctrl+V, or drop it', true), 'paste one with Cmd+V, or drop it');
  assert.equal(keysFor('Redo (Ctrl+Y)', false), 'Redo (Ctrl+Y)');
  assert.equal(keysFor('No shortcut here', true), 'No shortcut here');
});
