// Content script entry (top frame): answers the background worker.
import { MAX_SNAPSHOTS } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import { setIndicator, showStatus } from './badge.js';
import { scanPage } from './elements.js';
import { clearPointers, pointerCount, showPointers } from './pointer.js';
import { SnapshotRegistry } from './snapshot.js';
import { resolveTarget } from './validate.js';

const registry = new SnapshotRegistry({ max: MAX_SNAPSHOTS });

function getElements() {
  const t0 = performance.now();
  const described = scanPage();
  const { snapshotId, ids } = registry.create(described);
  const elements = described.map((d, i) => ({
    id: ids[i], role: d.role, name: d.name, region: d.region, x: d.x, y: d.y, visible: d.visible, enabled: d.enabled
  }));
  return { snapshotId, elements, scanMs: Math.round(performance.now() - t0) };
}

function highlight({ snapshotId, targets, label, ambiguous }) {
  if (!Array.isArray(targets) || !targets.length) return { ok: false, reason: 'no-targets' };
  const resolved = targets.slice(0, 3).map((t) => resolveTarget(registry, String(snapshotId), t));
  const live = resolved.filter((r) => r.el);
  if (!live.length) return { ok: false, reason: resolved[0].reason };
  const rects = showPointers(live.map((r) => r.el), { label: String(label || 'Click here').slice(0, 40), ambiguous: !!ambiguous });
  return { ok: true, count: live.length, rematched: live.some((r) => r.rematched), rects };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !request || typeof request.action !== 'string') return;
  switch (request.action) {
    case MSG.GET_ELEMENTS:
      sendResponse(getElements());
      break;
    case MSG.HIGHLIGHT:
      sendResponse(highlight(request));
      break;
    case MSG.STATUS:
      showStatus(String(request.text || ''), request.autoHideMs);
      sendResponse({ ok: true });
      break;
    case MSG.INDICATOR:
      setIndicator(!!request.listening);
      sendResponse({ ok: true });
      break;
    case MSG.CLEAR_HIGHLIGHT:
      clearPointers();
      sendResponse({ ok: true, status: 'Cleared pointer', remaining: pointerCount() });
      break;
  }
});

addEventListener('pagehide', () => {
  clearPointers();
  registry.clear();
});
