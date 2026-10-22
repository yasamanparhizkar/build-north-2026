// Pure helpers for building the Gemini prompt and parsing its answer (no Chrome APIs).

/** Strip whitespace and surrounding quotes that often sneak in when pasting a key. */
export function cleanApiKey(rawKey) {
  return (rawKey || '').trim().replace(/^["']|["']$/g, '');
}

/**
 * @param {{audioBase64?: string, text?: string}} input
 * @param {Array<object>} elements  from the content script
 * @param {string} previousTranscript
 */
export function buildPrompt(input, elements, previousTranscript = '') {
  const source = input.audioBase64
    ? 'The attached audio is the family member speaking.'
    : `The family member said: "${input.text}"`;
  const context = previousTranscript
    ? `Previous thing they said (for context): "${previousTranscript}"`
    : '';

  return `
You help a senior citizen use their computer. A family member is guiding them by voice during a video call.
${source}
${context}

Tasks:
1. Transcribe what was said (empty string if silence/noise).
2. Decide if it is an instruction about where to click or find something on the screen.
3. If so, choose the best matching element from the list below, using the text AND spatial hints
   ("left side", "top right", "bottom"). Each element has "region" (e.g. "top-left") and normalized
   x/y (0 = left/top, 1 = right/bottom).
4. Write a short, friendly label (max 4 words), e.g. "Click Record Here".

Elements: ${JSON.stringify(elements)}

Respond ONLY with JSON:
{"transcript": string, "isCommand": boolean, "matchedId": string|null, "label": string}
Use matchedId null if nothing fits. Never invent ids.`;
}

/** Parse the model's reply, tolerating extra text around the JSON object. */
export function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = (text || '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini returned non-JSON');
    return JSON.parse(match[0]);
  }
}

/**
 * Decide what to do with a model result. Guards against hallucinated element ids.
 * @returns {{kind: 'point'|'no-match'|'not-command', id?: string, label?: string, transcript: string}}
 */
export function interpretResult(result, elements) {
  const transcript = result?.transcript || '';
  if (!result?.isCommand) return { kind: 'not-command', transcript };
  const valid = result.matchedId && elements.some((e) => e.id === result.matchedId);
  if (!valid) return { kind: 'no-match', transcript };
  return { kind: 'point', id: result.matchedId, label: result.label, transcript };
}

