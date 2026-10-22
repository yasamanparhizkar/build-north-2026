import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, cleanApiKey, interpretResult, parseModelJson } from '../src/background/prompt.js';

test('cleanApiKey trims whitespace and surrounding quotes (regression: \\$ typo)', () => {
  assert.equal(cleanApiKey('  "abc123"  '), 'abc123');
  assert.equal(cleanApiKey("'abc123'"), 'abc123');
  assert.equal(cleanApiKey('abc$'), 'abc$');
  assert.equal(cleanApiKey(undefined), '');
});

test('buildPrompt embeds elements, spoken text and context', () => {
  const elements = [{ id: 'sh-1', text: 'Record', region: 'bottom-left' }];
  const p = buildPrompt({ text: 'the record button is on the left' }, elements, 'earlier sentence');
  assert.match(p, /the record button is on the left/);
  assert.match(p, /earlier sentence/);
  assert.match(p, /"id":"sh-1"/);
});

test('buildPrompt mentions audio when audio is supplied', () => {
  assert.match(buildPrompt({ audioBase64: 'AAAA' }, []), /attached audio/);
});

test('parseModelJson handles clean JSON and JSON wrapped in prose/fences', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure!\n```json\n{"a":{"b":2}}\n```'), { a: { b: 2 } });
  assert.throws(() => parseModelJson('no json here'), /non-JSON/);
});

test('interpretResult points only at ids that exist', () => {
  const elements = [{ id: 'sh-1' }];
  const ok = interpretResult({ isCommand: true, matchedId: 'sh-1', label: 'Click', transcript: 't' }, elements);
  assert.deepEqual(ok, { kind: 'point', id: 'sh-1', label: 'Click', transcript: 't' });

  const hallucinated = interpretResult({ isCommand: true, matchedId: 'sh-99', transcript: 't' }, elements);
  assert.equal(hallucinated.kind, 'no-match');

  const chatter = interpretResult({ isCommand: false, matchedId: 'sh-1', transcript: 'hi' }, elements);
  assert.equal(chatter.kind, 'not-command');
});

