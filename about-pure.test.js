import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LINKS, MAX_ASKS, NEWS_FOR, REVIEW_STEP, askClosed, askShown, captured, cleanNotice, hasNews, installed, minorBefore, minorOf, newsSeen, shouldAsk,
} from './about-pure.js';
import enUi from './locales/en.ui.js';

const manifest = JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8'));
const fresh = cleanNotice(undefined);

test('the news are about the release line of the manifest: a new minor release rewrites them', () => {
  assert.equal(minorOf(manifest.version), NEWS_FOR);
  assert.ok(enUi['about.news'].length > 20);
});

test('minorOf keeps major and minor, and nothing else is a version', () => {
  assert.equal(minorOf('0.2.1'), '0.2');
  assert.equal(minorOf('1.10.0'), '1.10');
  for (const bad of [undefined, null, 5, '', '0.2', '0.2.1.4', '0.2.x', '1.2.3-beta']) assert.equal(minorOf(bad), null, String(bad));
});

test('a minor release is before another when its major or its minor is lower, a patch never is', () => {
  assert.equal(minorBefore('0.1.0', '0.2.0'), true);
  assert.equal(minorBefore('0.9.5', '0.10.0'), true);
  assert.equal(minorBefore('0.9.0', '1.0.0'), true);
  assert.equal(minorBefore('0.2.0', '0.2.9'), false);
  assert.equal(minorBefore('0.2.1', '0.1.0'), false);
  assert.equal(minorBefore(null, '0.2.0'), false);
  assert.equal(minorBefore('0.1.0', 'nope'), false);
});

test('cleanNotice starts from nothing seen, no capture, and a first request after REVIEW_STEP captures; garbage falls back to that', () => {
  assert.deepEqual(fresh, { seen: null, captures: 0, asked: 0, next: REVIEW_STEP });
  assert.deepEqual(cleanNotice({ seen: 'x', captures: -1, asked: 'a', next: 'soon' }), fresh);
  assert.deepEqual(cleanNotice({ captures: 1.5, asked: 9 }), { ...fresh, asked: MAX_ASKS });
  assert.equal(cleanNotice({ next: null }).next, null, 'never is kept');
  assert.deepEqual(cleanNotice('text'), fresh);
});

test('a first install has nothing new; an update that kept no state starts from the version it came from', () => {
  assert.equal(installed(fresh, '0.2.1', { reason: 'install' }).seen, '0.2.1');
  assert.equal(installed(fresh, '0.3.0', { reason: 'update', previousVersion: '0.2.1' }).seen, '0.2.1');
  assert.equal(installed(fresh, '0.3.0', { reason: 'update', previousVersion: 'junk' }).seen, '0.3.0');
  const seen = { ...fresh, seen: '0.1.0' };
  assert.equal(installed(seen, '0.2.1', { reason: 'update', previousVersion: '0.2.0' }), seen, 'what was seen is kept');
  assert.equal(installed(fresh, '0.2.1', {}), fresh, 'no reason, no change');
});

test('there is news after a minor update only, and until they are seen', () => {
  const now = `${NEWS_FOR}.1`;
  assert.equal(hasNews({ ...fresh, seen: '0.1.0' }, now), true);
  assert.equal(hasNews({ ...fresh, seen: `${NEWS_FOR}.0` }, now), false, 'a patch update');
  assert.equal(hasNews({ ...fresh, seen: now }, now), false, 'a first install');
  assert.equal(hasNews(fresh, now), false, 'nothing known: no dot');
  assert.equal(hasNews({ ...fresh, seen: '0.1.0' }, '9.9.0'), false, 'the text is not about that release');
  const read = newsSeen({ ...fresh, seen: '0.1.0' }, now);
  assert.equal(hasNews(read, now), false);
  assert.equal(newsSeen(fresh, 'junk'), fresh);
});

test('the request comes after REVIEW_STEP captures, not before', () => {
  let n = fresh;
  for (let i = 1; i < REVIEW_STEP; i++) n = captured(n);
  assert.equal(shouldAsk(n), false);
  n = captured(n);
  assert.equal(n.captures, REVIEW_STEP);
  assert.equal(shouldAsk(n), true);
});

test('a request that is shown comes back once after REVIEW_STEP more captures, and then never', () => {
  let n = { ...fresh, captures: REVIEW_STEP };
  n = askShown(n);
  assert.equal(shouldAsk(n), false, 'shown: not again at the next opening');
  assert.equal(n.next, 2 * REVIEW_STEP);
  n = { ...n, captures: 2 * REVIEW_STEP - 1 };
  assert.equal(shouldAsk(n), false);
  n = captured(n);
  assert.equal(shouldAsk(n), true, 'the second request');
  n = askShown(n);
  assert.equal(n.asked, MAX_ASKS);
  assert.equal(n.next, null);
  assert.equal(shouldAsk({ ...n, captures: 1e5 }), false, 'never a third');
});

test('an answer closes the request for good', () => {
  const closed = askClosed({ ...fresh, captures: REVIEW_STEP });
  assert.equal(shouldAsk({ ...closed, captures: 1e5 }), false);
  assert.equal(closed.next, null);
});

test('the links go to the store reviews of Obturo, the issues of its repository and Oblitero, over https', () => {
  for (const url of Object.values(LINKS)) assert.match(url, /^https:\/\//);
  assert.match(LINKS.reviews, /\/kaafiicmlbdchfalaljmbeoblihjbnih\/reviews$/);
  assert.equal(LINKS.issues, 'https://github.com/kodetix-fr/obturo/issues');
  assert.match(LINKS.oblitero, /ofnapekaofoabpfodbffomjkpljmbdfd$/);
});
