// Offscreen document: streams the Meet tab's audio (the family member's voice)
// to Gemini Live and reports finished utterances to the background worker.
import { AUDIO_FRAME_SIZE, TARGET_SAMPLE_RATE, UTTERANCE_SILENCE_MS } from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { LiveTranscriber } from '../voice/liveClient.js';
import { UtteranceDetector } from '../voice/utteranceDetector.js';
import { frameToPcmBase64 } from './audio.js';

let audioCtx = null;
let mediaStream = null;
let processor = null;
let transcriber = null;
let detector = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== TARGET_OFFSCREEN) return;
  if (msg.action === MSG.START_CAPTURE) startCapture(msg).catch((e) => report('error', e.message));
  if (msg.action === MSG.STOP_CAPTURE) stopCapture();
});

function report(state, detail) {
  chrome.runtime.sendMessage({ action: MSG.LIVE_STATUS, state, detail });
}

async function startCapture({ streamId, apiKey, model }) {
  stopCapture();

  detector = new UtteranceDetector({
    silenceMs: UTTERANCE_SILENCE_MS,
    onUtterance: (text) => chrome.runtime.sendMessage({ action: MSG.UTTERANCE, text })
  });
  transcriber = new LiveTranscriber({
    apiKey,
    model,
    onText: (fragment) => detector.feed(fragment),
    onTurnComplete: () => detector.flush(),
    onStatus: report
  });
  transcriber.start();

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);

  // Capturing a tab mutes it for the user, so route audio back to the speakers.
  source.connect(audioCtx.destination);

  // Stream small frames continuously: this is what keeps latency low.
  processor = audioCtx.createScriptProcessor(AUDIO_FRAME_SIZE, 1, 1);
  processor.onaudioprocess = (e) => {
    transcriber.sendAudio(frameToPcmBase64(e.inputBuffer.getChannelData(0), audioCtx.sampleRate, TARGET_SAMPLE_RATE));
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);
}

function stopCapture() {
  if (processor) { processor.disconnect(); processor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (transcriber) { transcriber.stop(); transcriber = null; }
  if (detector) { detector.reset(); detector = null; }
}
