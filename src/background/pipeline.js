// Audio / transcript / typed text -> element decision -> validated pointer.
import { MSG } from '../shared/messages.js';
import { decideFromModel, decideFromText } from './decision.js';
import { GeminiError, callGemini } from './gemini.js';
import { EMPTY_METRICS, bump, recordSample } from './metrics.js';
import {
  STATUS, commandKey, isDuplicateCommand, rememberCommand, resultStaleReason, staleReason
} from './sessionState.js';
import { getSession, updateSession, withLock } from './session.js';
import { findTargetTab, notifyTab, sendToTab } from './tabs.js';
import { stopListening } from './capture.js';

async function getSettings() {
  const s = await chrome.storage.local.get(['geminiApiKey', 'model', 'pointerStyle']);
  return { apiKey: s.geminiApiKey || '', model: s.model || '', pointerStyle: s.pointerStyle === 'driver' ? 'driver' : 'spotlight' };
}

export function updateMetrics(fn) {
  return withLock(async () => {
    const { metrics } = await chrome.storage.session.get('metrics');
    await chrome.storage.session.set({ metrics: fn({ ...EMPTY_METRICS, ...(metrics || {}) }) });
  });
}

async function askGemini({ input, elements, previousTranscript }) {
  const { apiKey, model } = await getSettings();
  await updateMetrics((m) => bump(bump(m, 'apiCalls'), 'audioSecondsSent', (input.durationMs || 0) / 1000));
  try {
    return await callGemini(
      { apiKey, model, input, elements, previousTranscript },
      {
        onModelResolved: (picked) => chrome.storage.local.set({ model: picked }),
        onFallback: (next, err) => console.warn(`[gemini] ${err.message} -> trying ${next}`)
      }
    );
  } catch (e) {
    await updateMetrics((m) => bump(m, 'apiErrors'));
    throw e;
  }
}

/** Debug line in the service-worker console and in the page's DevTools console. */
function debugLog(tabId, text) {
  console.log(`[Senior Helper] ${text}`);
  if (tabId) notifyTab(tabId, { action: MSG.STATUS, consoleOnly: true, text });
}

async function getSnapshot(tabId) {
  const snap = await sendToTab(tabId, { action: MSG.GET_ELEMENTS });
  if (!snap || !Array.isArray(snap.elements)) throw new Error('Could not read the page');
  return snap;
}

/** Shared tail: dedupe, stale check, highlight with snapshot validation, metrics. */
async function applyDecision({ decision, job, tabId, snapshot, timings = {}, typed = false }) {
  const now = Date.now();
  if (job) {
    const stale = resultStaleReason(job, await getSession());
    if (stale) return { status: `⏭️ Skipped (${stale})` };
  }

  if (decision.kind === 'ignore') {
    // After a wake phrase the person expects an answer, so say what was heard.
    if (job && !job.wake && decision.transcript) {
      // Always-listen: show what was heard so it's clear the helper is working.
      notifyTab(tabId, { action: MSG.STATUS, text: `🎧 Heard: "${decision.transcript.slice(0, 80)}"`, autoHideMs: 4000 });
    }
    if (job?.wake) {
      const heard = (decision.transcript || '').slice(0, 80);
      notifyTab(tabId, {
        action: MSG.STATUS,
        text: heard ? `🤔 I heard "${heard}", but no request about the screen.` : "🤔 I didn't catch a request. Please try again.",
        autoHideMs: 6000
      });
    }
    return { status: '👂 Not a computer instruction', transcript: decision.transcript };
  }
  if (decision.kind === 'no-match' || !decision.ids.length) {
    const what = decision.target ? `"${decision.target}"` : 'that';
    notifyTab(tabId, { action: MSG.STATUS, text: `I couldn't find ${what} on this page.`, autoHideMs: 5000 });
    return { status: `🤷 No matching button found for ${what}`, transcript: decision.transcript };
  }

  const byId = new Map(snapshot.elements.map((e) => [e.id, e]));
  const targets = decision.ids.map((id) => byId.get(id)).filter(Boolean).map((e) => ({ id: e.id, name: e.name, role: e.role }));
  const key = commandKey(decision.target || decision.transcript, targets[0]?.name);

  // Overlapping always-on clips can repeat a command; a wake-word request is always deliberate.
  if (!typed && !job?.wake) {
    const s = await getSession();
    if (isDuplicateCommand(s.recentCommands, key, now)) return { status: '🔁 Duplicate command ignored' };
  }

  const t0 = Date.now();
  const ambiguous = decision.kind === 'candidates';
  const label = ambiguous ? 'Is it one of these?' : decision.label || `Click ${targets[0].name}`;
  const { pointerStyle } = await getSettings();
  const res = await sendToTab(tabId, {
    action: MSG.HIGHLIGHT, snapshotId: snapshot.snapshotId, targets, label, ambiguous, renderer: pointerStyle
  });
  const matchMs = Date.now() - t0 + (snapshot.scanMs || 0);

  if (!res?.ok) {
    notifyTab(tabId, { action: MSG.STATUS, text: 'The page changed. Please say it again.', autoHideMs: 5000 });
    return { status: `⚠️ Could not point: ${res?.reason || 'unknown'}` };
  }

  // Replace "Got it, thinking…" with the result.
  if (job) notifyTab(tabId, { action: MSG.STATUS, text: `✅ ${ambiguous ? 'Is it one of these?' : label}`, autoHideMs: 2500 });

  await updateSession((s) => ({
    recentCommands: rememberCommand(s.recentCommands, key, now),
    lastHighlightSeq: typeof job?.seq === 'number' ? job.seq : s.lastHighlightSeq
  }));
  await updateMetrics((m) => recordSample(bump(m, 'highlights'), {
    gemini: timings.gemini ?? null,
    match: matchMs,
    total: timings.startedAt ? Date.now() - timings.startedAt : null
  }));

  return {
    status: `✅ Pointing to: ${ambiguous ? targets.map((t) => t.name).join(' / ') : label} (${decision.source})`,
    transcript: decision.transcript,
    highlight: res
  };
}

async function handleGeminiError(e, tabId) {
  debugLog(tabId, `AI error: ${e.message}`);
  if (e instanceof GeminiError && e.kind === 'rate-limit') {
    const until = Date.now() + e.retryAfterMs;
    await updateSession({ rateLimitedUntil: until, detail: 'Gemini free-tier limit reached; pausing briefly.' });
    notifyTab(tabId, { action: MSG.STATUS, text: `Helper is resting for ${Math.ceil(e.retryAfterMs / 1000)}s (API limit).`, autoHideMs: 6000 });
  } else if (e instanceof GeminiError && e.kind === 'auth') {
    notifyTab(tabId, { action: MSG.STATUS, text: '❌ The Gemini API key was rejected. Check Settings in the helper.', autoHideMs: 8000 });
    await stopListening({ status: STATUS.ERROR, detail: e.message });
  } else {
    // Never fail silently: the person just asked for something and is waiting.
    const text = e instanceof GeminiError && (e.kind === 'busy' || e.kind === 'timeout' || e.kind === 'network')
      ? '😕 The AI service is busy or unreachable right now. Please ask again in a moment.'
      : `⚠️ Sorry, something went wrong: ${String(e.message || e).slice(0, 80)}`;
    notifyTab(tabId, { action: MSG.STATUS, text, autoHideMs: 7000 });
    await updateSession({ detail: e.message });
  }
  return { status: `❌ ${e.message}` };
}

/** Clip-mode audio from the offscreen document. */
export async function processAudioClip(clip) {
  const session = await getSession();
  await updateMetrics((m) => bump(m, 'clipsReceived'));
  const stale = staleReason(clip, session, Date.now());
  if (stale) {
    await updateMetrics((m) => bump(m, 'clipsSkipped'));
    if (clip.wake && stale === 'rate-limited') {
      const tabId = await findTargetTab(session.captureTabId);
      notifyTab(tabId, { action: MSG.STATUS, text: '⏳ The helper is resting for a few seconds (API limit). Please ask again soon.', autoHideMs: 6000 });
    }
    return { status: `⏭️ Skipped (${stale})` };
  }
  await updateSession({ lastSeqHandled: clip.seq, status: STATUS.PROCESSING });

  let tabId = null;
  try {
    tabId = await findTargetTab(session.captureTabId);
    // Tell the person right away that the request was caught (before the AI answers).
    notifyTab(tabId, { action: MSG.STATUS, text: '🎧 Got it, thinking…', autoHideMs: 8000 });
    debugLog(tabId, `clip #${clip.seq} sent: ${(clip.durationMs / 1000).toFixed(1)} s of audio (${clip.reason}), waiting for AI…`);
    const snapshot = await getSnapshot(tabId);
    const { result, latencyMs, model, modelVersion } = await askGemini({
      input: { audioBase64: clip.audioBase64, mimeType: clip.mimeType, durationMs: clip.durationMs, wake: clip.wake === true },
      elements: snapshot.elements,
      previousTranscript: session.lastTranscript
    });
    const sinceSpeechEnd = clip.capturedAt ? Date.now() - clip.capturedAt : null;
    debugLog(tabId, `heard: "${result.transcript || ''}" | command: ${result.isCommand} | target: ${result.target || '-'} | AI ${latencyMs} ms (${modelVersion || model})${sinceSpeechEnd != null ? ` | ${sinceSpeechEnd} ms since you stopped talking` : ''}`);
    if (result.transcript) {
      await updateSession({ lastTranscript: result.transcript.slice(-200), lastHeard: result.transcript.slice(-120) });
    }
    return await applyDecision({
      decision: decideFromModel(result, snapshot.elements),
      job: clip,
      tabId,
      snapshot,
      timings: { gemini: latencyMs, startedAt: clip.capturedAt }
    });
  } catch (e) {
    return handleGeminiError(e, tabId);
  } finally {
    await updateSession((s) => (s.status === STATUS.PROCESSING ? { status: STATUS.LISTENING } : null));
  }
}

/** A command typed by the user (MANUAL_COMMAND). */
export async function processText(text, { tabId: forcedTabId } = {}) {
  const session = await getSession();
  const tabId = forcedTabId || (await findTargetTab(session.captureTabId));
  if (!tabId) throw new Error('No page to point on');

  try {
    const snapshot = await getSnapshot(tabId);
    let decision = decideFromText(text, snapshot.elements);
    let gemini = null;
    if (!decision) {
      const { apiKey } = await getSettings();
      if (apiKey) {
        const { result, latencyMs } = await askGemini({ input: { text }, elements: snapshot.elements, previousTranscript: '' });
        gemini = latencyMs;
        decision = decideFromModel(result, snapshot.elements);
        // A typed command is always meant as a command; fall back to the matcher.
        if (decision.kind === 'ignore') decision = decideFromText(text, snapshot.elements, { allowAmbiguous: true });
      } else {
        decision = decideFromText(text, snapshot.elements, { allowAmbiguous: true });
      }
    }
    return await applyDecision({
      decision,
      tabId,
      snapshot,
      typed: true,
      timings: { gemini, startedAt: Date.now() }
    });
  } catch (e) {
    return handleGeminiError(e, tabId);
  }
}
