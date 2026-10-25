// On-device wake-word detector: openWakeWord models on ONNX Runtime Web.
// Audio never leaves the computer here; this only decides when to open the gate.
//
// `ort` (the onnxruntime-web module) and `loadModel` are injected so the same code
// runs in the offscreen document (vendored runtime, fetch) and in Node tests.
import {
  CHUNK_SAMPLES, EMBEDDING_DIM, EMBEDDING_WINDOW, HEAD_FRAMES, MEL_BINS, WakeFeatures, toInt16Range
} from './features.js';

/** Build the three-model runner used by WakeFeatures. */
export async function createRunner(ort, loadModel, { melFile, embeddingFile, wakeFile }) {
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const [melS, embS, headS] = await Promise.all(
    [melFile, embeddingFile, wakeFile].map(async (f) => ort.InferenceSession.create(await loadModel(f), opts))
  );
  const run = async (session, data, dims) => {
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, dims) });
    return out[session.outputNames[0]].data;
  };
  return {
    async mel(audio) {
      const spec = await run(melS, audio, [1, audio.length]);
      const out = new Float32Array(spec.length);
      for (let i = 0; i < spec.length; i++) out[i] = spec[i] / 10 + 2; // openWakeWord's transform
      return out;
    },
    embed: (windows, count) => run(embS, windows, [count, EMBEDDING_WINDOW, MEL_BINS, 1]),
    async head(features) {
      const out = await run(headS, features, [1, HEAD_FRAMES, EMBEDDING_DIM]);
      return out[0];
    }
  };
}

export class WakeWordDetector {
  /**
   * @param {{runner: object, threshold?: number, maxBacklogChunks?: number,
   *          onWake?: (score: number) => void, onScore?: (score: number) => void}} opts
   */
  constructor({ runner, threshold = 0.5, maxBacklogChunks = 25, onWake = () => {}, onScore = () => {} }) {
    Object.assign(this, { threshold, maxBacklogChunks, onWake, onScore });
    this.features = new WakeFeatures({ runner });
    this.pending = new Float32Array(0);
    this.queue = [];
    this.running = false;
    this.paused = false;
    this.droppedChunks = 0;
    this.maxScore = 0;
  }

  async init() {
    await this.features.init();
    return this;
  }

  /** Feed 16 kHz float samples (-1..1). Inference runs asynchronously, in order. */
  push(samples) {
    if (this.paused || !samples.length) return;
    const all = new Float32Array(this.pending.length + samples.length);
    all.set(this.pending, 0);
    all.set(samples, this.pending.length);
    let offset = 0;
    for (; offset + CHUNK_SAMPLES <= all.length; offset += CHUNK_SAMPLES) {
      this.queue.push(toInt16Range(all.subarray(offset, offset + CHUNK_SAMPLES)));
    }
    this.pending = all.slice(offset);
    if (this.queue.length > this.maxBacklogChunks) {
      // The computer is too slow to keep up: skip ahead rather than fall further behind.
      this.droppedChunks += this.queue.length;
      this.queue = [];
      this.features.reset();
    }
    if (!this.running) this.drain();
  }

  async drain() {
    this.running = true;
    try {
      while (this.queue.length && !this.paused) {
        const score = await this.features.processChunk(this.queue.shift());
        this.maxScore = Math.max(this.maxScore, score);
        this.onScore(score);
        if (score >= this.threshold) {
          this.pause(); // the gate resumes us when it closes again
          this.onWake(score);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Stop scoring (gate open) and drop anything queued. */
  pause() {
    this.paused = true;
    this.queue = [];
    this.pending = new Float32Array(0);
  }

  /** Start scoring again from a clean state, so the last wake word cannot fire twice. */
  resume() {
    this.features.reset();
    this.pending = new Float32Array(0);
    this.queue = [];
    this.paused = false;
  }
}
