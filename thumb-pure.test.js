import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbPlan, versionsKey } from './thumb-pure.js';

test('thumbPlan: 240 px wide, never enlarged, only the top for a very tall image', () => {
  assert.deepEqual(thumbPlan(1920, 1080), { keepH: 1080, k: 0.125 });
  assert.deepEqual(thumbPlan(1920, 16384), { keepH: 1280, k: 0.125 });
  assert.deepEqual(thumbPlan(100, 50), { keepH: 50, k: 1 });
});

// A thumbnail is written only if the shot still has the versions it was rendered from.
test('versionsKey: the same state gives the same key, a clone included, and any change gives another', () => {
  const state = { versions: [{ name: 'V1', crop: null, scale: 1, objects: [{ type: 'Rect', left: 1, top: 2, fill: '#000' }] }], active: 0 };
  assert.equal(versionsKey(state), versionsKey(structuredClone(state)), 'what the database hands back is the same');
  assert.equal(versionsKey({ versions: [], active: -1 }), versionsKey({ versions: [], active: -1 }));
  assert.notEqual(versionsKey(state), versionsKey({ ...state, active: -1 }), 'the displayed version counts');
  assert.notEqual(versionsKey(state), versionsKey({ versions: [], active: -1 }), 'a version added');
  const moved = structuredClone(state);
  moved.versions[0].objects[0].left = 2;
  assert.notEqual(versionsKey(state), versionsKey(moved), 'an object moved');
  const cropped = structuredClone(state);
  cropped.versions[0].crop = { x: 0, y: 0, w: 10, h: 10 };
  assert.notEqual(versionsKey(state), versionsKey(cropped), 'a crop');
  assert.equal(versionsKey({ versions: undefined, active: undefined }), versionsKey({ versions: [], active: -1 }), 'a row without versions is the original');
});
