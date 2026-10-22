// Scans the page for interactive elements: the main document, open shadow
// roots and same-origin iframes. Coordinates are in the top-level viewport.
import { MAX_ELEMENTS, MAX_OFFSCREEN_ELEMENTS, MAX_SAME_NAME } from '../shared/constants.js';
import { accessibleName, computeRole } from './accname.js';
import { hasSize, isRectVisible, limitCandidates, regionFor } from './describe.js';
import { OVERLAY_HOST_ID } from './overlay.js';

export const INTERACTIVE_SELECTOR = [
  'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="option"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
  '[role="combobox"]', '[role="searchbox"]', '[role="textbox"]', '[role="treeitem"]', '[role="slider"]',
  '[contenteditable="true"]', '[aria-label][tabindex]', '[data-tooltip][tabindex]', '[onclick]'
].join(',');

// A match nested inside one of these is part of the outer control, not a separate one.
const CONTAINER_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
const MAX_NODES = 30000;
const MAX_FRAME_DEPTH = 4;

/** Rect of `el` in top-level viewport coordinates (handles same-origin iframes). */
export function topRect(el) {
  const r = el.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  let win = el.ownerDocument.defaultView;
  try {
    while (win && win.frameElement) {
      const fe = win.frameElement;
      const fr = fe.getBoundingClientRect();
      left += fr.left + fe.clientLeft;
      top += fr.top + fe.clientTop;
      win = win.parent;
    }
  } catch {
    /* cross-origin ancestor: best effort */
  }
  return { left, top, width: r.width, height: r.height };
}

export function isDisplayed(el) {
  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  } else {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  }
  return !el.closest('[aria-hidden="true"], [inert]');
}

function scanRoot(root, out, budget, depth) {
  const doc = root.ownerDocument || root;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.id === OVERLAY_HOST_ID ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let node;
  while ((node = walker.nextNode()) && budget.left-- > 0) {
    if (node.matches(INTERACTIVE_SELECTOR) && !node.parentElement?.closest(CONTAINER_SELECTOR)) out.push(node);
    if (node.shadowRoot) scanRoot(node.shadowRoot, out, budget, depth);
    if ((node.tagName === 'IFRAME' || node.tagName === 'FRAME') && depth < MAX_FRAME_DEPTH) {
      let frameDoc = null;
      try {
        frameDoc = node.contentDocument; // null for cross-origin frames
      } catch {
        frameDoc = null;
      }
      if (frameDoc?.documentElement) scanRoot(frameDoc, out, budget, depth + 1);
    }
  }
}

/** Describe one element, or null if it should not be offered. */
export function describeElement(el, vw, vh) {
  const rect = topRect(el);
  if (!hasSize(rect) || !isDisplayed(el)) return null;
  const role = computeRole(el);
  const name = accessibleName(el, role);
  if (!name) return null;
  const cx = Math.min(1, Math.max(0, (rect.left + rect.width / 2) / vw));
  const cy = Math.min(1, Math.max(0, (rect.top + rect.height / 2) / vh));
  return {
    el,
    role,
    name,
    rect,
    region: regionFor(cx, cy),
    x: +cx.toFixed(2),
    y: +cy.toFixed(2),
    visible: isRectVisible(rect, vw, vh),
    enabled: !(el.disabled || el.getAttribute('aria-disabled') === 'true')
  };
}

/** @returns {Array<object>} described candidates (with live `el` references) */
export function scanPage({ limit = true } = {}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nodes = [];
  scanRoot(document, nodes, { left: MAX_NODES }, 0);
  const described = [];
  for (const el of nodes) {
    const d = describeElement(el, vw, vh);
    if (d) described.push(d);
  }
  return limit
    ? limitCandidates(described, { maxVisible: MAX_ELEMENTS, maxOffscreen: MAX_OFFSCREEN_ELEMENTS, maxSameName: MAX_SAME_NAME })
    : described;
}
