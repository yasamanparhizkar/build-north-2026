// Offscreen document: captures the Google Meet tab's playback audio, keeps it
// audible, and turns it into speech clips for the background worker:
//   wake (default): an on-device wake-word detector opens a gate; only the request
//                   that follows the wake phrase is sent,
//   clips (always): every utterance is sent as overlapping clips.
// Raw audio is never stored; clips live only in memory until sent.
import {
  AUDIO_FRAME_SIZE, CLIP_HOP_MS, CLIP_WINDOW_MS, END_OF_SPEECH_MS, MIN_SPEECH_MS, TARGET_SAMPLE_RATE,
  VOICE_MODES, WAKE_CHIME, WAKE_END_OF_COMMAND_MS, WAKE_GRACE_MS, WAKE_MAX_COMMAND_MS,
  WAKE_MIN_COMMAND_SPEECH_MS, WAKE_PREROLL_MS, WAKE_WAIT_FOR_COMMAND_MS
} from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { StreamDownsampler, encodeWav, toBase64 } from './audio.js';
import { ClipSegmenter } from './segmenter.js';
import { WakeGate } from './wakeGate.js';
import { loadWakeDetector, playChime } from './wakeEngine.js';

let state = null; // { generation, audioCtx, mediaStream, processor, seq, segmenter | gate + wake }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== TARGET_OFFSCREEN || sender.id !== chrome.runtime.id) return;
  if (msg.action === MSG.START_CAPTURE) {
    startCapture(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => { stopCapture(); sendResponse({ ok: false, error: e.message }); });
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
  const audioCtx = new AudioContext();
  await audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(mediaStream);

  // Tab capture mutes the tab for the user: play it back exactly once.
  source.connect(audioCtx.destination);

  // Analysis branch goes through a muted gain node so it can never double the playback.
  await audioCtx.audioWorklet.addModule(chrome.runtime.getURL('src/offscreen/frame-forwarder.worklet.js'));
  const processor = new AudioWorkletNode(audioCtx, 'frame-forwarder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { frameSize: AUDIO_FRAME_SIZE }
  });
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  const downsampler = new StreamDownsampler(audioCtx.sampleRate, TARGET_SAMPLE_RATE);
  state = { generation, audioCtx, mediaStream, processor, seq: 0 };

  if (mode === VOICE_MODES.WAKE) {
    state.wake = wake;
    state.gate = new WakeGate({
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
    processor.port.onmessage = (e) => {
      const samples = downsampler.process(e.data);
      if (!state || !samples.length) return;
      state.gate.push(samples, Date.now());
      if (!state.gate.isOpen) state.wake.push(samples);
    };
  } else {
    state.segmenter = new ClipSegmenter({
      sampleRate: TARGET_SAMPLE_RATE,
      windowMs: CLIP_WINDOW_MS,
      hopMs: CLIP_HOP_MS,
      minSpeechMs: MIN_SPEECH_MS,
      endOfSpeechMs: END_OF_SPEECH_MS,
      onClip: (clip) => sendClip(clip, generation)
    });
    processor.port.onmessage = (e) => {
      const samples = downsampler.process(e.data);
      state?.segmenter?.push(samples, Date.now());
    };
  }

  // Meet tab closed / navigated away / capture revoked.
  for (const track of mediaStream.getAudioTracks()) {
    track.onended = () => {
      send({ action: MSG.CAPTURE_ENDED, generation, detail: 'The Meet tab stopped sharing audio (closed or reloaded).' });
      stopCapture();
    };
  }
}

/** The on-device detector heard the wake phrase: open the gate and tell the user. */
function onWake(generation) {
  if (!state || state.generation !== generation || !state.gate) return;
  state.gate.open();
  if (WAKE_CHIME) {
    try { playChime(state.audioCtx); } catch { /* chime is optional */ }
  }
  send({ action: MSG.WAKE_EVENT, generation, state: 'open' });
}

function stopCapture() {
  if (!state) return;
  const s = state;
  state = null;
  s.processor.port.onmessage = null;
  try { s.processor.disconnect(); } catch { /* ignore */ }
  s.mediaStream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  s.audioCtx.close().catch(() => {});
  s.segmenter?.reset();
  s.wake?.pause();
  s.gate?.reset();
}
