// Wake-word detector tests. The real-model tests run the bundled openWakeWord
// models with onnxruntime-web (wasm) in Node on the clips in test/fixtures/audio.
// Those clips are synthetic (espeak-ng), so they prove the pipeline, not
// real-world accuracy: check that in a real Meet call (docs/TESTING.md).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-web';
import {
  CHUNK_SAMPLES, EMBEDDING_DIM, MEL_BINS, WARMUP_PREDICTIONS, WakeFeatures, toInt16Range
} from '../src/wakeword/features.js';
import { WakeWordDetector, createRunner } from '../src/wakeword/detector.js';
import {
  WAKE_EMBEDDING_FILE, WAKE_MEL_FILE, WAKE_MODEL_DIR, WAKE_MODEL_FILE, WAKE_THRESHOLD
} from '../src/shared/constants.js';

const AUDIO_DIR = 'test/fixtures/audio';

function readWav(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.equal(b.readUInt32LE(24), 16000, 'fixtures are 16 kHz');
  const pcm = new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
  return Float32Array.from(pcm, (v) => v / 32768);
}

/** Feed audio the way the offscreen document does (40 ms frames, in real-time order). */
async function maxScore(detector, audio) {
  const all = new Float32Array(audio.length + 2 * 16000); // 1 s of silence before and after
  all.set(audio, 16000);
  for (let i = 0; i < all.length; i += 640) {
    detector.push(all.subarray(i, i + 640));
    while (detector.running) await new Promise((r) => setTimeout(r, 0));
  }
  return detector.maxScore;
}

let runner;
before(async () => {
  ort.env.wasm.numThreads = 1;
  const load = (f) => new Uint8Array(fs.readFileSync(path.join(WAKE_MODEL_DIR, f)));
  runner = await createRunner(ort, load, { melFile: WAKE_MEL_FILE, embeddingFile: WAKE_EMBEDDING_FILE, wakeFile: WAKE_MODEL_FILE });
});

test('toInt16Range scales and clips like 16-bit PCM', () => {
  assert.deepEqual([...toInt16Range(Float32Array.from([0, 1, -1, 2, -2, 0.5]))], [0, 32767, -32768, 32767, -32768, 16383]);
});

test('WakeFeatures with a fake runner: shapes, warm-up zeros, and 8 mel frames per chunk', async () => {
  const calls = { mel: [], embed: [], head: [] };
  const fake = {
    mel: async (a) => { calls.mel.push(a.length); return new Float32Array(Math.max(1, Math.floor((a.length - 400) / 160) + 1 - 1) * MEL_BINS).fill(0.5); },
    embed: async (w, n) => { calls.embed.push(n); return new Float32Array(n * EMBEDDING_DIM).fill(0.1); },
    head: async (f) => { calls.head.push(f.length); return 0.9; }
  };
  const feats = new WakeFeatures({ runner: fake });
  await feats.init();
  const scores = [];
  for (let i = 0; i < 8; i++) scores.push(await feats.processChunk(new Float32Array(CHUNK_SAMPLES)));
  assert.deepEqual(scores.slice(0, WARMUP_PREDICTIONS), [0, 0, 0, 0, 0]);
  assert.equal(scores[WARMUP_PREDICTIONS], 0.9);
  // First chunk has no left context (1280 samples); later chunks carry 480 samples of context.
  assert.deepEqual(calls.mel.slice(1, 4), [1280, 1760, 1760]);
  assert.ok(calls.head.every((n) => n === 16 * EMBEDDING_DIM));
});

test('real models: the bundled runtime matches the devDependency version', () => {
  const vendored = fs.readFileSync('vendor/onnxruntime-web/ort.wasm.bundle.min.mjs', 'utf8').slice(0, 200);
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.ok(vendored.includes(`v${pkg.devDependencies['onnxruntime-web']}`), 'run: npm run vendor:ort');
});

const clips = fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.wav')).sort();

for (const file of clips.filter((f) => f.startsWith('pos_'))) {
  test(`real models: "${WAKE_MODEL_FILE}" fires on ${file}`, async () => {
    const det = await new WakeWordDetector({ runner, threshold: 2 }).init(); // threshold 2: never pause
    const score = await maxScore(det, readWav(path.join(AUDIO_DIR, file)));
    assert.ok(score >= WAKE_THRESHOLD, `max score ${score.toFixed(3)} < ${WAKE_THRESHOLD}`);
  });
}

for (const file of clips.filter((f) => f.startsWith('neg_'))) {
  test(`real models: does not fire on ${file}`, async () => {
    const det = await new WakeWordDetector({ runner, threshold: 2 }).init();
    const score = await maxScore(det, readWav(path.join(AUDIO_DIR, file)));
    assert.ok(score < WAKE_THRESHOLD, `max score ${score.toFixed(3)} >= ${WAKE_THRESHOLD}`);
  });
}

test('detector pauses itself on a hit, fires onWake once, and resumes clean', async () => {
  const hits = [];
  const det = await new WakeWordDetector({ runner, threshold: WAKE_THRESHOLD, onWake: (s) => hits.push(s) }).init();
  const audio = readWav(path.join(AUDIO_DIR, 'pos_2.wav'));
  await maxScore(det, audio);
  assert.equal(hits.length, 1);
  assert.equal(det.paused, true);
  det.push(new Float32Array(16000)); // ignored while paused (gate is open)
  assert.equal(det.queue.length, 0);
  det.resume();
  assert.equal(det.paused, false);
  await maxScore(det, audio);
  assert.equal(hits.length, 2, 'fires again after resume');
});

test('detector skips ahead instead of falling behind when overloaded', async () => {
  const det = await new WakeWordDetector({ runner, maxBacklogChunks: 3 }).init();
  det.push(new Float32Array(CHUNK_SAMPLES * 10)); // 10 chunks at once
  assert.ok(det.droppedChunks >= 10);
  while (det.running) await new Promise((r) => setTimeout(r, 0));
});
