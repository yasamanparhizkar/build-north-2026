import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concatChunks, downsample, encodeWav, rms, toBase64 } from '../src/offscreen/audio.js';

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

test('downsample is a no-op at equal rates', () => {
  const data = new Float32Array([0.1, 0.2]);
  assert.equal(downsample(data, 16000, 16000), data);
});

test('encodeWav writes a valid 16-bit mono PCM header', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const v = new DataView(wav.buffer);
  const tag = (o) => String.fromCharCode(...wav.subarray(o, o + 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(36), 'data');
  assert.equal(v.getUint32(24, true), 16000); // sample rate
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint16(34, true), 16); // bits
  assert.equal(v.getUint32(40, true), 8); // 4 samples * 2 bytes
  assert.equal(wav.length, 44 + 8);
  assert.equal(v.getInt16(46, true), 0x7fff); // +1 clipped to max
  assert.equal(v.getInt16(48, true), -0x8000); // -1 -> min
});

test('toBase64 round-trips', () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 255]);
  assert.deepEqual([...Buffer.from(toBase64(bytes), 'base64')], [...bytes]);
});

test('toBase64 handles buffers larger than the chunk size', () => {
  const bytes = new Uint8Array(0x8000 * 2 + 5).fill(7);
  assert.equal(Buffer.from(toBase64(bytes), 'base64').length, bytes.length);
});

test('concatChunks joins in order', () => {
  const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3])], 3);
  assert.deepEqual([...out], [1, 2, 3]);
});

