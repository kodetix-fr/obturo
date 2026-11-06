import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGEND_MAX, MARKER_DIAMETER, MARKER_SIDES, autoSide, boxLeft, fitSide, cleanMarkerNumber, closeGaps, cleanSide, cleanLegend, discCenterX, legendBox, legendFontSize, markerDiameter, markerFontSize, markerInk, nextMarkerNumber } from './marker-pure.js';

test('nextMarkerNumber: 1 first, then the smallest number that is free', () => {
  assert.equal(nextMarkerNumber([]), 1);
  assert.equal(nextMarkerNumber([1]), 2);
  assert.equal(nextMarkerNumber([1, 2, 3]), 4);
  assert.equal(nextMarkerNumber([3, 1, 2]), 4, 'in any order');
  assert.equal(nextMarkerNumber([1, 3]), 2, 'the number of a deleted step comes back');
  assert.equal(nextMarkerNumber([2, 3]), 1);
  assert.equal(nextMarkerNumber([1, 1, 2]), 3, 'a duplicate changes nothing');
  assert.equal(nextMarkerNumber(new Set([1, 2])), 3, 'any iterable');
  assert.equal(nextMarkerNumber([1, 2.5, '3', null, undefined, -1, 0, NaN, {}]), 2, 'what is not a positive whole number is ignored');
});

test('closeGaps: a plain sequence closes up after a deletion, numbers typed by hand are left alone', () => {
  assert.deepEqual(closeGaps([1, 3, 4], [2]), [1, 2, 3]);
  assert.deepEqual(closeGaps([1, 4, 5], [2, 3]), [1, 2, 3]);
  assert.deepEqual(closeGaps([1, 2, 3], [4]), [1, 2, 3], 'the last one leaves nothing to close');
  assert.deepEqual(closeGaps([2, 3], [1]), [1, 2]);
  assert.deepEqual(closeGaps([], [1]), []);
  assert.deepEqual(closeGaps([1, 2, 2, 3], [2]), [1, 2, 2, 3], 'a repeated number was typed by hand');
  assert.deepEqual(closeGaps([1, 5, 9], [5]), [1, 5, 9], 'a gap was typed by hand');
  assert.deepEqual(closeGaps([1, 2], []), [1, 2]);
});

test('markerDiameter: follows the width of the image within bounds, scaled by the setting, never unreadable', () => {
  assert.equal(markerDiameter(1600), 40, '1 / 40 of the width');
  assert.equal(markerDiameter(1600, 0.6), 24);
  assert.equal(markerDiameter(1600, 1.8), 72);
  assert.equal(markerDiameter(200), MARKER_DIAMETER.min, 'a small image: the lower bound');
  assert.equal(markerDiameter(20000), MARKER_DIAMETER.max, 'a huge image: the upper bound');
  assert.equal(markerDiameter(20000, 1.8), Math.round(MARKER_DIAMETER.max * 1.8));
  assert.equal(markerDiameter(100, 0.6), 20, 'thin on a small image: not below 20 px');
  assert.ok(Number.isInteger(markerDiameter(1234, 0.6)));
});

test('markerInk: white on dark colors, near black on light ones', () => {
  for (const dark of ['#000000', '#e53935', '#2563eb', '#43a047', '#808080', '#8e24aa']) assert.equal(markerInk(dark), '#ffffff', dark);
  for (const light of ['#ffffff', '#fbc02d', '#ffeb3b', '#e0e0e0', '#a5d6a7']) assert.equal(markerInk(light), '#111111', light);
  assert.equal(markerInk('#FFF'), '#111111', 'short form');
  assert.equal(markerInk('not a color'), '#ffffff', 'unknown: white');
  assert.equal(markerInk(undefined), '#ffffff');
  assert.equal(markerInk('rgba(255,255,255,.5)'), '#ffffff', 'only #rrggbb is read');
});

test('markerFontSize: smaller as the number gets longer, so that it stays inside the disc', () => {
  assert.ok(markerFontSize(40, 1) > markerFontSize(40, 10));
  assert.ok(markerFontSize(40, 10) > markerFontSize(40, 100));
  assert.equal(markerFontSize(40, 9), markerFontSize(40, 1));
  assert.ok(Math.abs(markerFontSize(100, 5) - 56) < 1e-9);
});

test('cleanLegend: one line, trimmed, spaces collapsed, at most 60 characters, nothing for what is not text', () => {
  assert.equal(cleanLegend('Open the menu'), 'Open the menu');
  assert.equal(cleanLegend('  Open   the' + String.fromCharCode(9) + 'menu' + String.fromCharCode(10)), 'Open the menu', 'one line, spaces collapsed');
  assert.equal(cleanLegend('   '), '');
  for (const junk of [undefined, null, '']) assert.equal(cleanLegend(junk), '');
  assert.equal(cleanLegend(42), '42');
  assert.equal(LEGEND_MAX, 60);
  assert.equal(cleanLegend('x'.repeat(100)), 'x'.repeat(60));
  assert.equal(cleanLegend(`${'x'.repeat(59)} y`), 'x'.repeat(59), 'no trailing space left by the cut');
  assert.doesNotThrow(() => encodeURIComponent(cleanLegend('😀'.repeat(100))), 'no pair of surrogates cut in two');
  assert.equal([...cleanLegend('😀'.repeat(100))].length, 60);
});

test('legendBox: everything follows the diameter of the disc, the text sets the width', () => {
  const a = legendBox(40, 100), b = legendBox(80, 200);
  for (const k of ['gap', 'padX', 'height']) assert.equal(b[k], a[k] * 2, k);
  assert.equal(b.width, a.width * 2);
  assert.equal(a.width, 100 + 2 * a.padX, 'the text and its padding');
  assert.ok(a.height < 40 && a.height > 20, 'a pill a bit lower than the disc');
  assert.equal(legendFontSize(40), 20);
  assert.ok(legendFontSize(40) < markerFontSize(40, 1), 'smaller than the number');
});

test('cleanSide: left, right for anything else (an old marker has none)', () => {
  assert.deepEqual([...MARKER_SIDES], ['right', 'left']);
  assert.equal(cleanSide('left'), 'left');
  for (const junk of ['right', 'Left', '', null, undefined, 1, {}]) assert.equal(cleanSide(junk), 'right', String(junk));
});

test('cleanMarkerNumber: 1 to 999, whole, nothing else', () => {
  for (const [typed, n] of [['1', 1], [' 12 ', 12], ['999', 999], [7, 7], ['007', 7]]) assert.equal(cleanMarkerNumber(typed), n, String(typed));
  for (const junk of ['', ' ', '0', '000', '1000', '-3', '1.5', '1e2', 'a', '1 2', null, undefined, {}, NaN]) assert.equal(cleanMarkerNumber(junk), null, String(junk));
});

test('boxLeft and discCenterX: the disc stays where it is when the legend grows, changes side or goes away', () => {
  const d = 40;
  for (const side of /** @type {Array<'right' | 'left'>} */ (['right', 'left'])) {
    for (const footprint of [0, 50, 180]) {
      const cx = 300;
      const left = boxLeft(cx, d, footprint, side);
      assert.equal(discCenterX(left, d, footprint, side), cx, `${side} ${footprint}`);
    }
  }
  assert.equal(boxLeft(300, 40, 100, 'right'), 280, 'the disc is at the left end');
  assert.equal(boxLeft(300, 40, 100, 'left'), 180, 'the legend is on the left of the disc');
  assert.equal(boxLeft(300, 40, 0, 'left'), boxLeft(300, 40, 0, 'right'), 'no legend: no side');
});

test('autoSide: right, unless the legend leaves the image there and fits on the left', () => {
  assert.equal(autoSide(200, 40, 100, 1600), 'right', 'plenty of room');
  assert.equal(autoSide(1500, 40, 100, 1600), 'left', 'out on the right, room on the left');
  assert.equal(autoSide(1500, 40, 0, 1600), 'right', 'no legend');
  assert.equal(autoSide(100, 40, 400, 300), 'right', 'out on the right and on the left: stays right');
  assert.equal(autoSide(1580, 40, 100, 1600), 'left');
  assert.equal(autoSide(1459, 40, 120, 1600), 'right', 'it just fits');
  assert.equal(autoSide(1461, 40, 120, 1600), 'left', 'it just does not');
});

test('fitSide: the side that was wished, unless it leaves the image and the other one does not', () => {
  assert.equal(fitSide('left', 800, 40, 100, 1600), 'left', 'plenty of room: the wish');
  assert.equal(fitSide('right', 800, 40, 100, 1600), 'right');
  assert.equal(fitSide('left', 60, 40, 100, 1600), 'right', 'it would leave the image on the left');
  assert.equal(fitSide('right', 1550, 40, 100, 1600), 'left', 'it would leave the image on the right');
  assert.equal(fitSide('left', 60, 40, 5000, 300), 'left', 'it leaves on both sides: the wish');
  assert.equal(fitSide('left', 60, 40, 0, 1600), 'left', 'no legend, nothing to leave');
});
