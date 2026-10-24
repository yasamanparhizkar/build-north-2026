// Gemini REST client with structured output, timeouts, model fallback and
// bounded retries. `fetchImpl` is injectable for unit tests.
import { DEFAULT_MODEL, GEMINI_API_BASE, GEMINI_TIMEOUT_MS } from '../shared/constants.js';
import {
  RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, buildUserPrompt, cleanApiKey, parseModelJson, validateModelResult
} from './prompt.js';

export class GeminiError extends Error {
  constructor(message, { status = 0, kind = 'api', retryAfterMs = 0 } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // 'auth' | 'rate-limit' | 'timeout' | 'not-found' | 'api' | 'network'
    this.retryAfterMs = retryAfterMs;
  }
}

/** Choose a model from a ListModels response: newest non-lite Flash that supports generateContent. */
export function pickFlashModel(models) {
  const usable = (models || []).filter(
    (m) => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/.test(m.name) &&
      !/(image|tts|audio|live|embedding|thinking-exp)/.test(m.name)
  );
  const version = (name) => parseFloat((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const rank = (m) => version(m.name) * 10 - (/lite/.test(m.name) ? 1 : 0) - (/preview|exp/.test(m.name) ? 0.5 : 0);
  usable.sort((a, b) => rank(b) - rank(a));
  return usable[0] ? usable[0].name.replace(/^models\//, '') : null;
}

/** Thinking adds latency; turn it down. Gemini 2.5 uses a token budget, 3.x+ uses levels. */
export function thinkingConfigFor(model) {
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-[3-9]/.test(model) || /latest/.test(model)) return { thinkingLevel: 'low' };
  return null;
}

function parseRetryAfter(data) {
  const details = data?.error?.details || [];
  for (const d of details) {
    if (d.retryDelay) return Math.ceil(parseFloat(d.retryDelay) * 1000) || 0;
  }
  return 0;
}

async function postJson(url, key, body, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    return { res, data };
  } catch (e) {
    if (e.name === 'AbortError') throw new GeminiError('Gemini request timed out', { kind: 'timeout' });
    throw new GeminiError(`Network error: ${e.message}`, { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

function toError(res, data, model) {
  const msg = data?.error?.message || `HTTP ${res.status}`;
  if (res.status === 429) {
    return new GeminiError(`Rate limit or quota reached: ${msg}`, { status: 429, kind: 'rate-limit', retryAfterMs: parseRetryAfter(data) || 30000 });
  }
  if (res.status === 401 || res.status === 403 || /API key/i.test(msg)) {
    return new GeminiError(`API key rejected: ${msg}`, { status: res.status, kind: 'auth' });
  }
  if (res.status === 404) return new GeminiError(`Model "${model}" not found`, { status: 404, kind: 'not-found' });
  return new GeminiError(`Gemini ${res.status}: ${msg}`, { status: res.status, kind: 'api' });
}

export async function listFlashModel(key, fetchImpl) {
  const res = await fetchImpl(`${GEMINI_API_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw toError(res, data, 'list');
  return pickFlashModel(data.models);
}

/**
 * @param {{apiKey: string, model?: string, input: {audioBase64?: string, mimeType?: string, text?: string},
 *          elements: Array<object>, previousTranscript?: string}} req
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, onModelResolved?: (m: string) => void}} [opts]
 * @returns {Promise<{result: object, model: string, latencyMs: number}>}
 */
export async function callGemini(req, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || GEMINI_TIMEOUT_MS;
  const key = cleanApiKey(req.apiKey);
  if (!key) throw new GeminiError('API key is empty', { kind: 'auth' });

  let model = (req.model || '').trim() || DEFAULT_MODEL;
  let useThinking = true;
  let retriedServer = false;
  let resolvedModel = false;
  const started = Date.now();

  const parts = [{ text: buildUserPrompt(req.input, req.elements, req.previousTranscript) }];
  if (req.input.audioBase64) {
    parts.push({ inlineData: { mimeType: req.input.mimeType || 'audio/wav', data: req.input.audioBase64 } });
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const generationConfig = {
      temperature: 0.1,
      maxOutputTokens: 400,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    };
    const thinking = useThinking ? thinkingConfigFor(model) : null;
    if (thinking) generationConfig.thinkingConfig = thinking;

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 500) throw new GeminiError('Gemini request timed out', { kind: 'timeout' });

    const { res, data } = await postJson(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      key,
      { systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }, contents: [{ role: 'user', parts }], generationConfig },
      { fetchImpl, timeoutMs: remaining }
    );

    if (res.ok) {
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new GeminiError(`Empty response (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'unknown'})`);
      const ids = new Set(req.elements.map((e) => e.id));
      return { result: validateModelResult(parseModelJson(text), ids), model, latencyMs: Date.now() - started };
    }

    const err = toError(res, data, model);
    // 1) Unknown thinking parameter for this model -> retry without it.
    if (res.status === 400 && useThinking && /thinking/i.test(data?.error?.message || '')) {
      useThinking = false;
      continue;
    }
    // 2) Model retired / unknown -> pick an available Flash model once.
    if (err.kind === 'not-found' && !resolvedModel) {
      resolvedModel = true;
      const picked = await listFlashModel(key, fetchImpl);
      if (!picked || picked === model) throw err;
      model = picked;
      opts.onModelResolved?.(picked);
      continue;
    }
    // 3) Transient server error -> one quick retry.
    if (res.status >= 500 && !retriedServer) {
      retriedServer = true;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    throw err;
  }
  throw new GeminiError('Gemini request failed after retries');
}
