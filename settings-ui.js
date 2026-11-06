// The settings dialog of library.html. Loaded on first use (a dynamic import from library.js), so it costs nothing at
// startup.
//
// A control with a `name` equal to a key of settings.js is filled from the stored settings when the dialog opens and
// saved on its own 'change' event: to add a setting, add the control to library.html (inside a <section> of
// #settingsBody, with data-i18n labels) and its texts to locales/*.ui.js. Numbers (type number or range, or
// data-type="number") are saved as numbers, checkboxes as booleans, the rest as strings. settings.js validates.
import { DEFAULT_SETTINGS, DOWNLOAD_FORMATS, FORMAT_NAMES, getSettings, setSettings } from './settings.js';
import { t } from './i18n.js';
import { LANGUAGES } from './languages.js';
import { byId, setI18n } from './dom-i18n.js';
import * as historySettings from './history-settings.js';

const dialog = byId('settings', HTMLDialogElement);
const form = byId('settingsForm', HTMLFormElement);

/** @type {(settings: import('./settings.js').Settings) => void} */
let onChange = () => {};
let readOnly = () => false; // another tab holds the editing lock: the retention settings and the purge are not for this one
let built = false;
const RETENTION_KEYS = ['retentionDays', 'maxBytes'];

// A setting that could not be read or saved says so, in the dialog, where the user is looking.
/** @param {'settings.saveFailed' | 'settings.readFailed' | null} key null clears it */
function showError(key) {
  const el = byId('settingsError');
  if (key) setI18n(el, key);
  el.hidden = !key;
}

function build() {
  built = true;
  // One option per language, after "Auto". The names are autonyms: they are not translated.
  const select = byId('language');
  for (const [code, name] of Object.entries(LANGUAGES)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.append(option);
  }
  buildExport();
  historySettings.build(() => readOnly());
  form.addEventListener('change', save);
  dialog.addEventListener('close', () => { // the address no longer says "settings" once they are closed
    if (location.hash.startsWith('#settings')) history.replaceState(null, '', location.pathname + location.search);
  });
}

/** @param {Record<string, any>} settings */
function fill(settings) {
  for (const el of /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[name]'))) {
    const value = settings[el.name];
    if (value === undefined) continue;
    if (el.type === 'radio') el.checked = el.value === String(value);
    else if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
  }
  showQuality();
}

// ---- the Download section (locales/*.export.js) ----

// The format choices come from DOWNLOAD_FORMATS, like the languages: the names are not translated. The quality is written
// beside its slider, and again when the language changes (a percentage is written differently in French).
function buildExport() {
  const group = byId('downloadFormatChoices');
  for (const format of DOWNLOAD_FORMATS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'downloadFormat';
    input.value = format;
    const text = document.createElement('span');
    text.textContent = FORMAT_NAMES[format];
    label.append(input, text);
    group.append(label);
  }
  byId('downloadQualityRange').addEventListener('input', showQuality);
  new MutationObserver(showQuality).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

function showQuality() {
  const range = byId('downloadQualityRange', HTMLInputElement);
  const text = t('dl.quality.value', { n: Math.round(Number(range.value) * 100) });
  byId('downloadQualityOut').textContent = text;
  range.setAttribute('aria-valuetext', text);
}

async function save(/** @type {Event} */ e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (!el.name) return;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'number' || el.type === 'range' || el.dataset.type === 'number') value = Number(el.value);
  else value = el.value;
  try {
    if (readOnly() && RETENTION_KEYS.includes(el.name)) { // the control is disabled; this is for a change that got through anyway
      const current = await getSettings();
      fill(current);
      historySettings.refresh(current);
      return;
    }
    const stored = await setSettings({ [el.name]: value });
    showError(null);
    fill(stored);
    await onChange(stored); // the new language is in place before the figures are written in it
    historySettings.refresh(stored);
  } catch (err) {
    console.error('Obturo: settings not saved', err);
    showError('settings.saveFailed');
  }
}

/**
 * @param {(settings: import('./settings.js').Settings) => void | Promise<void>} apply called with the settings as stored, after each
 *   change (language and theme are applied by the page)
 * @param {() => boolean} [isReadOnly] true in a tab where another one holds the editing lock
 */
export async function openSettings(apply, isReadOnly = () => false) {
  onChange = apply;
  readOnly = isReadOnly;
  if (!built) build();
  showError(null);
  let current = DEFAULT_SETTINGS;
  try {
    current = await getSettings();
  } catch (err) { // what the dialog would show are not the settings in use: say so
    console.error('Obturo: settings unreadable', err);
    showError('settings.readFailed');
  }
  fill(current);
  historySettings.refresh(current);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0; // always from the first section
}
