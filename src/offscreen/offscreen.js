// Offscreen document: captures the Google Meet tab's playback audio, keeps it
// audible, and turns it into overlapping speech clips for the background worker.
// Raw audio is never stored; clips live only in memory until sent.
import {
  AUDIO_FRAME_SIZE, CLIP_HOP_MS, CLIP_WINDOW_MS, END_OF_SPEECH_MS, MIN_SPEECH_MS, TARGET_SAMPLE_RATE
} from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { StreamDownsampler, encodeWav, toBase64 } from './audio.js';
import { ClipSegmenter } from './segmenter.js';

let state = null; // { generation, audioCtx, mediaStream, processor, segmenter, seq }

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

async function startCapture({ streamId, generation }) {
  stopCapture();
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
  state.segmenter = new ClipSegmenter({
    sampleRate: TARGET_SAMPLE_RATE,
    windowMs: CLIP_WINDOW_MS,
    hopMs: CLIP_HOP_MS,
    minSpeechMs: MIN_SPEECH_MS,
    endOfSpeechMs: END_OF_SPEECH_MS,
    onClip: (clip) => {
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
        capturedAt: clip.speechEndedAt
      });
    }
  });
  processor.port.onmessage = (e) => {
    const samples = downsampler.process(e.data);
    state?.segmenter?.push(samples, Date.now());
  };

  // Meet tab closed / navigated away / capture revoked.
  for (const track of mediaStream.getAudioTracks()) {
    track.onended = () => {
      send({ action: MSG.CAPTURE_ENDED, generation, detail: 'The Meet tab stopped sharing audio (closed or reloaded).' });
      stopCapture();
    };
  }
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
}
