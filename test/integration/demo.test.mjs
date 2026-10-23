// Spotlight module scenarios on the local demo page (no AI pipeline):
// simple buttons, navigation links, scroll containers, fixed and transformed
// elements, framework re-renders, same-origin iframes, edges, refusals,
// click-through, Escape/close, cleanup and reduced motion. Pixel-verified.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { decodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SCREENSHOT_DIR || path.join(ROOT, 'test', 'integration', 'screenshots');
const VIEW = { width: 1280, height: 800 };
const SHOWN_MS = 450;

let browser;
let page;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const demo = (fn, ...args) => page.evaluate(fn, ...args);
const show = (key, text, opts) => demo((k, t, o) => window.__demo.show(k, t, o), key, text, opts);
const state = () => demo(() => window.__demo.state());
const destroy = () => demo(() => window.__demo.destroy());
const rect = (js) => page.evaluate(`(() => { const r = (${js}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
const shot = async (name) => decodePng(await page.screenshot(name ? { path: path.join(SHOTS, name) } : {}));
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

function peak(img, r) {
  let best = 0;
  for (let i = 1; i <= 6; i++) for (let j = 1; j <= 3; j++) best = Math.max(best, img.at(r.left + (r.width * i) / 7, r.top + (r.height * j) / 4).lum);
  return best;
}
const DARK = [1100, 760]; // page background far from all targets

/** Opening matches target + 16 px, target lit, background dark. */
async function assertSpotlit(targetJs, name) {
  await sleep(SHOWN_MS);
  const s = await state();
  const r = await rect(targetJs);
  assert.ok(s.shown, 'spotlight not shown');
  const hole = s.holes[0];
  assert.ok(near(hole.left, r.left - 16) && near(hole.top, r.top - 16), `opening ${JSON.stringify(hole)} vs target ${JSON.stringify(r)}`);
  assert.ok(near(hole.width, r.width + 32) && near(hole.height, r.height + 32), 'opening size');
  const img = await shot(name);
  assert.ok(peak(img, r) >= 200, `target not lit (${peak(img, r)})`);
  return { s, r, img };
}

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: [ROOT], defaultViewport: VIEW });
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/index.js'), { timeout: 15000 });
  const id = new URL(sw.url()).host;
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/src/demo/demo.html`);
  await page.bringToFront();
  await page.waitForFunction(() => window.__demo);
});

after(async () => {
  await browser?.close();
});

test('simple button: soft spotlight, page ~82% dark, white instruction text', async () => {
  const base = await shot();
  assert.ok((await show('record', 'Click the Record button.')).ok);
  const { s, img } = await assertSpotlit("document.getElementById('record')", 'demo-record.png');
  const dark = img.at(...DARK).lum;
  const expected = base.at(...DARK).lum * 0.18;
  assert.ok(Math.abs(dark - expected) <= 12, `overlay darkness: ${base.at(...DARK).lum} -> ${dark} (expected ~${expected.toFixed(0)})`);
  assert.equal(s.label.side, 'below');
  assert.ok(s.label.visible);
});

test('navigation link at the top', async () => {
  assert.ok((await show('navSettings')).ok);
  await assertSpotlit("document.getElementById('navSettings')", 'demo-nav.png');
});

test('element inside a scroll container is scrolled into view and tracked', async () => {
  assert.ok((await show('item25')).ok);
  await assertSpotlit("document.getElementById('item25')", 'demo-scrollbox.png');
  await demo(() => { document.getElementById('scrollbox').scrollTop -= 40; });
  await sleep(150);
  const s = await state();
  const r = await rect("document.getElementById('item25')");
  assert.ok(near(s.holes[0].top, r.top - 16), 'opening did not follow the container scroll');
});

test('fixed-position element stays aligned while the page scrolls', async () => {
  await demo(() => window.scrollTo(0, 0));
  assert.ok((await show('fixedHelp')).ok);
  await assertSpotlit("document.getElementById('fixedHelp')", 'demo-fixed.png');
  await demo(() => window.scrollBy(0, 300));
  await sleep(150);
  const s = await state();
  const r = await rect("document.getElementById('fixedHelp')");
  assert.ok(near(s.holes[0].top, r.top - 16));
  assert.equal(s.label.side, 'above', 'text placed above a bottom-edge target');
  await demo(() => window.scrollTo(0, 0));
});

test('transformed (rotated/scaled) element uses its visual bounding box', async () => {
  assert.ok((await show('tilted')).ok);
  await assertSpotlit("document.getElementById('tilted')", 'demo-transformed.png');
});

test('dynamic page: spotlight survives framework re-renders of the target', async () => {
  assert.ok((await show('dynamic', 'Click Save draft.', { timeoutMs: 0 })).ok);
  await sleep(3400); // at least two re-renders
  const s = await state();
  assert.ok(s.active && s.shown, `spotlight lost on re-render (reason ${s.reason})`);
  await assertSpotlit("document.querySelector('[data-demo=\"save\"]')", 'demo-dynamic.png');
});

test('same-origin iframe content gets top-level coordinates', async () => {
  assert.ok((await show('frame')).ok);
  await sleep(SHOWN_MS);
  const s = await state();
  const r = await page.evaluate(() => {
    const f = document.getElementById('frame');
    const fr = f.getBoundingClientRect();
    const b = f.contentDocument.getElementById('frameBtn').getBoundingClientRect();
    return { left: fr.left + f.clientLeft + b.left, top: fr.top + f.clientTop + b.top, width: b.width, height: b.height };
  });
  assert.ok(near(s.holes[0].left, r.left - 16) && near(s.holes[0].top, r.top - 16), `${JSON.stringify(s.holes[0])} vs ${JSON.stringify(r)}`);
  assert.ok(peak(await shot('demo-iframe.png'), r) >= 200);
});

test('target near the viewport edge: text stays on screen and off the target', async () => {
  await demo(() => window.scrollTo(0, 0));
  assert.ok((await show('corner')).ok);
  await sleep(SHOWN_MS);
  const { label, holes } = await state();
  assert.ok(label.left >= 12 && label.left + label.width <= VIEW.width - 12, `text off screen: ${JSON.stringify(label)}`);
  const h = holes[0];
  const overlap = label.left < h.left + h.width && label.left + label.width > h.left && label.top < h.top + h.height && label.top + label.height > h.top;
  assert.ok(!overlap, 'text covers the target');
});

test('far-away target: smooth scroll first, then highlight', async () => {
  await demo(() => window.scrollTo(0, 0));
  const shown = await show('bottom');
  assert.ok(shown.ok);
  assert.ok((await demo(() => window.scrollY)) > 300, 'page did not scroll');
  await assertSpotlit("document.getElementById('bottomBtn')", 'demo-far.png');
  await demo(() => window.scrollTo(0, 0));
});

test('hidden, missing, ambiguous and invalid targets are refused and leave the page bright', async () => {
  await destroy();
  assert.deepEqual(await show('hidden'), { ok: false, reason: 'hidden' });
  assert.deepEqual(await show('missing'), { ok: false, reason: 'missing' });
  assert.deepEqual(await demo(() => window.__demo.showSelector('.btn', 'x')), { ok: false, reason: 'ambiguous' });
  assert.deepEqual(await demo(() => window.__demo.showSelector('##bad', 'x')), { ok: false, reason: 'invalid-selector' });
  assert.ok((await demo(() => window.__demo.showSelector('#send', 'Click Send.'))).ok, 'a unique selector works');
  await destroy();
  await sleep(50);
  assert.ok((await shot()).at(...DARK).lum >= 230, 'page left dark');
});

test('real clicks pass through to the target and end the guidance; never auto-clicks', async () => {
  await demo(() => { window.__clicks = {}; });
  assert.ok((await show('compose', 'Click Compose.')).ok);
  await sleep(SHOWN_MS);
  assert.deepEqual(await demo(() => window.__clicks), {}, 'spotlight clicked something by itself');
  const r = await rect("document.getElementById('compose')");
  await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
  assert.equal(await demo(() => window.__clicks.compose), 1, 'click did not reach the target');
  await sleep(450);
  const s = await state();
  assert.equal(s.active, false, 'guidance should end after the target is activated');
  assert.ok((await shot()).at(...DARK).lum >= 230);
});

test('clicks elsewhere on the page also pass through (visuals are click-through)', async () => {
  await demo(() => { window.__clicks = {}; });
  assert.ok((await show('record')).ok);
  await sleep(SHOWN_MS);
  const r = await rect("document.getElementById('send')");
  await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
  assert.equal(await demo(() => window.__clicks.send), 1);
  assert.equal((await state()).active, true, 'clicking another control must not cancel');
});

test('Escape and the close control cancel; focus is never moved', async () => {
  await demo(() => document.getElementById('instruction').focus());
  assert.ok((await show('record')).ok);
  await sleep(SHOWN_MS);
  assert.equal(await demo(() => document.activeElement.id), 'instruction', 'focus moved by spotlight');
  await page.keyboard.press('Escape');
  await sleep(300);
  assert.equal((await state()).active, false, 'Escape did not close');

  assert.ok((await show('record')).ok);
  await sleep(SHOWN_MS);
  const { label } = await state();
  await page.mouse.click(label.left + label.width - 14, label.top + label.height / 2); // close "×"
  await sleep(300);
  assert.equal((await state()).active, false, 'close control did not close');
  assert.ok((await shot()).at(...DARK).lum >= 230);
});

test('resize keeps the opening and text aligned', async () => {
  assert.ok((await show('record')).ok);
  await page.setViewport({ width: 900, height: 650 });
  await sleep(250);
  const s = await state();
  const r = await rect("document.getElementById('record')");
  assert.ok(near(s.holes[0].left, r.left - 16) && near(s.holes[0].top, r.top - 16));
  assert.ok(s.label.left + s.label.width <= 900 - 12);
  await page.setViewport(VIEW);
  await destroy();
});

test('rapid re-highlighting never stacks overlays and cleans up fully', async () => {
  for (const k of ['record', 'compose', 'send', 'record', 'navSettings', 'record']) await show(k);
  await sleep(SHOWN_MS);
  const once = (await shot()).at(...DARK).lum;
  assert.ok(once <= 60, 'overlay missing');
  await destroy();
  assert.ok((await show('record')).ok);
  await sleep(SHOWN_MS);
  assert.ok(Math.abs((await shot()).at(...DARK).lum - once) <= 3, 'overlays stacked');
  await destroy();
  await sleep(50);
  assert.equal((await state()).active, false);
  assert.ok((await shot()).at(...DARK).lum >= 230, 'leftover overlay after destroy');
});

test('reduced motion: final state immediately, no fade', async () => {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await show('record');
  await sleep(80);
  assert.ok((await shot()).at(...DARK).lum <= 60, 'still fading under reduced motion');
  await destroy();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
});

test('no page errors during all scenarios', () => {
  assert.deepEqual(errors, []);
});

