import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, inViewport, intersects, padRect, placeLabel, placeMarker, sameRect } from '../src/content/spotlight/geometry.js';
import { toInstruction } from '../src/content/pointer.js';

const VP = { width: 1280, height: 800 };
const SIZE = { width: 260, height: 28 };
const hole = (left, top, width = 120, height = 60) => ({ left, top, width, height });
const box = (p) => ({ left: p.left, top: p.top, width: SIZE.width, height: SIZE.height });
const inside = (r, vp = VP, m = 12) => r.left >= m && r.top >= m && r.left + r.width <= vp.width - m && r.top + r.height <= vp.height - m;

test('padRect grows evenly; clamp handles inverted bounds', () => {
  assert.deepEqual(padRect({ left: 10, top: 20, width: 30, height: 40 }, 16), { left: -6, top: 4, width: 62, height: 72 });
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
  assert.equal(clamp(5, 10, 0), 10, 'lower bound wins when the box is bigger than the viewport');
});

test('inViewport / intersects / sameRect', () => {
  assert.ok(inViewport(hole(10, 10), VP));
  assert.ok(inViewport(hole(-100, 10), VP), 'partially visible counts');
  assert.ok(!inViewport(hole(-200, 10), VP));
  assert.ok(!inViewport(hole(10, 900), VP));
  assert.ok(intersects(hole(0, 0), hole(100, 50)));
  assert.ok(!intersects(hole(0, 0), hole(200, 0)));
  assert.ok(sameRect(hole(1, 1), hole(1.3, 1)));
  assert.ok(!sameRect(hole(1, 1), hole(3, 1)));
});

test('label goes below the target when there is room, centered on it', () => {
  const h = hole(500, 100);
  const p = placeLabel(h, SIZE, VP);
  assert.equal(p.side, 'below');
  assert.ok(Math.abs(p.left + SIZE.width / 2 - (500 + 60)) <= 1);
  assert.ok(!intersects(box(p), h));
});

test('label goes above a target near the bottom edge', () => {
  const h = hole(500, 740);
  const p = placeLabel(h, SIZE, VP);
  assert.equal(p.side, 'above');
  assert.ok(!intersects(box(p), h));
  assert.ok(inside(box(p)));
});

test('label goes beside a tall target that fills the height', () => {
  const h = hole(100, 5, 200, 790);
  const p = placeLabel(h, SIZE, VP);
  assert.equal(p.side, 'right');
  assert.ok(!intersects(box(p), h));
});

test('label never leaves the viewport near corners', () => {
  for (const h of [hole(0, 0), hole(1200, 0), hole(0, 760), hole(1200, 760, 80, 40)]) {
    const p = placeLabel(h, SIZE, VP);
    assert.ok(inside(box(p)), `${JSON.stringify(h)} -> ${JSON.stringify(p)}`);
    assert.ok(!intersects(box(p), h), `overlaps target at ${JSON.stringify(h)}`);
  }
});

test('label still stays on screen when nothing fits (huge target, tiny viewport)', () => {
  const vp = { width: 320, height: 240 };
  const p = placeLabel(hole(0, 0, 320, 240), SIZE, vp);
  assert.ok(p.left >= 12 && p.top >= 12);
});

test('markers sit on the top-left corner but stay on screen', () => {
  assert.deepEqual(placeMarker(hole(100, 100), 30, VP), { left: 85, top: 85 });
  assert.deepEqual(placeMarker(hole(-10, -10), 30, VP), { left: 4, top: 4 });
});

test('toInstruction makes calm sentences', () => {
  assert.equal(toInstruction('Click Compose', 1), 'Click Compose.');
  assert.equal(toInstruction('Click the Record button.', 1), 'Click the Record button.');
  assert.equal(toInstruction('Click Record', 2), 'Is it one of these?');
});

