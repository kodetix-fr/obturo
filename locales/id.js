// Indonesian texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './id.ui.js';
import sw from './id.sw.js';
import popup from './id.popup.js'; // popup
import history from './id.history.js'; // history
import download from './id.export.js'; // export
import chooser from './id.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
