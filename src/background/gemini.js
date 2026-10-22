// Gemini REST client. `fetchImpl` is injectable so it can be unit tested.
import { GEMINI_ENDPOINT, GEMINI_MODEL } from '../shared/constants.js';
import { buildPrompt, cleanApiKey, parseModelJson } from './prompt.js';

export async function callGemini(
  { apiKey, input, elements, previousTranscript },
  fetchImpl = fetch
) {
  const key = cleanApiKey(apiKey);
  if (!key) throw new Error('API key is empty');

  const parts = [{ text: buildPrompt(input, elements, previousTranscript) }];
  if (input.audioBase64) {
    parts.push({ inlineData: { mimeType: input.mimeType || 'audio/wav', data: input.audioBase64 } });
  }

  const res = await fetchImpl(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || 'unknown error'}`);

  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseModelJson(text);
}
