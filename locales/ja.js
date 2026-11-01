// Japanese texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './ja.ui.js';
import sw from './ja.sw.js';
import popup from './ja.popup.js'; // popup
import history from './ja.history.js'; // history
import download from './ja.export.js'; // export
import chooser from './ja.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
