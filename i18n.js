// Runtime translation. A flat key -> text map per language; the user picks the language (or follows the browser).
// No DOM, no chrome.* and no IndexedDB here: it runs the same in the service worker, the library and Node tests.
// English is always loaded (the fallback of every other language); another language is loaded when it is needed:
// the pages import locales/<code>.js on demand (loadLanguage), the service worker, which cannot import() on demand,
// imports the `sw` part of every language (locales/sw.js) and gives it to addTexts. t() stays synchronous.
// Add a language: see CONTRIBUTING.md (the texts in locales/, the code and its name in languages.js).
import en from './locales/en.js';
import { LANGUAGES, pluralForm } from './languages.js';

export { LANGUAGES, pluralForm, resolveLanguage } from './languages.js';

/** @type {Record<string, Record<string, string>>} */
const DICTIONARIES = { en };

let current = 'en';

/** Are the texts of this language loaded? @param {string} lang */
export const hasLanguage = (lang) => Object.hasOwn(DICTIONARIES, lang);

/**
 * Loads the texts of a language (locales/<code>.js), once. Resolves to the language that can be used: `lang`, or English
 * when it is not a language of the extension or its file cannot be loaded (never rejects: a page always has texts).
 * @param {string} lang
 * @returns {Promise<string>}
 */
export async function loadLanguage(lang) {
  if (hasLanguage(lang)) return lang;
  if (!Object.hasOwn(LANGUAGES, lang)) return 'en';
  try {
    DICTIONARIES[lang] = (await import(`./locales/${lang}.js`)).default;
    return lang;
  } catch (e) {
    console.error('Obturo: language not loaded', lang, e);
    return 'en';
  }
}

/**
 * Adds texts to a language without loading its file: the service worker gives the `sw` parts it imports statically.
 * @param {string} lang
 * @param {Record<string, string>} texts
 */
export function addTexts(lang, texts) {
  DICTIONARIES[lang] = { ...DICTIONARIES[lang], ...texts };
}

/** @param {string} lang A loaded language (loadLanguage, addTexts); another one gives English. @returns {string} the language really in use */
export function setLanguage(lang) {
  current = hasLanguage(lang) ? lang : 'en';
  return current;
}

export const getLanguage = () => current;

/**
 * t('key') or t('key', { n: 3 }) which replaces {n}. A missing key falls back to English, then to the key itself:
 * visible on screen and in tests, never an exception.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  const text = DICTIONARIES[current][key] ?? DICTIONARIES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : text;
}

// Number and date formats follow the language in use. One Intl object per language, created on first use.
/** @type {Map<string, Intl.NumberFormat>} */
const numberFormats = new Map();
/** @type {Map<string, Intl.DateTimeFormat>} */
const dateFormats = new Map();

/** @param {number} n */
export function formatNumber(n) {
  let f = numberFormats.get(current);
  if (!f) numberFormats.set(current, f = new Intl.NumberFormat(current));
  return f.format(n);
}

/** The keys of a shortcut as a Mac names them: Ctrl is Cmd there, and redo is Cmd+Shift+Z. @param {string} text @param {boolean} mac */
export const keysFor = (text, mac) => (mac ? text.replace(/(?:Ctrl|Strg)\+Y/g, 'Cmd+Shift+Z').replace(/(?:Ctrl|Strg)\+/g, 'Cmd+') : text);

/** The key of a count in the language in use: `one` or `other`, for a text that has both forms ('x.one', 'x.other'). @param {number} n @param {string} one @param {string} other */
export const pluralKey = (n, one, other) => (pluralForm(current, n) === 'one' ? one : other);

/**
 * The text of a key that has a singular and a plural form, with {n} the formatted number.
 * @param {number} n
 * @param {string} one key
 * @param {string} other key
 * @param {Record<string, string | number>} [vars]
 */
export const plural = (n, one, other, vars) => t(pluralKey(n, one, other), { ...vars, n: formatNumber(n) });

const UNITS = /** @type {const} */ (['B', 'KB', 'MB', 'GB', 'TB']);
const UNIT_KEYS = { B: 'hist.unit.b', KB: 'hist.unit.kb', MB: 'hist.unit.mb', GB: 'hist.unit.gb', TB: 'hist.unit.tb' };
const NBSP = String.fromCharCode(160);

/**
 * A size in the unit that reads best: 1.2 GB, 340 MB, 12 KB. One decimal below 100, none above. Decimal multiples (1 KB = 1,000 B), as
 * the system and the browser count.
 * @param {number} bytes
 * @returns {{ value: number, unit: typeof UNITS[number] }}
 */
export function splitBytes(bytes) {
  let v = Math.max(0, Number(bytes) || 0);
  let u = 0;
  const round = (x, unit) => (unit === 0 || x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  while (u < UNITS.length - 1 && round(v, u) >= 1000) {
    v /= 1000;
    u++;
  }
  return { value: round(v, u), unit: UNITS[u] };
}

/** A size for people, in the language in use: "1.2 GB", "340 MB" / "1,2 Go", "340 Mo". @param {number} bytes */
export function fmtBytes(bytes) {
  const { value, unit } = splitBytes(bytes);
  return `${formatNumber(value)}${NBSP}${t(UNIT_KEYS[unit])}`;
}

/**
 * Short date and time of a timestamp (ms), e.g. "Oct 2, 03:15 PM" or "2 oct., 15:15"; the year is added for a date that is
 * not of the current year ("Oct 2, 2025, 03:15 PM"), so that two captures a year apart never read the same.
 * @param {number} ms
 * @param {number} [now] The current time (ms), for the tests.
 */
export function formatDate(ms, now = Date.now()) {
  const old = new Date(ms).getFullYear() !== new Date(now).getFullYear();
  const key = `${current}${old ? ':year' : ''}`;
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, f = new Intl.DateTimeFormat(current, { day: 'numeric', month: 'short', ...(old && { year: 'numeric' }), hour: '2-digit', minute: '2-digit' }));
  return f.format(ms);
}
