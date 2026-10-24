// Voice capture path in real Chrome: real synthesized speech (Windows SAPI,
// test/fixtures/speech-compose.wav) is fed as a MediaStream through the same
// AudioWorklet -> resampler -> VAD -> clip code the extension uses on a Meet tab.
// Verifies the audio actually arrives intact and measures the endpoint delay
// (end of speech -> clip ready). Does NOT cover Chrome tab capture itself or Gemini.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = {
  long: fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'speech-compose.wav')).toString('base64'),
  short: fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'speech-short.wav')).toString('base64')
};

let browser;
let page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ROOT],
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/index.js'), { timeout: 15000 });
  const id = new URL(sw.url()).host;
  page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.goto(`chrome-extension://${id}/src/popup/popup.html`);

  // Test harness running inside the extension page (same origin as the real offscreen document).
  await page.evaluate(async (wavs) => {
    const { startClipCapture } = await import(chrome.runtime.getURL('src/offscreen/captureGraph.js'));
    const { StreamDownsampler } = await import(chrome.runtime.getURL('src/offscreen/audio.js'));
    const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bytesOf = { long: decode(wavs.long), short: decode(wavs.short) };

    const envelope = (samples, rate, ms = 20) => {
      const n = Math.floor((rate * ms) / 1000);
      const out = [];
      for (let i = 0; i + n <= samples.length; i += n) {
        let s = 0;
        for (let j = 0; j < n; j++) s += samples[i + j] ** 2;
        out.push(Math.sqrt(s / n));
      }
      return out;
    };
    const bestCorrelation = (a, b, maxLag) => {
      let best = -1;
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        const xs = [];
        const ys = [];
        for (let i = 0; i < a.length; i++) {
          const j = i + lag;
          if (j >= 0 && j < b.length) { xs.push(a[i]); ys.push(b[j]); }
        }
        if (xs.length < 20) continue;
        const mean = (v) => v.reduce((p, c) => p + c, 0) / v.length;
        const mx = mean(xs); const my = mean(ys);
        let num = 0; let dx = 0; let dy = 0;
        for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
        best = Math.max(best, num / Math.sqrt(dx * dy || 1));
      }
      return best;
    };

    /** pattern: array of 'speech' | seconds of silence. */
    window.__voice = async (pattern, { settleMs = 2500, fixture = 'long' } = {}) => {
      const bytes = bytesOf[fixture];
      const ctx = new AudioContext();
      await ctx.resume();
      const speech = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const dest = ctx.createMediaStreamDestination();
      const clips = [];
      const cap = await startClipCapture(dest.stream, {
        audioCtx: ctx,
        playback: false,
        onClip: (c) => clips.push({ at: performance.now(), samples: c.samples, durationMs: c.durationMs, speechMs: c.speechMs, reason: c.reason })
      });

      const ch = speech.getChannelData(0);
      let lastLoud = ch.length - 1;
      while (lastLoud > 0 && Math.abs(ch[lastLoud]) < 0.02) lastLoud--;
      const lastLoudSec = lastLoud / speech.sampleRate;

      const startAt = ctx.currentTime + 0.3;
      const wallStart = performance.now() + 300;
      let t = 0;
      const speechEnds = [];
      for (const item of pattern) {
        if (item === 'speech') {
          const src = ctx.createBufferSource();
          src.buffer = speech;
          src.connect(dest);
          src.start(startAt + t);
          speechEnds.push(wallStart + (t + lastLoudSec) * 1000);
          t += speech.duration;
        } else {
          t += item;
        }
      }
      await new Promise((r) => setTimeout(r, 300 + t * 1000 + settleMs));

      // Reference signal at 16 kHz for integrity checks.
      const ds = new StreamDownsampler(speech.sampleRate, 16000);
      const ref = ds.process(ch);
      const result = {
        frames: cap.framesReceived(),
        sampleRate: ctx.sampleRate,
        speechSec: speech.duration,
        lastLoudSec,
        clips: clips.map((c, i) => ({
          reason: c.reason,
          durationMs: c.durationMs,
          speechMs: c.speechMs,
          rms: Math.sqrt(c.samples.reduce((p, v) => p + v * v, 0) / c.samples.length),
          endpointDelayMs: Math.round(c.at - (speechEnds[Math.min(i, speechEnds.length - 1)] ?? c.at)),
          envelopeCorrelation: bestCorrelation(envelope(ref, 16000), envelope(c.samples, 16000), 60)
        }))
      };
      cap.stop();
      return result;
    };
  }, FIXTURES);
});

after(async () => {
  await browser?.close();
});

test('real speech through AudioWorklet arrives intact (frames flow, envelope matches the original)', async () => {
  const r = await page.evaluate(() => window.__voice(['speech']));
  console.log(`  ctx ${r.sampleRate} Hz, ${r.frames} frames, speech ${r.speechSec.toFixed(2)} s, last loud ${r.lastLoudSec.toFixed(2)} s`);
  console.log('  clips:', JSON.stringify(r.clips.map((c) => ({ ...c, rms: +c.rms.toFixed(3), envelopeCorrelation: +c.envelopeCorrelation.toFixed(3) }))));
  assert.ok(r.frames > 50, `AudioWorklet delivered only ${r.frames} frames`);
  assert.equal(r.clips.length, 1, 'one command should give exactly one clip');
  const [c] = r.clips;
  assert.equal(c.reason, 'end-of-speech');
  assert.ok(c.speechMs >= 1500, `speech too short: ${c.speechMs}`);
  assert.ok(c.rms > 0.01, 'clip is silent');
  assert.ok(c.envelopeCorrelation >= 0.9, `audio garbled or dropped (envelope correlation ${c.envelopeCorrelation})`);
  assert.ok(c.durationMs >= r.speechSec * 1000 * 0.7 && c.durationMs <= r.speechSec * 1000 + 1500, `clip length ${c.durationMs} vs speech ${r.speechSec * 1000}`);
});

test('latency: clip is ready shortly after the speaker stops', async () => {
  const r = await page.evaluate(() => window.__voice(['speech']));
  const [c] = r.clips;
  console.log(`  endpoint delay (end of speech -> clip ready): ${c.endpointDelayMs} ms`);
  assert.ok(c.endpointDelayMs <= 900, `endpoint delay too long: ${c.endpointDelayMs} ms`);
  assert.ok(c.endpointDelayMs >= 0);
});

test('two commands separated by a pause give two clips, each with ONLY its own command', async () => {
  const r = await page.evaluate(() => window.__voice(['speech', 2.0, 'speech']));
  console.log('  clips:', JSON.stringify(r.clips.map((c) => ({ reason: c.reason, durationMs: c.durationMs, speechMs: c.speechMs }))));
  assert.equal(r.clips.length, 2, `got ${r.clips.length} clips`);
  assert.ok(r.clips.every((c) => c.envelopeCorrelation >= 0.9));
  // The second clip must not drag the previous command along (the model would act on the old one).
  const single = r.clips[0].speechMs;
  assert.ok(r.clips[1].speechMs <= single * 1.25, `2nd clip holds ${r.clips[1].speechMs} ms of speech vs ${single} ms for one command`);
  assert.ok(r.clips[1].durationMs <= r.speechSec * 1000 + 1500, `2nd clip is ${r.clips[1].durationMs} ms long`);
});

test('realistic short commands one second apart: each clip holds only its own command', async () => {
  const r = await page.evaluate(() => window.__voice(['speech', 1.3, 'speech', 1.3, 'speech'], { fixture: 'short' }));
  console.log('  clips:', JSON.stringify(r.clips.map((c) => ({ reason: c.reason, durationMs: c.durationMs, speechMs: c.speechMs }))));
  assert.equal(r.clips.length, 3, `got ${r.clips.length} clips`);
  const single = r.clips[0].speechMs;
  for (const [i, c] of r.clips.entries()) {
    assert.ok(c.speechMs <= single * 1.3, `clip ${i + 1} holds ${c.speechMs} ms of speech vs ${single} ms for one command (old command dragged along)`);
  }
});

test('silence and low noise produce no clips (nothing is sent)', async () => {
  const r = await page.evaluate(() => window.__voice([4.0]));
  assert.equal(r.clips.length, 0);
});

