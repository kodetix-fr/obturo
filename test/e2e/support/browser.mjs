// Launches Playwright's Chromium with the extension loaded, in a throwaway profile.
//
// - The loaded extension is a COPY of the runtime files of the repository (the same list as the package), in a
//   temporary folder created by mkdtemp: we test what ships, and nothing is ever written into the repository.
// - The browser profile is throwaway too. The temporary folder (profile + copy) is deleted on close, by its exact
//   path.
// - E2E_DPR environment variable: simulated display scale (1, 1.5, 2...), 1 by default.
import { chromium } from 'playwright-core';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuntimeFiles } from '../../../scripts/package.mjs';
import { instrument } from './instrument.mjs';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DPR = Number(process.env.E2E_DPR || 1);

// Appended to the end of sw.js in the test copy: gives the tests control over the functions of the service worker (the
// user gesture is simulated by calling them) and records the badges with their timestamp. Nothing more: the production
// code runs as is.
const SW_HOOK = `
import * as __db from './db.js';
import * as __settings from './settings.js';
const __badge = [];
const __setText = chrome.action.setBadgeText.bind(chrome.action);
const __setColor = chrome.action.setBadgeBackgroundColor.bind(chrome.action);
chrome.action.setBadgeText = (o) => { __badge.push([Date.now(), 'text', o.text]); return __setText(o); };
chrome.action.setBadgeBackgroundColor = (o) => { __badge.push([Date.now(), 'color', o.color]); return __setColor(o); };
// "Saved but not copied" branch: the copy call (first argument = long base64 string) returns false.
const __execute = chrome.scripting.executeScript.bind(chrome.scripting);
chrome.scripting.executeScript = (o) => (globalThis.__failCopy && typeof o.args?.[0] === 'string' && o.args[0].length > 100)
  ? Promise.resolve([{ result: false }]) : __execute(o);
// The calls to chrome.contextMenus and the answers of Chrome (kind, props, error, time), from the very start of the worker: the
// menu is built a few milliseconds after the start, and a test that records later would miss that first build.
globalThis.__menu = [];
{
  const api = /** @type {any} */ (chrome.contextMenus);
  const { create, removeAll } = api;
  api.create = (props, cb) => create.call(api, props, () => { globalThis.__menu.push(['create', props, chrome.runtime.lastError?.message ?? null, performance.now()]); cb?.(); });
  api.removeAll = (cb) => removeAll.call(api, () => { globalThis.__menu.push(['removeAll', null, null, performance.now()]); cb?.(); });
}
globalThis.__t = { capture, captureFull, startArea, startElement, openLibrary, run, onMessage, db: __db, settings: __settings, badge: __badge };
`;

// macOS ignores --lang: the language of the interface comes from AppleLanguages, which the command line of the process can set
// without touching the settings of the machine. Playwright takes no such argument, and headless takes one address at most (the
// value of the setting counts as one), so a launcher script adds the setting and leaves Playwright's blank page out.
function languageLauncher(root, lang) {
  const file = join(root, 'chromium-lang.sh');
  const script = `#!/bin/sh
for a in "$@"; do shift; [ "$a" = about:blank ] || set -- "$@" "$a"; done
exec '${chromium.executablePath()}' -AppleLanguages '(${lang})' "$@"
`;
  writeFileSync(file, script, { mode: 0o755 });
  return file;
}

function copyExtension(dest, { hook, hostPermissions, realDefaults }) {
  for (const rel of listRuntimeFiles(REPO)) {
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(dest, rel));
  }
  if (hostPermissions) {
    // captureVisibleTab requires a user gesture (activeTab); the tests make none, so they give the copy
    // access to the sites. The scenarios that prove no extra permission is needed do without it.
    const file = join(dest, 'manifest.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    manifest.host_permissions = ['<all_urls>'];
    writeFileSync(file, JSON.stringify(manifest));
  }
  if (hook) appendFileSync(join(dest, 'sw.js'), SW_HOOK);
  if (hook && !realDefaults) {
    // The default after a capture is to ask what to do (a window opens). The capture tests are about the copy and the saving, so their copy of
    // the extension starts with the other choice; the tests of the window itself ask for the real defaults.
    const file = join(dest, 'settings.js');
    const text = readFileSync(file, 'utf8');
    const patched = text.replace("afterCapture: 'ask',", "afterCapture: 'copy',");
    if (patched === text) throw new Error("settings.js has no `afterCapture: 'ask',` to turn into 'copy' for the capture tests");
    writeFileSync(file, patched);
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.hook]            exposes globalThis.__t in the service worker
 * @param {boolean} [options.hostPermissions] adds host_permissions <all_urls> to the copy (captures without a gesture)
 * @param {boolean} [options.realDefaults]    with the hook: keeps the real default after a capture (ask what to do) instead of the copy the capture tests expect
 * @param {boolean} [options.realWindow]      real window (captureVisibleTab) instead of an emulated viewport
 * @param {boolean} [options.instrumented]    injects instrument.mjs into every page
 * @param {{ width: number, height: number }} [options.size]
 * @param {string} [options.lang]             UI language of the browser (--lang), e.g. 'fr': picks _locales/<lang> for the manifest
 */
export async function launchExtension({ hook = false, hostPermissions = false, realDefaults = false, realWindow = false, instrumented = true, size = { width: 1500, height: 900 }, lang } = {}) {
  // Short prefix: on Windows, the IndexedDB files in the profile must not exceed MAX_PATH.
  const root = mkdtempSync(join(tmpdir(), 'obt-'));
  const ext = join(root, 'ext');
  const profile = join(root, 'p');
  mkdirSync(ext);
  copyExtension(ext, { hook, hostPermissions, realDefaults });

  const cleanup = () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  // Software rendering on every machine: the pixel-for-pixel tests compare two renderings, which a GPU can round differently.
  const args = [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu'];
  if (lang) args.push(`--lang=${lang}`);
  if (realWindow) args.push(`--window-size=${size.width},${size.height}`, `--force-device-scale-factor=${DPR}`, '--hide-scrollbars');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', // "full" Chromium in headless mode: the only one that loads extensions
      headless: true,
      args,
      ...(lang && process.platform === 'darwin' && { executablePath: languageLauncher(root, lang) }),
      ...(lang && { env: { ...process.env, LANGUAGE: lang.replace('-', '_') } }), // Chrome on Linux reads the language of its interface from LANGUAGE
      acceptDownloads: true,
      ...(realWindow ? { viewport: null } : { viewport: size, deviceScaleFactor: DPR }),
    });
    if (instrumented) await context.addInitScript(instrument);

    const errors = [];
    const watch = (page) => {
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    };
    context.pages().forEach(watch);
    context.on('page', watch);

    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const id = sw.url().split('/')[2];
    return {
      context, sw, id, errors,
      url: (path = 'library.html') => `chrome-extension://${id}/${path}`,
      async close() {
        await context.close();
        cleanup();
      },
    };
  } catch (e) {
    await context?.close().catch(() => {});
    cleanup();
    throw e;
  }
}
