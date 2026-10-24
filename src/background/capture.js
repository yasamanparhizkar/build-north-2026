// Starts/stops Meet tab audio capture through the offscreen document
// (Chrome 116+ pattern: stream id from the service worker, consumed offscreen).
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { isScriptableUrl } from '../shared/urls.js';
import { EMPTY_METRICS } from './metrics.js';
import { STATUS, isListeningStatus } from './sessionState.js';
import { getSession, resetSession, updateSession } from './session.js';
import { notifyTab } from './tabs.js';

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
let creating = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA'],
        justification: 'Capture Google Meet tab audio so spoken guidance can be understood'
      })
      .finally(() => { creating = null; });
  }
  await creating;
}

async function closeOffscreen() {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {
    /* already closed */
  }
}

async function sendToOffscreen(msg) {
  let lastError;
  for (let i = 0; i < 6; i++) {
    try {
      return await chrome.runtime.sendMessage({ target: TARGET_OFFSCREEN, ...msg });
    } catch (e) {
      lastError = e; // document script may still be loading
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw lastError;
}

// [text, background, text colour].
export function updateActionBadge(status) {
  const map = {
    listening: ['ON', '#34B36F', '#FFFFFF'],
    processing: ['ON', '#34B36F', '#FFFFFF'],
    starting: ['…', '#5f6368', '#FFFFFF'],
    interrupted: ['!', '#f29900', '#FFFFFF'],
    error: ['!', '#f29900', '#FFFFFF']
  };
  const [text, background, textColor] = map[status] || ['', '#5f6368', '#FFFFFF'];
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: background }).catch(() => {});
  chrome.action.setBadgeTextColor({ color: textColor }).catch(() => {});
}

async function broadcastIndicator(listening) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.filter((t) => isScriptableUrl(t.url || '')).map((t) => notifyTab(t.id, { action: MSG.INDICATOR, listening }))
  );
}

/** Must follow a user gesture (popup click): the popup grants activeTab for this tab. */
export async function startListening(tabId) {
  if (!tabId) throw new Error('No tab to listen to');
  const settings = await chrome.storage.local.get(['geminiApiKey']);
  if (!settings.geminiApiKey) throw new Error('Voice needs a Gemini API key. Save one first.');

  const current = await getSession();
  if (isListeningStatus(current.status) && current.captureTabId === tabId) return current;
  if (current.status !== STATUS.IDLE) await stopListening({ silent: true });

  const session = await resetSession({ status: STATUS.STARTING, captureTabId: tabId, detail: 'Starting capture…' });
  await chrome.storage.session.set({ metrics: { ...EMPTY_METRICS, startedAt: Date.now() } });
  updateActionBadge(STATUS.STARTING);

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreen();
    const ack = await sendToOffscreen({ action: MSG.START_CAPTURE, streamId, generation: session.generation });
    if (!ack?.ok) throw new Error(ack?.error || 'Audio capture did not start');
  } catch (e) {
    await closeOffscreen();
    const detail = friendlyCaptureError(e);
    await updateSession({ status: STATUS.ERROR, detail });
    updateActionBadge(STATUS.ERROR);
    throw new Error(detail);
  }

  const next = await updateSession({ status: STATUS.LISTENING, detail: '' });
  updateActionBadge(STATUS.LISTENING);
  notifyTab(tabId, { action: MSG.INDICATOR, listening: true });
  return next;
}

function friendlyCaptureError(e) {
  const m = e?.message || String(e);
  if (/invoked|activeTab|permission/i.test(m)) {
    return 'Chrome blocked capture. Open the helper popup on the Meet tab and press Start again.';
  }
  if (/active stream|already/i.test(m)) return 'This tab is already being captured. Stop and start again.';
  return `Could not capture tab audio: ${m}`;
}

export async function stopListening({ status = STATUS.IDLE, detail = '', silent = false } = {}) {
  try {
    await chrome.runtime.sendMessage({ target: TARGET_OFFSCREEN, action: MSG.STOP_CAPTURE });
  } catch {
    /* offscreen document already gone */
  }
  await closeOffscreen();
  // New generation: any in-flight Gemini result is discarded when it returns.
  await resetSession({ status, detail });
  updateActionBadge(status);
  if (!silent) await broadcastIndicator(false);
}

/** Capture ended without the user pressing Stop (tab closed, track ended, error). */
export async function interruptListening(detail, generation) {
  const s = await getSession();
  if (generation !== undefined && generation !== s.generation) return;
  if (s.status === STATUS.IDLE) return;
  await stopListening({ status: STATUS.INTERRUPTED, detail });
}

/** Track the page the senior is looking at (for display; processing re-queries it). */
export async function trackActiveTab(tabId) {
  const s = await getSession();
  if (!isListeningStatus(s.status)) return;
  await updateSession({ targetTabId: tabId });
  notifyTab(tabId, { action: MSG.INDICATOR, listening: true });
}

/** After a service-worker restart, reconcile stored state with reality. */
export async function recoverSession() {
  const s = await getSession();
  const alive = await hasOffscreen();
  if ([STATUS.STARTING, STATUS.LISTENING, STATUS.PROCESSING].includes(s.status)) {
    if (!alive) {
      await resetSession({ status: STATUS.INTERRUPTED, detail: 'The helper restarted. Press Start Listening again.' });
      updateActionBadge(STATUS.INTERRUPTED);
      return;
    }
    if (s.status !== STATUS.LISTENING) await updateSession({ status: STATUS.LISTENING });
    updateActionBadge(STATUS.LISTENING);
    return;
  }
  if (alive) await closeOffscreen(); // orphaned capture: never keep listening without a session
  updateActionBadge(s.status);
}
