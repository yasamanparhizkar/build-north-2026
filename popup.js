const statusEl = document.getElementById('status');
const listenBtn = document.getElementById('toggleListen');

chrome.storage.local.get(['geminiApiKey'], (res) => {
  if (res.geminiApiKey) document.getElementById('apiKey').value = res.geminiApiKey;
});

function refreshListenButton() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (s) => {
    if (chrome.runtime.lastError || !s) return;
    listenBtn.textContent = s.active ? '🛑 Stop Listening' : '🎧 Start Listening to This Tab (open on the Meet tab)';
  });
}
refreshListenButton();

document.getElementById('saveKey').addEventListener('click', () => {
  const key = document.getElementById('apiKey').value.trim();
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    statusEl.textContent = '✅ API Key saved!';
  });
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

listenBtn.addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
  if (state && state.active) {
    await chrome.runtime.sendMessage({ action: 'STOP_LISTENING' });
    statusEl.textContent = '🛑 Stopped listening.';
  } else {
    const tab = await activeTab();
    if (!tab) { statusEl.textContent = '❌ No active tab found.'; return; }
    const res = await chrome.runtime.sendMessage({ action: 'START_LISTENING', tabId: tab.id });
    statusEl.textContent = res && res.ok
      ? '🎧 Listening to this tab\'s audio. You can switch tabs now.'
      : '❌ ' + (res && res.error);
  }
  refreshListenButton();
});

document.getElementById('sendCmd').addEventListener('click', async () => {
  const text = document.getElementById('manualCmd').value.trim();
  if (!text) return;
  const tab = await activeTab();
  if (!tab) return;
  statusEl.textContent = '🔍 Finding element on page...';
  const res = await chrome.runtime.sendMessage({ action: 'MANUAL_COMMAND', text, tabId: tab.id });
  statusEl.textContent = (res && res.status) || 'Done';
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_HIGHLIGHT' }, () => void chrome.runtime.lastError);
  statusEl.textContent = 'Cleared pointer';
});
