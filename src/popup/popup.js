import { MSG } from '../shared/messages.js';
import { isMeetUrl } from '../shared/urls.js';
import { DEFAULT_VOICE_MODE, VOICE_MODES, WAKE_PHRASE } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const mainView = $('main-view');
const textView = $('text-view');
const settingsView = $('settings-view');
const askForm = $('ask-form');
const askInput = $('ask-input');
const askSubmit = $('ask-submit');
const askStatus = $('ask-status');
const listenSwitch = $('listen-switch');
const statusLabel = $('status-label');
const wave = $('wave');
const meetHint = $('meet-hint');
const privacyNote = $('privacy-note');
const apiKeyInput = $('api-key');
const modelInput = $('model');
const voiceModeSelect = $('voice-mode');
const voiceModeNote = $('voice-mode-note');
const saveBtn = $('save');
const diagList = $('diag-list');

const LISTENING = ['listening', 'processing', 'starting'];
const LISTENING_LABEL = { starting: 'Starting…', listening: 'Listening', processing: 'Listening' };
const PRIVACY_TEXT = {
  [VOICE_MODES.WAKE]: `Nothing is shared until someone says "${WAKE_PHRASE}". Then only that request goes to Google Gemini.`,
  [VOICE_MODES.ALWAYS]: 'While listening, your Meet audio is shared with Google Gemini.'
};
const MODE_NOTE = {
  [VOICE_MODES.WAKE]: 'Less credit usage, more secure.',
  [VOICE_MODES.ALWAYS]: 'More credit usage, less security.'
};
const validMode = (m) => (Object.values(VOICE_MODES).includes(m) ? m : DEFAULT_VOICE_MODE);

let onMeet = false;
let startError = '';
let saveTimer = null;

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

const views = { main: mainView, text: textView, settings: settingsView };
let current = 'main';
let beforeSettings = 'main';

function show(name) {
  if (name === 'settings') beforeSettings = current;
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  current = name;
  if (name === 'text') askInput.focus();
}

/** Plain one-line result for the text page. The highlight on the page is the main feedback. */
function resultMessage(res) {
  if (res?.ok === false) return res.error || "Couldn't reach the page. Please try again.";
  const status = res?.status || '';
  if (status.startsWith('Error: ')) return status.slice('Error: '.length);
  if (status.startsWith('Pointing to') || status.includes('Duplicate') || status.includes('Skipped')) return '';
  return "Couldn't find that on this page.";
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
  const waiting = s.status === 'listening' && s.voiceMode === VOICE_MODES.WAKE;
  statusLabel.textContent = waiting
    ? `Say "${WAKE_PHRASE}"`
    : listening ? LISTENING_LABEL[s.status] : onMeet ? 'Not listening' : 'Not on a Meet tab';

  wave.toggleAttribute('hidden', !listening); // SVG has no .hidden property
  privacyNote.hidden = listening || !onMeet;

  const failure = startError || (['interrupted', 'error'].includes(s.status) ? s.detail || 'Capture stopped' : '');
  const hint = failure || (onMeet ? '' : 'Open a Google Meet tab, then start here');
  meetHint.textContent = hint;
  meetHint.hidden = listening || !hint;

  renderDiag(s);
}

async function init() {
  const s = await chrome.storage.local.get(['geminiApiKey', 'model', 'voiceMode']);
  apiKeyInput.value = s.geminiApiKey || '';
  modelInput.value = s.model || '';
  voiceModeSelect.value = validMode(s.voiceMode);
  showModeText(voiceModeSelect.value);
  const tab = await activeTab();
  onMeet = isMeetUrl(tab?.url || '');
  renderDiag({});
  refresh();
}

function showModeText(mode) {
  privacyNote.textContent = PRIVACY_TEXT[mode];
  voiceModeNote.textContent = MODE_NOTE[mode];
}
voiceModeSelect.addEventListener('change', () => showModeText(voiceModeSelect.value));

$('open-settings').addEventListener('click', () => showView(true));
$('back').addEventListener('click', () => showView(false));
$('open-settings').addEventListener('click', () => show('settings'));
$('open-settings-from-text').addEventListener('click', () => show('settings'));
$('open-text').addEventListener('click', () => show('text'));
$('open-audio').addEventListener('click', () => show('main'));
$('back').addEventListener('click', () => show(beforeSettings));

const syncAskButton = () => { askSubmit.disabled = askInput.value.trim() === ''; };
askInput.addEventListener('input', syncAskButton);
syncAskButton();

askForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = askInput.value.trim();
  if (!query) return;
  askSubmit.disabled = true;
  askStatus.textContent = 'Looking…';
  try {
    const tab = await activeTab();
    const res = await chrome.runtime.sendMessage({ action: MSG.MANUAL_COMMAND, text: query, tabId: tab?.id });
    askStatus.textContent = resultMessage(res);
  } catch {
    askStatus.textContent = "Couldn't reach the helper. Please try again.";
  } finally {
    syncAskButton();
  }
});

saveBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({
    geminiApiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    voiceMode: validMode(voiceModeSelect.value) // takes effect the next time listening starts
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
