// Audio/text -> Gemini -> pointer on the page.
import { MSG } from '../shared/messages.js';
import { callGemini } from './gemini.js';
import { interpretResult } from './prompt.js';
import { getSession, updateSession } from './session.js';
import { sendToTab } from './tabs.js';

export async function handleInput(input, forcedTabId) {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  const session = await getSession();
  const tabId = forcedTabId || session.targetTabId || session.captureTabId;
  if (!tabId) throw new Error('No page to point on');

  if (!geminiApiKey) {
    await sendToTab(tabId, { action: MSG.STATUS, text: '⚠️ Save your Gemini API key in the extension popup first.' });
    return '⚠️ Missing API key';
  }

  const elements = (await sendToTab(tabId, { action: MSG.GET_ELEMENTS }))?.elements || [];
  const result = await callGemini({
    apiKey: geminiApiKey,
    input,
    elements,
    previousTranscript: session.lastTranscript
  });

  if (result.transcript) await updateSession({ lastTranscript: result.transcript.slice(-300) });

  const outcome = interpretResult(result, elements);
  if (outcome.kind === 'point') {
    await sendToTab(tabId, { action: MSG.HIGHLIGHT, id: outcome.id, label: outcome.label });
    return `✅ Pointing to: ${outcome.label}`;
  }
  if (outcome.transcript) {
    await sendToTab(tabId, { action: MSG.STATUS, text: `👂 Heard: "${outcome.transcript}"`, autoHideMs: 4000 });
  }
  return outcome.kind === 'no-match' ? '🤷 No matching button found' : '👂 Not a computer instruction';
}
