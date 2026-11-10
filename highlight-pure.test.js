import test from 'node:test';
import assert from 'node:assert/strict';
import { SPOT_SHADE } from './spot-pure.js';
import { DEFAULT_HIGHLIGHT, HIGHLIGHT_OPACITY, highlightColor } from './highlight-pure.js';
import { PALETTE } from './mask-pure.js';

test('the shade of the spotlight dims without hiding', () => {
  const alpha = Number(/, ([0-9.]+)\)$/.exec(SPOT_SHADE)?.[1]);
  assert.ok(alpha > 0.3 && alpha < 0.8, `${alpha}`);
});

test('highlighter color: any opaque color of the editor, the yellow of the palette otherwise; never fully opaque', () => {
  assert.equal(DEFAULT_HIGHLIGHT, PALETTE.find((p) => p.key === 'prop.color.yellow').hex, 'the yellow of the palette');
  for (const p of PALETTE) assert.equal(highlightColor(p.hex), p.hex, p.key);
  assert.equal(highlightColor('#12ab34'), '#12ab34', 'a free color');
  assert.equal(highlightColor(' #FF9EC4 '), '#ff9ec4', 'case and spaces');
  for (const junk of ['red', 'rgba(0,0,0,.5)', '#11223380', '', null, undefined, 5, {}]) assert.equal(highlightColor(junk), DEFAULT_HIGHLIGHT, String(junk));
  assert.ok(HIGHLIGHT_OPACITY > 0 && HIGHLIGHT_OPACITY < 1, 'a highlighter in black must not hide what is under it');
});
