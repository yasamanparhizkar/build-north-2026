import { MSG } from '../shared/messages.js';

const statusEl = document.getElementById('status');
const listenBtn = document.getElementById('toggleListen');

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

async function refreshListenButton() {
  const s = await chrome.runtime.sendMessage({ action: MSG.GET_STATE });
  listenBtn.textContent = s?.active
    ? '🛑 Stop Listening'
    : '🎧 Start Listening to This Tab (open on the Meet tab)';
}

chrome.storage.local.get(['geminiApiKey'], (res) => {
  if (res.geminiApiKey) document.getElementById('apiKey').value = res.geminiApiKey;
});

document.getElementById('saveKey').addEventListener('click', () => {
  const key = document.getElementById('apiKey').value.trim();
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    statusEl.textContent = '✅ API Key saved!';
  });
});

listenBtn.addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ action: MSG.GET_STATE });
  if (state?.active) {
    await chrome.runtime.sendMessage({ action: MSG.STOP_LISTENING });
    statusEl.textContent = '🛑 Stopped listening.';
  } else {
    const tab = await activeTab();
    if (!tab) { statusEl.textContent = '❌ No active tab found.'; return; }
    const res = await chrome.runtime.sendMessage({ action: MSG.START_LISTENING, tabId: tab.id });
    statusEl.textContent = res?.ok
      ? "🎧 Listening to this tab's audio. You can switch tabs now."
      : '❌ ' + res?.error;
  }
  refreshListenButton();
});

document.getElementById('sendCmd').addEventListener('click', async () => {
  const text = document.getElementById('manualCmd').value.trim();
  if (!text) return;
  const tab = await activeTab();
  if (!tab) return;
  statusEl.textContent = '🔍 Finding element on page...';
  const res = await chrome.runtime.sendMessage({ action: MSG.MANUAL_COMMAND, text, tabId: tab.id });
  statusEl.textContent = res?.status || 'Done';
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: MSG.CLEAR_HIGHLIGHT }, () => void chrome.runtime.lastError);
  statusEl.textContent = 'Cleared pointer';
});

refreshListenButton();
