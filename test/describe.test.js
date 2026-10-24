import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildElementText, implicitRole, isRectVisible, limitCandidates, namesMatch, normalizeName, regionFor
} from '../src/content/describe.js';
import { SnapshotRegistry, nearestTo } from '../src/content/snapshot.js';

test('regionFor maps points to a 3x3 grid', () => {
  assert.equal(regionFor(0.1, 0.1), 'top-left');
  assert.equal(regionFor(0.5, 0.5), 'middle-center');
  assert.equal(regionFor(0.9, 0.9), 'bottom-right');
  assert.equal(regionFor(0.9, 0.5), 'middle-right');
});

test('normalizeName collapses whitespace, strips control chars and truncates', () => {
  assert.equal(normalizeName('  Record\n  the\u0000 button '), 'Record the button');
  assert.equal(normalizeName('x'.repeat(200)).length, 60);
  assert.equal(buildElementText('Record', '  the\n  button '), 'Record the button');
});

test('namesMatch is case/whitespace-insensitive and never matches empty', () => {
  assert.ok(namesMatch('Compose', ' compose '));
  assert.ok(!namesMatch('Compose', 'Send'));
  assert.ok(!namesMatch('', ''));
});

test('isRectVisible rejects tiny and off-screen rects', () => {
  const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h });
  assert.ok(isRectVisible(rect(10, 10, 50, 50), 1000, 800));
  assert.ok(isRectVisible(rect(-20, 10, 50, 50), 1000, 800), 'partially visible counts');
  assert.ok(!isRectVisible(rect(10, 10, 5, 5), 1000, 800));
  assert.ok(!isRectVisible(rect(10, 900, 50, 50), 1000, 800));
  assert.ok(!isRectVisible(rect(-100, 10, 50, 50), 1000, 800));
});

test('implicitRole covers common controls', () => {
  assert.equal(implicitRole('button'), 'button');
  assert.equal(implicitRole('a', '', true), 'link');
  assert.equal(implicitRole('input', 'checkbox'), 'checkbox');
  assert.equal(implicitRole('input', 'search'), 'searchbox');
  assert.equal(implicitRole('input', 'submit'), 'button');
  assert.equal(implicitRole('select'), 'combobox');
  assert.equal(implicitRole('div', '', false, true), 'textbox');
});

test('limitCandidates: visible first, caps repeats and off-screen count', () => {
  const list = [
    ...Array.from({ length: 10 }, () => ({ role: 'button', name: 'Not starred', visible: true })),
    { role: 'button', name: 'Compose', visible: true },
    ...Array.from({ length: 10 }, (_, i) => ({ role: 'link', name: `Footer ${i}`, visible: false }))
  ];
  const out = limitCandidates(list, { maxVisible: 50, maxOffscreen: 3, maxSameName: 4 });
  assert.equal(out.filter((c) => c.name === 'Not starred').length, 4);
  assert.ok(out.some((c) => c.name === 'Compose'));
  assert.equal(out.filter((c) => !c.visible).length, 3);
  assert.ok(out.findIndex((c) => !c.visible) > out.findIndex((c) => c.name === 'Compose'));
});

test('SnapshotRegistry: ids only resolve with their own snapshot', () => {
  const reg = new SnapshotRegistry({ max: 2, pageToken: 'p' });
  const a = { tag: 'A' };
  const b = { tag: 'B' };
  const s1 = reg.create([{ el: a, role: 'button', name: 'Compose' }]);
  const s2 = reg.create([{ el: b, role: 'button', name: 'Send' }]);
  assert.deepEqual(s1.ids, ['el-1']);
  assert.notEqual(s1.snapshotId, s2.snapshotId);
  assert.equal(reg.lookup(s1.snapshotId, 'el-1').ref.deref(), a);
  assert.equal(reg.lookup(s2.snapshotId, 'el-1').ref.deref(), b);
  assert.equal(reg.lookup('other-v1', 'el-1'), null);
});

test('SnapshotRegistry expires old snapshots', () => {
  const reg = new SnapshotRegistry({ max: 2, pageToken: 'p' });
  const s1 = reg.create([{ el: {}, role: 'button', name: 'A' }]);
  reg.create([]);
  reg.create([]);
  assert.equal(reg.has(s1.snapshotId), false);
  assert.equal(reg.lookup(s1.snapshotId, 'el-1'), null);
});

test('different page instances never share snapshot ids', () => {
  const r1 = new SnapshotRegistry();
  const r2 = new SnapshotRegistry();
  assert.notEqual(r1.create([]).snapshotId, r2.create([]).snapshotId);
});

test('nearestTo picks the candidate closest to the original position', () => {
  const c = (left) => ({ rect: { left, top: 0, width: 10, height: 10 } });
  const near = c(105);
  assert.equal(nearestTo({ left: 100, top: 0, width: 10, height: 10 }, [c(0), near, c(500)]), near);
});

test('escapeHtml neutralizes markup for HTML-rendering libraries', async () => {
  const { escapeHtml } = await import('../src/content/describe.js');
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("Tom & Jerry's"), 'Tom &amp; Jerry&#39;s');
  assert.equal(escapeHtml(null), '');
});
