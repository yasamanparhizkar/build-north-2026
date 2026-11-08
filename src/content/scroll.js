// Scroll hints. The helper never scrolls the page; it only points: at the page's own
// scroll control when one is visible, otherwise at the edge of the scrolling area.
import { topRect } from './elements.js';
import { getOverlay } from './overlay.js';
import { hideSpotlight, showSpotlight } from './spotlight/index.js';
import { showPointers } from './pointer.js';

const SCROLL_CONTROL = {
  down: /^(scroll down|page down|scroll to bottom|go down|down)$/i,
  up: /^(scroll up|page up|scroll to top|back to top|go up|up)$/i
};
const MIN_COVER = 0.25; // a scroller must fill at least a quarter of the window
const EDGE_WIDTH = 120;
const EDGE_HEIGHT = 48;
const EDGE_INSET = 24;
const MOVED_PX = 40; // the person has scrolled enough: the hint is no longer needed
const HINT_MS = 8000;

/** The element that actually scrolls: the page itself, or the largest visible scrolling pane. */
export function findScroller(vw, vh) {
  const root = document.scrollingElement;
  if (root && root.scrollHeight > root.clientHeight + 4) return root;
  let best = null;
  let bestArea = 0;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (el.scrollHeight <= el.clientHeight + 4) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const r = topRect(el);
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const area = w * h;
    if (area >= MIN_COVER * vw * vh && area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

function atEnd(el, direction) {
  const max = el.scrollHeight - el.clientHeight;
  return direction === 'down' ? el.scrollTop >= max - 2 : el.scrollTop <= 2;
}

/**
 * @param {'up'|'down'} direction
 * @param {Array<object>} described visible elements from scanPage()
 * @returns {{ok: boolean, where?: string, reason?: string}}
 */
export function showScrollHint(direction, described) {
  const vw = innerWidth;
  const vh = innerHeight;

  const control = described.find((d) => d.enabled && SCROLL_CONTROL[direction].test(d.name.trim()));
  if (control) {
    showPointers([control.el], { label: `Click ${control.name}` });
    return { ok: true, where: 'control' };
  }

  const scroller = findScroller(vw, vh);
  if (!scroller) return { ok: false, reason: 'no-scroller' };
  if (atEnd(scroller, direction)) {
    return { ok: false, reason: 'at-end', where: direction === 'down' ? 'bottom' : 'top' };
  }

  // Anchor the hint on the scroller's visible edge, on the right side, near the bottom (down) or top (up).
  const r = topRect(scroller);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, vh);
  const right = Math.min(r.right, vw);
  const left = Math.max(0, right - EDGE_WIDTH - EDGE_INSET);
  const anchorTop = direction === 'down' ? bottom - EDGE_HEIGHT - EDGE_INSET : top + EDGE_INSET;

  const { layer } = getOverlay();
  const anchor = document.createElement('div');
  anchor.style.cssText = `position:fixed;left:${left}px;top:${anchorTop}px;width:${EDGE_WIDTH}px;height:${EDGE_HEIGHT}px;pointer-events:none;`;
  layer.appendChild(anchor);

  const scrollTarget = scroller === document.scrollingElement ? window : scroller;
  const start = scroller.scrollTop;
  const onScroll = () => {
    if (Math.abs(scroller.scrollTop - start) > MOVED_PX) hideSpotlight('scrolled');
  };
  scrollTarget.addEventListener('scroll', onScroll, { passive: true });

  const text = `Scroll ${direction}. You can also use your mouse wheel, trackpad or the arrow keys.`;
  showSpotlight(anchor, text, {
    padding: 8,
    scroll: false,
    dismissOnActivate: false,
    timeoutMs: HINT_MS,
    onClose: () => {
      anchor.remove();
      scrollTarget.removeEventListener('scroll', onScroll);
    }
  });
  return { ok: true, where: 'edge', text };
}
