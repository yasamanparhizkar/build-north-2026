import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiError, callGemini, pickFlashModel, resetThinkingCache, thinkingConfigFor, thinkingLadder } from '../src/background/gemini.js';

const answer = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] })
});
const failure = (status, message, extra = {}) => ({ ok: false, status, json: async () => ({ error: { message, ...extra } }) });

const okAnswer = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const elements = [{ id: 'el-1', role: 'button', name: 'Compose', region: 'top-left' }];
const good = { transcript: 'click compose', isCommand: true, intent: 'locate_element', target: 'Compose', region: 'none', matchedElementId: 'el-1', confidence: 0.9, label: 'Click Compose' };

test('sends audio inline, strict schema, key header; returns validated result', async () => {
  let captured;
  const fetchImpl = async (url, init) => { captured = { url, init }; return answer(good); };
  const { result, model } = await callGemini(
    { apiKey: ' "KEY" ', model: 'gemini-2.5-flash', input: { audioBase64: 'QUJD', mimeType: 'audio/wav' }, elements },
    { fetchImpl }
  );
  assert.equal(result.matchedElementId, 'el-1');
  assert.equal(model, 'gemini-2.5-flash');
  assert.match(captured.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(captured.init.headers['x-goog-api-key'], 'KEY');
  assert.ok(!captured.url.includes('KEY'), 'key must not be in the URL');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.contents[0].parts[1].inlineData.data, 'QUJD');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.responseSchema.properties.matchedElementId);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.ok(body.systemInstruction.parts[0].text.includes('untrusted'));
});

test('a hallucinated id is dropped by validation', async () => {
  const fetchImpl = async () => answer({ ...good, matchedElementId: 'el-404' });
  const { result } = await callGemini({ apiKey: 'k', input: { text: 'x' }, elements }, { fetchImpl });
  assert.equal(result.matchedElementId, null);
});

test('retired model (404) -> picks an available Flash model via ListModels and retries', async () => {
  const calls = [];
  let resolved = null;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/models?')) {
      return { ok: true, status: 200, json: async () => ({ models: [
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
      ] }) };
    }
    if (url.includes('gemini-2.5-flash:')) return failure(404, 'models/gemini-2.5-flash is not found');
    return answer(good);
  };
  const { model } = await callGemini(
    { apiKey: 'k', model: 'gemini-2.5-flash', input: { text: 'x' }, elements },
    { fetchImpl, onModelResolved: (m) => { resolved = m; } }
  );
  assert.equal(model, 'gemini-3.5-flash');
  assert.equal(resolved, 'gemini-3.5-flash');
  assert.equal(calls.length, 3);
});

test('thinking ladder: a 2.5-backed alias walks down to budget 0, then remembers it (one failed request per model, not per command)', async () => {
  resetThinkingCache();
  const sent = [];
  const fetchImpl = async (_url, init) => {
    const tc = JSON.parse(init.body).generationConfig.thinkingConfig;
    sent.push(tc);
    if (tc?.thinkingLevel) return failure(400, 'Unknown name "thinkingLevel": Cannot find field.');
    return { ok: true, status: 200, json: async () => ({ modelVersion: 'gemini-2.5-flash', usageMetadata: { thoughtsTokenCount: 0 }, candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] }) };
  };
  const first = await callGemini({ apiKey: 'k', model: 'gemini-flash-latest', input: { text: 'x' }, elements }, { fetchImpl });
  assert.deepEqual(sent, [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }]);
  assert.deepEqual(first.thinking, { thinkingBudget: 0 });
  assert.equal(first.modelVersion, 'gemini-2.5-flash');

  sent.length = 0;
  await callGemini({ apiKey: 'k', model: 'gemini-flash-latest', input: { text: 'x' }, elements }, { fetchImpl });
  assert.deepEqual(sent, [{ thinkingBudget: 0 }], 'second command must go straight to the working setting');
});

test('thinking ladder: a model that accepts the fastest setting is used from the start', async () => {
  resetThinkingCache();
  const sent = [];
  const fetchImpl = async (_url, init) => { sent.push(JSON.parse(init.body).generationConfig.thinkingConfig); return okAnswer(good); };
  const r = await callGemini({ apiKey: 'k', model: 'gemini-3.5-flash', input: { text: 'x' }, elements }, { fetchImpl });
  assert.deepEqual(sent, [{ thinkingLevel: 'minimal' }]);
  assert.deepEqual(r.thinking, { thinkingLevel: 'minimal' });
});

test('thinking ladder: a model with no thinking support ends with no thinkingConfig', async () => {
  resetThinkingCache();
  const sent = [];
  const fetchImpl = async (_url, init) => {
    const tc = JSON.parse(init.body).generationConfig.thinkingConfig;
    sent.push(tc);
    return tc ? failure(400, 'thinking is not supported by this model') : okAnswer(good);
  };
  await callGemini({ apiKey: 'k', model: 'gemini-9-future-flash', input: { text: 'x' }, elements }, { fetchImpl });
  assert.equal(sent.at(-1), undefined);
  assert.equal(sent.length, 4, 'tries each of the 3 settings once, then none');
});

test('rate limit surfaces retry delay', async () => {
  const fetchImpl = async () => failure(429, 'quota', { details: [{ retryDelay: '12s' }] });
  await assert.rejects(
    callGemini({ apiKey: 'k', input: { text: 'x' }, elements }, { fetchImpl }),
    (e) => e instanceof GeminiError && e.kind === 'rate-limit' && e.retryAfterMs === 12000
  );
});

test('bad key is classified as auth error', async () => {
  const fetchImpl = async () => failure(400, 'API key not valid. Please pass a valid API key.');
  await assert.rejects(callGemini({ apiKey: 'k', input: { text: 'x' }, elements }, { fetchImpl }), (e) => e.kind === 'auth');
});

test('5xx is retried once, then fails', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return failure(503, 'overloaded'); };
  await assert.rejects(callGemini({ apiKey: 'k', input: { text: 'x' }, elements }, { fetchImpl }), /503/);
  assert.equal(n, 2);
});

test('timeout aborts the request', async () => {
  const fetchImpl = (_url, init) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    callGemini({ apiKey: 'k', input: { text: 'x' }, elements }, { fetchImpl, timeoutMs: 600 }),
    (e) => e.kind === 'timeout'
  );
});

test('malformed model output is rejected', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"transcript":"x"}' }] } }] }) });
  await assert.rejects(callGemini({ apiKey: 'k', input: { text: 'x' }, elements }, { fetchImpl }), /Malformed/);
});

test('empty key never touches the network', async () => {
  const fetchImpl = async () => { throw new Error('should not be called'); };
  await assert.rejects(callGemini({ apiKey: '  ', input: { text: 'x' }, elements }, { fetchImpl }), /empty/);
});

test('pickFlashModel prefers newest non-lite stable flash', () => {
  const m = (name) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] });
  assert.equal(pickFlashModel([m('gemini-2.0-flash'), m('gemini-3.1-flash-lite'), m('gemini-3.1-flash'), m('gemini-3.1-flash-image')]), 'gemini-3.1-flash');
  assert.equal(pickFlashModel([]), null);
});

test('thinkingConfigFor / thinkingLadder pick the right knob per generation', () => {
  assert.deepEqual(thinkingConfigFor('gemini-2.5-flash'), { thinkingBudget: 0 });
  assert.deepEqual(thinkingConfigFor('gemini-3.5-flash'), { thinkingLevel: 'minimal' });
  assert.equal(thinkingConfigFor('gemini-2.0-flash'), null);
  assert.deepEqual(thinkingLadder('gemini-flash-latest').at(-1), null, 'always ends with a safe fallback');
});
