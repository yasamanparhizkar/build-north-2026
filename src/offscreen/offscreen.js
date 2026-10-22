// Offscreen document: captures the Google Meet tab's playback audio, keeps it
// audible, and turns it into overlapping speech clips (default) or a live
// transcript stream (experimental) for the background worker.
// Raw audio is never stored; clips live only in memory until sent.
import {
  AUDIO_FRAME_SIZE, CLIP_HOP_MS, CLIP_WINDOW_MS, END_OF_SPEECH_MS, MIN_SPEECH_MS,
  TARGET_SAMPLE_RATE, UTTERANCE_SILENCE_MS, VOICE_MODES
} from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { LiveTranscriber } from '../voice/liveClient.js';
import { UtteranceDetector } from '../voice/utteranceDetector.js';
import { StreamDownsampler, encodeWav, pcm16Base64, toBase64 } from './audio.js';
import { ClipSegmenter } from './segmenter.js';

let state = null; // { generation, audioCtx, mediaStream, processor, segmenter, transcriber, detector }

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

async function startCapture({ streamId, generation, mode, apiKey, liveModel }) {
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
  const processor = audioCtx.createScriptProcessor(AUDIO_FRAME_SIZE, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  const downsampler = new StreamDownsampler(audioCtx.sampleRate, TARGET_SAMPLE_RATE);
  state = { generation, audioCtx, mediaStream, processor, seq: 0 };

  if (mode === VOICE_MODES.LIVE) {
    setupLive(apiKey, liveModel);
    processor.onaudioprocess = (e) => {
      const samples = downsampler.process(e.inputBuffer.getChannelData(0));
      if (samples.length) state?.transcriber?.sendAudio(pcm16Base64(samples));
    };
  } else {
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
    processor.onaudioprocess = (e) => {
      const samples = downsampler.process(e.inputBuffer.getChannelData(0));
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

function setupLive(apiKey, model) {
  const generation = state.generation;
  state.detector = new UtteranceDetector({
    silenceMs: UTTERANCE_SILENCE_MS,
    onUtterance: (text) => {
      if (!state) return;
      send({ action: MSG.UTTERANCE, generation, seq: state.seq++, text, capturedAt: Date.now() });
    }
  });
  state.transcriber = new LiveTranscriber({
    apiKey,
    model,
    onText: (fragment) => state?.detector?.feed(fragment),
    onTurnComplete: () => state?.detector?.flush(),
    onStatus: (s, detail) => send({ action: MSG.LIVE_STATUS, generation, state: s, detail })
  });
  state.transcriber.start();
}

function stopCapture() {
  if (!state) return;
  const s = state;
  state = null;
  s.processor.onaudioprocess = null;
  try { s.processor.disconnect(); } catch { /* ignore */ }
  s.mediaStream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  s.audioCtx.close().catch(() => {});
  s.transcriber?.stop();
  s.detector?.reset();
  s.segmenter?.reset();
}
