// Pure audio helpers (no browser APIs besides btoa), unit tested in test/audio.test.js.

/** Naive box-filter downsample. */
export function downsample(data, fromRate, toRate) {
  if (fromRate === toRate) return data;
  const ratio = fromRate / toRate;
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

/** Float samples (-1..1) -> 16-bit signed PCM. */
export function floatToInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function toBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** One audio frame -> base64 16 kHz PCM16, ready for the Live API. */
export function frameToPcmBase64(float32, inputRate, targetRate) {
  const pcm = floatToInt16(downsample(float32, inputRate, targetRate));
  return toBase64(new Uint8Array(pcm.buffer));
}
