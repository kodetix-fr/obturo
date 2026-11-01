// "Open the library" reactivates the tab that is already open instead of creating a second one (which would be
// read-only). The test copy has NO extra permission beyond the manifest: this proves that getContexts, tabs.update
// and windows.update are enough, without the "tabs" permission.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './support/browser.mjs';
import { poll } from './support/editor.mjs';

describe('library: reactivating the existing tab', () => {
  let h, sw, page;
  const library = () => h.context.pages().filter((p) => p.url().startsWith('chrome-extension://') && p.url().includes('library.html'));
  const tabs = () => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['TAB'] }))
    .filter((c) => c.documentUrl.split(/[?#]/)[0] === chrome.runtime.getURL('library.html'))
    .map((c) => ({ tabId: c.tabId, windowId: c.windowId })));
  const isActive = (tabId) => sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, tabId);
  const openLibrary = () => sw.evaluate(() => __t.openLibrary());
  const waitTabs = (n, what) => poll(async () => (await tabs()).length === n, { what, timeout: 6000, interval: 100 });
  const closeLibrary = async () => {
    for (const p of library()) await p.close();
    await waitTabs(0, 'no library tab left');
  };

  before(async () => {
    h = await launchExtension({ hook: true, instrumented: false, realWindow: true, size: { width: 1280, height: 800 } });
    sw = h.sw;
    page = await h.context.newPage();
    await page.goto('about:blank');
  });
  after(() => h?.close());

  it('start: no library tab; the first call creates one', async () => {
    assert.equal((await tabs()).length, 0);
    await openLibrary();
    await waitTabs(1, 'library tab created');
  });

  it('a second call reactivates the same tab, with no duplicate', async () => {
    const [{ tabId }] = await tabs();
    await page.bringToFront(); // the library is no longer the active tab
    await poll(async () => (await isActive(tabId)) === false, { what: 'library in the background' });
    await openLibrary();
    await poll(() => isActive(tabId), { what: 'library reactivated' });
    const after = await tabs();
    assert.deepEqual(after.map((t) => t.tabId), [tabId], 'no duplicate');
  });

  it('the query and the hash of the address are ignored', async () => {
    await closeLibrary();
    await sw.evaluate(() => chrome.tabs.create({ url: `${chrome.runtime.getURL('library.html')}?x=1#frag` }));
    await waitTabs(1, 'tab opened with ?query#hash');
    const [{ tabId }] = await tabs();
    await page.bringToFront();
    await poll(async () => (await isActive(tabId)) === false, { what: 'library in the background' });
    await openLibrary();
    await poll(() => isActive(tabId), { what: 'library reactivated' });
    assert.deepEqual((await tabs()).map((t) => t.tabId), [tabId]);
  });

  it('the settings entry on a tab that is already open: the dialog opens, again after it was closed, no second tab', async () => {
    await closeLibrary();
    await openLibrary();
    await waitTabs(1, 'library tab created');
    const lib = library()[0];
    await lib.waitForFunction(() => !document.documentElement.classList.contains('pending')); // the page is up
    const dialogOpen = () => lib.waitForSelector('dialog#settings[open]', { timeout: 6000 });
    for (const round of [1, 2]) {
      await page.bringToFront();
      await sw.evaluate(() => __t.openLibrary({ settings: true }));
      await dialogOpen();
      assert.equal((await tabs()).length, 1, `no second tab (round ${round})`);
      await lib.bringToFront();
      await lib.keyboard.press('Escape');
      await lib.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
      await lib.waitForFunction(() => location.hash === ''); // the close event comes a task later
    }
  });

  it('after closing, a call creates one again (just one)', async () => {
    const [{ tabId: previous }] = await tabs();
    await closeLibrary();
    await openLibrary();
    await waitTabs(1, 'tab created again');
    assert.notEqual((await tabs())[0].tabId, previous);
    await closeLibrary();
  });
});
