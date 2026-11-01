// Russian texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './ru.ui.js';
import sw from './ru.sw.js';
import popup from './ru.popup.js'; // popup
import history from './ru.history.js'; // history
import download from './ru.export.js'; // export
import chooser from './ru.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
