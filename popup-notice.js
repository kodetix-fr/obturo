// Loaded by popup.js once the popup is painted: the dot on the Settings row when there are news to read, and the one request for a
// review. The same words and the same links for everyone; "Later" and "No thanks" are as easy to reach as the review.
import { LINKS } from './about-pure.js';
import { closeReviewAsk, newsPending, takeReviewAsk } from './about.js';

/** @param {string} className @param {string} text @param {() => void} onClick */
function button(className, text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/** @param {(key: string) => string} t @param {(url: string) => Promise<void>} open */
function ask(t, open) {
  const box = document.createElement('section');
  box.id = 'ask';
  box.className = 'ask';
  box.setAttribute('aria-label', t('popup.ask.label'));
  const text = document.createElement('p');
  text.className = 'ask-text';
  text.textContent = t('popup.ask.text');
  const row = document.createElement('div');
  row.className = 'ask-buttons';
  row.append(
    button('ask-btn primary', t('popup.ask.review'), async () => {
      await closeReviewAsk().catch((e) => console.error('Obturo:', e));
      await open(LINKS.reviews);
    }),
    button('ask-btn', t('popup.ask.later'), () => box.remove()),
    button('ask-btn', t('popup.ask.never'), async () => {
      box.remove();
      await closeReviewAsk().catch((e) => console.error('Obturo:', e));
    }),
  );
  box.append(text, row, button('link', t('popup.ask.problem'), () => open(LINKS.issues)));
  document.getElementById('menu')?.after(box);
}

/** @param {(key: string) => string} t The texts of the popup. @param {(url: string) => Promise<void>} open Opens a page in a new tab and closes the popup. */
export async function run(t, open) {
  try {
    if (await newsPending()) {
      const row = document.querySelector('[data-id="open-settings"]');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      row?.append(dot);
      row?.setAttribute('aria-label', `${row.getAttribute('aria-label')}, ${t('popup.news')}`);
    }
    if (await takeReviewAsk()) ask(t, open);
  } finally {
    performance.mark('obturo:popup-notice');
  }
}
