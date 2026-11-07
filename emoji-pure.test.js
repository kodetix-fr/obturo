import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EMOJI, EMOJIS, cleanEmoji } from './emoji-pure.js';

test('the picker has twenty distinct emoji, built from code points', () => {
  assert.equal(EMOJIS.length, 20);
  assert.equal(new Set(EMOJIS).size, 20);
  assert.equal(EMOJIS[0].codePointAt(0), 0x1F44D);
  assert.equal([...EMOJIS[4]].length, 2, 'a warning sign is a symbol and a variation selector');
});

test('cleanEmoji keeps an emoji of the picker and gives the first for anything else', () => {
  assert.equal(cleanEmoji(EMOJIS[7]), EMOJIS[7]);
  for (const odd of [undefined, null, '', 'x', 3, '\u{1F40C}']) assert.equal(cleanEmoji(odd), DEFAULT_EMOJI);
});
