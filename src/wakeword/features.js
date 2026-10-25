// Streaming openWakeWord feature pipeline (pure, no browser APIs; unit tested).
//
// A JavaScript port of openWakeWord's AudioFeatures streaming logic
// (openwakeword/utils.py, v0.6.0), fed exactly one 80 ms chunk at a time:
//
//   16 kHz audio --(melspectrogram.onnx)--> 32-bin mel frames, 8 per chunk
//   last 76 mel frames --(embedding_model.onnx)--> one 96-dim embedding per chunk
//   last 16 embeddings --(<wake word>.onnx)--> score 0..1 per chunk
//
// The three models are reached through an injected `runner`, so this file has no
// dependency on onnxruntime and can be tested with fakes.

export const SAMPLE_RATE = 16000;
export const CHUNK_SAMPLES = 1280; // 80 ms
export const MEL_CONTEXT_SAMPLES = 160 * 3; // extra left context for the mel model
export const MEL_BINS = 32;
export const EMBEDDING_WINDOW = 76; // mel frames per embedding
export const EMBEDDING_STEP = 8; // mel frames per chunk
export const EMBEDDING_DIM = 96;
export const HEAD_FRAMES = 16; // embeddings per wake-word prediction
export const WARMUP_PREDICTIONS = 5; // openWakeWord ignores the first 5 scores after a reset

const MEL_MAX_FRAMES = 10 * 97; // ~10 s, as in openWakeWord
const FEATURE_MAX_FRAMES = 120; // ~10 s

/**
 * @typedef {object} Runner
 * @property {(audio: Float32Array) => Promise<Float32Array>} mel
 *   int16-scaled samples -> flat [frames x 32] mel frames (already transformed x/10 + 2)
 * @property {(windows: Float32Array, count: number) => Promise<Float32Array>} embed
 *   `count` flat [76 x 32] windows -> flat [count x 96] embeddings
 * @property {(features: Float32Array) => Promise<number>} head
 *   flat [16 x 96] embeddings -> wake-word score
 */

/** Float samples (-1..1) to the int16 value range the models were trained on, as floats. */
export function toInt16Range(samples) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.trunc(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/** Small deterministic PRNG so the warm-up noise is reproducible in tests. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WakeFeatures {
  /** @param {{runner: Runner, seed?: number}} opts */
  constructor({ runner, seed = 1 }) {
    this.runner = runner;
    this.seed = seed;
    this.initialFeatures = null;
  }

  /** Must be awaited once before use: computes the warm-up feature buffer. */
  async init() {
    // openWakeWord starts the feature buffer with embeddings of 4 s of low-level noise.
    const rand = mulberry32(this.seed);
    const noise = new Float32Array(SAMPLE_RATE * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rand() * 2000) - 1000;
    const mel = await this.runner.mel(noise);
    const frames = mel.length / MEL_BINS;
    const count = Math.floor((frames - EMBEDDING_WINDOW) / EMBEDDING_STEP) + 1;
    const windows = new Float32Array(count * EMBEDDING_WINDOW * MEL_BINS);
    for (let w = 0; w < count; w++) {
      const start = w * EMBEDDING_STEP * MEL_BINS;
      windows.set(mel.subarray(start, start + EMBEDDING_WINDOW * MEL_BINS), w * EMBEDDING_WINDOW * MEL_BINS);
    }
    const emb = await this.runner.embed(windows, count);
    this.initialFeatures = [];
    for (let w = 0; w < count; w++) this.initialFeatures.push(emb.slice(w * EMBEDDING_DIM, (w + 1) * EMBEDDING_DIM));
    this.reset();
  }

  reset() {
    if (!this.initialFeatures) throw new Error('WakeFeatures.init() was not awaited');
    this.raw = new Float32Array(0); // last CHUNK + context samples (int16 range)
    this.mel = []; // Float32Array(32) per frame
    for (let i = 0; i < EMBEDDING_WINDOW; i++) this.mel.push(new Float32Array(MEL_BINS).fill(1));
    this.features = this.initialFeatures.slice();
    this.predictions = 0;
  }

  /**
   * Process exactly one 80 ms chunk.
   * @param {Float32Array} chunk CHUNK_SAMPLES samples in the int16 value range
   * @returns {Promise<number>} wake-word score for this chunk
   */
  async processChunk(chunk) {
    if (chunk.length !== CHUNK_SAMPLES) throw new Error(`chunk must be ${CHUNK_SAMPLES} samples`);

    // Keep only what the mel model needs: this chunk plus 3 hops of left context.
    const keep = Math.min(this.raw.length, MEL_CONTEXT_SAMPLES);
    const input = new Float32Array(keep + CHUNK_SAMPLES);
    input.set(this.raw.subarray(this.raw.length - keep), 0);
    input.set(chunk, keep);
    this.raw = input;

    const mel = await this.runner.mel(input);
    for (let f = 0; f < mel.length / MEL_BINS; f++) this.mel.push(mel.slice(f * MEL_BINS, (f + 1) * MEL_BINS));
    if (this.mel.length > MEL_MAX_FRAMES) this.mel.splice(0, this.mel.length - MEL_MAX_FRAMES);

    const window = new Float32Array(EMBEDDING_WINDOW * MEL_BINS);
    const first = this.mel.length - EMBEDDING_WINDOW;
    for (let i = 0; i < EMBEDDING_WINDOW; i++) window.set(this.mel[first + i], i * MEL_BINS);
    this.features.push(await this.runner.embed(window, 1));
    if (this.features.length > FEATURE_MAX_FRAMES) this.features.splice(0, this.features.length - FEATURE_MAX_FRAMES);

    const head = new Float32Array(HEAD_FRAMES * EMBEDDING_DIM);
    const start = this.features.length - HEAD_FRAMES;
    for (let i = 0; i < HEAD_FRAMES; i++) head.set(this.features[start + i], i * EMBEDDING_DIM);
    const score = await this.runner.head(head);

    this.predictions++;
    return this.predictions <= WARMUP_PREDICTIONS ? 0 : score;
  }
}
