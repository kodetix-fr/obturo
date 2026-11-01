// The texts of the popup in every language: its own part ('popup.*') and the 'menu.*' texts of the icon menu (the sw part),
// about 2.5 KB per language. Imported statically by popup.js: a dynamic import() after its script runs costs a round trip on a
// cold start (measured: the rows came in at 305 ms against 250 allowed), the static graph is fetched along with the script.
// i18n.test.js checks that every language of languages.js is here.
import deSw from './de.sw.js';
import dePopup from './de.popup.js';
import enSw from './en.sw.js';
import enPopup from './en.popup.js';
import esSw from './es.sw.js';
import esPopup from './es.popup.js';
import frSw from './fr.sw.js';
import frPopup from './fr.popup.js';
import idSw from './id.sw.js';
import idPopup from './id.popup.js';
import jaSw from './ja.sw.js';
import jaPopup from './ja.popup.js';
import ptBRSw from './pt-BR.sw.js';
import ptBRPopup from './pt-BR.popup.js';
import ruSw from './ru.sw.js';
import ruPopup from './ru.popup.js';
import zhCNSw from './zh-CN.sw.js';
import zhCNPopup from './zh-CN.popup.js';

/** @type {Record<string, Record<string, string>>} */
export default {
  de: { ...deSw, ...dePopup },
  en: { ...enSw, ...enPopup },
  es: { ...esSw, ...esPopup },
  fr: { ...frSw, ...frPopup },
  id: { ...idSw, ...idPopup },
  ja: { ...jaSw, ...jaPopup },
  'pt-BR': { ...ptBRSw, ...ptBRPopup },
  ru: { ...ruSw, ...ruPopup },
  'zh-CN': { ...zhCNSw, ...zhCNPopup },
};
