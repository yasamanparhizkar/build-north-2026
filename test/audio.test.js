import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsample, floatToInt16, frameToPcmBase64, toBase64 } from '../src/offscreen/audio.js';

test('downsample 48k -> 16k yields a third of the samples', () => {
  const out = downsample(new Float32Array(4800).fill(1), 48000, 16000);
  assert.equal(out.length, 1600);
  assert.ok(out.every((v) => v === 1));
});

test('downsample is a no-op at equal rates', () => {
  const data = new Float32Array([0.1, 0.2]);
  assert.equal(downsample(data, 16000, 16000), data);
});

test('floatToInt16 scales and clips', () => {
  const out = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  assert.deepEqual([...out], [0, 0x7fff, -0x8000, 0x7fff, -0x8000, Math.trunc(0.5 * 0x7fff)]);
});

test('toBase64 round-trips', () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 255]);
  assert.deepEqual([...Buffer.from(toBase64(bytes), 'base64')], [...bytes]);
});

test('toBase64 handles buffers larger than the chunk size', () => {
  const bytes = new Uint8Array(0x8000 * 2 + 5).fill(7);
  assert.equal(Buffer.from(toBase64(bytes), 'base64').length, bytes.length);
});

test('frameToPcmBase64 produces 16 kHz little-endian PCM16', () => {
  // 48 samples @ 48 kHz -> 16 samples @ 16 kHz -> 32 bytes
  const b64 = frameToPcmBase64(new Float32Array(48).fill(1), 48000, 16000);
  const bytes = Buffer.from(b64, 'base64');
  assert.equal(bytes.length, 32);
  assert.equal(bytes.readInt16LE(0), 0x7fff);
});
