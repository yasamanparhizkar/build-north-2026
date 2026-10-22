// Helpers for talking to content scripts.
const RETRY_DELAY_MS = 150;
const RETRIES = 3;

/** Send a message to a tab, injecting the content script first if the page predates the install. */
export async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/loader.js'] });
    let lastError;
    for (let i = 0; i < RETRIES; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return await chrome.tabs.sendMessage(tabId, msg);
      } catch (e) {
        lastError = e; // module may still be loading
      }
    }
    throw lastError;
  }
}
