// Full chain with REAL Chrome tab audio capture (chrome.tabCapture -> offscreen
// document -> AudioWorklet -> clip -> service worker -> AI -> pointer).
// A local "meeting" page plays recorded speech from its tab, exactly like a remote
// participant's voice coming out of a Google Meet tab. The AI is replaced by a fake
// that records the exact request and returns a fixed answer.
//
// Not covered: Google Meet itself (needs sign-in) and the real AI's transcription.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const SHOTS = process.env.SCREENSHOT_DIR || path.join(ROOT, 'test', 'integration', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let worker;
let server;
let page;
let tabId;
const sw = (fn, ...args) => worker.evaluate(fn, ...args);

async function launch(extraArgs = []) {
  const b = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ROOT],
    // Puppeteer mutes all tabs by default; a muted tab gives tab capture pure silence.
    ignoreDefaultArgs: ['--mute-audio'],
    args: ['--autoplay-policy=no-user-gesture-required', ...extraArgs],
    defaultViewport: { width: 1280, height: 800 }
  });
  const t = await b.waitForTarget((x) => x.type() === 'service_worker' && x.url().endsWith('/src/background/index.js'), { timeout: 15000 });
  const w = await t.worker();
  for (let i = 0; i < 100; i++) {
    if (await w.evaluate(() => typeof globalThis.__seniorHelperTest === 'object' && !!chrome.tabs).catch(() => false)) break;
    await sleep(100);
  }
  return { b, w, id: new URL(t.url()).host };
}

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // Chrome only lets an extension capture a tab after the user clicks it. In automation
  // there is no user, so the extension is allow-listed by its id (a Chrome test switch).
  const first = await launch();
  const extId = first.id;
  await first.b.close();
  ({ b: browser, w: worker } = await launch([`--allowlisted-extension-id=${extId}`]));

  globalThis.__offLogs = [];
  browser.on('targetcreated', async (t) => {
    if (!t.url().includes('offscreen')) return;
    const p = await t.asPage().catch(() => null);
    p?.on('console', (m) => globalThis.__offLogs.push(m.type() + ': ' + m.text()));
    p?.on('pageerror', (e) => globalThis.__offLogs.push('pageerror: ' + e.message));
  });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/meet.html`, { waitUntil: 'load' });
  await page.bringToFront();
  tabId = await sw(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());

  // Fake AI: record exactly what is sent, answer "Compose".
  await sw(async () => {
    await chrome.storage.local.set({ geminiApiKey: 'test-key', model: 'gemini-3.5-flash-lite', voiceMode: 'clips' });
    globalThis.__requests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const audio = parts.find((p) => p.inlineData)?.inlineData;
      const text = parts.find((p) => p.text)?.text || '';
      const rows = JSON.parse(text.slice(text.lastIndexOf('\n') + 1));
      // WAV payload -> duration and loudness, to prove real speech was sent (not silence).
      const bin = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
      const pcm = new Int16Array(bin.buffer, 44, Math.floor((bin.length - 44) / 2));
      const rms = Math.sqrt(pcm.reduce((s, v) => s + (v / 32768) ** 2, 0) / pcm.length);
      const compose = rows.find((r) => r[2] === 'Compose');
      const answer = {
        transcript: 'click the compose button', isCommand: true, intent: 'locate_element', target: 'Compose',
        region: 'none', matchedElementId: compose ? compose[0] : null, confidence: 0.92, label: 'Click Compose'
      };
      globalThis.__requests.push({
        url: url.replace(/key=[^&]+/, 'key=***'),
        model: url.match(/models\/([^:]+):/)?.[1],
        audioMime: audio.mimeType,
        audioBytes: bin.length,
        audioSeconds: +(pcm.length / 16000).toFixed(2),
        audioRms: +rms.toFixed(3),
        elementRows: rows,
        promptStart: text.slice(0, 160),
        hasSystemInstruction: !!body.systemInstruction,
        responseSchema: !!body.generationConfig.responseSchema,
        answer
      });
      return new Response(JSON.stringify({ modelVersion: 'fake-ai', candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200 });
    };
  });
});

after(async () => {
  await sw(() => globalThis.__seniorHelperTest.stopListening()).catch(() => {});
  await browser?.close();
  server?.close();
});

let start;

test('real tab capture starts on the meeting tab', async () => {
  start = await sw(async (id) => {
    try {
      await globalThis.__seniorHelperTest.startListening(id);
      return { ok: true, state: await globalThis.__seniorHelperTest.getState() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, tabId);
  console.log('  start:', JSON.stringify({ ok: start.ok, status: start.state?.status, error: start.error }));
  assert.ok(start.ok, `capture did not start: ${start.error}`);
  assert.equal(start.state.status, 'listening');
});

test('speech played by the tab is captured, sent to the AI, and the pointer lands on the button', async () => {
  assert.ok(start?.ok, 'capture not running');
  const consoleLines = [];
  page.on('console', (m) => { if (m.text().startsWith('[Senior Helper]')) consoleLines.push(m.text()); });

  const t0 = Date.now();
  const played = await page.evaluate(() => window.playVoice('/audio/pos_2.wav')); // "Hey Jarvis, click the compose button."
  const speechEnd = Date.now();
  let reqs = [];
  for (let i = 0; i < 60 && !reqs.length; i++) { await sleep(100); reqs = await sw(() => globalThis.__requests); }
  await sleep(700);
  reqs = await sw(() => globalThis.__requests);
  const ui = (await sw((id) => chrome.tabs.sendMessage(id, { action: 'INDICATOR', listening: true }, { frameId: 0 }), tabId)).ui;
  await page.screenshot({ path: path.join(SHOTS, 'meet-chain.png') });

  const diag = await sw(() => globalThis.__seniorHelperTest.getState());
  console.log('  state:', JSON.stringify({ status: diag.status, detail: diag.detail, metrics: diag.metrics }));
  const off = browser.targets().find((t) => t.url().includes('offscreen.html'));
  console.log('  offscreen target:', off ? off.url() : 'NONE');
  if (off) {
    const offPage = await off.asPage().catch(() => null);
    if (offPage) {
      const info = await offPage.evaluate(async () => {
        const ctxs = [];
        return globalThis.__seniorHelperAudio || { missing: true };
      }).catch((e) => ({ err: e.message }));
      console.log('  offscreen page:', JSON.stringify(info));
    }
  }
  console.log('  offscreen logs:', JSON.stringify(globalThis.__offLogs || []));
  console.log(`  played ${played.toFixed(2)} s of speech from the tab; first AI request ${reqs.length ? 'sent' : 'NOT sent'}; ${Date.now() - speechEnd} ms after speech ended`);
  if (reqs[0]) {
    const r = reqs[0];
    console.log('  SENT to AI:', JSON.stringify({ url: r.url, model: r.model, audio: `${r.audioMime}, ${r.audioBytes} bytes, ${r.audioSeconds} s, rms ${r.audioRms}`, systemInstruction: r.hasSystemInstruction, strictSchema: r.responseSchema }));
    console.log('  SENT elements [id, role, name, region, visible]:', JSON.stringify(r.elementRows));
    console.log('  RETURNED by AI:', JSON.stringify(r.answer));
  }
  console.log('  page console:', JSON.stringify(consoleLines));
  console.log('  pointer:', JSON.stringify(ui.halos));

  assert.ok(reqs.length >= 1, 'no audio clip ever reached the AI');
  const r = reqs[0];
  assert.equal(r.audioMime, 'audio/wav');
  assert.ok(r.audioSeconds >= played * 0.6, `clip ${r.audioSeconds} s vs ${played} s of speech`);
  assert.ok(r.audioRms > 0.01, 'clip is silent');
  assert.ok(r.elementRows.some((row) => row[2] === 'Compose'), 'Compose not in the element list');
  assert.ok(!JSON.stringify(r).includes('test-key'), 'API key leaked into the logged request');

  const compose = await page.evaluate(() => { const b = document.getElementById('compose').getBoundingClientRect(); return { left: b.left, top: b.top }; });
  assert.equal(ui.halos.length, 1, 'no pointer shown');
  assert.ok(Math.abs(ui.halos[0].left - (compose.left - 16)) <= 2 && Math.abs(ui.halos[0].top - (compose.top - 16)) <= 2, 'pointer not on Compose');
  assert.ok(consoleLines.some((l) => l.includes('heard: "click the compose button"')), 'heard-line missing from page console');
  assert.equal(await page.evaluate(() => window.__clicks), 0, 'something was clicked automatically');
  console.log(`  total: ${Date.now() - t0} ms from start of playback (fake AI answers instantly)`);
});
