// The pointer: highlight box + arrow + label per target, kept glued to the element.
// Never clicks or focuses anything; pointer-events are disabled on every part.
import { HIGHLIGHT_TIMEOUT_MS } from '../shared/constants.js';
import { showStatus } from './badge.js';
import { isDisplayed, topRect } from './elements.js';
import { getOverlay, prefersReducedMotion } from './overlay.js';

const ARROW_DOWN = '<svg viewBox="0 0 24 24"><path d="M12 23 3 12h6V1h6v11h6z" fill="#e0115f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const ARROW_UP = '<svg viewBox="0 0 24 24"><path d="M12 1 21 12h-6v11H9V12H3z" fill="#e0115f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const PAD = 8;

let active = null; // { items, timer, raf }

function makeItem(layer, el, label, index, single) {
  const box = document.createElement('div');
  box.className = single ? 'box spotlight' : 'box';
  const arrow = document.createElement('div');
  arrow.className = 'arrow';
  const text = document.createElement('div');
  text.className = single ? 'label' : 'num';
  text.textContent = single ? `👆 ${label}` : String(index + 1); // textContent: never HTML
  layer.append(box, arrow, text);
  return { el, box, arrow, text, single, arrowDir: null };
}

function place(item) {
  const r = topRect(item.el);
  const hidden = !item.el.isConnected || r.width < 2 || r.height < 2 || !isDisplayed(item.el);
  for (const n of [item.box, item.arrow, item.text]) n.classList.toggle('hidden', hidden);
  if (hidden) return false;

  Object.assign(item.box.style, {
    left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px`
  });

  // Arrow above the element pointing down, or below pointing up near the top edge.
  const below = r.top < 110;
  const dir = below ? 'up' : 'down';
  if (item.arrowDir !== dir) {
    item.arrow.innerHTML = below ? ARROW_UP : ARROW_DOWN; // static, trusted SVG
    item.arrowDir = dir;
  }
  const cx = r.left + r.width / 2;
  const arrowTop = below ? r.top + r.height + PAD + 4 : r.top - PAD - 60;
  Object.assign(item.arrow.style, { left: `${cx - 28}px`, top: `${arrowTop}px` });

  const vw = window.innerWidth;
  if (item.single) {
    const labelTop = below ? arrowTop + 60 : arrowTop - 46;
    const width = Math.min(320, item.text.offsetWidth || 200);
    const left = Math.min(Math.max(8, cx - width / 2), vw - width - 8);
    Object.assign(item.text.style, { left: `${left}px`, top: `${Math.max(4, labelTop)}px` });
  } else {
    Object.assign(item.text.style, { left: `${r.left - PAD - 17}px`, top: `${r.top - PAD - 17}px` });
  }
  return true;
}

function tick() {
  if (!active) return;
  const anyAlive = active.items.some((i) => i.el.isConnected);
  if (!anyAlive) {
    clearPointers();
    showStatus('That button went away. Please ask again.', 4000);
    return;
  }
  active.items.forEach(place);
  active.raf = requestAnimationFrame(tick);
}

/**
 * @param {Array<Element>} elements  validated live elements
 * @param {{label: string, ambiguous?: boolean}} opts
 * @returns {Array<object>} top-level rects (for diagnostics/tests)
 */
export function showPointers(elements, { label, ambiguous = false }) {
  clearPointers();
  const { layer } = getOverlay();
  const single = elements.length === 1;

  const first = elements[0];
  const r = topRect(first);
  if (r.top < 0 || r.left < 0 || r.top + r.height > window.innerHeight || r.left + r.width > window.innerWidth) {
    first.scrollIntoView({ block: 'center', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  active = { items: elements.map((el, i) => makeItem(layer, el, label, i, single)), timer: null, raf: 0 };
  active.items.forEach(place);
  active.raf = requestAnimationFrame(tick);
  active.timer = setTimeout(clearPointers, HIGHLIGHT_TIMEOUT_MS);

  if (ambiguous || !single) showStatus(`🔢 ${label} (${elements.length} choices)`, 8000);
  else showStatus(`✅ ${label}`, 4000);

  return elements.map((el) => topRect(el));
}

export function clearPointers() {
  if (!active) return;
  clearTimeout(active.timer);
  cancelAnimationFrame(active.raf);
  for (const i of active.items) { i.box.remove(); i.arrow.remove(); i.text.remove(); }
  active = null;
}

export function pointerCount() {
  return active ? active.items.length : 0;
}
