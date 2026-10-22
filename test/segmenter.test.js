import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipSegmenter, EnergyVad } from '../src/offscreen/segmenter.js';

const SR = 16000;
const FRAME = 640; // 40 ms
const speech = () => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = 0.1 * Math.sin(i / 3);
  return f;
};
const quiet = (amp = 0.0005) => new Float32Array(FRAME).fill(amp);

function run(pattern, opts = {}) {
  const clips = [];
  const seg = new ClipSegmenter({
    sampleRate: SR, windowMs: 6000, hopMs: 4000, minSpeechMs: 250, endOfSpeechMs: 700,
    onClip: (c) => clips.push(c), ...opts
  });
  let t = 0;
  for (const [kind, ms] of pattern) {
    for (let elapsed = 0; elapsed < ms; elapsed += 40) {
      seg.push(kind === 'speech' ? speech() : quiet(), t);
      t += 40;
    }
  }
  return clips;
}

test('EnergyVad flags speech, not silence, and holds a short hangover', () => {
  const vad = new EnergyVad();
  for (let i = 0; i < 20; i++) assert.equal(vad.isSpeech(quiet(), 40), false);
  assert.equal(vad.isSpeech(speech(), 40), true);
  assert.equal(vad.isSpeech(quiet(), 40), true); // hangover
  for (let i = 0; i < 10; i++) vad.isSpeech(quiet(), 40);
  assert.equal(vad.isSpeech(quiet(), 40), false);
});

test('EnergyVad still detects quiet speech above the floor', () => {
  const vad = new EnergyVad();
  for (let i = 0; i < 50; i++) vad.isSpeech(quiet(0.0003), 40);
  const soft = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) soft[i] = 0.01 * Math.sin(i / 3); // ~ -43 dBFS
  assert.equal(vad.isSpeech(soft, 40), true);
});

test('silence produces no clips (no wasted API calls)', () => {
  assert.equal(run([['silence', 20000]]).length, 0);
});

test('a short command is emitted once, right after it ends', () => {
  const clips = run([['silence', 2000], ['speech', 1500], ['silence', 2000]]);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].reason, 'end-of-speech');
  // speech + ~300 ms padding each side + hangover, not the leading 2 s of silence
  assert.ok(clips[0].durationMs >= 1500 && clips[0].durationMs <= 2600, `duration ${clips[0].durationMs}`);
});

test('a cough/click shorter than minSpeech is ignored', () => {
  assert.equal(run([['silence', 1000], ['speech', 80], ['silence', 3000]]).length, 0);
});

test('long speech yields overlapping 6 s windows every ~4 s', () => {
  const clips = run([['speech', 13000], ['silence', 1500]]);
  const hops = clips.filter((c) => c.reason === 'hop');
  assert.ok(hops.length >= 2, `hops ${hops.length}`);
  assert.ok(hops.every((c) => c.durationMs <= 6000));
  assert.equal(clips.at(-1).reason, 'end-of-speech');
  // Consecutive windows overlap: (window - hop) = 2 s of shared audio.
  assert.ok(hops[1].durationMs > 4000);
});

test('a sentence crossing a hop boundary appears whole in the next clip', () => {
  // 3.6 s speech (no emit yet), 0.3 s pause (below end-of-speech), 1.5 s speech
  const clips = run([['speech', 3600], ['silence', 300], ['speech', 1500], ['silence', 1500]]);
  const last = clips.at(-1);
  assert.ok(last.durationMs >= 1500 + 300, 'tail clip includes context before the boundary');
});

test('speechEndedAt excludes trailing silence (for latency metrics)', () => {
  const clips = run([['speech', 1000], ['silence', 1000]]);
  assert.equal(clips.length, 1);
  assert.ok(clips[0].speechEndedAt <= 1000 + 400, `speechEndedAt ${clips[0].speechEndedAt}`);
});
