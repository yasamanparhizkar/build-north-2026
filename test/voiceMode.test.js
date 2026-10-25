import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indicatorMessage, voiceModeFrom } from '../src/background/capture.js';
import { matchLocal } from '../src/background/matcher.js';

test('voice mode defaults to always listen; known modes are kept', () => {
  assert.equal(voiceModeFrom(undefined), 'clips');
  assert.equal(voiceModeFrom(''), 'clips');
  assert.equal(voiceModeFrom('bogus'), 'clips');
  assert.equal(voiceModeFrom('wake'), 'wake');
  assert.equal(voiceModeFrom('clips'), 'clips');
  assert.equal(voiceModeFrom('live'), 'clips', 'the removed Live mode falls back to the default');
});

test('the on-page pill tells people what to say in wake mode', () => {
  assert.equal(indicatorMessage(true, 'wake').label, 'Say "Hey Jarvis"');
  assert.equal(indicatorMessage(true, 'clips').label, 'Listening');
  assert.equal(indicatorMessage(false, 'wake').listening, false);
});

test('the wake phrase is ignored when matching buttons', () => {
  const els = [{ id: 'el-1', role: 'button', name: 'Compose', region: 'top-left', visible: true, enabled: true }];
  const m = matchLocal('Hey Jarvis, click compose', els);
  assert.equal(m.confident, true);
  assert.equal(m.result.matchedElementId, 'el-1');
});
