// Spotlight instructions are always one complete, capitalised sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instructionFor } from '../src/shared/instruction.js';
import { matchLocal } from '../src/background/matcher.js';

test('keyboard hints and brackets are dropped: "Raise hand (ctrl + alt + h)"', () => {
  assert.equal(instructionFor('Raise hand (ctrl + alt + h)'), 'Click raise hand.');
  assert.equal(instructionFor('Click Raise hand (ctrl + alt + h)'), 'Click raise hand.');
  assert.equal(instructionFor('Mute microphone [Ctrl+D'), 'Click mute microphone.');
});

test('only the first word is capitalised; the rest are lowercase', () => {
  assert.equal(instructionFor('Raise Hand'), 'Click raise hand.');
  assert.equal(instructionFor('Search Wikipedia'), 'Click search wikipedia.');
  assert.equal(instructionFor('Click Send Email'), 'Click send email.');
  assert.equal(instructionFor('Scroll Down'), 'Scroll down.');
});

test('a label without an action verb gets "Click", and the first letter is capitalised', () => {
  assert.equal(instructionFor('compose'), 'Click compose.');
  assert.equal(instructionFor('Compose'), 'Click compose.');
  assert.equal(instructionFor('Scroll down'), 'Scroll down.');
});

test('it is idempotent: applying it again changes nothing', () => {
  for (const label of ['Click Compose', 'Scroll up', 'Raise hand (ctrl + h)', 'unlabeled button']) {
    const once = instructionFor(label);
    assert.equal(instructionFor(once), once);
  }
});

test('"unlabeled" placeholders read as a sentence', () => {
  assert.equal(instructionFor('unlabeled button'), 'Click the button.');
});

test('a label that is only a verb, empty, or only punctuation gets a complete fallback', () => {
  for (const label of ['', '   ', 'Click', 'click (ctrl+k)', '...', undefined, null]) {
    assert.equal(instructionFor(label), 'Click the highlighted control.', String(label));
  }
});

test('a name too long to show whole is replaced, never cut mid-word', () => {
  const long = 'Send the quarterly report to every person on the distribution list today';
  const out = instructionFor(long);
  assert.equal(out, 'Click the highlighted control.');
  assert.match(out, /\.$/);
});

test('every output ends with a full stop and starts with a capital letter', () => {
  for (const label of ['raise hand', 'mute (ctrl+d)', 'scroll down', 'Send email', 'x', 'OK']) {
    const out = instructionFor(label);
    assert.match(out, /^[A-Z].*\.$/, out);
  }
});

test('the local matcher keeps the full name, so "Raise hand (ctrl + alt + h)" is not cut to "Raise hand (ctrl"', () => {
  const els = [{ id: 'el-1', role: 'button', name: 'Raise hand (ctrl + alt + h)', region: 'right-top', x: 0.9, y: 0.1, enabled: true }];
  const m = matchLocal('show raise hand', els);
  assert.equal(instructionFor(m.result.label), 'Click raise hand.');
});
