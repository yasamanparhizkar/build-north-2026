// Optional pointer renderer built on Driver.js (vendored in src/vendor/driver.js,
// MIT). Enabled via popup -> Settings -> Pointer style. Used for a single target;
// multiple candidates always use the built-in spotlight.
//
// Driver.js provides the overlay/stage and its positioning; its default popover is
// NOT used. The instruction is the same floating white text as the built-in
// spotlight (spotlight/typography.js), rendered in our Shadow DOM.
//
// Differences from the built-in spotlight (by design of Driver.js): its overlay
// lives in the page DOM with its CSS added to the page, the cutout edge is hard,
// and clicking the dark area closes it (the highlighted element stays clickable).
// Safety: never clicks; keyboard control disabled; focus Driver.js moves on its own
// is given back.
import { HIGHLIGHT_TIMEOUT_MS } from '../shared/constants.js';
import { showStatus } from './badge.js';
import { topRect } from './elements.js';
import { getOverlay, prefersReducedMotion } from './overlay.js';
import { padRect } from './spotlight/geometry.js';
import { InstructionLabel } from './spotlight/typography.js';

const BASE = 'src/vendor/driver.js/';
const CSS_ID = 'senior-helper-driver-css';
const PAD = 16;
const FOCUS_GUARD_MS = 1500;

let lib = null;
let active = null; // { d, el, label, timer, raf, cleanup }

function ensureCss() {
  if (document.getElementById(CSS_ID)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL(`${BASE}driver.css`);
    link.onload = link.onerror = () => resolve();
    (document.head || document.documentElement).appendChild(link);
  });
}

async function loadDriver() {
  lib ??= await import(chrome.runtime.getURL(`${BASE}driver.js.mjs`));
  await ensureCss();
  return lib.driver;
}

/** Give focus back if Driver.js moves it without the user doing anything. */
function guardFocus(target) {
  const previous = document.activeElement;
  let userActed = false;
  const onUser = () => { userActed = true; };
  const onFocus = (e) => {
    if (userActed) return;
    const t = e.target;
    if (t === target || target.contains?.(t)) {
      if (previous && previous !== document.body && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      else t.blur?.();
    }
  };
  addEventListener('pointerdown', onUser, true);
  addEventListener('keydown', onUser, true);
  addEventListener('focusin', onFocus, true);
  const stop = () => {
    removeEventListener('pointerdown', onUser, true);
    removeEventListener('keydown', onUser, true);
    removeEventListener('focusin', onFocus, true);
  };
  const timer = setTimeout(stop, FOCUS_GUARD_MS);
  return () => { clearTimeout(timer); stop(); };
}

/**
 * @param {Element} el  validated live element
 * @param {{label: string}} opts
 */
export async function showDriverPointer(el, { label }) {
  clearDriverPointer();
  const driver = await loadDriver();
  const reduced = prefersReducedMotion();
  const cleanupFocus = guardFocus(el);
  const onKey = (e) => { if (e.key === 'Escape') clearDriverPointer(); };

  const d = driver({
    animate: !reduced,
    smoothScroll: !reduced,
    overlayColor: '#000',
    overlayOpacity: 0.82,
    stagePadding: PAD,
    stageRadius: 14,
    allowClose: true,
    allowKeyboardControl: false,
    disableActiveInteraction: false,
    onDestroyed: () => { if (active?.d === d) teardown(); }
  });
  d.highlight({ element: el }); // no popover: we render our own floating text

  const { layer } = getOverlay();
  const text = /[.!?]$/.test(label) ? label : `${label}.`;
  const labelEl = new InstructionLabel(layer, { text, onClose: () => clearDriverPointer() });
  addEventListener('keydown', onKey, true);

  active = { d, el, label: labelEl, raf: 0, timer: setTimeout(clearDriverPointer, HIGHLIGHT_TIMEOUT_MS), cleanup: () => { cleanupFocus(); removeEventListener('keydown', onKey, true); } };
  let frame = 0;
  const loop = () => {
    if (!active) return;
    if (!active.el.isConnected) {
      clearDriverPointer();
      showStatus('That button went away. Please ask again.', 4000);
      return;
    }
    const vp = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    active.label.place(padRect(topRect(active.el), PAD), vp);
    active.label.setVisible(true);
    if (++frame % 15 === 0) active.d.refresh(); // catch layout changes Driver.js doesn't observe
    active.raf = requestAnimationFrame(loop);
  };
  loop();
}

function teardown() {
  const a = active;
  active = null;
  if (!a) return;
  clearTimeout(a.timer);
  cancelAnimationFrame(a.raf);
  a.cleanup();
  a.label.remove();
}

export function clearDriverPointer() {
  if (!active) return;
  const { d } = active;
  teardown();
  if (d.isActive()) d.destroy();
}

export function driverPointerActive() {
  return !!active;
}

export function driverLabelState() {
  return active ? active.label.rect() : null;
}
