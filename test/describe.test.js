import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElementText, isRectVisible, regionFor } from '../src/content/describe.js';

test('regionFor maps points to a 3x3 grid', () => {
  assert.equal(regionFor(0.1, 0.1), 'top-left');
  assert.equal(regionFor(0.5, 0.5), 'middle-center');
  assert.equal(regionFor(0.9, 0.9), 'bottom-right');
  assert.equal(regionFor(0.9, 0.5), 'middle-right');
});

test('buildElementText merges, collapses whitespace and truncates', () => {
  assert.equal(buildElementText('Record', '  the\n  button '), 'Record the button');
  assert.equal(buildElementText(null, null), '');
  assert.equal(buildElementText('x'.repeat(200), '').length, 80);
});

test('isRectVisible rejects tiny and off-screen rects', () => {
  const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  assert.ok(isRectVisible(rect(10, 10, 50, 50), 1000, 800));
  assert.ok(!isRectVisible(rect(10, 10, 5, 5), 1000, 800));
  assert.ok(!isRectVisible(rect(10, 900, 50, 50), 1000, 800));
  assert.ok(!isRectVisible(rect(-100, 10, 50, 50), 1000, 800));
});
