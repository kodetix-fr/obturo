// Loaded by popup.js once the popup is painted: the dot on the Settings row when there are news to read, and the one request for a
// review. The same words and the same link for everyone; "No thanks" is as easy to reach as the review.
import { icon } from './dom-i18n.js';
import { LINKS } from './about-pure.js';
import { closeReviewAsk, newsPending, takeReviewAsk } from './about.js';

/** @param {string} className @param {() => void} onClick */
function button(className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `link ${className}`;
  b.addEventListener('click', onClick);
  return b;
}

/** One row in the place of the two links under the menu, so the popup keeps its height: a click on the row is the review, the cross is "no thanks", closing the popup is "later". @param {(key: string) => string} t @param {(url: string) => Promise<void>} open */
function ask(t, open) {
  const links = document.getElementById('links');
  if (!links) return;
  const box = document.createElement('div');
  box.id = 'ask';
  box.className = 'foot ask';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('popup.ask.label'));
  const review = button('ask-review', async () => {
    await closeReviewAsk().catch((e) => console.error('Obturo:', e));
    await open(LINKS.reviews);
  });
  const label = document.createElement('span');
  label.textContent = t('popup.ask.row');
  review.append(icon('star'), label);
  const never = button('ask-never', async () => {
    box.remove();
    links.hidden = false;
    await closeReviewAsk().catch((e) => console.error('Obturo:', e));
  });
  never.title = t('popup.ask.never');
  never.setAttribute('aria-label', t('popup.ask.never'));
  never.append(icon('x'));
  box.append(review, never);
  links.hidden = true;
  links.after(box);
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
