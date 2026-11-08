import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectScroll } from '../src/background/scroll.js';
import { decideFromText } from '../src/background/decision.js';
import { validateModelResult } from '../src/background/prompt.js';

test('detectScroll recognises up and down requests', () => {
  assert.equal(detectScroll('Scroll down'), 'down');
  assert.equal(detectScroll('mom, scroll up please'), 'up');
  assert.equal(detectScroll('go down the page'), 'down');
  assert.equal(detectScroll('page down'), 'down');
});

test('detectScroll ignores unrelated speech and scroll bars', () => {
  assert.equal(detectScroll('click the compose button'), null);
  assert.equal(detectScroll('the scroll bar is strange'), null);
  assert.equal(detectScroll('down'), null);
  assert.equal(detectScroll(''), null);
});

test('decideFromText returns a scroll decision before the element matcher runs', () => {
  const d = decideFromText('scroll down', [{ id: 'el-1', role: 'button', name: 'Down', region: 'top-left' }]);
  assert.equal(d.kind, 'scroll');
  assert.equal(d.direction, 'down');
});

test('validateModelResult accepts a scroll answer and ignores ids for it', () => {
  const r = validateModelResult({ transcript: 'scroll down', isCommand: true, intent: 'scroll', scrollDirection: 'down', matchedElementId: 'el-1', confidence: 0.9, label: 'Scroll down' }, ['el-1']);
  assert.equal(r.intent, 'scroll');
  assert.equal(r.scrollDirection, 'down');
  assert.equal(r.matchedElementId, null);
  const bad = validateModelResult({ transcript: 'scroll sideways', isCommand: true, intent: 'scroll', scrollDirection: 'left', confidence: 0.9, label: '' }, []);
  assert.equal(bad.scrollDirection, 'none');
});
