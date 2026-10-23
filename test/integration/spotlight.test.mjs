// Visual verification of the spotlight overlay in real Chrome.
// Decodes screenshots and checks real pixel brightness: the target must stay
// bright inside the opening while the rest of the page is darkened.
// Run with: npm run test:integration
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { decodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const SHOTS = process.env.SCREENSHOT_DIR || path.join(ROOT, 'test', 'integration', 'screenshots');
const VIEW = { width: 1280, height: 800 };
const FADE_MS = 450; // overlay fade-in is 260 ms

let browser;
let worker;
let server;
let page;
let tabId;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = (fn, ...args) => worker.evaluate(fn, ...args);
const send = (msg) => sw((id, m) => chrome.tabs.sendMessage(id, m, { frameId: 0 }), tabId, msg);
const command = (text) => sw((id, t) => globalThis.__seniorHelperTest.processText(t, { tabId: id }), tabId, text);
const clear = () => send({ action: 'CLEAR_HIGHLIGHT' });
const rectOf = (sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}, sel);

async function shot(name) {
  const png = await page.screenshot(name ? { path: path.join(SHOTS, name) } : {});
  return decodePng(png);
}

/** Brightest pixel on a grid inside the element (robust to dark text glyphs). */
function peak(img, r) {
  let best = 0;
  for (let i = 1; i <= 6; i++) {
    for (let j = 1; j <= 3; j++) {
      best = Math.max(best, img.at(r.left + (r.width * i) / 7, r.top + (r.height * j) / 4).lum);
    }
  }
  return best;
}
const FAR = [640, 620]; // empty white area of the fixture

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ROOT], // supported loader (the --load-extension flag is being phased out)
    args: ['--window-size=1280,900'],
    defaultViewport: VIEW
  });
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/index.js'), { timeout: 15000 });
  worker = await target.worker();
  for (let i = 0; i < 100; i++) {
    if (await worker.evaluate(() => typeof chrome.tabs === 'object' && typeof globalThis.__seniorHelperTest === 'object').catch(() => false)) break;
    await sleep(100);
  }
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'load' });
  await page.bringToFront(); // rAF only runs in the foreground tab
  tabId = await sw(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());
  for (let i = 0; i < 40; i++) {
    if (await send({ action: 'CLEAR_HIGHLIGHT' }).then(() => true).catch(() => false)) break;
    await sleep(150);
  }
});

after(async () => {
  await browser?.close();
  server?.close();
});

test('spotlight: target stays at normal brightness while the page is darkened', async () => {
  await clear();
  const compose = await rectOf('#compose');
  const base = await shot();
  const baseInside = { lum: peak(base, compose) };
  const baseFar = base.at(...FAR);

  const res = await command('click the compose button');
  assert.match(res.status, /✅/);
  await sleep(FADE_MS);
  const img = await shot('spotlight-single.png');

  const inside = { lum: peak(img, compose) };
  const far = img.at(...FAR);
  assert.ok(Math.abs(inside.lum - baseInside.lum) <= 12, `target dimmed: ${baseInside.lum} -> ${inside.lum}`);
  assert.ok(far.lum <= baseFar.lum * 0.3, `page not darkened enough: ${baseFar.lum} -> ${far.lum}`);
  assert.ok(far.lum >= 15, 'page should be charcoal, not black');

  const ui = res.highlight.ui;
  assert.equal(ui.backdrops, 1);
  assert.equal(ui.backdropVisible, true);
  assert.equal(ui.halos.length, 1);
  assert.ok(ui.halos[0].visible, 'halo visible');
  // Opening = target + 16 px padding on every side
  assert.ok(Math.abs(ui.halos[0].left - (compose.left - 16)) <= 2);
  assert.ok(Math.abs(ui.halos[0].width - (compose.width + 32)) <= 2);
});

test('spotlight: floating white text (no box) and a soft feathered, warm edge', async () => {
  await clear();
  const res = await command('click archive');
  await sleep(FADE_MS);
  const img = await shot('spotlight-text.png');
  const label = res.highlight.ui.label;
  assert.ok(label?.visible, 'instruction text visible');

  // Text is white on the darkened page: bright glyph pixels AND dark gaps (no panel behind it).
  let max = 0;
  let min = 255;
  for (let x = label.left + 2; x < label.left + label.width - 34; x += 2) {
    for (let y = label.top + 2; y < label.top + label.height - 2; y += 2) {
      const l = img.at(x, y).lum;
      max = Math.max(max, l);
      min = Math.min(min, l);
    }
  }
  assert.ok(max >= 235, `no white text (max lum ${max})`);
  assert.ok(min <= 80, `a background panel is behind the text (min lum ${min})`);

  // Feathered edge: brightness rises gradually across the opening's edge, not in one step.
  const [hole] = res.highlight.ui.halos;
  const edgeX = hole.left + hole.width;
  const y = hole.top + hole.height / 2;
  const outside = img.at(edgeX + 26, y).lum;
  const edge = img.at(edgeX, y).lum;
  const inner = img.at(edgeX - 7, y).lum;
  assert.ok(outside < edge && edge < inner, `not a gradient: ${outside} / ${edge} / ${inner}`);
  assert.ok(edge - outside >= 15 && inner - edge >= 15, `hard edge: ${outside} / ${edge} / ${inner}`);
  const warm = img.at(edgeX + 6, y);
  assert.ok(warm.r >= warm.b, `glow should be warm-white, got ${JSON.stringify(warm)}`);
});

test('spotlight: follows the target on scroll and on resize', async () => {
  await clear();
  await command('click archive');
  await sleep(FADE_MS);
  await page.evaluate(() => window.scrollBy(0, 50));
  await sleep(250);
  let archive = await rectOf('#dynamic');
  let img = await shot('spotlight-scrolled.png');
  let ui = (await send({ action: 'INDICATOR', listening: false })).ui;
  assert.ok(Math.abs(ui.halos[0].top - (archive.top - 16)) <= 2, `halo ${ui.halos[0].top} vs target ${archive.top}`);
  assert.ok(peak(img, archive) >= 200, 'target bright after scroll');

  await page.setViewport({ width: 900, height: 700 });
  await sleep(300);
  archive = await rectOf('#dynamic');
  img = await shot('spotlight-resized.png');
  ui = (await send({ action: 'INDICATOR', listening: false })).ui;
  assert.ok(Math.abs(ui.halos[0].left - (archive.left - 16)) <= 2, `halo ${ui.halos[0].left} vs target ${archive.left}`);
  assert.ok(peak(img, archive) >= 200, 'target bright after resize');
  assert.ok(img.at(450, 600).lum <= 80, 'page still dark after resize');

  await page.setViewport(VIEW);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
});

test('spotlight: clearing removes all spotlight UI and the page is bright again', async () => {
  await command('click the compose button');
  await sleep(FADE_MS);
  const res = await clear();
  assert.equal(res.ui.backdrops, 0);
  assert.equal(res.ui.halos.length, 0);
  assert.equal(res.ui.cards.length, 0);
  await sleep(50);
  assert.ok((await shot()).at(...FAR).lum >= 240);
});

test('spotlight: repeated highlighting never stacks overlays', async () => {
  await clear();
  await command('click the compose button');
  await sleep(FADE_MS);
  const once = (await shot()).at(...FAR).lum;
  await command('click the compose button');
  const res = await command('click the compose button');
  await sleep(FADE_MS);
  assert.equal(res.highlight.ui.backdrops, 1);
  assert.equal(res.highlight.ui.halos.length, 1);
  assert.ok(Math.abs((await shot()).at(...FAR).lum - once) <= 4, 'overlay got darker: stacked layers');
});

test('spotlight: invalid, removed or hidden targets never leave the page dark', async () => {
  await clear();
  const bad = await send({ action: 'HIGHLIGHT', snapshotId: 'nope-v1', targets: [{ id: 'el-1', name: 'Does not exist', role: 'button' }], label: 'x' });
  assert.equal(bad.ok, false);
  assert.ok((await shot()).at(...FAR).lum >= 240, 'page dark after invalid target');

  // Target hidden while shown -> dimming is lifted until it is visible again
  await command('click archive');
  await sleep(FADE_MS);
  await page.evaluate(() => { document.getElementById('dynamic').style.display = 'none'; });
  await sleep(250);
  assert.ok((await shot()).at(...FAR).lum >= 240, 'page dark while target hidden');
  await page.evaluate(() => { document.getElementById('dynamic').style.display = ''; });
  await sleep(250);
  assert.ok((await shot()).at(...FAR).lum <= 80, 'dimming back when target visible');

  // Target removed while shown -> everything is cleaned up
  await page.evaluate(() => { const b = document.getElementById('dynamic'); b.dataset.keep = b.outerHTML; b.remove(); });
  await sleep(300);
  const ui = (await clear()).ui;
  assert.equal(ui.backdrops, 0);
  assert.ok((await shot()).at(...FAR).lum >= 240, 'page dark after target removed');
  await page.evaluate(() => {
    const row = document.querySelector('.row');
    row.insertBefore(Object.assign(document.createElement('button'), { id: 'dynamic', textContent: 'Archive' }), row.children[1]);
  });
});

test('spotlight: multiple candidates each get an opening', async () => {
  await clear();
  const res = await command('click record');
  await sleep(FADE_MS);
  const img = await shot('spotlight-candidates.png');
  assert.equal(res.highlight.ui.halos.length, 2);
  assert.equal(res.highlight.ui.cards.length, 1, 'one instruction for the candidate set');
  for (const sel of ['#recordLeft', '#recordRight']) {
    assert.ok(peak(img, await rectOf(sel)) >= 200, `${sel} dimmed`);
  }
  assert.ok(img.at(...FAR).lum <= 80);
});

test('spotlight: target near the bottom edge is scrolled in and opened', async () => {
  await clear();
  await page.evaluate(() => window.scrollTo(0, 0));
  await command('contact us');
  await sleep(1200); // smooth scroll + fade
  const link = await rectOf('#footer');
  const ui = (await send({ action: 'INDICATOR', listening: false })).ui;
  assert.ok(ui.backdropVisible);
  assert.ok(link.top >= 0 && link.top + link.height <= VIEW.height, 'target not scrolled fully into view');
  assert.ok(ui.halos[0].top < VIEW.height && ui.halos[0].top + ui.halos[0].height > 0, 'opening not on screen');
  assert.ok((await shot('spotlight-edge.png')).at(link.left + 3, link.top + link.height / 2).lum >= 150, 'link not lit');
  await clear();
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('spotlight: listening indicator and Stop stay usable; page clicks pass through', async () => {
  await clear();
  const shown = await send({ action: 'INDICATOR', listening: true });
  const stop = shown.ui.stopButton;
  assert.ok(stop, 'stop button rendered');
  await command('click the compose button');
  await sleep(FADE_MS);
  const img = await shot('spotlight-indicator.png');
  assert.ok(img.at(stop.left + 4, stop.top + stop.height / 2).lum >= 230, 'Stop button darkened by overlay');
  const pill = img.at(stop.left - 5, stop.top + stop.height / 2); // gap between label and button
  assert.ok(pill.r >= 180 && pill.g <= 90, `indicator pill darkened: ${JSON.stringify(pill)}`);

  // A real user click on the highlighted button reaches the page (overlay is click-through).
  const before = await page.evaluate(() => window.__clicks);
  const compose = await rectOf('#compose');
  await page.mouse.click(compose.left + compose.width / 2, compose.top + compose.height / 2);
  assert.equal(await page.evaluate(() => window.__clicks), before + 1);

  // The Stop button receives clicks above the overlay.
  await page.mouse.click(stop.left + stop.width / 2, stop.top + stop.height / 2);
  await sleep(100);
  const after = await clear();
  assert.equal(after.ui.stopButton, null, 'Stop click did not reach the indicator');
});

test('spotlight: reduced motion shows the final state immediately', async () => {
  await clear();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await command('click the compose button');
  await sleep(40);
  assert.ok((await shot()).at(...FAR).lum <= 80, 'overlay still animating under reduced motion');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await clear();
});

// ---- Optional Driver.js renderer (popup -> Settings -> Pointer style) ----
const setStyle = (style) => sw((s) => chrome.storage.local.set({ pointerStyle: s }), style);
const driverDom = () => page.evaluate(() => ({
  overlay: document.querySelectorAll('.driver-overlay').length,
  popover: (() => {
    const p = document.querySelector('.driver-popover');
    return p && getComputedStyle(p).display !== 'none' ? p.textContent : null;
  })(),
  active: document.body.classList.contains('driver-active'),
  focused: document.activeElement?.id || document.activeElement?.tagName
}));

test('driver.js mode: target lit, page dark, floating text (no Driver.js popover), focus untouched', async () => {
  await clear();
  await page.evaluate(() => document.getElementById('note').focus());
  await setStyle('driver');
  const compose = await rectOf('#compose');
  const res = await command('click the compose button');
  assert.match(res.status, /✅/);
  assert.equal(res.highlight.renderer, 'driver');
  await sleep(900); // Driver.js animation
  const img = await shot('driver-single.png');
  assert.ok(peak(img, compose) >= 200, 'target dimmed in driver mode');
  assert.ok(img.at(...FAR).lum <= 80, `page not darkened: ${img.at(...FAR).lum}`);
  const dom = await driverDom();
  assert.equal(dom.overlay, 1);
  assert.equal(dom.popover, null, 'Driver.js default popover must not be used');
  const label = res.highlight.ui.driverLabel;
  assert.ok(label?.visible, 'floating instruction text shown');
  let max = 0;
  for (let x = label.left + 2; x < label.left + label.width - 34; x += 2) max = Math.max(max, img.at(x, label.top + label.height / 2).lum);
  assert.ok(max >= 235, `instruction text not white (max ${max})`);
  assert.equal(dom.focused, 'note', 'Driver.js must not steal focus');
  assert.equal(res.highlight.ui.backdrops, 0, 'built-in spotlight not shown at the same time');
});

test('driver.js mode: labels are rendered as text, never as HTML', async () => {
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'xss';
    b.setAttribute('aria-label', 'Zebra <img src=x onerror="window.__xss=1">');
    b.textContent = 'z';
    document.querySelector('.row').appendChild(b);
  });
  await command('zebra');
  await sleep(700);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'label executed as HTML');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.driver-popover').length), 0);
  await page.evaluate(() => document.getElementById('xss').remove());
  await sleep(400);
});

test('driver.js mode: clear, repeat and removed target all clean up', async () => {
  await command('click the compose button');
  await command('click the compose button');
  await sleep(700);
  assert.equal((await driverDom()).overlay, 1, 'stacked Driver.js overlays');
  const cleared = await clear();
  assert.equal(cleared.ui.driverActive, false);
  await sleep(400);
  let dom = await driverDom();
  assert.equal(dom.overlay, 0);
  assert.equal(dom.active, false);
  assert.ok((await shot()).at(...FAR).lum >= 240, 'page dark after clear');

  await command('click archive');
  await sleep(700);
  await page.evaluate(() => document.getElementById('dynamic').remove());
  await sleep(700);
  dom = await driverDom();
  assert.equal(dom.overlay, 0, 'overlay left after target removed');
  assert.ok((await shot()).at(...FAR).lum >= 240, 'page dark after target removed');
  await page.evaluate(() => {
    const row = document.querySelector('.row');
    row.insertBefore(Object.assign(document.createElement('button'), { id: 'dynamic', textContent: 'Archive' }), row.children[1]);
  });
});

test('driver.js mode: multiple candidates fall back to the built-in spotlight', async () => {
  const res = await command('click record');
  assert.equal(res.highlight.renderer, 'spotlight');
  assert.equal(res.highlight.ui.halos.length, 2);
  assert.equal((await driverDom()).overlay, 0);
  await clear();
  await setStyle('spotlight');
});

test('spotlight on a real site: Wikipedia search box is lit, page is dark', async (t) => {
  const p = await browser.newPage();
  try {
    await p.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    t.skip('network: Wikipedia unreachable');
    await p.close();
    return;
  }
  await p.bringToFront();
  const id = await sw(async (u) => (await chrome.tabs.query({})).find((x) => x.url === u)?.id, p.url());
  const base = decodePng(await p.screenshot());
  const whiteSpots = [[1150, 650], [20, 780]].filter(([x, y]) => base.at(x, y).lum >= 240); // empty page background
  let res;
  for (let i = 0; i < 20 && !res?.highlight; i++) {
    res = await sw((tid) => globalThis.__seniorHelperTest.processText('click in the search box', { tabId: tid }), id).catch(() => null);
    if (!res?.highlight) await sleep(200);
  }
  assert.match(res.status, /✅/);
  await sleep(FADE_MS);
  const img = decodePng(await p.screenshot({ path: path.join(SHOTS, 'spotlight-wikipedia.png') }));
  const box = res.highlight.rects[0];
  assert.ok(peak(img, box) >= 200, 'search box dimmed');
  assert.ok(whiteSpots.length > 0, 'no white background found to compare');
  for (const [x, y] of whiteSpots) assert.ok(img.at(x, y).lum <= 80, `page not darkened at ${x},${y}: ${img.at(x, y).lum}`);
  await p.close();
});

