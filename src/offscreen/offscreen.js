// Offscreen document: captures the Google Meet tab's playback audio, keeps it
// audible, and turns it into speech clips for the background worker:
//   wake (default): an on-device wake-word detector opens a gate; only the request
//                   that follows the wake phrase is sent,
//   clips (always): every utterance is sent as overlapping clips.
// Raw audio is never stored; clips live only in memory until sent.
import {
  CLIP_HOP_MS, CLIP_WINDOW_MS, END_OF_SPEECH_MS, MIN_SPEECH_MS, TARGET_SAMPLE_RATE,
  VOICE_MODES, WAKE_CHIME, WAKE_END_OF_COMMAND_MS, WAKE_GRACE_MS, WAKE_MAX_COMMAND_MS,
  WAKE_MIN_COMMAND_SPEECH_MS, WAKE_PREROLL_MS, WAKE_WAIT_FOR_COMMAND_MS
} from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { encodeWav, toBase64 } from './audio.js';
import { startAudioGraph } from './captureGraph.js';
import { ClipSegmenter } from './segmenter.js';
import { WakeGate } from './wakeGate.js';
import { loadWakeDetector, playChime } from './wakeEngine.js';

/** Live counters for debugging: inspect `__seniorHelperAudio` in the offscreen document's DevTools. */
const debug = (globalThis.__seniorHelperAudio = { frames: 0, loudFrames: 0, clipsSent: 0, mode: null, lastError: null });

let state = null; // { generation, graph, audioCtx, seq, segmenter | gate + wake }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== TARGET_OFFSCREEN || sender.id !== chrome.runtime.id) return;
  if (msg.action === MSG.START_CAPTURE) {
    startCapture(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => { debug.lastError = e.message; console.warn('[Senior Helper] capture failed', e); stopCapture(); sendResponse({ ok: false, error: e.message }); });
    return true;
  }
  if (msg.action === MSG.STOP_CAPTURE) {
    stopCapture();
    sendResponse({ ok: true });
  }
});

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function sendClip(clip, generation) {
  if (!state) return;
  debug.clipsSent++;
  console.log(`[Senior Helper] clip ready: ${clip.durationMs} ms (${clip.reason})`);
  send({
    action: MSG.AUDIO_CLIP,
    generation,
    seq: state.seq++,
    audioBase64: toBase64(encodeWav(clip.samples, TARGET_SAMPLE_RATE)),
    mimeType: 'audio/wav',
    durationMs: clip.durationMs,
    speechMs: clip.speechMs,
    reason: clip.reason,
    wake: clip.reason.startsWith('wake-'),
    capturedAt: clip.speechEndedAt
  });
}

async function startCapture({ streamId, generation, mode = VOICE_MODES.WAKE }) {
  stopCapture();
  // Load the wake-word model first: if it fails, fail before any audio is captured.
  const wake = mode === VOICE_MODES.WAKE ? await loadWakeDetector({ onWake: () => onWake(generation) }) : null;
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });

  const mine = { generation, graph: null, audioCtx: null, seq: 0, wake: null, gate: null, segmenter: null };
  state = mine;

  debug.mode = mode;
  let onSamples;
  if (mode === VOICE_MODES.WAKE) {
    mine.wake = wake;
    mine.gate = new WakeGate({
      sampleRate: TARGET_SAMPLE_RATE,
      prerollMs: WAKE_PREROLL_MS,
      graceMs: WAKE_GRACE_MS,
      minCommandSpeechMs: WAKE_MIN_COMMAND_SPEECH_MS,
      endOfCommandMs: WAKE_END_OF_COMMAND_MS,
      waitForCommandMs: WAKE_WAIT_FOR_COMMAND_MS,
      maxCommandMs: WAKE_MAX_COMMAND_MS,
      onClip: (clip) => sendClip(clip, generation),
      onClose: (reason) => {
        send({ action: MSG.WAKE_EVENT, generation, state: reason === 'no-command' ? 'no-command' : 'closed' });
        state?.wake?.resume(); // listen for the wake phrase again
      }
    });
    onSamples = (samples, now) => {
      if (state !== mine) return;
      mine.gate.push(samples, now);
      if (!mine.gate.isOpen) mine.wake.push(samples);
    };
  } else {
    mine.segmenter = new ClipSegmenter({
      sampleRate: TARGET_SAMPLE_RATE,
      windowMs: CLIP_WINDOW_MS,
      hopMs: CLIP_HOP_MS,
      minSpeechMs: MIN_SPEECH_MS,
      endOfSpeechMs: END_OF_SPEECH_MS,
      onClip: (clip) => sendClip(clip, generation)
    });
    onSamples = (samples, now) => mine.segmenter?.push(samples, now);
  }

  const handle = onSamples;
  onSamples = (samples, now) => {
    debug.frames++;
    let s = 0;
    for (let i = 0; i < samples.length; i += 8) s += samples[i] * samples[i];
    if (Math.sqrt(s / (samples.length / 8)) > 0.01) debug.loudFrames++;
    handle(samples, now);
  };
  try {
    mine.graph = await startAudioGraph(mediaStream, {
      onSamples,
      onEnded: () => {
        send({ action: MSG.CAPTURE_ENDED, generation, detail: 'The Meet tab stopped sharing audio (closed or reloaded).' });
        stopCapture();
      }
    });
  } catch (e) {
    mediaStream.getTracks().forEach((t) => t.stop()); // never leave the tab capture running
    throw e;
  }
  mine.audioCtx = mine.graph.audioCtx;
}

/** The on-device detector heard the wake phrase: open the gate and tell the user. */
function onWake(generation) {
  if (!state || state.generation !== generation || !state.gate) return;
  state.gate.open();
  if (WAKE_CHIME && state.audioCtx) {
    try { playChime(state.audioCtx); } catch { /* chime is optional */ }
  }
  send({ action: MSG.WAKE_EVENT, generation, state: 'open' });
}

function stopCapture() {
  if (!state) return;
  const s = state;
  state = null;
  s.graph?.stop();
  s.segmenter?.reset();
  s.wake?.pause();
  s.gate?.reset();
}
