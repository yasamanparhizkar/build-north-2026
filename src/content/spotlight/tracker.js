// DOM target tracking: follows each target every animation frame (covers page and
// container scrolling, resize, transforms, fixed elements, layout changes and
// same-origin iframes via topRect), re-acquires targets that a framework
// re-rendered, and reports when they are lost.
import { isDisplayed, topRect } from '../elements.js';
import { inViewport, sameRect } from './geometry.js';

const REACQUIRE_EVERY_MS = 150;
const LOST_GRACE_MS = 1200;

export class TargetTracker {
  /**
   * @param {Element[]} elements
   * @param {{reacquire?: (index: number) => (Element|null), onFrame: (states: Array<object>) => void,
   *          onLost: () => void}} opts
   */
  constructor(elements, { reacquire, onFrame, onLost }) {
    this.targets = elements.map((el) => ({ el, rect: null, visible: false, lostAt: 0, lastTry: 0 }));
    this.reacquire = reacquire;
    this.onFrame = onFrame;
    this.onLost = onLost;
    this.raf = 0;
    this.stableFrames = 0;
    this.running = false;
  }

  get elements() {
    return this.targets.map((t) => t.el);
  }

  start() {
    this.running = true;
    this.measure();
    const loop = () => {
      if (!this.running) return;
      this.measure();
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Recompute all target states and notify. Safe to call any time. */
  measure() {
    const now = performance.now();
    const vp = { width: document.documentElement.clientWidth || innerWidth, height: document.documentElement.clientHeight || innerHeight };
    let moved = false;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.el.isConnected) {
        t.lostAt ||= now;
        if (this.reacquire && now - t.lastTry >= REACQUIRE_EVERY_MS) {
          t.lastTry = now;
          const replacement = this.reacquire(i);
          if (replacement && replacement.isConnected) {
            t.el = replacement;
            t.lostAt = 0;
          }
        }
      }
      if (!t.el.isConnected) {
        t.visible = false;
        continue;
      }
      t.lostAt = 0;
      const rect = topRect(t.el);
      if (!sameRect(rect, t.rect)) moved = true;
      t.rect = rect;
      t.visible = isDisplayed(t.el) && inViewport(rect, vp);
    }
    this.stableFrames = moved ? 0 : this.stableFrames + 1;

    const allLost = this.targets.every((t) => t.lostAt && now - t.lostAt > LOST_GRACE_MS);
    if (allLost) {
      this.stop();
      this.onLost();
      return;
    }
    this.onFrame(this.targets, vp);
  }

  /** True once targets have not moved for a few frames (scroll finished). */
  get settled() {
    return this.stableFrames >= 3;
  }
}

