// Starts/stops tab audio capture through the offscreen document.
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { getSession, updateSession } from './session.js';

export async function startListening(tabId) {
  if (!tabId) throw new Error('No tab to listen to');
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture Google Meet tab audio for transcription'
    });
  }
  await updateSession({ active: true, captureTabId: tabId, targetTabId: null, lastTranscript: '' });
  chrome.runtime.sendMessage({ target: TARGET_OFFSCREEN, action: MSG.START_CAPTURE, streamId });
}

export async function stopListening() {
  try {
    await chrome.runtime.sendMessage({ target: TARGET_OFFSCREEN, action: MSG.STOP_CAPTURE });
  } catch {
    /* offscreen document already gone */
  }
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  await updateSession({ active: false });
}

/**
 * The senior may switch from the Meet tab to Gmail etc. Point on whichever
 * non-Meet tab she is looking at; fall back to the Meet tab itself.
 */
export async function trackActiveTab(tabId) {
  const s = await getSession();
  if (!s.active) return;
  await updateSession({ targetTabId: tabId === s.captureTabId ? null : tabId });
}

