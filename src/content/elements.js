// Scans the DOM for visible interactive elements.
import { MAX_ELEMENTS } from '../shared/constants.js';
import { buildElementText, isRectVisible, regionFor } from './describe.js';

const SELECTORS =
  'button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [aria-label], [data-tooltip]';

export function collectInteractiveElements() {
  document.querySelectorAll('[data-senior-id]').forEach((el) => el.removeAttribute('data-senior-id'));

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const list = [];
  let counter = 1;

  for (const el of document.querySelectorAll(SELECTORS)) {
    if (list.length >= MAX_ELEMENTS) break;
    const rect = el.getBoundingClientRect();
    if (!isRectVisible(rect, vw, vh)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;

    const aria = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title');
    const text = buildElementText(aria, (el.innerText || el.placeholder || el.value || '').trim());
    if (!text) continue;

    const cx = (rect.left + rect.width / 2) / vw;
    const cy = (rect.top + rect.height / 2) / vh;
    const id = `sh-${counter++}`;
    el.setAttribute('data-senior-id', id);
    list.push({
      id,
      tag: el.tagName.toLowerCase(),
      text,
      region: regionFor(cx, cy),
      x: +cx.toFixed(2),
      y: +cy.toFixed(2)
    });
  }
  return list;
}

