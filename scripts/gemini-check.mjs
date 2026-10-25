// Calls Gemini exactly like the extension does (src/background/gemini.js), with a
// real recording, once per model, and prints status + time. Nothing is changed.
//
// Usage (from the repo folder):
//   read -s GEMINI_API_KEY && export GEMINI_API_KEY   # paste the key, press Enter (not shown, not saved)
//   node scripts/gemini-check.mjs
//   node scripts/gemini-check.mjs gemini-3.5-flash-lite   # only this model
import fs from 'node:fs';
import { callGemini } from '../src/background/gemini.js';
import { BUSY_FALLBACK_MODELS, DEFAULT_MODEL, GEMINI_ATTEMPT_TIMEOUT_MS, GEMINI_TIMEOUT_MS } from '../src/shared/constants.js';

const key = process.env.GEMINI_API_KEY || '';
if (!key) {
  console.error('GEMINI_API_KEY is not set. Run:  read -s GEMINI_API_KEY && export GEMINI_API_KEY');
  process.exit(1);
}

// A Gmail-like button list, in the same shape the content script sends.
const names = ['Compose', 'Inbox', 'Starred', 'Snoozed', 'Sent', 'Drafts', 'Search mail', 'Settings', 'Google apps', 'Refresh', 'More', 'Main menu'];
const elements = names.map((name, i) => ({
  id: `el-${i + 1}`, role: name === 'Search mail' ? 'searchbox' : 'button', name, region: i < 6 ? 'left' : 'top-right', x: 0.1, y: 0.1 + i * 0.05, visible: true, enabled: true
}));

const wav = fs.readFileSync('test/fixtures/audio/pos_2.wav'); // "Hey Jarvis, click the compose button."
const audio = { audioBase64: wav.toString('base64'), mimeType: 'audio/wav', durationMs: Math.round(((wav.length - 44) / 32000) * 1000), wake: true };

const models = process.argv[2] ? [process.argv[2]] : [...new Set(['gemini-flash-latest', DEFAULT_MODEL, ...BUSY_FALLBACK_MODELS])];

async function once(label, model, input) {
  const t0 = Date.now();
  try {
    // No fallbacks and a long timeout: we want each model's own behaviour and real time.
    const out = await callGemini({ apiKey: key, model, input, elements }, { fallbackModels: [], timeoutMs: 60000, attemptTimeoutMs: 60000 });
    const r = out.result;
    const picked = elements.find((e) => e.id === r.matchedElementId)?.name || '(none)';
    console.log(`OK    ${model.padEnd(24)} ${label.padEnd(5)} ${String(Date.now() - t0).padStart(6)} ms  -> ${picked}  | heard: "${r.transcript}" | command: ${r.isCommand}`);
  } catch (e) {
    console.log(`FAIL  ${model.padEnd(24)} ${label.padEnd(5)} ${String(Date.now() - t0).padStart(6)} ms  -> ${e.kind || 'error'}: ${String(e.message).slice(0, 140)}`);
  }
}

console.log(`Clip: ${audio.durationMs} ms of audio, ${elements.length} buttons. The extension waits ${GEMINI_ATTEMPT_TIMEOUT_MS} ms per model, ${GEMINI_TIMEOUT_MS} ms in total.\n`);
for (const model of models) {
  await once('text', model, { text: 'click the compose button' });
  await once('audio', model, audio);
}
