// English texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './en.ui.js';
import sw from './en.sw.js';
import popup from './en.popup.js'; // popup
import history from './en.history.js'; // history
import download from './en.export.js'; // export
import chooser from './en.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
