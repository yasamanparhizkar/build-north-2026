// Isolated overlay: one host element with a closed Shadow DOM, so host-page CSS
// cannot restyle the pointer and our CSS cannot leak into the page.
import { OVERLAY_CSS } from './styles.js';

export const OVERLAY_HOST_ID = 'senior-helper-root';

let host = null;
let shadow = null;

export function getOverlay() {
  if (!host) {
    host = document.createElement('div');
    host.id = OVERLAY_HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    shadow.append(style, layer);
  }
  // SPAs sometimes replace <body>; attach to <html> and re-attach if removed.
  if (!host.isConnected) document.documentElement.appendChild(host);
  return { host, root: shadow, layer: shadow.querySelector('.layer') };
}

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

