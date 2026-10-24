import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE, WakeGate } from '../src/offscreen/wakeGate.js';

const SR = 16000;
const FRAME = 640; // 40 ms
const speech = () => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = 0.1 * Math.sin(i / 3);
  return f;
};
const quiet = () => new Float32Array(FRAME).fill(0.0005);

function makeGate(overrides = {}) {
  const clips = [];
  const closes = [];
  const gate = new WakeGate({
    sampleRate: SR,
    prerollMs: 2000,
    graceMs: 300,
    minCommandSpeechMs: 300,
    endOfCommandMs: 900,
    waitForCommandMs: 5000,
    maxCommandMs: 8000,
    onClip: (c) => clips.push(c),
    onClose: (r) => closes.push(r),
    ...overrides
  });
  let t = 0;
  const feed = (kind, ms) => {
    for (let e = 0; e < ms; e += 40) { gate.push(kind === 'speech' ? speech() : quiet(), t); t += 40; }
  };
  return { gate, clips, closes, feed };
}

test('closed gate never emits, however long people talk', () => {
  const { clips, closes, feed, gate } = makeGate();
  feed('silence', 1000);
  feed('speech', 30000);
  feed('silence', 2000);
  assert.equal(gate.state, GATE.CLOSED);
  assert.equal(clips.length, 0);
  assert.equal(closes.length, 0);
});

test('closed gate keeps only the pre-roll in memory', () => {
  const { gate, feed } = makeGate();
  feed('speech', 10000);
  assert.ok(gate.prerollTotalMs <= 2000 && gate.prerollTotalMs >= 1960, `${gate.prerollTotalMs}`);
});

test('wake phrase, pause, command, pause -> one clip with pre-roll + command', () => {
  const { gate, clips, closes, feed } = makeGate();
  feed('silence', 1000);
  feed('speech', 800); // "Hey Jarvis"
  gate.open(); // detector fires at the end of the phrase
  feed('silence', 700); // short pause (waits for the command)
  feed('speech', 1500); // "click the compose button"
  feed('silence', 1500);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].reason, 'wake-command');
  assert.deepEqual(closes, ['command']);
  // 2 s pre-roll + 0.7 s pause + 1.5 s command + <= ~0.3 s + VAD hangover of trailing silence
  assert.ok(clips[0].durationMs >= 4100 && clips[0].durationMs <= 4900, `duration ${clips[0].durationMs}`);
  assert.equal(gate.state, GATE.CLOSED);
});

test('wake phrase and command in one breath are captured whole', () => {
  const { gate, clips, feed } = makeGate();
  feed('silence', 1000);
  feed('speech', 700); // "Hey Jarvis"
  gate.open();
  feed('speech', 1200); // "click compose" without a pause
  feed('silence', 1200);
  assert.equal(clips.length, 1);
  assert.ok(clips[0].speechMs >= 1800, `speech ${clips[0].speechMs}`);
});

test('the tail of the wake phrase alone does not count as a command', () => {
  const { gate, clips, closes, feed } = makeGate();
  feed('speech', 800);
  gate.open();
  feed('speech', 200); // end of "...vis" after detection (inside the grace period)
  feed('silence', 6000);
  assert.equal(clips.length, 0);
  assert.deepEqual(closes, ['no-command']);
});

test('no request after the wake phrase -> closes without sending anything', () => {
  const { gate, clips, closes, feed } = makeGate();
  feed('speech', 800);
  gate.open();
  feed('silence', 5200);
  assert.equal(clips.length, 0);
  assert.deepEqual(closes, ['no-command']);
  assert.equal(gate.state, GATE.CLOSED);
});

test('a long monologue after the wake phrase is cut at maxCommandMs', () => {
  const { gate, clips, closes, feed } = makeGate();
  feed('speech', 800);
  gate.open();
  feed('speech', 12000);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].reason, 'wake-max-length');
  assert.deepEqual(closes, ['max-length']);
  assert.ok(clips[0].durationMs <= 2000 + 8000 + 40, `duration ${clips[0].durationMs}`);
});

test('after closing, talk is ignored again until the next wake phrase', () => {
  const { gate, clips, feed } = makeGate();
  feed('speech', 800);
  gate.open();
  feed('speech', 1000);
  feed('silence', 1200);
  assert.equal(clips.length, 1);
  feed('speech', 10000);
  feed('silence', 2000);
  assert.equal(clips.length, 1);
  gate.open();
  feed('speech', 1000);
  feed('silence', 1200);
  assert.equal(clips.length, 2);
});

test('reset drops buffered audio and closes the gate without emitting', () => {
  const { gate, clips, closes, feed } = makeGate();
  feed('speech', 800);
  gate.open();
  feed('speech', 1000);
  gate.reset();
  assert.equal(gate.state, GATE.CLOSED);
  assert.equal(gate.preroll.length, 0);
  feed('silence', 2000);
  assert.equal(clips.length, 0);
  assert.equal(closes.length, 0);
});
