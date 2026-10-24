// Status badge (bottom-right) and "listening" indicator with a Stop button (top-right).
import { MSG } from '../shared/messages.js';
import { getOverlay } from './overlay.js';

let badge = null;
let badgeTimer = null;
let indicator = null;

export function showStatus(text, autoHideMs) {
  const { layer } = getOverlay();
  if (!badge || !badge.isConnected) {
    badge = document.createElement('div');
    badge.className = 'badge';
    badge.setAttribute('role', 'status');
    layer.appendChild(badge);
  }
  badge.textContent = text;
  badge.classList.remove('hidden');
  clearTimeout(badgeTimer);
  if (autoHideMs) badgeTimer = setTimeout(() => badge.classList.add('hidden'), autoHideMs);
}

export function setIndicator(listening, label = 'Listening') {
  if (!listening) {
    indicator?.remove();
    indicator = null;
    return;
  }
  if (indicator?.isConnected) {
    indicator.querySelector('span').textContent = label;
    return;
  }
  const { layer } = getOverlay();
  indicator = document.createElement('div');
  indicator.className = 'indicator';
  const text = document.createElement('span');
  text.textContent = label;
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = 'Stop';
  stop.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: MSG.STOP_LISTENING }).catch(() => {});
    setIndicator(false);
  });
  indicator.append(text, stop);
  layer.appendChild(indicator);
}

/** Diagnostics for tests: Stop button rect (viewport px), or null if not shown. */
export function indicatorStopRect() {
  const btn = indicator?.isConnected ? indicator.querySelector('button') : null;
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
