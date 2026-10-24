// Pure audio helpers (no browser APIs besides btoa). Unit tested in test/audio.test.js.

export function rms(samples, stride = 1) {
  if (!samples.length) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i += stride) {
    sum += samples[i] * samples[i];
    n++;
  }
  return Math.sqrt(sum / n);
}

/** Naive box-filter downsample of a whole buffer. */
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

/**
 * Streaming box-filter downsampler: keeps the fractional remainder between
 * frames so no samples are lost or duplicated at frame boundaries.
 */
export class StreamDownsampler {
  constructor(fromRate, toRate) {
    this.ratio = fromRate / toRate;
    this.pos = 0;
    this.carry = new Float32Array(0);
  }

  process(input) {
    if (this.ratio === 1) return Float32Array.from(input);
    const data = new Float32Array(this.carry.length + input.length);
    data.set(this.carry, 0);
    data.set(input, this.carry.length);

    const out = [];
    let pos = this.pos;
    while (pos + this.ratio <= data.length) {
      const start = Math.floor(pos);
      const end = Math.floor(pos + this.ratio);
      let acc = 0;
      for (let j = start; j < end; j++) acc += data[j];
      out.push(acc / Math.max(1, end - start));
      pos += this.ratio;
    }
    const keepFrom = Math.floor(pos);
    this.carry = data.slice(keepFrom);
    this.pos = pos - keepFrom;
    return Float32Array.from(out);
  }
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

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(float32, sampleRate) {
  const pcm = floatToInt16(float32);
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

export function toBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}
