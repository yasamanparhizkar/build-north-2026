import { MSG } from '../shared/messages.js';
import { isMeetUrl } from '../shared/urls.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const listenBtn = $('toggleListen');

const STATE_TEXT = {
  idle: 'Not listening',
  starting: 'Starting capture…',
  listening: '🎧 Listening',
  processing: '🎧 Listening · processing…',
  interrupted: '⚠️ Capture interrupted',
  error: '❌ Error'
};

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

async function refresh() {
  const s = await chrome.runtime.sendMessage({ action: MSG.GET_STATE }).catch(() => null);
  if (!s) return;
  const stateEl = $('state');
  stateEl.className = `state ${s.status}`;
  stateEl.textContent = STATE_TEXT[s.status] + (s.detail ? ` — ${s.detail}` : '');
  const listening = ['listening', 'processing', 'starting'].includes(s.status);
  listenBtn.textContent = listening ? '🛑 Stop Listening' : '🎧 Start Listening (open this on the Meet tab)';
  listenBtn.classList.toggle('stop', listening);

  const m = s.metrics;
  const fmt = (v) => (v == null ? '–' : `${v} ms`);
  $('diag').textContent = m
    ? [
      `last heard: ${s.lastHeard ? `"${s.lastHeard}"` : '–'}`,
      `median Gemini: ${fmt(m.medianGeminiMs)}`,
      `median match+render: ${fmt(m.medianMatchMs)}`,
      `median speech→pointer: ${fmt(m.medianTotalMs)}`,
      `API calls/min: ${m.apiCallsPerMinute} (error rate ${m.apiErrorRate})`,
      `clips: ${m.clipsReceived} received, ${m.clipsSkipped} skipped`,
      `audio sent: ${m.audioSecondsSent} s · highlights: ${m.highlights}`
    ].join('\n')
    : 'No data yet.';
}

async function init() {
  const s = await chrome.storage.local.get(['geminiApiKey', 'model', 'voiceMode', 'liveModel', 'pointerStyle']);
  $('apiKey').value = s.geminiApiKey || '';
  $('model').value = s.model || '';
  $('voiceMode').value = s.voiceMode || 'clips';
  $('liveModel').value = s.liveModel || '';
  $('pointerStyle').value = s.pointerStyle === 'driver' ? 'driver' : 'spotlight';
  const tab = await activeTab();
  $('meetHint').classList.toggle('hidden', !tab || isMeetUrl(tab.url || ''));
  refresh();
}

$('saveKey').addEventListener('click', async () => {
  await chrome.storage.local.set({
    geminiApiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    voiceMode: $('voiceMode').value,
    liveModel: $('liveModel').value.trim(),
    pointerStyle: $('pointerStyle').value
  });
  statusEl.textContent = '✅ Settings saved.';
});

$('forgetKey').addEventListener('click', async () => {
  await chrome.storage.local.remove('geminiApiKey');
  $('apiKey').value = '';
  statusEl.textContent = '🗑️ API key removed from this browser.';
});

listenBtn.addEventListener('click', async () => {
  listenBtn.disabled = true;
  try {
    const state = await chrome.runtime.sendMessage({ action: MSG.GET_STATE });
    if (['listening', 'processing', 'starting'].includes(state?.status)) {
      await chrome.runtime.sendMessage({ action: MSG.STOP_LISTENING });
      statusEl.textContent = '🛑 Stopped listening.';
    } else {
      const tab = await activeTab();
      if (!tab) { statusEl.textContent = '❌ No active tab.'; return; }
      statusEl.textContent = '⏳ Starting…';
      const res = await chrome.runtime.sendMessage({ action: MSG.START_LISTENING, tabId: tab.id });
      statusEl.textContent = res?.ok
        ? "🎧 Listening to this tab's audio. You can switch to another tab now."
        : `❌ ${res?.error || 'Could not start'}`;
    }
  } finally {
    listenBtn.disabled = false;
    refresh();
  }
});

$('sendCmd').addEventListener('click', async () => {
  const text = $('manualCmd').value.trim();
  if (!text) return;
  const tab = await activeTab();
  if (!tab) return;
  statusEl.textContent = '🔍 Finding element on page…';
  const res = await chrome.runtime.sendMessage({ action: MSG.MANUAL_COMMAND, text, tabId: tab.id });
  statusEl.textContent = res?.status || 'Done';
});

$('manualCmd').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('sendCmd').click(); });

$('clearBtn').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: MSG.CLEAR_HIGHLIGHT }, { frameId: 0 }, () => void chrome.runtime.lastError);
  statusEl.textContent = 'Cleared pointer.';
});

chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'session') refresh(); });
init();

document.getElementById('openDemo').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/demo/demo.html') });
});
