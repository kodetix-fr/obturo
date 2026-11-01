// German texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './de.ui.js';
import sw from './de.sw.js';
import popup from './de.popup.js'; // popup
import history from './de.history.js'; // history
import download from './de.export.js'; // export
import chooser from './de.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
