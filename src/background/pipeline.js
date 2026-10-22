// Audio/text -> element -> pointer on the page.
// Text commands try the offline matcher first (instant, no API key); Gemini is
// used when the matcher is unsure, or for audio clips.
import { MSG } from '../shared/messages.js';
import { callGemini } from './gemini.js';
import { matchLocal } from './matcher.js';
import { interpretResult } from './prompt.js';
import { getSession, updateSession } from './session.js';
import { sendToTab } from './tabs.js';

export async function handleInput(input, forcedTabId) {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  const session = await getSession();
  const tabId = forcedTabId || session.targetTabId || session.captureTabId;
  if (!tabId) throw new Error('No page to point on');

  const elements = (await sendToTab(tabId, { action: MSG.GET_ELEMENTS }))?.elements || [];

  let result;
  let via;
  const local = input.text ? matchLocal(input.text, elements) : null;
  if (local?.confident) {
    result = local.result;
    via = 'offline';
  } else if (geminiApiKey) {
    result = await callGemini({ apiKey: geminiApiKey, input, elements, previousTranscript: session.lastTranscript });
    via = 'Gemini';
  } else if (local) {
    result = local.result; // best effort without a key
    via = 'offline';
  } else {
    await sendToTab(tabId, { action: MSG.STATUS, text: '⚠️ Audio needs a Gemini API key. Save one in the popup.' });
    return '⚠️ Audio needs an API key';
  }

  if (result.transcript && via === 'Gemini') await updateSession({ lastTranscript: result.transcript.slice(-300) });

  const outcome = interpretResult(result, elements);
  if (outcome.kind === 'point') {
    await sendToTab(tabId, { action: MSG.HIGHLIGHT, id: outcome.id, label: outcome.label });
    return `✅ Pointing to: ${outcome.label} (${via})`;
  }
  if (outcome.transcript) {
    await sendToTab(tabId, { action: MSG.STATUS, text: `👂 Heard: "${outcome.transcript}"`, autoHideMs: 4000 });
  }
  return outcome.kind === 'no-match' ? `🤷 No matching button found (${via})` : '👂 Not a computer instruction';
}
