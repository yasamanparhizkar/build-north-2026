// Measures how long Gemini takes to understand a spoken command, using the same
// code path as the extension (src/background/gemini.js) and real synthesized speech.
//
//   Windows PowerShell:  $env:GEMINI_API_KEY="your-key"; npm run voice:latency
//   macOS/Linux:         GEMINI_API_KEY=your-key npm run voice:latency
//   Options:             npm run voice:latency -- --models gemini-3.5-flash-lite,gemini-3.6-flash --runs 3
//   (see also scripts/gemini-check.mjs: one quick call per model with a status line)
//   No key / offline:    npm run voice:latency -- --dry-run     (checks the script itself with a fake API)
//
// The key is read from the environment only. It is never written anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callGemini, resetThinkingCache } from '../src/background/gemini.js';
import {
  BUSY_FALLBACK_MODELS, DEFAULT_MODEL, END_OF_SPEECH_MS, WAKE_END_OF_COMMAND_MS
} from '../src/shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const dryRun = flag('dry-run');
const runs = Number(opt('runs', 3));
const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey && !dryRun) {
  console.error('Set GEMINI_API_KEY first (see the comment at the top of this file), or use --dry-run.');
  process.exit(1);
}

// A Gmail-like screen: the model has to pick the right element, not just transcribe.
const NAMES = [
  ['button', 'Compose', 'top-left'], ['link', 'Inbox', 'middle-left'], ['link', 'Starred', 'middle-left'],
  ['link', 'Sent', 'middle-left'], ['link', 'Drafts', 'middle-left'], ['button', 'More', 'bottom-left'],
  ['searchbox', 'Search mail', 'top-center'], ['button', 'Settings', 'top-right'], ['button', 'Google apps', 'top-right'],
  ['button', 'Refresh', 'top-left'], ['button', 'Select', 'top-left'], ['button', 'Archive', 'top-center'],
  ['button', 'Delete', 'top-center'], ['button', 'Mark as read', 'top-center'], ['button', 'Snooze', 'top-center'],
  ...Array.from({ length: 25 }, (_, i) => ['button', 'Not starred', 'middle-center'][0] && ['link', `Message from sender ${i + 1}`, 'middle-center'])
];
const elements = NAMES.map(([role, name, region], i) => ({ id: `el-${i + 1}`, role, name, region, x: 0.5, y: 0.5, visible: true, enabled: true }));
const expectedId = elements.find((e) => e.name === 'Compose').id;

const clips = [
  { label: 'long ("Mom, please click the Compose button on the left.")', file: 'speech-compose.wav' },
  { label: 'short ("Click Compose.")', file: 'speech-short.wav' }
].map((c) => ({ ...c, base64: fs.readFileSync(path.join(ROOT, 'test', 'fixtures', c.file)).toString('base64'), bytes: fs.statSync(path.join(ROOT, 'test', 'fixtures', c.file)).size }));

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

function fakeFetch() {
  return async (_url, init) => {
    await new Promise((r) => setTimeout(r, 5));
    const answer = { transcript: 'click compose', isCommand: true, intent: 'locate_element', target: 'Compose', region: 'none', matchedElementId: expectedId, confidence: 0.9, label: 'Click Compose' };
    return { ok: true, status: 200, json: async () => ({ modelVersion: 'fake', candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };
  };
}

async function pickModels() {
  const given = opt('models', '');
  if (given) return given.split(',').map((s) => s.trim()).filter(Boolean);
  if (dryRun) return ['dry-run-model'];
  return [...new Set([DEFAULT_MODEL, ...BUSY_FALLBACK_MODELS])]; // what the extension itself tries, in order
}

const models = await pickModels();
console.log(`Elements sent: ${elements.length}   Runs per case: ${runs}   Wait before upload (not included below): ~${END_OF_SPEECH_MS} ms always-listen, ~${WAKE_END_OF_COMMAND_MS} ms trigger-word\n`);

const summary = [];
for (const model of models) {
  resetThinkingCache();
  for (const clip of clips) {
    const times = [];
    let ok = 0;
    let note = '';
    for (let i = 0; i < runs; i++) {
      try {
        const r = await callGemini(
          { apiKey: apiKey || 'dry-run', model, input: { audioBase64: clip.base64, mimeType: 'audio/wav' }, elements, previousTranscript: '' },
          dryRun ? { fetchImpl: fakeFetch() } : {}
        );
        times.push(r.latencyMs);
        if (r.result.matchedElementId === expectedId) ok++;
        if (i === 0) {
          note = `real model: ${r.modelVersion || r.model}, thinking: ${JSON.stringify(r.thinking)}, thought tokens: ${r.thoughtTokens}, heard: "${r.result.transcript}"`;
        }
        console.log(`  ${model} | ${clip.label.split(' ')[0]} | run ${i + 1}: ${r.latencyMs} ms${i === 0 ? '  (first call also pays connection setup and any rejected-setting retries)' : ''}`);
      } catch (e) {
        console.log(`  ${model} | ${clip.label.split(' ')[0]} | run ${i + 1}: FAILED ${e.message}`);
      }
    }
    summary.push({ model, clip: clip.label, bytes: clip.bytes, median: median(times), min: Math.min(...times), ok, runs, note });
  }
}

console.log('\n=== Summary (Gemini request only; add ~' + WAKE_END_OF_COMMAND_MS + ' ms end-of-command wait + a few ms page work) ===');
for (const s of summary) {
  console.log(`${s.model}\n   ${s.clip}: median ${s.median} ms, best ${s.min} ms, correct element ${s.ok}/${s.runs}\n   ${s.note}`);
}

