# Contributing

Obturo is open source under the MIT licence. This guide is for everyone who
works on it: how to set up, what the checks enforce, how the conventions go.
Bug reports and pull requests are welcome, in English or in French.

Obturo is deliberately small: an extension with no build step, no server and as
few permissions and dependencies as possible. A contribution is welcome when it
keeps that balance. For anything that touches a permission, the network or a
dependency, open an issue first and talk it through.

## Getting set up

Node 22.13 or newer (CI runs Node 24, and also Node 22.13 and Windows) and Chrome 116 or newer.

```sh
npm ci --ignore-scripts
```

`--ignore-scripts` is on purpose: no tool of the project needs an install
script, and it is a supply chain precaution. The `devDependencies` are exact
versions and `package-lock.json` is committed.

To try the extension, load the repository folder in `chrome://extensions`
(**Developer mode**, **Load unpacked**). There is no build; after a change,
reload the extension from its card. The logs of the service worker open from the
"service worker" link on that card, those of the library from the developer
tools of its tab.

The end-to-end tests drive the Chromium of Playwright. Install it once (the
version of Playwright is pinned, so the browser is too):

```sh
npx playwright-core install chromium
```

Add `--with-deps` on Linux for the system libraries of the browser. Nothing
else is downloaded.

## Before opening a pull request

```sh
npm run check       # lint, typecheck, unit tests and texts; no browser, fast
npm run test:e2e    # if the change touches capture, the library, the history or the editor
npm run package     # the zip must still hold the runtime files and nothing else
```

The same steps run in CI on every pull request (the `check` and `e2e` jobs),
alongside a security workflow (Semgrep, `npm audit`, Gitleaks). The end-to-end
tests run one file at a time (`--test-concurrency=1`, keep it) and take several
minutes, with a timeout of 180 seconds per test. `npm run bench` measures the
performance budgets; it depends on the hardware and does not run in CI, so run
it on an idle machine before and after a change that touches capture, the
library, the history or the editor, and put both tables in the pull request.

A few things that are easy to miss:

- **No permission added without a discussion.** The manifest declares
  `activeTab`, `scripting` and `contextMenus`, which shows no warning at
  install. A new permission, or access to websites, changes the promise made to
  users: it is discussed in an issue before any code, and justified in
  `docs/store-listing.md` and `docs/PRIVACY.md`. `manifest.test.js` pins the
  list.
- **No remote code, no telemetry.** No script, module or WebAssembly loaded from
  the network, no `eval`, no `new Function`, no request to a server. Everything
  that runs is in the repository.
- **No HTML parsing.** Strings from the captured page (title, address) flow
  through the interface. `innerHTML`, `outerHTML`, `insertAdjacentHTML` and
  `document.write` are forbidden by ESLint; use `textContent`, `createElement`
  and `replaceChildren`.
- **A runtime dependency needs a written reason**, in the issue or the pull
  request: why a platform API does not do, the weight added, the license, the
  upkeep. If it is accepted, it is copied unmodified into `vendor/`, with its
  pinned version, its checksums and its provenance in `vendor/README.md`, and its
  license in `THIRD_PARTY_NOTICES.md`. `npm audit` and Dependabot do not see
  `vendor/`: its version is checked by hand. Dev dependencies are exact versions,
  no `^`.
- **Logic is tested.** Every calculation lives in a pure module (no `chrome.*`,
  IndexedDB or DOM) with its `node:test` tests in a `*.test.js` file. Code that
  calls `chrome.*`, IndexedDB or the DOM is covered by the end-to-end tests in
  `test/e2e/`: a new behaviour adds its scenario there, or is tried by hand in
  Chrome and the pull request says what you tried.
- **The performance budgets count.** They are in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). A change to capture, the library
  or the editor says whether it still meets them.
- **The service worker stays light.** At load time it holds constants and
  listeners only, because it restarts often (the one exception is the rebuild of
  the icon menu, asynchronous and off the capture path). It imports `db.js`,
  `pure.js`, `fullpage-pure.js`, `gestures.js`, `i18n.js` and `settings.js` and
  what they import, never Fabric.js.
- **Stay small.** No build step, no test framework, no code formatter: follow
  `.editorconfig` and ESLint, and the style of the file you are in. Tests use
  `node:test`; Playwright is only the browser driver (`devDependency`).
- **Code, comments and log strings in English, ASCII only.** User-facing texts
  are not in the code: they live in `locales/` (nine languages) and in
  `_locales/`, never in `library.html` (a test fails on visible text written
  there). A text added in one language is added in every other (a test compares
  each language with English, key by key), and the French one addresses the
  reader as "tu" (a test fails on "vous" and the imperatives in "-ez"). Any
  script is fine in the files of `locales/`.
- **The history must not lose a capture it should keep.** The retention
  (`retention.js`, `db.js`) never removes a pinned capture, one the library has
  open or the one just added, and removes nothing when the settings cannot be
  read. A change there comes with its tests in `retention.test.js` and its
  scenario in `test/e2e/history.e2e.mjs` or `integrity.e2e.mjs`.
- **A change to the database schema has an upgrade step.** The database is at
  version 3 (`db.js`); a new version adds its step to `upgrade` and keeps every
  existing capture. `test/e2e/history.e2e.mjs` writes a database of the previous
  version (`seedV2`) and checks the upgrade.
- **No personal data.** Captures, exports and browser profiles never go in the
  repository. Tests use made-up pages and data.
- **Plain hyphens.** No em dash or en dash in prose, comments, strings or commit
  messages; use the punctuation the dash stood for.

## How the checks work

- **ESLint** (`eslint.config.js`): the recommended rules, `no-var`,
  `prefer-const`, `eqeqeq`, `no-eval`, `no-implied-eval`, `no-new-func`, and the
  ban on HTML parsing. `sw.js`, `db.js`, `pure.js`, `fullpage-pure.js`,
  `thumb-pure.js` and the encoders (`encode.js`,
  `pdf.js`, `zip.js`, which also run in a worker) are checked with the globals
  of a service worker, so using `document` or `window` by mistake is reported.
  `vendor/` is not linted.
- **TypeScript** (`tsconfig.json`): `allowJs` and `checkJs`, `noEmit`, with the
  types of `@types/chrome`. The mode is permissive (`strict` is off). Fabric.js
  ships without type files: `noResolve` keeps `tsc` out of the minified bundle,
  and `types/fabric.d.ts` declares it as `any`. The count is zero errors;
  `npx tsc -p tsconfig.json --strict` lists what a strict mode would still need
  (mostly untyped parameters). The tests and the Node scripts are checked by a
  second project, `tsconfig.node.json` (Node and Chrome types, without
  `noResolve`). To type a DOM element, annotate with JSDoc, for example
  `/** @type {HTMLInputElement} */`.
- **Unit tests**: `node --test "*.test.js"` (`npm test`) runs the `*.test.js`
  files at the root. They also check texts: the same keys and placeholders in
  every language as in English, every key used by the code, no visible text in
  `library.html`, the "tu" of the French, the manifest texts of each language
  (description within 132 characters) and the three permissions.
- **End-to-end tests**: `test/e2e/*.e2e.mjs`, run by `npm run test:e2e` at
  concurrency 1 (one file at a time). They drive Playwright's Chromium,
  headless, with the extension loaded (`--load-extension`). The extension they
  load is a temporary copy of its runtime files (the same list as the package);
  the browser profile is throwaway (made with `mkdtemp`, removed at the end by
  its exact path); nothing is written in the repository. The copy of `sw.js`
  gets a hook (`globalThis.__t`) so a test can trigger a capture without a
  keyboard gesture, and the copy of the manifest gets host permissions where a
  test needs `captureVisibleTab` without one; the scenarios that prove no extra
  permission is needed run without them. The `E2E_DPR` environment variable
  (`1.5`, `2`...) simulates a display scale, `E2E_TRACES` (a folder) keeps a
  Playwright trace of every launch of the browser: CI uploads them when the job
  fails. To add a scenario, reuse the
  helpers in `test/e2e/support/` (launch, IndexedDB seeds, mouse, export) and
  wait for a condition (`poll`, `shotWhere`) rather than a fixed delay.
- **Benchmark**: `npm run bench` measures the budgets of
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and prints a table.

## Adding a language

Nine languages exist today: English and French, written by the author, and
German, Spanish, Brazilian Portuguese, Indonesian, Russian, Japanese and
simplified Chinese, assisted translations that a native reader is welcome to
correct (a pull request on the files of `locales/` is enough). The texts of the
interface live in `locales/`, in six parts per language, and are loaded at run
time for the language chosen in the settings (`i18n.js`): English always, the
others on demand. To add one, say Italian (`it`):

1. **The texts.** Copy the six English parts to `locales/it.ui.js` (library and
   editor), `locales/it.sw.js` (icon menu, tooltip, notices),
   `locales/it.popup.js`, `locales/it.history.js`, `locales/it.export.js` and
   `locales/it.chooser.js`, and translate the values. Keep the keys, their order
   and the `{placeholders}`; no em or en dash. Copy `locales/en.js` to
   `locales/it.js` and point its six imports at the new files. A text that
   depends on a count comes as a `.one` and a `.other` pair; there are two forms
   only (`pluralForm` in `i18n.js`, from `Intl.PluralRules`): a language with
   more forms (Russian, Polish) words those texts so that the noun does not agree
   with the number ("Snapshots: {n}"), as `locales/ru.history.js` does. A
   language whose `one` also selects numbers above 1 (Russian: 21, 31) still
   gets `one` for 0 and 1 only (`pluralForm` in `i18n.js`).
2. **The registry.** In `languages.js`, add the code (as `chrome.i18n`
   writes it: `it`, `pt-BR`) and the name of the language in its own language to
   `LANGUAGES`: the language picker of the settings, the resolution of the
   browser language and the tests all read that list. In `locales/sw.js`, import
   `it.sw.js` and add it to the object: the service worker cannot load a language
   on demand.
3. **The browser-side texts.** Add `_locales/it/messages.json` (a code with a
   region takes an underscore: `pt_BR`) with the keys of
   `_locales/en/messages.json`: the name, the description (132 characters at
   most) and the names of the shortcuts, which Chrome reads from the manifest in
   the language of the browser. `actionTitle` must say the same as
   `sw.actionTitle` of `locales/it.sw.js`.
4. **The checks** need no change: `i18n.test.js` compares every language of
   `languages.js` with English, key by key (same keys and order, same
   placeholders, no empty text, plural pairs complete), `manifest.test.js`
   expects one `_locales` folder per language, and `settings-layout.e2e.mjs`
   opens the settings in every language to see that no choice is cut.
5. If keyboards sold for that language print the key names in that language
   (Shift, Delete...), add them to `KEY_NAMES` in `gestures.js`: the popup shows
   the shortcuts with them.
6. Run `npm run check` and `npm run package`, then try the language in the
   settings of the extension and in the popup.

## Commits

One logical change per commit. Subject in the imperative, in English, no
trailing period, no prefix or ticket number (no Conventional Commits):

```
Skip a capture requested while another one is running
```

Use the body to explain *why*: the constraint, the failure it avoids, what you
verified. The code says what changed; the message is where the reasoning is
kept, so it does not need to be repeated in comments.

A release is one commit titled `Release X.Y.Z`; the pull request number GitHub
adds makes it `Release 0.2.0 (#12)`.

## Packaging and releases

`npm run package` writes `dist/obturo-<version>.zip`, where `<version>` is read
from `manifest.json`. The script needs nothing but Node. It checks the manifest
(valid JSON, version format, and in each language of `_locales/`: every
`__MSG_key__` defined, `name` at most 75 characters, `short_name` 12,
`description` 132) and that the files it cites are there, reads the zip back and
compares it with the disk, warns about any file over 500 KB outside `vendor/`,
then prints the list of files, their sizes and the SHA-256 of the zip. The
package holds the runtime files only: no tests, no documentation, no tool
configuration, no hidden folders.

To release, in one pull request: set `version` in `manifest.json`, `package.json`
and `package-lock.json`, replace "unreleased" by the date in the entry of
`CHANGELOG.md`, and run `npm run check` and `npm run package`. Once it is
merged, tag the merge commit
`vX.Y.Z` on `main`. The release workflow first refuses a tag whose commit is not
on `main` or whose name differs from the version of `manifest.json`,
`package.json` or `package-lock.json`; then it runs `npm run check` and the
end-to-end tests on the tagged commit; only then does it create the GitHub
release with generated notes and upload the zip with a `.sha256` file. A tag that
fails one of these publishes nothing, and the job can be re-run once the cause is
fixed (a tag moved to another commit is deleted and pushed again).

## Reporting a bug

Open an [issue](https://github.com/kodetix-fr/obturo/issues) with the template.
Include the version of Obturo (in `chrome://extensions`, or `manifest.json`),
your Chrome version and system, and the steps that reproduce it. For a full
page, say what kind of page it is: the document scrolling, or an inner
container. If the service worker logged something, paste it (the "service
worker" link on the extension's card). Do not attach a capture that holds
personal or confidential data.

For anything security-related, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## License

Contributions are accepted under the [MIT licence](LICENSE) that covers the
project. Fabric.js, in `vendor/`, keeps its own MIT license.
