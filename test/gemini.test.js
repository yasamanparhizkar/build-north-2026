import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callGemini } from '../src/background/gemini.js';

const okResponse = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] })
});

test('callGemini sends audio inline with the key header and parses the reply', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return okResponse({ transcript: 'hi', isCommand: false, matchedId: null, label: '' });
  };

  const result = await callGemini(
    { apiKey: ' "KEY" ', input: { audioBase64: 'QUJD', mimeType: 'audio/wav' }, elements: [], previousTranscript: '' },
    fetchImpl
  );

  assert.equal(result.transcript, 'hi');
  assert.match(captured.url, /generateContent$/);
  assert.equal(captured.init.headers['x-goog-api-key'], 'KEY');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.contents[0].parts[1].inlineData.data, 'QUJD');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('callGemini surfaces API errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) });
  await assert.rejects(
    callGemini({ apiKey: 'k', input: { text: 'x' }, elements: [] }, fetchImpl),
    /Gemini 429: quota/
  );
});

test('callGemini rejects an empty key without calling the network', async () => {
  const fetchImpl = async () => { throw new Error('should not be called'); };
  await assert.rejects(callGemini({ apiKey: '  ', input: { text: 'x' }, elements: [] }, fetchImpl), /empty/);
});
