import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocal, spatialHints, tokenize } from '../src/background/matcher.js';

const els = [
  { id: 'sh-1', text: 'Compose', region: 'top-left' },
  { id: 'sh-2', text: 'Inbox 12 unread', region: 'middle-left' },
  { id: 'sh-3', text: 'Turn on captions (c)', region: 'bottom-center' },
  { id: 'sh-4', text: 'Record', region: 'bottom-left' },
  { id: 'sh-5', text: 'Record', region: 'bottom-right' },
  { id: 'sh-6', text: 'Search mail', region: 'top-center' }
];

test('tokenize lowercases and strips punctuation', () => {
  assert.deepEqual(tokenize('Click the "Compose" button!'), ['click', 'the', 'compose', 'button']);
});

test('spatialHints finds horizontal and vertical words', () => {
  assert.deepEqual(spatialHints(tokenize('top right corner')), { horiz: 'right', vert: 'top' });
  assert.deepEqual(spatialHints(tokenize('no hints')), { horiz: null, vert: null });
});

test('matches a simple command confidently', () => {
  const m = matchLocal('click the compose button', els);
  assert.equal(m.result.matchedId, 'sh-1');
  assert.ok(m.confident);
  assert.equal(m.result.label, 'Click Compose');
});

test('plural / prefix variations still match', () => {
  assert.equal(matchLocal('turn on the caption', els).result.matchedId, 'sh-3');
  assert.equal(matchLocal('where is search', els).result.matchedId, 'sh-6');
});

test('spatial hints disambiguate identical labels', () => {
  assert.equal(matchLocal('the record button is on the left side', els).result.matchedId, 'sh-4');
  assert.equal(matchLocal('record on the right', els).result.matchedId, 'sh-5');
});

test('ambiguous commands are not confident (so Gemini can be consulted)', () => {
  const m = matchLocal('click record', els);
  assert.ok(m.result.matchedId);
  assert.equal(m.confident, false);
});

test('unrelated or empty commands give no match', () => {
  assert.equal(matchLocal('what a lovely day', els).result.matchedId, null);
  assert.equal(matchLocal('click the button on the left', els).result.matchedId, null);
  assert.equal(matchLocal('', els).result.matchedId, null);
  assert.equal(matchLocal('compose', []).result.matchedId, null);
});
