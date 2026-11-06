// What the history view, the strip, the editor and the history block of the settings share: the confirmation dialog, the
// deletion with a progress, the "Purge now" dialog and the "Delete everything" one. The dialogs are in library.html
// (#confirmDlg, #purgeDlg); this module fills them, shows them and resolves when they close. Sizes and plurals: i18n.js.
//
// Two events on `document` tell the rest of the page what happens to the history:
//   'obturo:history-deleting'  { ids, waits }  about to delete these shots; a listener that holds one of them (the library, with
//                              its editor) pushes a promise to `waits` and the deletion starts when all are settled
//   'obturo:history-changed'   { reason }      shots were removed (reason 'deleted' | 'purged'); lists and gauges read again
import { deleteShots, listEntries, previewPurge, purgeNow } from './db.js';
import { chunks, purgeOptions, sameWord, summarizeSelection } from './history-model.js';
import { fmtBytes, formatNumber, plural, t } from './i18n.js';
import { byId as $ } from './dom-i18n.js';
import { clamp } from './pure.js';

/** Shots removed per transaction when deleting many: one transaction is a progress step. */
const DELETE_CHUNK = 250;

/** "1 capture", "5,000 captures". @param {number} n */
export const countText = (n) => plural(n, 'hist.count.one', 'hist.count.other');

/** @param {string} name @param {object} [detail] */
export const notify = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

const frame = () => new Promise((done) => setTimeout(done)); // lets the page paint between two steps of a long job

// A tab where another one holds the editing lock may look, never change: the history view and the settings give the library's
// answer here, and everything below that deletes or purges checks it, whatever button or key led to it.
let isReadOnly = () => false;
/** @param {() => boolean} check */
export const guardWith = (check) => { isReadOnly = check; };

// --- Deleting ---

/**
 * Deletes shots by chunks, so that a long job reports its progress and never blocks the page. A shot that no longer exists is
 * skipped. Tells the page first ('obturo:history-deleting', so the editor can let go of the shot it holds) and after.
 * @param {number[]} ids
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<number>} how many shots were deleted
 */
export async function deleteWithProgress(ids, onProgress) {
  if (isReadOnly()) throw new Error('read-only tab');
  /** @type {Promise<unknown>[]} */
  const waits = [];
  notify('obturo:history-deleting', { ids, waits });
  await Promise.all(waits);
  let deleted = 0;
  let done = 0;
  try {
    for (const part of chunks(ids, DELETE_CHUNK)) {
      deleted += (await deleteShots(part)).deleted;
      done += part.length;
      onProgress?.(done, ids.length);
      if (done < ids.length) await frame();
    }
  } finally {
    notify('obturo:history-changed', { reason: 'deleted' }); // also after a failure: some chunks went
  }
  return deleted;
}

// --- Confirmation ---

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

// --- Delete everything ---

/** The "Delete everything" flow of the settings: counts, strong confirmation (a word to type), then the deletion with a progress. @returns {Promise<boolean>} */
export async function wipeHistory() {
  if (isReadOnly()) return false;
  const entries = await listEntries({});
  if (!entries.length) return false;
  const ids = entries.map((e) => e.id);
  const sum = summarizeSelection(entries, new Set(ids));
  const done = await confirmDialog({
    title: t('hist.wipe.title'),
    lines: [t('hist.wipe.body', { what: countText(sum.count), size: fmtBytes(sum.bytes) })],
    ok: t('hist.wipe.ok'),
    word: t('hist.wipe.word'),
    run: (progress) => deleteWithProgress(ids, (n, total) => progress(t('hist.del.progress', { done: formatNumber(n), total: formatNumber(total) }), n / total)),
    error: t('hist.del.failed'),
  });
  return done;
}

// --- Purge now ---

/** "Purge now": options, a preview of what they would remove, and the purge. Resolves when the dialog closes. @returns {Promise<void>} */
export function openPurgeDialog() {
  if (isReadOnly()) return Promise.resolve();
  const dlg = /** @type {HTMLDialogElement} */ ($('purgeDlg'));
  const ageOn = /** @type {HTMLInputElement} */ ($('pgAgeOn'));
  const days = /** @type {HTMLInputElement} */ ($('pgDays'));
  const capOn = /** @type {HTMLInputElement} */ ($('pgCapOn'));
  const size = /** @type {HTMLInputElement} */ ($('pgSize'));
  const unit = /** @type {HTMLSelectElement} */ ($('pgUnit'));
  const preview = $('pgPreview');
  const bar = /** @type {HTMLProgressElement} */ ($('pgProgress'));
  const runBtn = /** @type {HTMLButtonElement} */ ($('pgRun'));
  const closeBtn = /** @type {HTMLButtonElement} */ ($('pgClose'));

  const line = (text, cls = '') => {
    const p = document.createElement('p');
    p.textContent = text;
    if (cls) p.className = cls;
    return p;
  };
  const options = () => purgeOptions({
    ageOn: ageOn.checked, days: days.value, capOn: capOn.checked, size: size.value, unit: /** @type {'MB' | 'GB'} */ (unit.value),
  });

  bar.hidden = true;
  runBtn.hidden = false;
  runBtn.disabled = true;
  runBtn.textContent = t('hist.purge.run');
  closeBtn.disabled = false;
  closeBtn.textContent = t('hist.cancel');
  preview.replaceChildren();

  return new Promise((resolve) => {
    const ac = new AbortController();
    const on = { signal: ac.signal };
    let seq = 0;
    let timer = 0;
    let busy = false;

    const refresh = async () => {
      const mine = ++seq;
      const o = options();
      if (!o.olderThanDays && !o.maxBytes) {
        preview.replaceChildren(line(t('hist.purge.none')));
        runBtn.disabled = true;
        return;
      }
      try {
        const p = await previewPurge(o);
        if (mine !== seq) return;
        const lines = [];
        lines.push(line(p.deleted ? t('hist.purge.some', { what: countText(p.deleted), size: fmtBytes(p.freedBytes) }) : t('hist.purge.none')));
        if (p.keptPinned || p.keptEdited) lines.push(line(t('hist.purge.kept', { pinned: formatNumber(p.keptPinned), edited: formatNumber(p.keptEdited) })));
        if (p.deleted) lines.push(line(t('hist.purge.remaining', { what: countText(p.remaining.count), size: fmtBytes(p.remaining.bytes) })));
        if (p.overCap) lines.push(line(t('hist.purge.over'), 'warn'));
        preview.replaceChildren(...lines);
        runBtn.disabled = p.deleted === 0;
      } catch (e) {
        if (mine !== seq) return;
        console.error('Obturo: purge preview failed', e);
        preview.replaceChildren(line(t('hist.purge.failed'), 'warn'));
        runBtn.disabled = true;
      }
    };
    const later = () => {
      clearTimeout(timer);
      runBtn.disabled = true; // the preview in front of the user is out of date
      timer = window.setTimeout(refresh, 150);
    };

    const run = async () => {
      if (busy || runBtn.disabled || isReadOnly()) return;
      busy = true;
      seq++; // drops a preview still on its way
      runBtn.disabled = closeBtn.disabled = true;
      runBtn.textContent = t('hist.purge.running');
      bar.hidden = false;
      try {
        // ponytail: purgeNow works by lots but reports once at the end, so the bar cannot count; pass it a progress callback like deleteWithProgress to report a number.
        // The capture open in the editor is never part of what it removes (db.js), so there is nothing to ask the editor to let go of.
        const out = await purgeNow(options());
        preview.replaceChildren(line(t('hist.purge.done', { what: countText(out.deleted), size: fmtBytes(out.freedBytes) })));
        runBtn.hidden = true;
        closeBtn.textContent = t('common.close');
      } catch (e) {
        console.error('Obturo: purge failed', e);
        preview.replaceChildren(line(t('hist.purge.failed'), 'warn'));
        runBtn.textContent = t('hist.purge.run');
      } finally {
        notify('obturo:history-changed', { reason: 'purged' }); // also after a failure: some lots went
      }
      busy = false;
      bar.hidden = true;
      closeBtn.disabled = false;
      closeBtn.focus();
    };

    for (const el of [ageOn, days, capOn, size, unit]) el.addEventListener('input', later, on);
    unit.addEventListener('change', later, on);
    runBtn.addEventListener('click', run, on);
    closeBtn.addEventListener('click', () => { if (!busy) dlg.close(); }, on);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape' && busy) e.preventDefault(); }, on);
    dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); }, on);
    dlg.addEventListener('close', () => { clearTimeout(timer); ac.abort(); resolve(); }, { once: true });
    dlg.showModal();
    refresh();
  });
}
