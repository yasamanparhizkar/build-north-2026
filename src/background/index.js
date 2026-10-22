// Service worker entry point: wires messages to the modules.
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { startListening, stopListening, trackActiveTab } from './capture.js';
import { handleInput } from './pipeline.js';
import { LatestJobQueue } from './queue.js';
import { getSession } from './session.js';
import { sendToTab } from './tabs.js';

// If commands arrive faster than we can handle them, only the newest matters.
const utteranceQueue = new LatestJobQueue();

const LIVE_STATUS_TEXT = {
  connecting: '🎧 Connecting to live listening...',
  connected: '🎧 Listening live',
  reconnecting: '🔄 Reconnecting...',
  error: '❌ Live listening failed'
};

async function reportLiveStatus(state, detail) {
  const text = LIVE_STATUS_TEXT[state];
  if (!text) return;
  const { captureTabId } = await getSession();
  if (!captureTabId) return;
  const autoHideMs = state === 'connected' ? 3000 : 0;
  sendToTab(captureTabId, { action: MSG.STATUS, text: detail ? `${text}: ${detail}` : text, autoHideMs }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === TARGET_OFFSCREEN) return;

  switch (msg.action) {
    case MSG.START_LISTENING:
      startListening(msg.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    case MSG.STOP_LISTENING:
      stopListening().then(() => sendResponse({ ok: true }));
      return true;
    case MSG.GET_STATE:
      getSession().then(sendResponse);
      return true;
    case MSG.UTTERANCE:
      utteranceQueue.push(() => handleInput({ text: msg.text }));
      return;
    case MSG.LIVE_STATUS:
      reportLiveStatus(msg.state, msg.detail);
      return;
    case MSG.MANUAL_COMMAND:
      handleInput({ text: msg.text }, msg.tabId)
        .then((status) => sendResponse({ status }))
        .catch((e) => sendResponse({ status: '❌ ' + e.message }));
      return true;
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => trackActiveTab(tabId));

