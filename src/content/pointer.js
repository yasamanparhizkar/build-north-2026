// Adapter between the content script (main.js) and the spotlight module.
// Keeps the existing interface: showPointers / clearPointers / pointerCount / describeSpotlight.
// Never clicks or focuses the target.
import { showStatus } from './badge.js';
import { topRect } from './elements.js';
import { destroySpotlight, getSpotlightState, showSpotlight } from './spotlight/index.js';

const MAX_LABEL_LENGTH = 80;

/** Turn a short label ("Click Compose") into a calm instruction sentence. */
export function toInstruction(label, count) {
  if (count > 1) return 'Is it one of these?';
  const text = String(label || 'Click here').trim().slice(0, MAX_LABEL_LENGTH);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * @param {Array<Element>} elements validated live elements (first = primary)
 * @param {{label?: string, ambiguous?: boolean, reacquire?: (index: number) => Element|null}} opts
 * @returns {Array<object>} top-level rects (diagnostics)
 */
export function showPointers(elements, { label = 'Click here', ambiguous = false, reacquire = null } = {}) {
  if (!elements?.length) return [];
  showSpotlight(elements[0], toInstruction(label, elements.length), {
    extraTargets: elements.slice(1),
    reacquire,
    onClose: (reason) => {
      if (reason === 'missing') showStatus('That button went away. Please ask again.', 4000);
    }
  });
  if (ambiguous || elements.length > 1) showStatus(`${elements.length} possible matches — ask which one.`, 6000);
  return elements.map((el) => topRect(el));
}

export function clearPointers() {
  destroySpotlight();
}

export function pointerCount() {
  return getSpotlightState().targets;
}

/** Diagnostics for tests: what the spotlight is currently showing (viewport px). */
export function describeSpotlight() {
  const s = getSpotlightState();
  return {
    backdrops: s.active ? 1 : 0,
    backdropVisible: s.active && s.holes.some((h) => h.visible),
    halos: s.holes,
    cards: s.label ? [s.label] : [],
    label: s.label
  };
}
