// The languages of the interface, the one a setting and the browser lead to, and the plural form, which depends on the language alone.
// Tiny and alone on purpose: the popup reads it without loading i18n.js and the whole English dictionary
// (its budget is 100 ms to the first paint); i18n.js builds on it for the language in use.

/** Language code (BCP 47, as chrome.i18n.getUILanguage writes them) -> its own name, as the language picker shows it (an autonym, never translated). */
export const LANGUAGES = Object.freeze({
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  id: 'Bahasa Indonesia',
  ja: '日本語',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  'zh-CN': '简体中文',
});

const CODES = Object.keys(LANGUAGES);

/**
 * The language to use: the setting when it names one, else the browser's language (an exact match first, then another
 * region of the same language, then the bare language), else English.
 * ponytail: a region that is not translated takes the first translated region of its language (pt-PT and pt-AO read pt-BR, zh-HK reads zh-CN); a table of preferences (zh-HK -> zh-TW) the day a language has two translated regions.
 * @param {string} setting 'auto' or a language code (see settings.js)
 * @param {string} [uiLanguage] browser UI language, e.g. 'fr', 'fr-FR', 'en-US', 'pt_BR', 'zh-Hans-CN'
 * @returns {string} a key of LANGUAGES
 */
export function resolveLanguage(setting, uiLanguage = 'en') {
  if (typeof setting === 'string' && Object.hasOwn(LANGUAGES, setting)) return setting;
  const tag = String(uiLanguage).toLowerCase().replace(/_/g, '-');
  const base = tag.split('-')[0];
  return CODES.find((c) => c.toLowerCase() === tag)
    ?? CODES.find((c) => c.toLowerCase() === base || c.toLowerCase().startsWith(`${base}-`))
    ?? 'en';
}

/**
 * Singular or plural form for a count, by the rules of the language ('one' | 'other'): in French 0 and 1 are singular.
 * A count above 1 is always plural: Russian says `one` for 21 and 31 too, and no text of the pair could be right for both.
 * @param {string} lang
 * @param {number} n
 * @returns {'one' | 'other'}
 */
export function pluralForm(lang, n) {
  try {
    return n <= 1 && new Intl.PluralRules(lang).select(n) === 'one' ? 'one' : 'other';
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}
