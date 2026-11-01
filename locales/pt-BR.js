// Brazilian Portuguese texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './pt-BR.ui.js';
import sw from './pt-BR.sw.js';
import popup from './pt-BR.popup.js'; // popup
import history from './pt-BR.history.js'; // history
import download from './pt-BR.export.js'; // export
import chooser from './pt-BR.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
