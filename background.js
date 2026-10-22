chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CALL_GEMINI') {
    callGeminiAPI(request.apiKey, request.prompt)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});

async function callGeminiAPI(rawApiKey, prompt) {
  const cleanKey = (rawApiKey || '').trim().replace(/^["']|["']\$/g, '');
  if (!cleanKey) {
    throw new Error('API Key is empty');
  }

  // Put the exact model Google requested in your screenshot first!
  const modelsToTry = [
    'gemini-3.0-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-2.0-flash'
  ];

  let lastError = 'Unknown API error';

  for (const modelName of modelsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second max timeout per call

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`;

      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        lastError = data.error?.message || `HTTP ${response.status}`;
        // If this model name doesn't exist (404/400), immediately try the next one in the list
        continue;
      }

      // Safely extract text from any part of the response
      const parts = data.candidates?.[0]?.content?.parts || [];
      const fullText = parts.map((p) => p.text || '').join('\n');

      // Extract the JSON object {...} even if the model added extra words
      const jsonMatch = fullText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error(`Model returned non-JSON: ${fullText.slice(0, 60)}`);
      }

      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      lastError = err.name === 'AbortError' ? `Timed out waiting for ${modelName}` : err.message;
    }
  }

  throw new Error(lastError);
}