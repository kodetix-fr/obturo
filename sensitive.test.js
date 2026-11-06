import test from 'node:test';
import assert from 'node:assert/strict';
import './sensitive.js';

const { find } = globalThis.__obturoSensitive;

/** What is hidden in a text: [kind, hidden text] pairs. */
const hidden = (text) => find(text).map(({ start, end, kind }) => [kind, text.slice(start, end)]);
const nothing = (text) => assert.deepEqual(hidden(text), [], text);

test('e-mail addresses', () => {
  assert.deepEqual(hidden('write to jane.doe+tag@example.co.uk now'), [['email', 'jane.doe+tag@example.co.uk']]);
  assert.deepEqual(hidden('A@b.io'), [['email', 'A@b.io']]);
  for (const text of ['icon@2x.png', 'logo@3x.svg', 'a handle: @jane', 'jane@', 'user@localhost', 'no at sign.com']) nothing(text);
});

test('phone numbers: international and French forms', () => {
  for (const phone of ['+33 6 12 34 56 78', '+33612345678', '0033 6 12 34 56 78', '+1 (415) 555-2671', '06 12 34 56 78', '06.12.34.56.78', '06-12-34-56-78', '0612345678']) {
    assert.deepEqual(hidden(`call ${phone} today`), [['phone', phone]], phone);
  }
  for (const text of ['2026-11-01 12:30:45', '192.168.1.100', '1698765432', '0.123456789', 'version 1.2.3', '123456789', '0123 456 789', 'order 12345', '+33 6 12']) nothing(text);
});

test('a no-break space or a narrow no-break space between the groups of a number', () => {
  for (const space of ['\u00a0', '\u202f']) {
    const card = ['4111', '1111', '1111', '1111'].join(space);
    const iban = 'FR14 2004 1010 0505 0001 3M02 606'.replaceAll(' ', space);
    const international = '+33 6 12 34 56 78'.replaceAll(' ', space);
    const national = '06 12 34 56 78'.replaceAll(' ', space);
    assert.deepEqual(hidden(`card ${card}.`), [['card', card]]);
    assert.deepEqual(hidden(`IBAN ${iban}.`), [['iban', iban]]);
    assert.deepEqual(hidden(`call ${international} today`), [['phone', international]]);
    assert.deepEqual(hidden(`call ${national} today`), [['phone', national]]);
  }
});

test('IBAN: the mod-97 check, with or without spaces', () => {
  for (const iban of ['FR14 2004 1010 0505 0001 3M02 606', 'FR1420041010050500013M02606', 'DE89 3704 0044 0532 0130 00', 'GB82 WEST 1234 5698 7654 32']) {
    assert.deepEqual(hidden(`IBAN ${iban}.`), [['iban', iban]], iban);
  }
  for (const text of ['FR14 2004 1010 0505 0001 3M02 607', 'GB82 WEST 1234 5698 7654 33', 'FR76 CODE WORD ONLY TEXT HERE']) nothing(text);
});

test('card numbers: 13 to 19 digits with the Luhn check, spaces or dashes allowed', () => {
  for (const card of ['4111 1111 1111 1111', '4111111111111111', '5500-0000-0000-0004', '3782 822463 10005', '4222222222222']) {
    assert.deepEqual(hidden(`card ${card} exp 12/29`), [['card', card]], card);
  }
  for (const text of ['4111 1111 1111 1112', '1234 5678 9012 3456', 'id 12345678901', '00000000000000000000000']) nothing(text);
});

test('secrets: the well-known prefixes, a JWT and a private key block', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'].join('.');
  for (const secret of [
    ...['sk_live_', 'sk_test_', 'rk_live_'].map((prefix) => prefix + '4eC39HqLyjWDarjtT1zdp7dc'),
    `ghp_${'a1B2c3D4e5'.repeat(4)}`, `gho_${'a1B2c3D4e5'.repeat(4)}`, `github_pat_${'A1b2C3d4E5'.repeat(3)}`,
    'AKIAIOSFODNN7EXAMPLE', 'xoxb-' + '123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx', `AIza${'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'}`,
    'sk-proj-abcdefghijklmnopqrstuvwx', jwt,
  ]) {
    assert.deepEqual(hidden(`key=${secret};`), [['secret', secret]], secret);
  }
  const bare = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  assert.deepEqual(hidden(bare), [['secret', bare]], 'the prefilter lets a key with no digit through');
  const dashes = '-----';
  const pem = `${dashes}BEGIN RSA PRIVATE KEY${dashes}\nMIIEowIBAAKCAQEA7\nabcdef\n${dashes}END RSA PRIVATE KEY${dashes}`;
  assert.deepEqual(hidden(`before\n${pem}\nafter`), [['secret', pem]]);
  const open = `${dashes}BEGIN PRIVATE KEY${dashes}\nMIIEvQIBADANBg`;
  assert.deepEqual(hidden(`x ${open}`), [['secret', open]], 'a block cut by the end of the text is hidden to its end');
});

test('what looks like a key but is not one stays', () => {
  for (const text of [
    'sk_live_short', 'a1b2c3d4e5f6a7b8c9d0' + 'e1f2a3b4c5d6e7f8a9b0', 'ghp_tooshort', 'AKIA1234', 'eyJhbGciOiJIUzI1NiJ9', 'BEGIN PRIVATE KEY', 'mask-live-' + '1234567890abcdef',
  ]) nothing(text);
});

test('several matches: in order, with their kind', () => {
  const text = 'mail jane@example.test or call +33 6 12 34 56 78, card 4111 1111 1111 1111';
  assert.deepEqual(hidden(text), [['email', 'jane@example.test'], ['phone', '+33 6 12 34 56 78'], ['card', '4111 1111 1111 1111']]);
  assert.deepEqual(find('x jane@example.test y'), [{ start: 2, end: 19, kind: 'email' }]);
});

test('matches that overlap are merged, so that the whole of both is hidden', () => {
  const text = 'FR14 2004 1010 0505 0001 3M02 606 0612345678';
  assert.deepEqual(hidden(text).map(([, s]) => s), ['FR14 2004 1010 0505 0001 3M02 606', '0612345678']);
  const touching = find('tel 06 12 34 56 78jane@example.test');
  assert.ok(touching.every((h, i) => i === 0 || h.start >= touching[i - 1].end), 'never overlapping');
});

test('a text without anything, an empty text and a long run of characters give nothing, quickly', () => {
  nothing('');
  nothing('Nothing to see here, only words and 42 numbers.');
  const started = Date.now();
  nothing('a'.repeat(200_000));
  nothing('1 '.repeat(100_000));
  assert.ok(Date.now() - started < 2000, 'linear on a long run');
});
