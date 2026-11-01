// Simplified Chinese texts. Each area owns its own part so that parallel edits never collide; i18n.test.js fails when a key
// exists in one language and not in the other, or in two parts at once.
import ui from './zh-CN.ui.js';
import sw from './zh-CN.sw.js';
import popup from './zh-CN.popup.js'; // popup
import history from './zh-CN.history.js'; // history
import download from './zh-CN.export.js'; // export
import chooser from './zh-CN.chooser.js'; // chooser

/** @type {Record<string, string>} */
export default { ...ui, ...sw, ...popup, ...history, ...download, ...chooser }; // popup, history, export, chooser
