// Role and accessible-name computation (simplified accname algorithm).
// PRIVACY: never reads the value or text typed into fields (inputs, textareas,
// contenteditable). Only labels, placeholders and button captions are used.
import { implicitRole, normalizeName } from './describe.js';

const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const BUTTON_INPUTS = new Set(['button', 'submit', 'reset']);

export function computeRole(el) {
  const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  return implicitRole(tag, (el.getAttribute('type') || '').toLowerCase(), el.hasAttribute('href'), el.isContentEditable);
}

function textOfIds(el, attr) {
  const ids = (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean);
  const root = el.getRootNode();
  return ids.map((id) => (root.getElementById ? root.getElementById(id) : el.ownerDocument.getElementById(id))?.textContent || '').join(' ');
}

function iconName(el) {
  const img = el.querySelector('img[alt]');
  if (img?.alt) return img.alt;
  const svgTitle = el.querySelector('svg title');
  return svgTitle?.textContent || '';
}

export function isField(el, role) {
  const tag = el.tagName;
  if (tag === 'INPUT') return !BUTTON_INPUTS.has(el.type) && el.type !== 'image';
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || FIELD_ROLES.has(role);
}

export function accessibleName(el, role = computeRole(el)) {
  let name = textOfIds(el, 'aria-labelledby') || el.getAttribute('aria-label') || '';

  if (!name && el.tagName === 'INPUT' && BUTTON_INPUTS.has(el.type)) name = el.value || el.type; // a caption, not user data
  if (!name && el.tagName === 'INPUT' && el.type === 'image') name = el.alt;

  if (!name && isField(el, role)) {
    if (el.labels?.length) name = [...el.labels].map((l) => l.textContent).join(' ');
    if (!name) name = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
    if (!name && role === 'searchbox') name = 'Search';
    return normalizeName(name);
  }

  if (!name) name = el.innerText || '';
  if (!normalizeName(name)) name = iconName(el) || el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
  return normalizeName(name);
}

