// Viewport-only element list, no caps, descriptive names for unlabeled controls, and scroll hints.
// Runs in the same Chrome-for-Testing setup as extension.test.mjs. Run with: npm run test:integration
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

let browser;
let worker;
let server;
let base;
let page;
let tabId;

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

const sw = (fn, ...args) => worker.evaluate(fn, ...args);

async function tabIdFor(url) {
  return sw(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
}

async function getElements(id) {
  for (let i = 0; i < 40; i++) {
    const res = await sw(async (tab) => {
      try {
        return await chrome.tabs.sendMessage(tab, { action: 'GET_ELEMENTS' }, { frameId: 0 });
      } catch {
        return null;
      }
    }, id);
    if (res) return res;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('content script never answered');
}

const command = (id, text) => sw((tab, t) => globalThis.__seniorHelperTest.processText(t, { tabId: tab }), id, text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  base = await serve();
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ROOT],
    args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
    defaultViewport: { width: 1280, height: 800 }
  });
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/index.js'), { timeout: 15000 });
  worker = await target.worker();
  for (let i = 0; i < 100; i++) {
    const ready = await worker.evaluate(() => typeof chrome.tabs === 'object' && typeof globalThis.__seniorHelperTest === 'object').catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  page = await browser.newPage();
  await page.goto(`${base}/viewport.html`, { waitUntil: 'load' });
  tabId = await tabIdFor(page.url());
});

after(async () => {
  await browser?.close();
  server?.close();
});

test('every visible control is listed, even 240 identical ones (no cap)', async () => {
  const snap = await getElements(tabId);
  const same = snap.elements.filter((e) => e.name === 'Not starred');
  assert.equal(same.length, 240);
  assert.ok(!snap.elements.some((e) => e.name === 'Far away'), 'off-screen control is not listed');
});

test('icon-only, link and nearby controls get descriptive names and are flagged as inferred', async () => {
  const snap = await getElements(tabId);
  const byName = (n) => snap.elements.find((e) => e.name === n);
  assert.ok(byName('Search')?.inferred, 'icon from class name');
  assert.ok(byName('Close')?.inferred, 'Lucide close icon');
  assert.ok(byName('Cart')?.inferred, 'name from link destination');
  assert.ok(byName('button near "Quarterly report"'), 'name from nearby text');
  assert.equal(byName('Not starred').inferred, false, 'real labels are not marked as inferred');
});

test('a control with no clue at all keeps a fallback name', async () => {
  const mystery = await browser.newPage();
  await mystery.goto(`${base}/unlabeled.html`, { waitUntil: 'load' });
  const id = await tabIdFor(mystery.url());
  const snap = await getElements(id);
  assert.ok(snap.elements.some((e) => e.name === 'unlabeled button'), JSON.stringify(snap.elements));
  await mystery.close();
});

test('a typed name finds an icon-only control by its inferred name', async () => {
  const res = await command(tabId, 'search');
  assert.match(res.status, /Pointing to/);
  await sleep(200);
});

test('"scroll down" with no scroll control on the page shows a hint at the scroll edge', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const res = await command(tabId, 'scroll down');
  assert.equal(res.highlight.where, 'edge');
  assert.match(res.highlight.text, /^Scroll down\./, 'the hint says what to do');
  await sleep(300);
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('"scroll up" points at the on-page "Back to top" control when there is one', async () => {
  await page.evaluate(() => window.scrollTo(0, 1000));
  await sleep(200);
  const res = await command(tabId, 'scroll up');
  assert.equal(res.highlight.where, 'control');
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('"scroll down" at the bottom of the page says so instead of pointing', async () => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(200);
  const res = await command(tabId, 'scroll down');
  assert.match(res.status, /at-end/);
  await page.evaluate(() => window.scrollTo(0, 0));
});
