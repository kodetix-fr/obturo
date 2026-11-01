// The `sw` part (icon menu, tooltip, notices) of every language but English, for the service worker: it cannot import() a
// language on demand, and these parts are small (about 2 KB each). English comes whole with i18n.js. i18n.test.js checks
// that every language of languages.js is here.
import de from './de.sw.js';
import es from './es.sw.js';
import fr from './fr.sw.js';
import id from './id.sw.js';
import ja from './ja.sw.js';
import ptBR from './pt-BR.sw.js';
import ru from './ru.sw.js';
import zhCN from './zh-CN.sw.js';

/** @type {Record<string, Record<string, string>>} */
export default { de, es, fr, id, ja, 'pt-BR': ptBR, ru, 'zh-CN': zhCN };
