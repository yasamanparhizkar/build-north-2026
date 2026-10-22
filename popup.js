const statusEl = document.getElementById('status');

// Load saved API key
chrome.storage.local.get(['geminiApiKey'], (res) => {
  if (res.geminiApiKey) document.getElementById('apiKey').value = res.geminiApiKey;
});

document.getElementById('saveKey').addEventListener('click', () => {
  const key = document.getElementById('apiKey').value.trim();
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    statusEl.textContent = '✅ API Key saved!';
  });
});

async function sendMessageToPage(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, msg, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = '⚠️ Refresh the web page first, then try again.';
    } else if (response && response.status) {
      statusEl.textContent = response.status;
    }
  });
}

document.getElementById('sendCmd').addEventListener('click', () => {
  const command = document.getElementById('manualCmd').value.trim();
  if (!command) return;
  statusEl.textContent = '🔍 Finding element with Gemini...';
  sendMessageToPage({ action: 'PROCESS_COMMAND', command });
});

document.getElementById('toggleVoice').addEventListener('click', () => {
  sendMessageToPage({ action: 'TOGGLE_VOICE' });
});

document.getElementById('clearBtn').addEventListener('click', () => {
  sendMessageToPage({ action: 'CLEAR_HIGHLIGHT' });
});