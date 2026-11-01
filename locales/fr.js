// Textes français. Chaque zone possède sa partie pour que des modifications en parallèle ne se heurtent jamais ;
// i18n.test.js échoue si une clé existe dans une langue et pas dans l'autre, ou dans deux parties à la fois.
import ui from './fr.ui.js';
import sw from './fr.sw.js';
import popup from './fr.popup.js'; // popup
import history from './fr.history.js'; // history
import download from './fr.export.js'; // export
import chooser from './fr.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
