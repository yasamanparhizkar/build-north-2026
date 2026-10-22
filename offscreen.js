// Offscreen document: captures the Meet tab's audio (the family member's voice),
// cuts it into short WAV clips and sends them to background.js.
const CLIP_SECONDS = 6;
const TARGET_RATE = 16000;
const SILENCE_RMS = 0.005; // skip silent clips to save API quota

let audioCtx = null;
let mediaStream = null;
let processor = null;
let buffers = [];
let samples = 0;
let inputRate = 48000;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.action === 'START_CAPTURE') startCapture(msg.streamId);
  if (msg.action === 'STOP_CAPTURE') stopCapture();
});

async function startCapture(streamId) {
  stopCapture();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  audioCtx = new AudioContext();
  inputRate = audioCtx.sampleRate;
  const source = audioCtx.createMediaStreamSource(mediaStream);

  // Capturing a tab mutes it for the user, so route audio back to the speakers.
  source.connect(audioCtx.destination);

  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    samples += e.inputBuffer.length;
    if (samples >= inputRate * CLIP_SECONDS) flushClip();
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

function flushClip() {
  const merged = new Float32Array(samples);
  let offset = 0;
  for (const b of buffers) { merged.set(b, offset); offset += b.length; }
  buffers = [];
  samples = 0;

  let sum = 0;
  for (let i = 0; i < merged.length; i += 8) sum += merged[i] * merged[i];
  const rms = Math.sqrt(sum / (merged.length / 8));
  if (rms < SILENCE_RMS) return;

  const wav = encodeWav(downsample(merged, inputRate, TARGET_RATE), TARGET_RATE);
  chrome.runtime.sendMessage({ action: 'AUDIO_CLIP', audioBase64: toBase64(wav), mimeType: 'audio/wav' });
}

function downsample(data, from, to) {
  if (from === to) return data;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(data.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), data.length);
    let acc = 0;
    for (let j = start; j < end; j++) acc += data[j];
    out[i] = acc / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(float32, rate) {
  const buf = new ArrayBuffer(44 + float32.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + float32.length * 2, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, float32.length * 2, true);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function toBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

