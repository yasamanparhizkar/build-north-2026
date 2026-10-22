let cachedModelName = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CALL_GEMINI') {
    callGeminiAuto(request.apiKey, request.prompt)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// 1. Automatically ask Google's API which Flash model your key supports
async function getAvailableModel(cleanKey) {
  if (cachedModelName) return cachedModelName;

  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
  const res = await fetch(listUrl, {
    headers: { 'x-goog-api-key': cleanKey }
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || `ListModels HTTP ${res.status}`);
  }

  // Filter for models that support generateContent
  const validModels = (data.models || []).filter(m =>
    (m.supportedGenerationMethods || []).includes('generateContent') &&
    !m.name.includes('2.5') // skip retired 2.5 models
  );

  // Prefer a 'flash' model for speed, otherwise pick the first available model
  const flashModel =
    validModels.find(m => m.name.includes('3') && m.name.includes('flash')) ||
    validModels.find(m => m.name.includes('flash')) ||
    validModels[0];

  if (!flashModel) {
    throw new Error('No generateContent models found for this API key');
  }

  cachedModelName = flashModel.name; // e.g., "models/gemini-3-flash-preview"
  console.log('Auto-selected model:', cachedModelName);
  return cachedModelName;
}

// 2. Call generateContent using the auto-detected model
async function callGeminiAuto(rawApiKey, prompt) {
  const cleanKey = (rawApiKey || '').trim().replace(/^["']|["']\$/g, '');
  if (!cleanKey) throw new Error('API Key is empty');

  const modelPath = await getAvailableModel(cleanKey);
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(cleanKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cleanKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    cachedModelName = null; // Reset cache if error
    throw new Error(`(${modelPath}) ${data.error?.message || response.status}`);
  }

  const parts = data.candidates?.[0]?.content?.parts || [];
  const fullText = parts.map((p) => p.text || '').join('\n');
  const jsonMatch = fullText.match(/\{[\s\S]*?\}/);

  if (!jsonMatch) {
    throw new Error(`Non-JSON response from ${modelPath}`);
  }

  return JSON.parse(jsonMatch[0]);
}