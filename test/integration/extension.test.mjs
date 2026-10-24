// Browser integration tests: loads the real unpacked extension into Chrome for
// Testing (via Puppeteer) and drives it on a local fixture page and on real
// public websites. Run with: npm run test:integration
//
// What this does NOT cover (needs a human + a real call, see README):
// tab audio capture, Meet playback, Gemini audio understanding.
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

let browser;
let worker;
let server;
let base;

function serve() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const file = path.join(FIXTURES, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''));
      if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

/** Run code in the extension's service worker. */
const sw = (fn, ...args) => worker.evaluate(fn, ...args);

async function tabIdFor(url) {
  return sw(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
}

async function getElements(tabId) {
  for (let i = 0; i < 40; i++) {
    const res = await sw(async (id) => {
      try {
        return await chrome.tabs.sendMessage(id, { action: 'GET_ELEMENTS' }, { frameId: 0 });
      } catch {
        return null;
      }
    }, tabId);
    if (res) return res;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('content script never answered');
}

const command = (tabId, text) => sw((id, t) => globalThis.__seniorHelperTest.processText(t, { tabId: id }), tabId, text);
const highlightRaw = (tabId, msg) => sw((id, m) => chrome.tabs.sendMessage(id, { action: 'HIGHLIGHT', ...m }, { frameId: 0 }), tabId, msg);

function near(a, b, tol = 3) {
  return Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol &&
    Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;
}

const rectOf = (page, js) => page.evaluate(`(() => { const r = (${js}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  base = await serve();
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ROOT], // supported loader (the --load-extension flag is being phased out)
    args: [
      // Chrome refuses to start as root (CI containers) unless sandboxing is off.
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '--autoplay-policy=no-user-gesture-required', // the wake-word test plays audio
      '--window-size=1280,900'
    ],
    defaultViewport: { width: 1280, height: 800 }
  });
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/index.js'), { timeout: 15000 });
  worker = await target.worker();
  // The worker target appears before extension APIs/modules are ready.
  for (let i = 0; i < 100; i++) {
    const ready = await worker.evaluate(() => typeof chrome.tabs === 'object' && typeof globalThis.__seniorHelperTest === 'object').catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  await browser?.close();
  server?.close();
});

let page;
let tabId;

test('fixture: content script injects and scans interactive elements', async () => {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/app.html`, { waitUntil: 'load' });
  tabId = await tabIdFor(page.url());
  const snap = await getElements(tabId);
  const names = snap.elements.map((e) => e.name);
  console.log(`  scan: ${snap.elements.length} elements in ${snap.scanMs} ms`);

  assert.match(snap.snapshotId, /^[a-z0-9]+-v\d+$/);
  for (const n of ['Compose', 'Search mail', 'Settings', 'Record', 'Archive', 'Shadow Send', 'Frame Reply', 'Contact us', 'Password', 'Note', 'Message body']) {
    assert.ok(names.includes(n), `missing ${n}: ${names.join(', ')}`);
  }
  assert.ok(!names.includes('Hidden Thing'), 'display:none elements are skipped');
  assert.equal(snap.elements.find((e) => e.name === 'Compose').region, 'top-left');
  assert.equal(snap.elements.find((e) => e.name === 'Compose').role, 'button');
  assert.equal(snap.elements.find((e) => e.name === 'Contact us').visible, false);
  assert.deepEqual(errors, []);
});

test('privacy: typed values, passwords and message bodies are never collected', async () => {
  const json = JSON.stringify(await getElements(tabId));
  for (const secret of ['hunter2', 'secret-note', 'private search text', 'Dear Mom']) {
    assert.ok(!json.includes(secret), `leaked "${secret}"`);
  }
});

test('typed command highlights the right element (offline, no API key)', async () => {
  const res = await command(tabId, 'click the compose button');
  assert.match(res.status, /✅/);
  assert.ok(near(res.highlight.rects[0], await rectOf(page, "document.getElementById('compose')")));
  assert.ok(await page.evaluate(() => !!document.getElementById('senior-helper-root')), 'overlay host present');
  await page.screenshot({ path: path.join(SHOTS, 'fixture-compose.png') });
});

test('icon-only control found by aria-label (synonym "gear")', async () => {
  const res = await command(tabId, 'click the gear');
  assert.match(res.status, /✅/);
  assert.ok(near(res.highlight.rects[0], await rectOf(page, "document.getElementById('settings')")));
});

test('spatial hint picks the right one of two identical buttons', async () => {
  const res = await command(tabId, 'the record button on the right');
  assert.ok(near(res.highlight.rects[0], await rectOf(page, "document.getElementById('recordRight')")));
});

test('ambiguous command shows a short candidate set instead of guessing', async () => {
  const res = await command(tabId, 'click record');
  assert.match(res.status, /✅/);
  assert.equal(res.highlight.count, 2);
  await page.screenshot({ path: path.join(SHOTS, 'fixture-ambiguous.png') });
});

test('open shadow DOM element is found and pointed at', async () => {
  const res = await command(tabId, 'shadow send');
  assert.ok(near(res.highlight.rects[0], await rectOf(page, "document.getElementById('widget').shadowRoot.getElementById('inner')")));
});

test('same-origin iframe element gets top-level coordinates', async () => {
  const res = await command(tabId, 'frame reply');
  const frame = await rectOf(page, "document.getElementById('frame')");
  const inner = await page.evaluate(() => {
    const r = document.getElementById('frame').contentDocument.getElementById('reply').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const expected = { left: frame.left + 2 + inner.left, top: frame.top + 2 + inner.top, width: inner.width, height: inner.height };
  assert.ok(near(res.highlight.rects[0], expected), JSON.stringify({ got: res.highlight.rects[0], expected }));
});

test('off-screen element is scrolled into view', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const res = await command(tabId, 'contact us');
  assert.match(res.status, /✅/);
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(await page.evaluate(() => window.scrollY > 500));
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('missing control reports no match and draws nothing new', async () => {
  const res = await command(tabId, 'click the print button');
  assert.match(res.status, /No matching/);
});

test('snapshot validation: re-rendered element is re-matched, removed element is rejected', async () => {
  const snap = await getElements(tabId);
  const archive = snap.elements.find((e) => e.name === 'Archive');
  // Re-render (same name/role, new node) -> re-matched
  await page.evaluate(() => { const b = document.getElementById('dynamic'); const n = b.cloneNode(true); b.replaceWith(n); });
  let res = await highlightRaw(tabId, { snapshotId: snap.snapshotId, targets: [archive], label: 'Click Archive' });
  assert.equal(res.ok, true);
  assert.equal(res.rematched, true);
  // Removed -> rejected, never points elsewhere
  await page.evaluate(() => document.getElementById('dynamic').remove());
  res = await highlightRaw(tabId, { snapshotId: snap.snapshotId, targets: [archive], label: 'Click Archive' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'target-gone');
});

test('snapshot validation: an id paired with the wrong name is refused', async () => {
  const snap = await getElements(tabId);
  const compose = snap.elements.find((e) => e.name === 'Compose');
  const res = await highlightRaw(tabId, { snapshotId: snap.snapshotId, targets: [{ ...compose, name: 'Settings' }], label: 'x' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'id-name-mismatch');
});

test('snapshot validation: unknown snapshot only resolves by exact role+name', async () => {
  const res = await highlightRaw(tabId, { snapshotId: 'zzz-v1', targets: [{ id: 'el-1', name: 'Settings', role: 'button' }], label: 'x' });
  assert.equal(res.ok, true);
  assert.ok(near(res.rects[0], await rectOf(page, "document.getElementById('settings')")));
  const none = await highlightRaw(tabId, { snapshotId: 'zzz-v1', targets: [{ id: 'el-1', name: 'Nonexistent', role: 'button' }], label: 'x' });
  assert.equal(none.ok, false);
});

test('pointer follows the element when the layout changes', async () => {
  await command(tabId, 'click the compose button');
  await page.evaluate(() => { document.querySelector('header').style.paddingTop = '120px'; });
  await new Promise((r) => setTimeout(r, 300));
  const res = await command(tabId, 'click the compose button');
  assert.ok(near(res.highlight.rects[0], await rectOf(page, "document.getElementById('compose')")));
  await page.evaluate(() => { document.querySelector('header').style.paddingTop = ''; });
});

test('clear pointer removes all highlights', async () => {
  const res = await sw((id) => chrome.tabs.sendMessage(id, { action: 'CLEAR_HIGHLIGHT' }, { frameId: 0 }), tabId);
  assert.equal(res.remaining, 0);
});

test('safety: the extension never clicked anything and never changed field values', async () => {
  assert.equal(await page.evaluate(() => window.__clicks), 0);
  assert.equal(await page.evaluate(() => document.getElementById('frame').contentWindow.__clicks), 0);
  assert.equal(await page.evaluate(() => document.getElementById('pw').value), 'hunter2');
});

test('re-injection does not duplicate listeners or overlays', async () => {
  await sw((id) => chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, files: ['src/content/loader.js'] }), tabId);
  await command(tabId, 'click the compose button');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#senior-helper-root').length), 1);
});

test('wake word: the on-device detector loads under the extension CSP and hears "Hey Jarvis"', async () => {
  const id = new URL(worker.url()).host;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Same origin and CSP as the real offscreen document.
  await page.goto(`chrome-extension://${id}/src/offscreen/offscreen.html`);
  const result = await page.evaluate(async () => {
    const { loadWakeDetector } = await import('/src/offscreen/wakeEngine.js');
    const read = async (name) => {
      const buf = await (await fetch(`/test/fixtures/audio/${name}`)).arrayBuffer();
      const pcm = new Int16Array(buf.slice(44));
      const audio = new Float32Array(pcm.length + 32000);
      for (let i = 0; i < pcm.length; i++) audio[16000 + i] = pcm[i] / 32768;
      return audio;
    };
    const run = async (name) => {
      let hits = 0;
      const det = await loadWakeDetector({ onWake: () => { hits++; } });
      const audio = await read(name);
      const t0 = performance.now();
      for (let i = 0; i < audio.length; i += 640) {
        det.push(audio.subarray(i, i + 640));
        while (det.running) await new Promise((r) => setTimeout(r, 0));
      }
      return { hits, max: det.maxScore, ms: Math.round(performance.now() - t0), seconds: audio.length / 16000 };
    };
    return { pos: await run('pos_2.wav'), neg: await run('neg_1.wav') };
  });
  await page.close();
  console.log(`#   wake word in Chrome: pos max ${result.pos.max.toFixed(3)} (${result.pos.ms} ms for ${result.pos.seconds.toFixed(1)} s audio), neg max ${result.neg.max.toFixed(3)}`);
  assert.deepEqual(errors, []);
  assert.equal(result.pos.hits, 1, 'fires once on "Hey Jarvis, click the compose button."');
  assert.equal(result.neg.hits, 0, 'stays quiet on ordinary conversation');
  assert.ok(result.pos.ms < result.pos.seconds * 1000, 'runs faster than real time');
});

/** Plays fixture clips through a second copy of the offscreen document (tab capture replaced). */
async function runOffscreen(mode, clipNames) {
  const id = new URL(worker.url()).host;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/src/offscreen/offscreen.html`);
  await page.evaluate(async (names) => {
    window.__sent = [];
    chrome.runtime.sendMessage = (msg) => { window.__sent.push(msg); return Promise.resolve(); };
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.resume();
    const decode = async (name) => ctx.decodeAudioData(await (await fetch(`/test/fixtures/audio/${name}`)).arrayBuffer());
    const parts = [];
    for (const n of names) parts.push(await decode(n));
    const gap = 0.8;
    const total = parts.reduce((n, b) => n + b.duration + gap, 0) + 2;
    const out = ctx.createBuffer(1, Math.ceil(total * ctx.sampleRate), ctx.sampleRate);
    let at = 0.5;
    for (const b of parts) { out.getChannelData(0).set(b.getChannelData(0), Math.round(at * ctx.sampleRate)); at += b.duration + gap; }
    const src = ctx.createBufferSource();
    src.buffer = out;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    window.__play = () => src.start();
    window.__totalMs = total * 1000;
  }, clipNames);
  // START_CAPTURE comes from the service worker, as in the real extension.
  const ack = await worker.evaluate((m) => chrome.runtime.sendMessage({
    target: 'offscreen', action: 'START_CAPTURE', streamId: 'fake', generation: 9999, mode: m
  }), mode);
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  const totalMs = await page.evaluate(() => { window.__play(); return window.__totalMs; });
  await new Promise((r) => setTimeout(r, totalMs + 1500));
  const sent = await page.evaluate(() => window.__sent.map((m) => ({
    action: m.action, state: m.state, reason: m.reason, wake: m.wake, durationMs: m.durationMs, bytes: m.audioBase64?.length || 0
  })));
  await worker.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', action: 'STOP_CAPTURE' }));
  await page.close();
  assert.deepEqual(errors, []);
  return sent;
}

test('wake word end to end: offscreen capture sends nothing for chat, one clip after "Hey Jarvis"', async () => {
  const sent = await runOffscreen('wake', ['neg_1.wav', 'neg_3.wav', 'pos_2.wav']);
  console.log(`#   offscreen messages (wake): ${JSON.stringify(sent)}`);
  const clips = sent.filter((m) => m.action === 'AUDIO_CLIP');
  assert.equal(clips.length, 1, 'exactly one clip: the request after the wake phrase');
  assert.equal(clips[0].wake, true);
  assert.equal(clips[0].reason, 'wake-command');
  assert.ok(clips[0].durationMs >= 2500 && clips[0].durationMs <= 6500, `clip ${clips[0].durationMs} ms`);
  assert.deepEqual(sent.filter((m) => m.action === 'WAKE_EVENT').map((m) => m.state), ['open', 'closed']);
  // Nothing at all was sent while the two chat sentences played.
  assert.equal(sent.findIndex((m) => m.action === 'WAKE_EVENT'), 0);
});

test('always-listen end to end: every sentence is sent, no wake word involved', async () => {
  const sent = await runOffscreen('clips', ['neg_1.wav', 'neg_4.wav']);
  console.log(`#   offscreen messages (always): ${JSON.stringify(sent)}`);
  const clips = sent.filter((m) => m.action === 'AUDIO_CLIP');
  // Ordinary chat (no wake phrase) is sent: overlapping clips during speech, a final one after it.
  assert.ok(clips.length >= 1, 'chat is sent without any wake phrase');
  assert.ok(clips.every((c) => c.wake === false && ['hop', 'end-of-speech'].includes(c.reason)));
  assert.equal(clips.at(-1).reason, 'end-of-speech');
  assert.equal(sent.filter((m) => m.action === 'WAKE_EVENT').length, 0);
});

test('popup: main view shows only the listening switch; the mode lives in Settings and is saved', async () => {
  await sw(() => chrome.storage.local.remove('voiceMode'));
  const id = new URL(worker.url()).host;
  const popup = await browser.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById('voice-mode').value === 'wake');
  const view = await popup.evaluate(() => ({
    mainControls: [...document.querySelectorAll('#main-view button, #main-view select, #main-view input')].map((e) => e.id),
    settingsHidden: document.getElementById('settings-view').hidden,
    privacy: document.getElementById('privacy-note').textContent
  }));
  assert.deepEqual(view.mainControls, ['listen-switch', 'open-settings']);
  assert.equal(view.settingsHidden, true);
  assert.match(view.privacy, /Nothing is shared until someone says "Hey Jarvis"/);
  await popup.evaluate(() => {
    document.getElementById('open-settings').click();
    const sel = document.getElementById('voice-mode');
    sel.value = 'clips';
    sel.dispatchEvent(new Event('change'));
    document.getElementById('save').click();
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await sw(async () => (await chrome.storage.local.get('voiceMode')).voiceMode), 'clips');
  assert.match(await popup.evaluate(() => document.getElementById('privacy-note').textContent), /your Meet audio is shared/);
  await sw(() => chrome.storage.local.remove('voiceMode'));
  assert.deepEqual(errors, []);
  await popup.close();
});

test('popup renders and reports idle state', async () => {
  const id = new URL(worker.url()).host;
  const popup = await browser.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById('status-label').textContent.includes('Not on a Meet tab'), { timeout: 5000 });
  assert.deepEqual(errors, []);
  await popup.screenshot({ path: path.join(SHOTS, 'popup.png') });
  await popup.close();
});

test('popup "Forget API key" removes the stored key', async () => {
  await sw(() => chrome.storage.local.set({ geminiApiKey: 'temporary-test-key' }));
  const id = new URL(worker.url()).host;
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById('api-key').value === 'temporary-test-key');
  await popup.evaluate(() => document.getElementById('forget-key').click());
  await popup.waitForFunction(() => document.getElementById('api-key').value === '');
  assert.equal(await sw(async () => (await chrome.storage.local.get('geminiApiKey')).geminiApiKey), undefined);
  await popup.close();
});

test('restricted pages fail gracefully', async () => {
  const p = await browser.newPage();
  await p.goto('chrome://version');
  const id = await tabIdFor('chrome://version/');
  const res = await command(id, 'click compose');
  assert.match(res.status, /does not allow/);
  await p.close();
});

// ---- Voice pipeline in the real service worker, with Gemini mocked ----
// (Covers dedupe, stale results after Stop, rate limiting and non-commands;
//  real audio capture + real Gemini need the manual procedure in README.)
async function installFakeGemini(behavior) {
  await sw(async (b) => {
    await chrome.storage.local.set({ geminiApiKey: 'test-key', model: 'gemini-2.5-flash' });
    globalThis.__realFetch ??= globalThis.fetch;
    globalThis.__fakeCalls = 0;
    globalThis.__fakeModels = [];
    globalThis.fetch = async (_url, init) => {
      globalThis.__fakeCalls++;
      const model = decodeURIComponent(String(_url).split('/models/')[1]?.split(':')[0] || '');
      globalThis.__fakeModels.push(model);
      if ((b.busyModels || []).includes(model) || b.busyModels === 'all') {
        return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 });
      }
      if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
      if (b.status) return new Response(JSON.stringify({ error: { message: 'quota', details: [{ retryDelay: '30s' }] } }), { status: b.status });
      const text = JSON.parse(init.body).contents[0].parts[0].text;
      const rows = JSON.parse(text.slice(text.lastIndexOf('\n') + 1));
      const row = rows.find((r) => r[2] === b.target);
      const answer = {
        transcript: b.transcript, isCommand: b.isCommand, intent: b.isCommand ? 'locate_element' : 'none',
        target: b.target || '', region: 'none', matchedElementId: row ? row[0] : null, confidence: 0.9, label: `Click ${b.target}`
      };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200 });
    };
  }, behavior);
}

async function fakeListening(tabId) {
  return sw(async (id) => {
    const { session } = await chrome.storage.session.get('session');
    const generation = (session?.generation || 0) + 1;
    await chrome.storage.session.set({
      session: { status: 'listening', generation, captureTabId: id, targetTabId: null, lastSeqHandled: -1, lastHighlightSeq: -1, lastTranscript: '', recentCommands: [], rateLimitedUntil: 0, detail: '' }
    });
    return generation;
  }, tabId);
}

const clip = (generation, seq) => sw((g, s) => globalThis.__seniorHelperTest.processAudioClip({
  generation: g, seq: s, audioBase64: 'UklGRg==', mimeType: 'audio/wav', capturedAt: Date.now(), durationMs: 1200
}), generation, seq);

test('voice pipeline: command clip -> pointer; overlapping repeat is deduplicated', async () => {
  await page.bringToFront();
  await installFakeGemini({ transcript: 'Mom, click the Compose button', isCommand: true, target: 'Compose' });
  const g = await fakeListening(tabId);
  const first = await clip(g, 0);
  assert.match(first.status, /✅ Pointing to: Click Compose/);
  assert.ok(near(first.highlight.rects[0], await rectOf(page, "document.getElementById('compose')")));
  const overlap = await clip(g, 1);
  assert.match(overlap.status, /Duplicate/);
  const replay = await clip(g, 1);
  assert.match(replay.status, /already-handled/);
  const old = await clip(g - 1, 2);
  assert.match(old.status, /old-session/);
});

test('voice pipeline: a repeated wake-word request is pointed at again (not deduplicated)', async () => {
  await installFakeGemini({ transcript: 'Hey Jarvis, click the Compose button', isCommand: true, target: 'Compose' });
  const g = await fakeListening(tabId);
  const wakeClip = (seq) => sw((gen, sq) => globalThis.__seniorHelperTest.processAudioClip({
    generation: gen, seq: sq, audioBase64: 'UklGRg==', mimeType: 'audio/wav', capturedAt: Date.now(), durationMs: 3000, wake: true
  }), g, seq);
  assert.match((await wakeClip(0)).status, /✅ Pointing to: Click Compose/);
  assert.match((await wakeClip(1)).status, /✅ Pointing to: Click Compose/);
});

test('voice pipeline: an overloaded model (503) falls back to another model and still points', async () => {
  await installFakeGemini({ transcript: 'Hey Jarvis, click the Compose button', isCommand: true, target: 'Compose', busyModels: ['gemini-2.5-flash'] });
  const g = await fakeListening(tabId);
  const res = await sw((gen) => globalThis.__seniorHelperTest.processAudioClip({
    generation: gen, seq: 0, audioBase64: 'UklGRg==', mimeType: 'audio/wav', capturedAt: Date.now(), durationMs: 3000, wake: true
  }), g);
  assert.match(res.status, /✅ Pointing to: Click Compose/);
  assert.deepEqual(await sw(() => globalThis.__fakeModels), ['gemini-2.5-flash', 'gemini-3.5-flash-lite']);
});

test('voice pipeline: when every model is overloaded the request fails with a clear status', async () => {
  await installFakeGemini({ busyModels: 'all' });
  const g = await fakeListening(tabId);
  const res = await sw((gen) => globalThis.__seniorHelperTest.processAudioClip({
    generation: gen, seq: 0, audioBase64: 'UklGRg==', mimeType: 'audio/wav', capturedAt: Date.now(), durationMs: 3000, wake: true
  }), g);
  assert.match(res.status, /❌ Gemini 503/);
  assert.equal(await sw(() => globalThis.__fakeCalls), 3, 'chosen model + 2 fallbacks, no endless retries');
  const state = await sw(() => globalThis.__seniorHelperTest.getState());
  assert.equal(state.status, 'listening', 'keeps listening for the next request');
});

test('voice pipeline: ordinary conversation draws nothing', async () => {
  await installFakeGemini({ transcript: 'How was your day?', isCommand: false, target: '' });
  const g = await fakeListening(tabId);
  const res = await clip(g, 0);
  assert.match(res.status, /Not a computer instruction/);
});

test('voice pipeline: result arriving after Stop is discarded', async () => {
  await installFakeGemini({ transcript: 'click settings', isCommand: true, target: 'Settings', delayMs: 600 });
  await sw((id) => chrome.tabs.sendMessage(id, { action: 'CLEAR_HIGHLIGHT' }, { frameId: 0 }), tabId);
  const g = await fakeListening(tabId);
  const pending = clip(g, 0);
  await new Promise((r) => setTimeout(r, 150));
  await sw(() => globalThis.__seniorHelperTest.stopListening());
  const res = await pending;
  assert.match(res.status, /Skipped/);
  const state = await sw(() => globalThis.__seniorHelperTest.getState());
  assert.equal(state.status, 'idle');
});

test('voice pipeline: rate limit pauses further API calls', async () => {
  await installFakeGemini({ status: 429 });
  const g = await fakeListening(tabId);
  const res = await clip(g, 0);
  assert.match(res.status, /Rate limit/);
  const next = await clip(g, 1);
  assert.match(next.status, /rate-limited/);
  assert.equal(await sw(() => globalThis.__fakeCalls), 1, 'no API call while paused');
});

test('voice pipeline: metrics are recorded', async () => {
  const state = await sw(() => globalThis.__seniorHelperTest.getState());
  assert.ok(state.metrics, 'metrics present');
  await sw(async () => {
    globalThis.fetch = globalThis.__realFetch;
    await chrome.storage.local.remove(['geminiApiKey', 'model']);
    await globalThis.__seniorHelperTest.stopListening();
  });
});

// ---- Real public websites (network required; skipped if unreachable) ----
async function realSite(t, url, cmd, expectName, shot) {
  const p = await browser.newPage();
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    t.skip(`network: could not load ${url}`);
    await p.close();
    return;
  }
  const id = await tabIdFor(p.url());
  const snap = await getElements(id);
  console.log(`  ${new URL(url).host}: ${snap.elements.length} elements in ${snap.scanMs} ms`);
  const t0 = Date.now();
  const res = await command(id, cmd);
  console.log(`  "${cmd}" -> ${res.status} (${Date.now() - t0} ms end-to-end, offline)`);
  assert.match(res.status, /✅/);
  assert.match(res.status, expectName);
  await p.screenshot({ path: path.join(SHOTS, shot) });
  assert.equal(await p.evaluate(() => document.querySelectorAll('#senior-helper-root').length), 1);
  await p.close();
}

test('real site: Wikipedia search box', (t) => realSite(t, 'https://en.wikipedia.org/wiki/Main_Page', 'click in the search box', /Click Search Wikipedia/i, 'wikipedia-search.png'));
test('real site: Wikipedia log in link', (t) => realSite(t, 'https://en.wikipedia.org/wiki/Main_Page', 'where is log in', /Log in/i, 'wikipedia-login.png'));
test('real site: example.com link', (t) => realSite(t, 'https://example.com/', 'click learn more', /Learn more|More information/i, 'example.png'));
