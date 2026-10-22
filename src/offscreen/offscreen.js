// Offscreen document: captures the Meet tab's audio (the family member's voice),
// cuts it into short WAV clips and sends them to the background worker.
import { CLIP_SECONDS, SILENCE_RMS, TARGET_SAMPLE_RATE } from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { concatChunks, downsample, encodeWav, rms, toBase64 } from './audio.js';

let audioCtx = null;
let mediaStream = null;
let processor = null;
let buffers = [];
let samples = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== TARGET_OFFSCREEN) return;
  if (msg.action === MSG.START_CAPTURE) startCapture(msg.streamId);
  if (msg.action === MSG.STOP_CAPTURE) stopCapture();
});

async function startCapture(streamId) {
  stopCapture();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);

  // Capturing a tab mutes it for the user, so route audio back to the speakers.
  source.connect(audioCtx.destination);

  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    samples += e.inputBuffer.length;
    if (samples >= audioCtx.sampleRate * CLIP_SECONDS) flushClip(audioCtx.sampleRate);
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);
}

function stopCapture() {
  if (processor) { processor.disconnect(); processor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  buffers = [];
  samples = 0;
}

function flushClip(inputRate) {
  const merged = concatChunks(buffers, samples);
  buffers = [];
  samples = 0;
  if (rms(merged) < SILENCE_RMS) return; // skip silence to save API quota

  const wav = encodeWav(downsample(merged, inputRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
  chrome.runtime.sendMessage({ action: MSG.AUDIO_CLIP, audioBase64: toBase64(wav), mimeType: 'audio/wav' });
}

