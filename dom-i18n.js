// Translation of the DOM. An element carries its key in a data attribute, so that a language change re-translates
// everything that is displayed, the texts typed from code included (setI18n remembers the key and its variables).
//
//   data-i18n="key"        the text content
//   data-i18n-title="key"  the tooltip
//   data-i18n-aria="key"   the aria-label
//   data-i18n-label="key" the tooltip AND the aria-label (icon buttons)
//   data-i18n-vars='{"n":3}' the variables of {n} in the text (JSON; set by setI18n)
//
// The strings of the captured page (title, address) never go through the dictionaries as keys: they only fill
// {variables}, and always land in textContent or an attribute.
import { getLanguage, t } from './i18n.js';

const SELECTOR = '[data-i18n],[data-i18n-title],[data-i18n-aria],[data-i18n-label]';

/** @param {HTMLElement} el */
function varsOf(el) {
  if (!el.dataset.i18nVars) return undefined;
  try { return JSON.parse(el.dataset.i18nVars); } catch { return undefined; }
}

/** Translates every marked element under `root` (the whole page by default) and sets the page language. @param {ParentNode} [root] */
export function applyDom(root = document) {
  document.documentElement.lang = getLanguage();
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(SELECTOR))) {
    const { i18n, i18nTitle, i18nAria, i18nLabel } = el.dataset;
    const vars = varsOf(el);
    if (i18n) el.textContent = t(i18n, vars);
    if (i18nTitle) el.title = t(i18nTitle, vars);
    if (i18nAria) el.setAttribute('aria-label', t(i18nAria, vars));
    if (i18nLabel) {
      el.title = t(i18nLabel, vars);
      el.setAttribute('aria-label', el.title);
    }
  }
}

/**
 * Sets the text of `el` from a key and remembers it for the next language change. No key clears the element.
 * @param {HTMLElement} el
 * @param {string} [key]
 * @param {Record<string, string | number>} [vars]
 */
export function setI18n(el, key, vars) {
  if (!key) {
    delete el.dataset.i18n;
    delete el.dataset.i18nVars;
    el.textContent = '';
    return;
  }
  el.dataset.i18n = key;
  if (vars) el.dataset.i18nVars = JSON.stringify(vars);
  else delete el.dataset.i18nVars;
  el.textContent = t(key, vars);
}

/**
 * Same for the aria-label of `el`.
 * @param {HTMLElement} el
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function setAria(el, key, vars) {
  el.dataset.i18nAria = key;
  if (vars) el.dataset.i18nVars = JSON.stringify(vars);
  else delete el.dataset.i18nVars;
  el.setAttribute('aria-label', t(key, vars));
}

/** An inline icon of the sprite in library.html (`#i-<name>`). @param {string} name */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
