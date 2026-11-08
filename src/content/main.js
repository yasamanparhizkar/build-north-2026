// Content script entry (top frame): answers the background worker.
import { MAX_SNAPSHOTS } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import { indicatorStopRect, setIndicator, showStatus } from './badge.js';
import { clearDriverPointer, driverLabelState, driverPointerActive, showDriverPointer } from './driverPointer.js';
import { scanPage, topRect } from './elements.js';
import { clearPointers, describeSpotlight, pointerCount, showPointers } from './pointer.js';
import { SnapshotRegistry } from './snapshot.js';
import { showScrollHint } from './scroll.js';
import { normalizeName } from './describe.js';
import { controlSignature, setVisionName } from './accname.js';
import { resolveTarget } from './validate.js';

const registry = new SnapshotRegistry({ max: MAX_SNAPSHOTS });

function getElements() {
  const t0 = performance.now();
  const described = scanPage();
  const { snapshotId, ids } = registry.create(described);
  const elements = described.map((d, i) => ({
    id: ids[i], role: d.role, name: d.name, region: d.region, x: d.x, y: d.y, enabled: d.enabled, inferred: !!d.inferred
  }));
  return { snapshotId, elements, scanMs: Math.round(performance.now() - t0) };
}

function highlight({ snapshotId, targets, label, ambiguous }) {
  if (!Array.isArray(targets) || !targets.length) return { ok: false, reason: 'no-targets' };
  const resolved = targets.slice(0, 3).map((t) => resolveTarget(registry, String(snapshotId), t));
  const liveIdx = resolved.map((r, i) => (r.el ? i : -1)).filter((i) => i >= 0);
  const live = liveIdx.map((i) => resolved[i]);
  if (!live.length) return { ok: false, reason: resolved[0].reason };
  // If a framework re-renders the target, find it again by the same validated role+name.
  const reacquire = (k) => resolveTarget(registry, String(snapshotId), targets[liveIdx[k]]).el;
  const rects = showPointers(live.map((r) => r.el), { label: String(label || 'Click here'), ambiguous: !!ambiguous, reacquire });
  return { ok: true, count: live.length, rematched: live.some((r) => r.rematched), rects, renderer: 'spotlight', ui: describeSpotlight() };
}

/**
 * Optional Driver.js renderer for a single target. Validation is identical;
 * multiple candidates or a load failure fall back to the built-in spotlight.
 */
async function highlightWith(request) {
  if (request.renderer !== 'driver') return highlight(request);
  const targets = Array.isArray(request.targets) ? request.targets : [];
  if (targets.length !== 1) return highlight(request);
  const r = resolveTarget(registry, String(request.snapshotId), targets[0]);
  if (!r.el) return { ok: false, reason: r.reason };
  try {
    clearPointers();
    await showDriverPointer(r.el, { label: String(request.label || 'Click here') });
    return { ok: true, count: 1, rematched: !!r.rematched, rects: [topRect(r.el)], renderer: 'driver', ui: uiState() };
  } catch (e) {
    console.warn('[Senior Helper] Driver.js failed, using built-in spotlight', e);
    return highlight(request);
  }
}

function clearAll() {
  clearPointers();
  clearDriverPointer();
}

/** Extra diagnostics returned with responses (used by integration tests; no page data). */
const uiState = () => ({ ...describeSpotlight(), driverActive: driverPointerActive(), driverLabel: driverLabelState(), stopButton: indicatorStopRect() });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !request || typeof request.action !== 'string') return;
  switch (request.action) {
    case MSG.GET_ELEMENTS:
      sendResponse(getElements());
      break;
    case MSG.HIGHLIGHT:
      clearDriverPointer();
      highlightWith(request).then(sendResponse);
      return true; // async response
    case MSG.GET_RECTS: {
      // Viewport rects and appearance fingerprints for vision naming; no names or text.
      const items = {};
      for (const id of request.ids || []) {
        const el = registry.lookup(String(request.snapshotId), String(id))?.ref.deref();
        if (el?.isConnected) items[id] = { rect: topRect(el), sig: controlSignature(el) };
      }
      sendResponse({ vw: innerWidth, vh: innerHeight, items });
      break;
    }
    case MSG.SET_NAMES: {
      for (const [id, name] of Object.entries(request.names || {})) {
        const entry = registry.lookup(String(request.snapshotId), id);
        const el = entry?.ref.deref();
        if (!el) continue;
        setVisionName(el, name);
        entry.name = normalizeName(name); // keeps resolveTarget's name check in step
      }
      sendResponse({ ok: true });
      break;
    }
    case MSG.SCROLL_HINT:
      clearAll();
      sendResponse({ ...showScrollHint(request.direction === 'up' ? 'up' : 'down', scanPage()), ui: uiState() });
      break;
    case MSG.STATUS:
      showStatus(String(request.text || ''), request.autoHideMs);
      sendResponse({ ok: true });
      break;
    case MSG.INDICATOR:
      setIndicator(!!request.listening, typeof request.label === 'string' ? request.label.slice(0, 60) : undefined);
      sendResponse({ ok: true, ui: uiState() });
      break;
    case MSG.CLEAR_HIGHLIGHT: {
      // wasActive tells the popup whether a highlight was showing (Escape clears it first, then closes).
      const wasActive = pointerCount() > 0 || driverPointerActive();
      clearAll();
      sendResponse({ ok: true, wasActive, status: 'Cleared pointer', remaining: pointerCount(), ui: uiState() });
      break;
    }
  }
});

addEventListener('pagehide', () => {
  clearAll();
  registry.clear();
});
