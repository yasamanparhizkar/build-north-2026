// Vision naming for controls the page never labelled. Only small crops of those controls
// are sent to Gemini (never the full screenshot), only after a command found no match,
// and each icon is named once per site: the answer is cached by origin and appearance.
import { DEFAULT_MODEL, GEMINI_API_BASE } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import { thinkingConfigFor } from './gemini.js';
import { sendToTab } from './tabs.js';

const MAX_TARGETS = 60; // controls per command, to bound the request size
const BATCH = 30; // crops per Gemini request
const CROP_PX = 96; // longest side of one crop
const PAD_PX = 4;
const TIMEOUT_MS = 15000;
const CACHE_KEY = 'visionCache';
const CACHE_MAX = 500;

const PROMPT = 'Each image is a small crop of one button or control from a web page, labelled by its id. ' +
  'For each id, give the control\'s name as a screen reader would say it, in 1 to 3 plain words ' +
  '(for example "Search", "Close", "Menu", "Share", "Play"). If you cannot tell, use "unknown". ' +
  'Answer only with the JSON list.';

const NAMES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { id: { type: 'STRING' }, name: { type: 'STRING' } },
    required: ['id', 'name']
  }
};

/** Keep only short, plain names; anything else is ignored. */
export function cleanName(raw) {
  const s = String(raw || '').replace(/[^\p{L}\p{N} '&-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 30 || /^unknown$/i.test(s) || /^unlabeled/i.test(s) || s.split(' ').length > 3) return '';
  return s;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Crop one control out of the captured page (rect in CSS px) and scale it down. */
async function cropToPng(bitmap, rect, scale) {
  const sx = Math.max(0, (rect.left - PAD_PX) * scale);
  const sy = Math.max(0, (rect.top - PAD_PX) * scale);
  const sw = Math.min(bitmap.width - sx, (rect.width + 2 * PAD_PX) * scale);
  const sh = Math.min(bitmap.height - sy, (rect.height + 2 * PAD_PX) * scale);
  if (sw < 2 || sh < 2) return null;
  const k = Math.min(1, CROP_PX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function askModel(batch, key, model) {
  const parts = [{ text: PROMPT }];
  for (const c of batch) parts.push({ text: `Control id ${c.id}:` }, { inlineData: { mimeType: 'image/png', data: c.data } });
  const generationConfig = {
    temperature: 0,
    maxOutputTokens: 1024,
    responseMimeType: 'application/json',
    responseSchema: NAMES_SCHEMA
  };
  const thinking = thinkingConfigFor(model);
  if (thinking) generationConfig.thinkingConfig = thinking;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
      signal: controller.signal
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const answers = JSON.parse(text || '[]');
    return Array.isArray(answers)
      ? answers.map((a) => ({ id: String(a?.id ?? ''), name: cleanName(a?.name) })).filter((a) => a.name)
      : [];
  } catch {
    return []; // naming is a bonus: on any failure the controls keep their "unlabeled" names
  } finally {
    clearTimeout(timer);
  }
}

async function readCache() {
  const s = await chrome.storage.local.get(CACHE_KEY);
  return s[CACHE_KEY] || {};
}

async function writeCache(cache) {
  const kept = Object.keys(cache).slice(-CACHE_MAX); // insertion order: oldest first
  await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(kept.map((k) => [k, cache[k]])) });
}

/**
 * Name the "unlabeled ..." controls of this snapshot from their pictures.
 * @returns {Promise<{snapshot: object, names: Object<string,string>}|null>} the snapshot with the new
 *   names applied, or null when there was nothing to do or naming is not possible right now.
 */
export async function nameUnlabeledControls({ tabId, snapshot, apiKey, model }) {
  const key = (apiKey || '').trim();
  if (!key) return null;
  const targets = snapshot.elements.filter((e) => e.name.startsWith('unlabeled ')).slice(0, MAX_TARGETS);
  if (!targets.length) return null;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !/^https?:/.test(tab.url)) return null;
  const origin = new URL(tab.url).origin;

  const info = await sendToTab(tabId, { action: MSG.GET_RECTS, snapshotId: snapshot.snapshotId, ids: targets.map((t) => t.id) }).catch(() => null);
  if (!info?.items) return null;

  const cache = await readCache();
  const names = {};
  const pending = [];
  for (const t of targets) {
    const item = info.items[t.id];
    if (!item) continue;
    const cached = cache[`${origin}|${item.sig}`];
    if (cached) names[t.id] = cached;
    else pending.push({ id: t.id, rect: item.rect, sig: item.sig });
  }

  // Only the active tab can be captured; otherwise keep whatever the cache already gave us.
  if (pending.length && tab.active) {
    let bitmap = null;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const scale = bitmap.width / info.vw;
      const crops = [];
      for (const p of pending) {
        const data = await cropToPng(bitmap, p.rect, scale);
        if (data) crops.push({ id: p.id, sig: p.sig, data });
      }
      for (let i = 0; i < crops.length; i += BATCH) {
        const batch = crops.slice(i, i + BATCH);
        for (const a of await askModel(batch, key, model || DEFAULT_MODEL)) {
          const crop = batch.find((c) => c.id === a.id);
          if (!crop) continue;
          names[crop.id] = a.name;
          cache[`${origin}|${crop.sig}`] = a.name;
        }
      }
      await writeCache(cache);
    } catch {
      // Capture can fail (tab just changed, restricted page): fall back to the DOM names.
    } finally {
      bitmap?.close?.();
    }
  }

  if (!Object.keys(names).length) return null;
  await sendToTab(tabId, { action: MSG.SET_NAMES, snapshotId: snapshot.snapshotId, names }).catch(() => null);
  const elements = snapshot.elements.map((e) => (names[e.id] ? { ...e, name: names[e.id], inferred: true } : e));
  return { snapshot: { ...snapshot, elements }, names };
}
