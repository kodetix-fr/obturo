// The "History" block of the settings dialog (library.html, section[data-section="history"]). The two selects (retention, size cap)
// are read and saved by settings-ui.js like every other setting; this module adds what they do not cover: the option for a stored
// value the menu does not list, the storage gauge, a line saying what the next cleanup would remove, and the two buttons
// (Purge now, Delete everything). Loaded with settings-ui.js, on the first opening of the dialog.
import { previewPurge, storageUsage } from './db.js';
import { meterState } from './history-model.js';
import { getSettings } from './settings.js';
import { fmtBytes, t } from './i18n.js';
import { byId as $ } from './dom-i18n.js';
import { countText, guardWith, openPurgeDialog, wipeHistory } from './history-dialogs.js';


// True in a tab where another one holds the editing lock: it looks at the history and its figures, and changes nothing.
let readOnly = () => false;
const RETENTION_CONTROLS = ['retentionDays', 'maxBytes', 'purgeBtn', 'wipeBtn'];

/** Makes sure the menu has an option for `value`, a stored value that the usual choices do not list. @param {HTMLSelectElement} select @param {number} value @param {string} label */
function keepOption(select, value, label) {
  select.querySelector('option[data-custom]')?.remove();
  if ([...select.options].some((o) => o.value === String(value))) return;
  const option = document.createElement('option');
  option.value = String(value);
  option.dataset.custom = '';
  option.textContent = label;
  select.append(option);
}

let seq = 0;

/**
 * Shows the stored settings and the state of the history: called when the dialog opens and after every change.
 * @param {import('./settings.js').Settings} settings
 */
export async function refresh(settings) {
  const keep = /** @type {HTMLSelectElement} */ ($('retentionDays'));
  const cap = /** @type {HTMLSelectElement} */ ($('maxBytes'));
  keepOption(keep, settings.retentionDays, t('hist.keep.custom', { n: settings.retentionDays }));
  keepOption(cap, settings.maxBytes, fmtBytes(settings.maxBytes));
  keep.value = String(settings.retentionDays);
  cap.value = String(settings.maxBytes);
  const locked = readOnly();
  for (const id of RETENTION_CONTROLS) /** @type {HTMLButtonElement | HTMLSelectElement} */ ($(id)).disabled = locked;
  $('histReadonly').hidden = !locked;

  const mine = ++seq;
  const text = $('storageText');
  const meter = $('storageMeter');
  const pending = $('storagePending');
  try {
    const usage = await storageUsage();
    const out = await previewPurge({ olderThanDays: settings.retentionDays, maxBytes: settings.maxBytes });
    if (mine !== seq) return; // a newer refresh is on its way
    const used = fmtBytes(usage.bytes);
    const count = countText(usage.count);
    text.textContent = settings.maxBytes > 0
      ? t('hist.meter.cap', { count, used, cap: fmtBytes(settings.maxBytes) })
      : t('hist.meter.nocap', { count, used });
    const state = meterState(usage.bytes, settings.maxBytes);
    meter.hidden = state.level === 'none';
    meter.dataset.level = state.level;
    meter.style.setProperty('--fill', String(state.ratio));
    meter.setAttribute('aria-valuenow', String(usage.bytes));
    meter.setAttribute('aria-valuemax', String(Math.max(settings.maxBytes, 1)));
    meter.setAttribute('aria-valuetext', text.textContent);
    const lines = [];
    if (out.deleted) lines.push(t('hist.pending', { what: `${countText(out.deleted)} (${fmtBytes(out.freedBytes)})` }));
    if (out.overCap) lines.push(t('hist.meter.over'));
    pending.textContent = lines.join(' ');
    pending.hidden = !lines.length;
  } catch (e) {
    if (mine !== seq) return;
    console.error('Obturo: storage figures unavailable', e);
    text.textContent = t('hist.meter.unavailable');
    meter.hidden = true;
    pending.hidden = true;
  }
}

/** Wires the buttons, once (settings-ui.js calls it when it builds the dialog). @param {() => boolean} isReadOnly */
export function build(isReadOnly) {
  readOnly = isReadOnly;
  guardWith(isReadOnly);
  $('purgeBtn').addEventListener('click', async () => {
    if (readOnly()) return;
    const settings = await getSettings().catch(() => null);
    /** @type {HTMLInputElement} */ ($('pgDays')).value = String(settings?.retentionDays || 30);
    /** @type {HTMLInputElement} */ ($('pgAgeOn')).checked = true;
    /** @type {HTMLInputElement} */ ($('pgCapOn')).checked = false;
    await openPurgeDialog();
  });
  $('wipeBtn').addEventListener('click', () => {
    if (!readOnly()) wipeHistory().catch((e) => console.error('Obturo: delete everything', e));
  });
  // after a purge or a deletion, from here or from the history view
  document.addEventListener('obturo:history-changed', () => {
    if (/** @type {HTMLDialogElement} */ ($('settings')).open) getSettings().then(refresh).catch(() => {});
  });
}
