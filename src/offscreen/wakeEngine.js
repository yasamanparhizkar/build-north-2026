// Loads the on-device wake-word detector inside the offscreen document.
// The runtime (vendor/onnxruntime-web) and models (models/wakeword) ship inside the
// extension; nothing is downloaded at run time and no audio is sent anywhere here.
import {
  WAKE_EMBEDDING_FILE, WAKE_MEL_FILE, WAKE_MODEL_DIR, WAKE_MODEL_FILE, WAKE_THRESHOLD
} from '../shared/constants.js';
import { WakeWordDetector, createRunner } from '../wakeword/detector.js';

let runnerPromise = null;

async function loadRunner() {
  const ort = await import('../../vendor/onnxruntime-web/ort.wasm.bundle.min.mjs');
  ort.env.wasm.numThreads = 1; // extension pages are not cross-origin isolated
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/onnxruntime-web/');
  const loadModel = async (file) => {
    const res = await fetch(chrome.runtime.getURL(WAKE_MODEL_DIR + file));
    if (!res.ok) throw new Error(`Wake-word model missing: ${file}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return createRunner(ort, loadModel, { melFile: WAKE_MEL_FILE, embeddingFile: WAKE_EMBEDDING_FILE, wakeFile: WAKE_MODEL_FILE });
}

/**
 * @param {{onWake: (score: number) => void, threshold?: number}} opts
 * @returns {Promise<WakeWordDetector>}
 */
export async function loadWakeDetector({ onWake, threshold = WAKE_THRESHOLD }) {
  if (!runnerPromise) runnerPromise = loadRunner().catch((e) => { runnerPromise = null; throw e; });
  const runner = await runnerPromise;
  return new WakeWordDetector({ runner, threshold, onWake }).init();
}

/** Short two-note tone so people know the helper heard them. */
export function playChime(audioCtx) {
  const t = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  gain.connect(audioCtx.destination);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  for (const [freq, at] of [[880, 0], [1320, 0.12]]) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t + at);
    osc.connect(gain);
    osc.start(t + at);
    osc.stop(t + at + 0.2);
  }
}
