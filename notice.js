// What a capture leaves on the page when the image is not what the user asked for (cut, reduced, stopped): a short box at
// the bottom right, for the time it takes to read it, gone sooner on a click. showNotice is serialized into the page by chrome.scripting.executeScript (sw.js): it can use
// nothing but its arguments and the DOM, and it stays in this file for that reason.
// The shadow root is open on purpose: the tests read it (the page's own styles do not reach it either way).
/**
 * @param {string} title
 * @param {string} text
 * @param {'info' | 'error'} tone A remark (blue), a failure (red).
 */
export function showNotice(title, text, tone) {
  const ID = 'obturo-notice'; // fullpage.js removes it when the next capture starts: it must not be in that image
  // The light values of --accent and --danger in library.css: the host page has no theme of ours to follow.
  const TONES = { info: ['#2563eb', '#fff', '#2563eb'], error: ['#b3261e', '#fff', '#b3261e'] };
  const [bg, fg, line] = TONES[tone] ?? TONES.info;
  document.getElementById(ID)?.remove();
  const host = document.createElement('div');
  host.id = ID;
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = 'all:initial;display:block;position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:12px 14px;'
    + `border:1px solid ${line};border-radius:8px;font:14px/1.4 system-ui,sans-serif;color:${fg};background:${bg};`
    + 'box-shadow:0 1px 2px rgba(14,21,34,.1),0 8px 28px rgba(14,21,34,.28);cursor:pointer';
  const head = document.createElement('div');
  head.style.cssText = 'font-weight:600;margin-bottom:2px';
  head.textContent = title;
  const body = document.createElement('div');
  body.textContent = text;
  box.append(head, body);
  box.addEventListener('click', () => host.remove());
  host.attachShadow({ mode: 'open' }).append(box);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), Math.min(15000, Math.max(8000, 70 * (title.length + text.length)))); // about the time it takes to read it
}
