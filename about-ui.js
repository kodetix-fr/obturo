// The "About" part of the settings (version, news of this release, links) and the dot on the settings button that says there is news to
// read. Loaded after the first paint by library.js and by the settings dialog; the state is about.js.
import { byId, setI18n } from './dom-i18n.js';
import { t } from './i18n.js';
import { LINKS, NEWS_FOR, minorOf } from './about-pure.js';
import { markNewsSeen, newsPending } from './about.js';

const version = () => chrome.runtime.getManifest().version;

/** @param {boolean} on */
function showDot(on) {
  byId('settingsDot').hidden = !on;
  const button = byId('settingsBtn');
  button.title = on ? `${t('app.settings')}, ${t('about.new')}` : t('app.settings');
  if (on) button.setAttribute('aria-describedby', 'settingsNew');
  else button.removeAttribute('aria-describedby');
}

/** The dot on the settings button, if the news of this release were not read yet. */
export async function showNewsDot() {
  try {
    showDot(await newsPending());
  } catch (e) {
    console.error('Obturo: news', e);
  }
}

let seenWatch = null;

// The news count as read once the About section is on screen; the dialog opens on it while they are not.
async function watchNews() {
  seenWatch?.disconnect();
  seenWatch = null;
  if (!(await newsPending())) return;
  const section = byId('aboutSection');
  section.scrollIntoView({ block: 'nearest' });
  seenWatch = new IntersectionObserver(async (entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    seenWatch?.disconnect();
    seenWatch = null;
    await markNewsSeen();
    showDot(false);
  }, { root: byId('settings'), threshold: 0.4 });
  seenWatch.observe(section);
}

/** The settings dialog is open: fills the About section and follows the news. */
export async function openAbout() {
  setI18n(byId('aboutVersion'), 'about.version', { v: version() });
  byId('aboutNews').hidden = minorOf(version()) !== NEWS_FOR;
  /** @type {HTMLAnchorElement} */ (byId('reviewLink')).href = LINKS.reviews;
  /** @type {HTMLAnchorElement} */ (byId('issuesLink')).href = LINKS.issues;
  const oblitero = /** @type {HTMLAnchorElement} */ (byId('obliteroLink'));
  oblitero.href = LINKS.oblitero;
  oblitero.textContent = 'Oblitero'; // a name, not translated
  try {
    await watchNews();
  } catch (e) {
    console.error('Obturo: news', e);
  }
}
