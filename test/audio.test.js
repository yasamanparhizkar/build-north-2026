import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  StreamDownsampler, downsample, encodeWav, floatToInt16, rms, toBase64
} from '../src/offscreen/audio.js';

test('rms of silence is 0 and of a constant signal is its amplitude', () => {
  assert.equal(rms(new Float32Array(100)), 0);
  assert.ok(Math.abs(rms(new Float32Array(100).fill(0.5)) - 0.5) < 1e-6);
  assert.equal(rms(new Float32Array(0)), 0);
});

test('downsample 48k -> 16k yields a third of the samples', () => {
  const out = downsample(new Float32Array(4800).fill(1), 48000, 16000);
  assert.equal(out.length, 1600);
  assert.ok(out.every((v) => v === 1));
});

test('StreamDownsampler loses no samples across odd-sized frames', () => {
  const ds = new StreamDownsampler(48000, 16000);
  let total = 0;
  for (let i = 0; i < 100; i++) total += ds.process(new Float32Array(2048).fill(0.25)).length;
  // 204800 input samples / 3 = 68266.67 -> 68266 complete output samples
  assert.equal(total, 68266);
});

test('StreamDownsampler handles 44.1 kHz (non-integer ratio) and preserves level', () => {
  const ds = new StreamDownsampler(44100, 16000);
  let total = 0;
  let last;
  for (let i = 0; i < 50; i++) { last = ds.process(new Float32Array(2048).fill(0.5)); total += last.length; }
  assert.ok(Math.abs(total - (2048 * 50) / (44100 / 16000)) <= 1);
  assert.ok(last.every((v) => Math.abs(v - 0.5) < 1e-6));
});

test('StreamDownsampler at equal rates is identity', () => {
  const ds = new StreamDownsampler(16000, 16000);
  assert.deepEqual([...ds.process(new Float32Array([0.1, 0.2]))].map((v) => +v.toFixed(3)), [0.1, 0.2]);
});

test('floatToInt16 scales and clips', () => {
  const out = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  assert.deepEqual([...out], [0, 0x7fff, -0x8000, 0x7fff, -0x8000, Math.trunc(0.5 * 0x7fff)]);
});

test('encodeWav writes a valid 16-bit mono PCM header and data', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const v = new DataView(wav.buffer);
  const tag = (o) => String.fromCharCode(...wav.subarray(o, o + 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(36), 'data');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(wav.length, 52);
  assert.equal(v.getInt16(46, true), 0x7fff);
  assert.equal(v.getInt16(48, true), -0x8000);
});

test('toBase64 round-trips, including large buffers', () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 255]);
  assert.deepEqual([...Buffer.from(toBase64(bytes), 'base64')], [...bytes]);
  const big = new Uint8Array(0x8000 * 2 + 5).fill(7);
  assert.equal(Buffer.from(toBase64(big), 'base64').length, big.length);
});

