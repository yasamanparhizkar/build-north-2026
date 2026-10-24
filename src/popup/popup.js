import { MSG } from '../shared/messages.js';
import { isMeetUrl } from '../shared/urls.js';

const $ = (id) => document.getElementById(id);
const mainView = $('main-view');
const settingsView = $('settings-view');
const listenSwitch = $('listen-switch');
const statusLabel = $('status-label');
const wave = $('wave');
const meetHint = $('meet-hint');
const privacyNote = $('privacy-note');
const apiKeyInput = $('api-key');
const modelInput = $('model');
const saveBtn = $('save');
const diagList = $('diag-list');

const LISTENING = ['listening', 'processing', 'starting'];
const LISTENING_LABEL = { starting: 'Starting…', listening: 'Listening', processing: 'Listening' };

let onMeet = false;
let startError = '';
let saveTimer = null;

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

function showView(settings) {
  mainView.hidden = settings;
  settingsView.hidden = !settings;
}

function renderDiag(s) {
  const m = s.metrics;
  const fmt = (v) => (v == null ? '—' : `${v} ms`);
  const rows = [
    ['Last heard', s.lastHeard || '—'],
    ['Median Gemini', fmt(m?.medianGeminiMs)],
    ['Match + render', fmt(m?.medianMatchMs)],
    ['Speech → pointer', fmt(m?.medianTotalMs)],
    ['API calls / min', m ? `${m.apiCallsPerMinute} · ${m.apiErrors} errors` : '—'],
    ['Clips', m ? `${m.clipsReceived} received · ${m.clipsSkipped} skipped` : '—'],
    ['Audio sent', m ? `${m.audioSecondsSent} s` : '—'],
    ['Highlights', m ? `${m.highlights}` : '—']
  ];
  diagList.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'diag-row';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
}

async function refresh() {
  const s = await chrome.runtime.sendMessage({ action: MSG.GET_STATE }).catch(() => null);
  if (!s) return;
  const listening = LISTENING.includes(s.status);
  listenSwitch.setAttribute('aria-checked', String(listening));
  listenSwitch.disabled = !listening && !onMeet;
  statusLabel.textContent = listening ? LISTENING_LABEL[s.status] : onMeet ? 'Not listening' : 'Not on a Meet tab';

  wave.toggleAttribute('hidden', !listening); // SVG has no .hidden property
  privacyNote.hidden = listening || !onMeet;

  const failure = startError || (['interrupted', 'error'].includes(s.status) ? s.detail || 'Capture stopped' : '');
  const hint = failure || (onMeet ? '' : 'Open a Google Meet tab, then start here');
  meetHint.textContent = hint;
  meetHint.hidden = listening || !hint;

  renderDiag(s);
}

async function init() {
  const s = await chrome.storage.local.get(['geminiApiKey', 'model']);
  apiKeyInput.value = s.geminiApiKey || '';
  modelInput.value = s.model || '';
  const tab = await activeTab();
  onMeet = isMeetUrl(tab?.url || '');
  renderDiag({});
  refresh();
}

$('open-settings').addEventListener('click', () => showView(true));
$('back').addEventListener('click', () => showView(false));

saveBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({
    geminiApiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim()
  });
  saveBtn.textContent = 'Saved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveBtn.textContent = 'Save'; }, 1400);
});

$('forget-key').addEventListener('click', async () => {
  await chrome.storage.local.remove('geminiApiKey');
  apiKeyInput.value = '';
});

listenSwitch.addEventListener('click', async () => {
  listenSwitch.disabled = true;
  startError = '';
  try {
    const state = await chrome.runtime.sendMessage({ action: MSG.GET_STATE });
    if (LISTENING.includes(state?.status)) {
      await chrome.runtime.sendMessage({ action: MSG.STOP_LISTENING });
    } else {
      const tab = await activeTab();
      if (!tab) {
        startError = 'No active tab.';
      } else {
        const res = await chrome.runtime.sendMessage({ action: MSG.START_LISTENING, tabId: tab.id });
        if (!res?.ok) startError = res?.error || 'Could not start';
      }
    }
  } finally {
    listenSwitch.disabled = false;
    refresh();
  }
});

chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'session') refresh(); });
init();
