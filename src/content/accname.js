// Role and accessible-name computation (simplified accname algorithm), plus descriptive
// names for controls the page never labelled.
// PRIVACY: never reads the value or text typed into fields (inputs, textareas,
// contenteditable). Only labels, placeholders, button captions, link targets, attributes
// and page text outside fields are used.
import { implicitRole, normalizeName } from './describe.js';
import { fieldWord, hashText, iconWord, linkWord, nearbyName, unlabeledName } from './nameHints.js';

const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const BUTTON_INPUTS = new Set(['button', 'submit', 'reset']);
const FIELD_TAGS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]';
const CONTROL_TAGS = 'button, a[href], input, textarea, select, [contenteditable], [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"]';
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const TEXT_LEAVES = `${HEADINGS}, span, p, td, th, li, label, strong, em, a, div`;
const MAX_ICON_NODES = 30;
const NEARBY_LEVELS = 3;

/** Vision-inferred names, set after a screenshot crop was named (see vision.js). */
const visionNames = new WeakMap();

export function setVisionName(el, name) {
  const clean = normalizeName(name);
  if (clean) visionNames.set(el, clean);
}

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

/** The label the page itself provides (the original rules). */
function domName(el, role) {
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

/** Labels that sit on a descendant: an inner aria-label, SVG <desc>, image or tooltip title. */
function descendantLabel(el) {
  return el.querySelector('[aria-label]')?.getAttribute('aria-label')
    || el.querySelector('svg desc')?.textContent
    || el.querySelector('img[title]')?.getAttribute('title')
    || el.querySelector('[title]')?.getAttribute('title')
    || '';
}

/** Class, id and test-hook tokens of the element and its icon children (never text). */
function iconTokens(el) {
  const tokens = [];
  for (const node of [el, ...el.querySelectorAll('*')].slice(0, MAX_ICON_NODES)) {
    for (const attr of ['class', 'id', 'data-icon', 'data-testid', 'data-test']) {
      const value = node.getAttribute(attr);
      if (value) tokens.push(value);
    }
    const use = node.getAttribute('href') || node.getAttribute('xlink:href');
    if (use?.startsWith('#')) tokens.push(use.slice(1));
  }
  return tokens;
}

/** Field name from its autocomplete/name/type, or "Search"/"Submit" for a search form's button. */
function formWord(el, role) {
  if (isField(el, role)) {
    return fieldWord({
      autocomplete: el.getAttribute('autocomplete') || '',
      name: el.getAttribute('name') || '',
      type: el.getAttribute('type') || ''
    });
  }
  const type = (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
  const form = el.closest('form');
  if (role === 'button' && type === 'submit' && form && !form.querySelector('input[type="password"]')
    && form.querySelector('input[type="search"], input[name="q"], input[name="query"], input[name="search"], [role="search"]')) {
    return 'Search';
  }
  return '';
}

/** The nearest short text outside this control and outside other controls, e.g. a row's subject line. */
function nearbyText(el) {
  let scope = el.parentElement;
  for (let level = 0; scope && level < NEARBY_LEVELS; level++, scope = scope.parentElement) {
    let fallback = '';
    for (const node of scope.querySelectorAll(TEXT_LEAVES)) {
      if (node.children.length || el.contains(node)) continue;
      if (node.closest(CONTROL_TAGS) || node.closest(FIELD_TAGS)) continue; // never read typed or control text
      const text = normalizeName(node.textContent);
      if (text.length < 2 || text.length > 30) continue;
      if (node.matches(HEADINGS)) return text;
      fallback ||= text;
    }
    if (fallback) return fallback;
  }
  return '';
}

/** A descriptive guess for a control with no label, in order of how reliable the clue is. */
function guessName(el, role) {
  const icon = iconWord(iconTokens(el));
  if (icon) return { name: icon, source: 'icon' };
  const link = el.tagName === 'A' ? linkWord(el.getAttribute('href')) : '';
  if (link) return { name: link, source: 'link' };
  const form = formWord(el, role);
  if (form) return { name: form, source: 'form' };
  const near = nearbyName(role, nearbyText(el));
  if (near) return { name: near, source: 'nearby' };
  return { name: unlabeledName(role), source: 'unlabeled' };
}

/**
 * @returns {{name: string, source: 'dom'|'vision'|'icon'|'link'|'form'|'nearby'|'unlabeled'}}
 * `source` other than 'dom' means the name was inferred; such names are never empty.
 */
export function accessibleNameInfo(el, role = computeRole(el)) {
  const dom = domName(el, role);
  if (dom) return { name: dom, source: 'dom' };
  const extra = normalizeName(descendantLabel(el));
  if (extra) return { name: extra, source: 'dom' };
  const vision = visionNames.get(el);
  if (vision) return { name: vision, source: 'vision' };
  return guessName(el, role);
}

export function accessibleName(el, role = computeRole(el)) {
  return accessibleNameInfo(el, role).name;
}

/** Fingerprint of how a control looks (tag, classes, icon path or image), with no text in it. */
export function controlSignature(el) {
  const parts = [
    el.tagName,
    el.getAttribute('class') || '',
    el.querySelector('path')?.getAttribute('d') || '',
    el.querySelector('img')?.getAttribute('src') || '',
    el.querySelector('use')?.getAttribute('href') || ''
  ];
  return hashText(parts.join('|'));
}
