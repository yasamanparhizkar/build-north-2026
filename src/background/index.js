// Service worker entry point: validates senders and routes messages to modules.
import { CONTENT_ALLOWED, MSG, OFFSCREEN_ONLY, TARGET_OFFSCREEN } from '../shared/messages.js';
import {
  indicatorMessage, interruptListening, recoverSession, startListening, stopListening, trackActiveTab
} from './capture.js';
import { WAKE_PHRASE } from '../shared/constants.js';
import { summarize } from './metrics.js';
import { processAudioClip, processText } from './pipeline.js';
import { LatestJobQueue } from './queue.js';
import { getSession } from './session.js';
import { isListeningStatus } from './sessionState.js';
import { findTargetTab, notifyTab } from './tabs.js';

// Only the newest waiting clip matters; older waiting clips are dropped (2 s overlap covers gaps).
const audioQueue = new LatestJobQueue((e) => console.warn('[audio job]', e));

const EXT_ORIGIN = chrome.runtime.getURL('');

function senderKind(sender) {
  if (sender.id !== chrome.runtime.id) return 'unknown';
  const url = sender.url || '';
  if (url.startsWith(EXT_ORIGIN)) return url.includes('/src/offscreen/') ? 'offscreen' : 'extension';
  if (sender.tab) return 'content';
  return 'unknown';
}

function allowed(kind, action) {
  if (kind === 'content') return CONTENT_ALLOWED.has(action);
  if (OFFSCREEN_ONLY.has(action)) return kind === 'offscreen';
  return kind === 'extension';
}

const WAKE_STATUS_TEXT = {
  open: '🎤 I\'m listening… say what to find.',
  'no-command': `🤔 I didn't hear a request. Say "${WAKE_PHRASE}" and try again.`
};

/** Wake phrase heard (gate open) or gate closed: show it on the page the senior is looking at. */
async function onWakeEvent(state, generation) {
  const s = await getSession();
  if (generation !== s.generation || !isListeningStatus(s.status)) return;
  const text = WAKE_STATUS_TEXT[state];
  if (!text) return;
  const tabId = await findTargetTab(s.captureTabId);
  notifyTab(tabId, { action: MSG.STATUS, text, autoHideMs: state === 'open' ? 9000 : 5000 });
}

async function getState() {
  const [session, { metrics }] = await Promise.all([getSession(), chrome.storage.session.get('metrics')]);
  return { ...session, recentCommands: undefined, metrics: metrics ? summarize(metrics, Date.now()) : null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.action !== 'string' || msg.target === TARGET_OFFSCREEN) return;
  const kind = senderKind(sender);
  if (!allowed(kind, msg.action)) {
    console.warn(`[security] rejected ${msg.action} from ${kind}`);
    return;
  }

  const reply = (promise) => {
    promise.then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message, status: `❌ ${e.message}` }));
    return true;
  };

  switch (msg.action) {
    case MSG.START_LISTENING:
      return reply(startListening(msg.tabId).then(() => ({ ok: true })));
    case MSG.STOP_LISTENING:
      audioQueue.clear();
      return reply(stopListening().then(() => ({ ok: true })));
    case MSG.GET_STATE:
      return reply(getState());
    case MSG.MANUAL_COMMAND:
      return reply(processText(String(msg.text || '').slice(0, 300), { tabId: msg.tabId }));
    case MSG.AUDIO_CLIP:
      audioQueue.push(() => processAudioClip(msg));
      return;
    case MSG.WAKE_EVENT:
      onWakeEvent(msg.state, msg.generation);
      return;
    case MSG.CAPTURE_ENDED:
    case MSG.CAPTURE_ERROR:
      audioQueue.clear();
      interruptListening(msg.detail || 'Audio capture stopped', msg.generation);
      return;
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => trackActiveTab(tabId));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getSession();
  if (s.captureTabId === tabId && s.status !== 'idle') {
    audioQueue.clear();
    await interruptListening('The Google Meet tab was closed.');
  }
});

// Re-show the listening pill after the senior navigates to a new page.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const s = await getSession();
  if (isListeningStatus(s.status)) notifyTab(tabId, indicatorMessage(true, s.voiceMode));
});

recoverSession();

// Test hook for browser integration tests (service-worker scope only; pages cannot reach it).
globalThis.__seniorHelperTest = { processText, processAudioClip, startListening, stopListening, getState };
