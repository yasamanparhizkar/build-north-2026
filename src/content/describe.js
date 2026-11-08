// Pure helpers for describing page elements (unit tested, no DOM access).
import { MAX_NAME_LENGTH } from '../shared/constants.js';

/** Map a normalized center point (0..1) to a human region like "top-left". */
export function regionFor(cx, cy) {
  const horiz = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
  const vert = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle';
  return `${vert}-${horiz}`;
}

/** Collapse whitespace, strip control characters, truncate. */
export function normalizeName(text, maxLength = MAX_NAME_LENGTH) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Back-compat helper: combine an accessible name and visible text. */
export function buildElementText(ariaOrTitle, inner, maxLength = 80) {
  return normalizeName(`${ariaOrTitle || ''} ${inner || ''}`, maxLength);
}

/** Escape text for libraries that render strings as HTML (e.g. Driver.js popovers). */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Two names refer to the same control (case/whitespace-insensitive). */
export function namesMatch(a, b) {
  const n = (s) => normalizeName(s).toLowerCase();
  return n(a) === n(b) && n(a) !== '';
}

/** True if a rect overlaps the viewport and is not a speck. */
export function isRectVisible(rect, vw, vh, minSize = 8) {
  return rect.width >= minSize && rect.height >= minSize &&
    rect.top + rect.height > 0 && rect.left + rect.width > 0 && rect.top < vh && rect.left < vw;
}

export function hasSize(rect, minSize = 8) {
  return rect.width >= minSize && rect.height >= minSize;
}

const INPUT_ROLES = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox',
  email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', number: 'spinbutton', password: 'textbox', '': 'textbox'
};

/** Implicit ARIA role for common interactive tags. */
export function implicitRole(tag, type = '', hasHref = false, editable = false) {
  switch (tag) {
    case 'button': return 'button';
    case 'a': return hasHref ? 'link' : 'generic';
    case 'input': return INPUT_ROLES[type] || 'textbox';
    case 'select': return 'combobox';
    case 'textarea': return 'textbox';
    case 'summary': return 'button';
    default: return editable ? 'textbox' : 'generic';
  }
}
