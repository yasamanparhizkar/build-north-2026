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
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--window-size=1280,900'],
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

test('popup renders and reports idle state', async () => {
  const id = new URL(worker.url()).host;
  const popup = await browser.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById('state').textContent.includes('Not listening'), { timeout: 5000 });
  assert.deepEqual(errors, []);
  await popup.screenshot({ path: path.join(SHOTS, 'popup.png') });
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
    globalThis.fetch = async (_url, init) => {
      globalThis.__fakeCalls++;
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
