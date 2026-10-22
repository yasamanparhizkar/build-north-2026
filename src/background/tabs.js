// Helpers for talking to content scripts (top frame only).
import { isScriptableUrl } from '../shared/urls.js';

const RETRY_DELAY_MS = 150;
const RETRIES = 4;

export class TabError extends Error {}

/** Send a message to a tab's top frame, injecting the content script first if needed. */
export async function sendToTab(tabId, msg, { inject = true } = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (firstError) {
    if (!inject) throw firstError;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new TabError('That tab is closed.');
    if (!isScriptableUrl(tab.url || '')) {
      throw new TabError('Chrome does not allow the helper on this page (e.g. chrome:// pages, Web Store, PDF viewer).');
    }
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['src/content/loader.js'] });
    let lastError = firstError;
    for (let i = 0; i < RETRIES; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
      } catch (e) {
        lastError = e; // module may still be loading
      }
    }
    throw lastError;
  }
}

/** Fire-and-forget message that never injects (e.g. status/indicator updates). */
export function notifyTab(tabId, msg) {
  if (!tabId) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});
}

/** The page the senior is looking at: the active tab of the last focused normal window. */
export async function findTargetTab(fallbackTabId) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  if (tab && isScriptableUrl(tab.url || '')) return tab.id;
  return fallbackTabId || tab?.id || null;
}
