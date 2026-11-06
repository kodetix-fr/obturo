import js from '@eslint/js';
import globals from 'globals';

// Strings from the captured page (title, URL) flow through the extension UI: anything that interprets HTML is
// forbidden by construction, we go through textContent / createElement / replaceChildren.
const NO_HTML = 'Forbidden: interprets HTML (the title and URL of the captured page flow through the UI). Use textContent, createElement or replaceChildren.';
const HTML_SINKS = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createContextualFragment', 'setHTMLUnsafe', 'parseHTMLUnsafe'];

// Files that run in the service worker, or that it may import (the export engines build the batch downloads): no
// document or window.
const WORKER = ['sw.js', 'db.js', 'idb.js', 'pure.js', 'fullpage-pure.js', 'thumb-pure.js', 'encode.js', 'pdf.js', 'zip.js'];
const NODE = ['**/*.test.js', 'scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.js'];

export default [
  { ignores: ['vendor/', 'dist/', 'node_modules/', 'coverage/'] },

  js.configs.recommended,

  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }], // `x == null` stays allowed (null or undefined)
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        ...HTML_SINKS.map((property) => ({ property, message: NO_HTML })),
        { object: 'document', property: 'write', message: NO_HTML },
        { object: 'document', property: 'writeln', message: NO_HTML },
      ],
      // The same workaround through destructuring: const { innerHTML } = el
      'no-restricted-syntax': [
        'error',
        {
          selector: `ObjectPattern > Property[key.name=/^(${HTML_SINKS.join('|')})$/]`,
          message: NO_HTML,
        },
      ],
    },
  },

  // Pages and injected scripts: browser + chrome.*
  {
    files: ['**/*.js'],
    ignores: [...WORKER, ...NODE],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },

  // Service worker: a forgotten document (or localStorage...) shows up right away (no-undef).
  {
    files: WORKER,
    languageOptions: { globals: { ...globals.serviceworker, chrome: 'readonly' } },
  },
  // Only exceptions: the functions passed to chrome.scripting.executeScript run in the page (window, ClipboardItem).
  {
    files: ['sw.js'],
    languageOptions: { globals: { ClipboardItem: 'readonly', window: 'readonly' } },
  },

  // Tests and scripts: Node.
  {
    files: NODE,
    languageOptions: { globals: globals.node },
  },
  // E2E tests and bench: Node driving a browser. The functions passed to page.evaluate (or to sw.evaluate) run in the
  // browser, hence document, window, chrome and __t (hook of the test service worker).
  {
    files: ['test/**/*.mjs', 'scripts/bench.mjs'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly', __t: 'readonly' } },
  },
];
