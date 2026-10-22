// Service worker entry point: wires messages to the modules.
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { startListening, stopListening, trackActiveTab } from './capture.js';
import { handleInput } from './pipeline.js';
import { LatestJobQueue } from './queue.js';
import { getSession } from './session.js';

const clipQueue = new LatestJobQueue();

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
    case MSG.AUDIO_CLIP:
      clipQueue.push(() => handleInput({ audioBase64: msg.audioBase64, mimeType: msg.mimeType }));
      return;
    case MSG.MANUAL_COMMAND:
      handleInput({ text: msg.text }, msg.tabId)
        .then((status) => sendResponse({ status }))
        .catch((e) => sendResponse({ status: '❌ ' + e.message }));
      return true;
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => trackActiveTab(tabId));

