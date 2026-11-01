// Spanish texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './es.ui.js';
import sw from './es.sw.js';
import popup from './es.popup.js'; // popup
import history from './es.history.js'; // history
import download from './es.export.js'; // export
import chooser from './es.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
