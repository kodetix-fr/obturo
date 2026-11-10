// The confirmation dialog of the library (#confirmDlg in library.html): fills it, shows it and resolves when it closes. Apart from
// history-dialogs.js so that the editor can ask without loading the database and the settings.
import { byId as $ } from './dom-i18n.js';
import { sameWord } from './history-model.js';
import { t } from './i18n.js';
import { clamp } from './pure.js';

/**
 * @typedef {object} ConfirmOptions
 * @property {string} title
 * @property {string[]} [lines] paragraphs of the text
 * @property {string} ok label of the confirm button (a red one)
 * @property {string} [word] a word the user has to type before the button is enabled
 * @property {(progress: (text: string, ratio?: number) => void) => Promise<unknown>} [run] the job: the dialog shows a
 *   progress bar while it runs and cannot be closed; it closes when the job succeeds
 * @property {string} [error] text shown if the job fails (the dialog then offers to close)
 */

/**
 * Asks before something that cannot be undone.
 * @param {ConfirmOptions} o
 * @returns {Promise<boolean>} true if confirmed (and the job, if any, succeeded)
 */
export function confirmDialog({ title, lines = [], ok, word = '', run, error = '' }) {
  const dlg = /** @type {HTMLDialogElement} */ ($('confirmDlg'));
  const okBtn = /** @type {HTMLButtonElement} */ ($('cfOk'));
  const cancelBtn = /** @type {HTMLButtonElement} */ ($('cfCancel'));
  const typeRow = /** @type {HTMLElement} */ ($('cfTypeRow'));
  const typeInput = /** @type {HTMLInputElement} */ ($('cfType'));
  const bar = /** @type {HTMLProgressElement} */ ($('cfProgress'));
  const status = $('cfStatus');

  $('cfTitle').textContent = title;
  $('cfBody').replaceChildren(...lines.map((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
  okBtn.textContent = ok;
  okBtn.hidden = false;
  cancelBtn.textContent = t('hist.cancel');
  typeRow.hidden = !word;
  typeInput.value = '';
  if (word) $('cfTypeLabel').textContent = t('hist.wipe.type', { word });
  bar.hidden = true;
  status.textContent = '';
  status.classList.remove('error');
  const ready = () => !word || sameWord(typeInput.value, word);
  okBtn.disabled = !ready();
  typeInput.disabled = cancelBtn.disabled = false;

  return new Promise((resolve) => {
    const ac = new AbortController();
    const on = { signal: ac.signal };
    let busy = false;
    let result = false;

    const confirm = async () => {
      if (busy || !ready()) return;
      if (!run) { result = true; dlg.close(); return; }
      busy = true;
      okBtn.disabled = cancelBtn.disabled = typeInput.disabled = true;
      bar.hidden = false;
      bar.removeAttribute('value'); // indeterminate until the job reports a ratio
      try {
        await run((text, ratio) => {
          status.textContent = text;
          if (ratio !== undefined) bar.value = clamp(ratio, 0, 1);
        });
        result = true;
        busy = false;
        dlg.close();
      } catch (e) {
        console.error('Obturo: confirmed job failed', e);
        busy = false;
        bar.hidden = true;
        status.textContent = error;
        status.classList.add('error');
        okBtn.hidden = true;
        cancelBtn.disabled = false;
        cancelBtn.focus();
      }
    };

    okBtn.addEventListener('click', confirm, on);
    cancelBtn.addEventListener('click', () => { if (!busy) dlg.close(); }, on);
    typeInput.addEventListener('input', () => { okBtn.disabled = !ready(); }, on);
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && busy) e.preventDefault();
      else if (e.key === 'Enter' && e.target === typeInput) { e.preventDefault(); confirm(); }
    }, on);
    dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); }, on);
    dlg.addEventListener('close', () => { ac.abort(); resolve(result); }, { once: true });
    dlg.showModal();
    (word ? typeInput : cancelBtn).focus(); // never the destructive button
  });
}
