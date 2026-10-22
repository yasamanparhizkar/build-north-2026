import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocal, spatialHints, stem, tokenize } from '../src/background/matcher.js';

const els = [
  { id: 'el-1', role: 'button', name: 'Compose', region: 'top-left' },
  { id: 'el-2', role: 'link', name: 'Inbox 12 unread', region: 'middle-left' },
  { id: 'el-3', role: 'button', name: 'Turn on captions (c)', region: 'bottom-center' },
  { id: 'el-4', role: 'button', name: 'Record', region: 'bottom-left' },
  { id: 'el-5', role: 'button', name: 'Record', region: 'bottom-right' },
  { id: 'el-6', role: 'searchbox', name: 'Search mail', region: 'top-center' },
  { id: 'el-7', role: 'button', name: 'Turn off microphone (ctrl + d)', region: 'bottom-center' },
  { id: 'el-8', role: 'button', name: 'Leave call', region: 'bottom-center' },
  { id: 'el-9', role: 'button', name: 'Settings', region: 'top-right' },
  { id: 'el-10', role: 'button', name: 'Send', region: 'bottom-left', enabled: false }
];

test('tokenize lowercases and strips punctuation', () => {
  assert.deepEqual(tokenize('Click the "Compose" button!'), ['click', 'the', 'compose', 'button']);
});

test('stem handles plurals', () => {
  assert.equal(stem('captions'), 'caption');
  assert.equal(stem('replies'), 'reply');
  assert.equal(stem('class'), 'class');
});

test('spatialHints finds horizontal and vertical words', () => {
  assert.deepEqual(spatialHints(tokenize('top right corner')), { horiz: 'right', vert: 'top' });
  assert.deepEqual(spatialHints(tokenize('no hints')), { horiz: null, vert: null });
});

test('Level 1: exact name match is confident', () => {
  const m = matchLocal('Mom, click the compose button', els);
  assert.equal(m.result.matchedElementId, 'el-1');
  assert.ok(m.confident);
  assert.equal(m.result.label, 'Click Compose');
});

test('plural / prefix variations still match', () => {
  assert.equal(matchLocal('turn on the caption', els).result.matchedElementId, 'el-3');
  assert.equal(matchLocal('where is search', els).result.matchedElementId, 'el-6');
});

test('Level 2: synonyms (mic -> microphone, hang up -> leave, gear -> settings)', () => {
  assert.equal(matchLocal('where is the mic button', els).result.matchedElementId, 'el-7');
  assert.equal(matchLocal('hang up the call', els).result.matchedElementId, 'el-8');
  assert.equal(matchLocal('click the gear', els).result.matchedElementId, 'el-9');
});

test('spatial hints disambiguate identical labels', () => {
  assert.equal(matchLocal('the record button is on the left side', els).result.matchedElementId, 'el-4');
  assert.equal(matchLocal('record on the right', els).result.matchedElementId, 'el-5');
  assert.equal(matchLocal('record', els, { region: 'bottom-right' }).result.matchedElementId, 'el-5');
});

test('ambiguous commands are not confident and list candidates', () => {
  const m = matchLocal('click record', els);
  assert.equal(m.confident, false);
  assert.deepEqual(m.candidates.map((c) => c.id).sort(), ['el-4', 'el-5']);
});

test('role hint boosts the right kind of control', () => {
  const two = [
    { id: 'a', role: 'link', name: 'Search tips', region: 'top-center' },
    { id: 'b', role: 'searchbox', name: 'Search', region: 'top-center' }
  ];
  assert.equal(matchLocal('click in the search box', two).result.matchedElementId, 'b');
});

test('disabled controls are penalized', () => {
  const m = matchLocal('send', els);
  assert.ok(m.score < 1);
});

test('unrelated or empty commands give no match', () => {
  assert.equal(matchLocal('what a lovely day', els).result.matchedElementId, null);
  assert.equal(matchLocal('click the button on the left', els).result.matchedElementId, null);
  assert.equal(matchLocal('', els).result.matchedElementId, null);
  assert.equal(matchLocal('compose', []).result.matchedElementId, null);
});

test('back-compat: elements with `text` instead of `name`', () => {
  assert.equal(matchLocal('compose', [{ id: 'x', text: 'Compose', region: 'top-left' }]).result.matchedElementId, 'x');
});
