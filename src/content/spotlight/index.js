// Senior Helper spotlight: a soft theatrical spotlight on an exact DOM element
// with floating white instruction text. Independent module:
//
//   showSpotlight(elementOrSelector, instruction, options) -> Promise<result>
//   updateSpotlight()     re-measure now (it also follows the target every frame)
//   hideSpotlight(reason) fade out, then destroy
//   destroySpotlight()    remove everything immediately
//
// Never clicks, focuses or blocks the page: every visual has pointer-events:none
// except the small close button. Real user clicks on the target pass through and
// (by default) end the guidance. Everything lives in the extension's closed
// Shadow DOM overlay (overlay.js), so page CSS and our CSS never mix.
import { getOverlay, prefersReducedMotion } from '../overlay.js';
import { isDisplayed, topRect } from '../elements.js';
import { inViewport, padRect } from './geometry.js';
import { SpotlightRenderer } from './renderer.js';
import { TargetTracker } from './tracker.js';
import { InstructionLabel, NumberMarkers } from './typography.js';

export const DEFAULTS = Object.freeze({
  padding: 16, // px around the target (12-20)
  radius: 14, // rounded corners of the lit area
  feather: 8, // softness of the light edge (Gaussian std-dev, px)
  opacity: 0.82, // darkness of the rest of the page
  scroll: true, // smooth-scroll the target into view first
  timeoutMs: 20000, // auto-hide; 0 = never
  dismissOnActivate: true, // hide after the user really clicks the target
  extraTargets: [], // further candidate elements (shown with numbers)
  reacquire: null, // (index) => Element|null, to follow framework re-renders
  onClose: null // (reason) => void; reasons: activated|escape|close-button|timeout|missing|api|replaced
});

const FADE_OUT_MS = 220;
const SCROLL_SETTLE_MAX_MS = 1200;

let current = null;

/** Element check that also works for nodes from same-origin iframes (other realms). */
const isElement = (x) => !!x && typeof x === 'object' && x.nodeType === 1 && typeof x.getBoundingClientRect === 'function';

/**
 * Resolve an element or a validated selector (must match exactly one element),
 * and refuse targets that cannot be shown.
 */
export function resolveSpotlightTarget(target) {
  let el = null;
  if (isElement(target)) {
    el = target;
  } else {
    if (typeof target !== 'string' || !target.trim()) return { el: null, reason: 'missing' };
    let matches;
    try {
      matches = document.querySelectorAll(target);
    } catch {
      return { el: null, reason: 'invalid-selector' };
    }
    if (matches.length === 0) return { el: null, reason: 'missing' };
    if (matches.length > 1) return { el: null, reason: 'ambiguous' };
    el = matches[0];
  }
  if (!el.isConnected) return { el: null, reason: 'missing' };
  const r = el.getBoundingClientRect();
  if (!isDisplayed(el) || r.width < 2 || r.height < 2) return { el: null, reason: 'hidden' };
  return { el };
}

class Spotlight {
  constructor(elements, instruction, opts) {
    this.opts = opts;
    this.closed = false;
    const { layer } = getOverlay();
    this.reduced = prefersReducedMotion();
    this.renderer = new SpotlightRenderer(layer, {
      count: elements.length, opacity: opts.opacity, feather: this.reduced ? Math.min(opts.feather, 6) : opts.feather, radius: opts.radius
    });
    this.label = new InstructionLabel(layer, { text: instruction, onClose: () => this.hide('close-button') });
    this.markers = elements.length > 1 ? new NumberMarkers(layer, elements.length) : null;
    this.shown = false;
    this.startedAt = performance.now();

    this.tracker = new TargetTracker(elements, {
      reacquire: opts.reacquire,
      onFrame: (targets, vp) => this.layout(targets, vp),
      onLost: () => this.hide('missing')
    });

    this.onKey = (e) => {
      if (e.key === 'Escape') this.hide('escape');
    };
    this.onClick = (e) => {
      if (!this.opts.dismissOnActivate || !e.isTrusted) return;
      const path = e.composedPath();
      if (this.tracker.elements.some((el) => path.includes(el))) setTimeout(() => this.hide('activated'), 150);
    };
    addEventListener('keydown', this.onKey, true);
    addEventListener('click', this.onClick, true);
    if (opts.timeoutMs) this.timer = setTimeout(() => this.hide('timeout'), opts.timeoutMs);

    const first = elements[0];
    if (opts.scroll && !inViewport(topRect(first), { width: innerWidth, height: innerHeight })) {
      first.scrollIntoView({ block: 'center', inline: 'nearest', behavior: this.reduced ? 'auto' : 'smooth' });
    }
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.tracker.start();
  }

  layout(targets, vp) {
    const holes = targets.map((t) => (t.visible ? padRect(t.rect, this.opts.padding) : null));
    this.renderer.update(holes);
    const primary = holes.find(Boolean) || null;
    this.label.place(primary, vp);
    this.markers?.place(holes, vp);

    // Fade in once a target is visible and scrolling has settled (or after a cap).
    const anyVisible = !!primary;
    const waitedEnough = performance.now() - this.startedAt > SCROLL_SETTLE_MAX_MS;
    if (!this.shown && anyVisible && (this.tracker.settled || waitedEnough)) {
      this.shown = true;
      this.resolveReady({ ok: true });
    }
    const on = this.shown && anyVisible;
    this.renderer.setVisible(on);
    this.label.setVisible(on);
    this.markers?.setVisible(on);
  }

  update() {
    if (!this.closed) this.tracker.measure();
  }

  hide(reason) {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.reason = reason;
    if (current === this) current = null;
    this.detach();
    this.renderer.setVisible(false);
    this.label.setVisible(false);
    this.markers?.setVisible(false);
    this.resolveReady({ ok: false, reason });
    try {
      this.opts.onClose?.(reason);
    } catch (e) {
      console.warn('[Senior Helper] onClose failed', e);
    }
    return new Promise((resolve) => setTimeout(() => { this.removeDom(); resolve(); }, this.reduced ? 0 : FADE_OUT_MS));
  }

  destroy() {
    if (current === this) current = null;
    if (!this.closed) {
      this.closed = true;
      this.reason = 'api';
      this.resolveReady({ ok: false, reason: 'api' });
    }
    this.detach();
    this.removeDom();
  }

  detach() {
    this.tracker.stop();
    clearTimeout(this.timer);
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('click', this.onClick, true);
  }

  removeDom() {
    this.renderer.remove();
    this.label.remove();
    this.markers?.remove();
  }

  state() {
    const t = this.tracker.targets;
    return {
      active: !this.closed,
      shown: this.shown && !this.closed,
      targets: t.length,
      holes: t.map((x) => (x.visible ? { ...padRect(x.rect, this.opts.padding), visible: true } : { visible: false })),
      label: this.label.rect(),
      reason: this.reason || null
    };
  }
}

/**
 * @param {Element|string} target  element, or a selector that must match exactly one element
 * @param {string} instruction  short text, e.g. "Click the Record button."
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {Promise<{ok: boolean, reason?: string}>} resolves when shown (or why not)
 */
export function showSpotlight(target, instruction, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { el, reason } = resolveSpotlightTarget(target);
  if (!el) return Promise.resolve({ ok: false, reason });
  if (current && !current.closed) {
    const prev = current;
    prev.closed = true;
    prev.reason = 'replaced';
    prev.resolveReady({ ok: false, reason: 'replaced' });
    try { prev.opts.onClose?.('replaced'); } catch { /* ignore */ }
    prev.destroy();
  }
  const extras = (opts.extraTargets || []).filter((x) => isElement(x) && x !== el && x.isConnected);
  current = new Spotlight([el, ...extras], String(instruction || 'Click here.').slice(0, 120), opts);
  return current.ready;
}

export function updateSpotlight() {
  current?.update();
}

export function hideSpotlight(reason = 'api') {
  const s = current;
  current = null;
  return s ? s.hide(reason) : Promise.resolve();
}

export function destroySpotlight() {
  const s = current;
  current = null;
  s?.destroy();
}

/** Diagnostics (tests, demo). Geometry is in viewport CSS pixels. */
export function getSpotlightState() {
  return current && !current.closed ? current.state() : { active: false, shown: false, targets: 0, holes: [], label: null, reason: null };
}
