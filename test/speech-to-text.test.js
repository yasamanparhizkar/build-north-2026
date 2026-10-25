import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The script under test, copied unchanged from test/fixtures/speech-to-text.js.
const scriptSource = readFileSync(
  new URL('./fixtures/speech-to-text.js', import.meta.url), 'utf8'
);

// Minimal stand-in for the browser's SpeechRecognition. The test drives it by
// calling onresult directly, the way the browser would after hearing speech.
class FakeRecognition {
  static last = null;
  started = false;
  constructor() { FakeRecognition.last = this; }
  start() { this.started = true; }
}

// Runs the script as if it were loaded in a page. `win` stands in for window.
// Returns what the script wrote to console.log and console.error.
function loadScript(win) {
  const out = { log: [], error: [] };
  const fakeConsole = {
    log: (...args) => out.log.push(args),
    error: (...args) => out.error.push(args),
  };
  new Function('window', 'console', scriptSource)(win, fakeConsole);
  return out;
}

// Builds an event shaped like a browser SpeechRecognitionEvent.
// Each entry is [transcript, isFinal].
function resultEvent(resultIndex, entries) {
  return {
    resultIndex,
    results: entries.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
  };
}

test('configures and starts recognition with the standard constructor', () => {
  FakeRecognition.last = null;
  const out = loadScript({ SpeechRecognition: FakeRecognition });
  const r = FakeRecognition.last;

  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  assert.equal(r.lang, 'en-US');
  assert.equal(r.started, true);
  assert.deepEqual(out.error, []);
});

test('falls back to the webkit-prefixed constructor', () => {
  FakeRecognition.last = null;
  loadScript({ webkitSpeechRecognition: FakeRecognition });

  assert.ok(FakeRecognition.last, 'webkitSpeechRecognition should be constructed');
  assert.equal(FakeRecognition.last.started, true);
});

test('logs an error and does nothing when the API is missing', () => {
  FakeRecognition.last = null;
  const out = loadScript({});

  assert.equal(FakeRecognition.last, null);
  assert.equal(out.error.length, 1);
  assert.equal(out.error[0][0], 'This browser does not support the Web Speech API.');
});

test('splits a result into Final and Live Typing text', () => {
  const out = loadScript({ SpeechRecognition: FakeRecognition });
  FakeRecognition.last.onresult(resultEvent(0, [
    ['turn on the lights', true],
    ['click the', false],
  ]));

  assert.deepEqual(out.log, [
    ['Final:', 'turn on the lights'],
    ['Live Typing:', 'click the'],
  ]);
});

test('only reads results from resultIndex onward', () => {
  const out = loadScript({ SpeechRecognition: FakeRecognition });
  // Index 0 was already handled in an earlier event, so the browser says
  // resultIndex is 1 and only "world" and "again" should be read.
  FakeRecognition.last.onresult(resultEvent(1, [
    ['hello', true],
    ['world', true],
    ['again', false],
  ]));

  assert.deepEqual(out.log, [
    ['Final:', 'world'],
    ['Live Typing:', 'again'],
  ]);
});

test('joins several final results in one event with no separator', () => {
  // Documents current behaviour: finals are concatenated as-is.
  const out = loadScript({ SpeechRecognition: FakeRecognition });
  FakeRecognition.last.onresult(resultEvent(0, [
    ['hello', true],
    ['there', true],
  ]));

  assert.deepEqual(out.log[0], ['Final:', 'hellothere']);
});

test('an interim-only event reports empty Final text', () => {
  const out = loadScript({ SpeechRecognition: FakeRecognition });
  FakeRecognition.last.onresult(resultEvent(0, [['pl', false]]));

  assert.deepEqual(out.log, [
    ['Final:', ''],
    ['Live Typing:', 'pl'],
  ]);
});
