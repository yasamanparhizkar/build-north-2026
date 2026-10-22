// Service worker: orchestrates Audio -> Gemini -> pointer on the senior's page.
const MODEL = 'gemini-2.5-flash';

// Service workers get killed often, so keep session state in storage.session.
async function getSession() {
  const { session } = await chrome.storage.session.get('session');
  return session || { active: false, captureTabId: null, targetTabId: null, lastTranscript: '' };
}
async function setSession(patch) {
  const next = { ...(await getSession()), ...patch };
  await chrome.storage.session.set({ session: next });
  return next;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return;

  if (msg.action === 'START_LISTENING') {
    startListening(msg.tabId).then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.action === 'STOP_LISTENING') {
    stopListening().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'GET_STATE') {
    getSession().then((s) => sendResponse(s));
    return true;
  }
  if (msg.action === 'AUDIO_CLIP') {
    enqueue(() => handleInput({ audioBase64: msg.audioBase64, mimeType: msg.mimeType }));
    return;
  }
  if (msg.action === 'MANUAL_COMMAND') {
    handleInput({ text: msg.text }, msg.tabId)
      .then((status) => sendResponse({ status }))
      .catch((e) => sendResponse({ status: '❌ ' + e.message }));
    return true;
  }
});

// The senior may switch from the Meet tab to Gmail etc. Point on whichever
// non-Meet tab she is looking at.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const s = await getSession();
  if (s.active && tabId !== s.captureTabId) await setSession({ targetTabId: tabId });
  else if (s.active && tabId === s.captureTabId) await setSession({ targetTabId: null });
});

async function startListening(tabId) {
  if (!tabId) throw new Error('No tab to listen to');
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture Google Meet tab audio for transcription'
    });
  }
  await setSession({ active: true, captureTabId: tabId, targetTabId: null, lastTranscript: '' });
  chrome.runtime.sendMessage({ target: 'offscreen', action: 'START_CAPTURE', streamId });
}

async function stopListening() {
  chrome.runtime.sendMessage({ target: 'offscreen', action: 'STOP_CAPTURE' }).catch(() => {});
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  await setSession({ active: false });
}

// Process clips one at a time; keep at most one waiting.
let busy = false;
let pending = null;
async function enqueue(job) {
  if (busy) { pending = job; return; }
  busy = true;
  try { await job(); } catch (e) { console.warn('Clip failed:', e); }
  busy = false;
  if (pending) { const next = pending; pending = null; enqueue(next); }
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    // Content script not present (page opened before install) -> inject and retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function handleInput(input, forcedTabId) {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  const session = await getSession();
  const tabId = forcedTabId || session.targetTabId || session.captureTabId;
  if (!tabId) throw new Error('No page to point on');
  if (!geminiApiKey) {
    await sendToTab(tabId, { action: 'STATUS', text: '⚠️ Save your Gemini API key in the extension popup first.' });
    return '⚠️ Missing API key';
  }

  const elements = (await sendToTab(tabId, { action: 'GET_ELEMENTS' }))?.elements || [];
  const result = await callGemini(geminiApiKey, input, elements, session.lastTranscript);

  if (result.transcript) await setSession({ lastTranscript: result.transcript.slice(-300) });

  const valid = elements.some((e) => e.id === result.matchedId);
  if (result.isCommand && result.matchedId && valid) {
    await sendToTab(tabId, { action: 'HIGHLIGHT', id: result.matchedId, label: result.label });
    return `✅ Pointing to: ${result.label}`;
  }
  if (result.transcript) {
    await sendToTab(tabId, { action: 'STATUS', text: `👂 Heard: "${result.transcript}"`, autoHideMs: 4000 });
  }
  return result.isCommand ? '🤷 No matching button found' : '👂 Not a computer instruction';
}

async function callGemini(rawKey, input, elements, previousTranscript) {
  const key = (rawKey || '').trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('API key is empty');

  const instructions = `
You help a senior citizen use their computer. A family member is guiding them by voice during a video call.
${input.audioBase64 ? 'The attached audio is the family member speaking.' : `The family member said: "${input.text}"`}
${previousTranscript ? `Previous thing they said (for context): "${previousTranscript}"` : ''}

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

  const parts = [{ text: instructions }];
  if (input.audioBase64) parts.push({ inlineData: { mimeType: input.mimeType || 'audio/wav', data: input.audioBase64 } });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
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
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Gemini returned non-JSON');
    return JSON.parse(m[0]);
  }
}
