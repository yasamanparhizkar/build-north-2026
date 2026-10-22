const statusEl = document.getElementById('status');

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
  if (!tab || !tab.id) {
    statusEl.textContent = '❌ No active tab found.';
    return;
  }

  // Cannot inject scripts into internal chrome:// pages
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
    statusEl.textContent = '⚠️ Please switch to a normal website (like Google Meet or Gmail).';
    return;
  }

  chrome.tabs.sendMessage(tab.id, msg, async (response) => {
    const err = chrome.runtime.lastError;
    if (err) {
      // If content.js isn't running on the page yet, inject it automatically!
      if (err.message.includes('Receiving end does not exist')) {
        statusEl.textContent = '⚡ Connecting to page...';
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          // Retry sending the command immediately after injecting!
          chrome.tabs.sendMessage(tab.id, msg, (retryResponse) => {
            if (chrome.runtime.lastError) {
              statusEl.textContent = '❌ Error: ' + chrome.runtime.lastError.message;
            } else if (retryResponse && retryResponse.status) {
              statusEl.textContent = retryResponse.status;
            }
          });
        } catch (injectErr) {
          statusEl.textContent = '❌ Cannot run on this page: ' + injectErr.message;
        }
      } else {
        statusEl.textContent = '⏳ Check bottom-right badge on page...';
      }
    } else if (response && response.status) {
      statusEl.textContent = response.status;
    }
  });
}

document.getElementById('sendCmd').addEventListener('click', () => {
  const command = document.getElementById('manualCmd').value.trim();
  if (!command) return;
  statusEl.textContent = '🔍 Finding element on page...';
  sendMessageToPage({ action: 'PROCESS_COMMAND', command });
});

document.getElementById('toggleVoice').addEventListener('click', () => {
  sendMessageToPage({ action: 'TOGGLE_VOICE' });
});

document.getElementById('clearBtn').addEventListener('click', () => {
  sendMessageToPage({ action: 'CLEAR_HIGHLIGHT' });
});