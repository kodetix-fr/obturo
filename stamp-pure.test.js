import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ADDRESS, displayAddress, stampFontSize, stampText } from './stamp-pure.js';

test('displayAddress drops the scheme, the fragment and a lone slash', () => {
  assert.equal(displayAddress('https://example.com/'), 'example.com');
  assert.equal(displayAddress('https://example.com/docs/a?b=1#top'), 'example.com/docs/a?b=1');
  assert.equal(displayAddress('http://localhost:3000/x'), 'localhost:3000/x');
  assert.equal(displayAddress('https://example.com/?q=1'), 'example.com/?q=1');
});

test('displayAddress keeps what is not a web address, and cuts a long one', () => {
  assert.equal(displayAddress('file:///tmp/a.html'), 'file:///tmp/a.html');
  assert.equal(displayAddress('not an address'), 'not an address');
  assert.equal(displayAddress(''), '');
  assert.equal(displayAddress(undefined), '');
  const cut = displayAddress(`https://example.com/${'a'.repeat(300)}`);
  assert.equal(cut.length, MAX_ADDRESS);
  assert.ok(cut.endsWith('...'));
});

test('stampText joins the address and the date, and copes with either one missing', () => {
  assert.equal(stampText('https://example.com/a', 'Nov 7, 2026, 2:03 PM'), 'example.com/a  |  Nov 7, 2026, 2:03 PM');
  assert.equal(stampText('', 'Nov 7, 2026'), 'Nov 7, 2026');
  assert.equal(stampText('https://example.com/', ''), 'example.com');
});

test('stampFontSize is 1/80 of the width, at least 11, and shrinks to fit', () => {
  assert.equal(stampFontSize(1600, 10), 20);
  assert.equal(stampFontSize(400, 10), 11);
  assert.equal(stampFontSize(1600, 100), 15); // 1536 px of room / 100 px per size unit
  assert.equal(stampFontSize(200, 100), 8); // never below 8
});
