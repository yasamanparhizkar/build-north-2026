// Instruction typography: floating white text next to the spotlight (no box,
// card, bubble or arrow), a discreet close control, and numbered markers for
// candidate targets. Text is always set with textContent (never HTML).
import { placeLabel, placeMarker } from './geometry.js';

const MARKER_SIZE = 30;

export class InstructionLabel {
  /**
   * @param {HTMLElement} layer
   * @param {{text: string, onClose: () => void}} opts
   */
  constructor(layer, { text, onClose }) {
    this.root = document.createElement('div');
    this.root.className = 'sh-text';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    this.message = document.createElement('span');
    this.message.className = 'sh-text-message';
    this.message.textContent = text;

    this.close = document.createElement('button');
    this.close.type = 'button';
    this.close.className = 'sh-text-close';
    this.close.setAttribute('aria-label', 'Close guidance');
    this.close.title = 'Close (Esc)';
    this.close.textContent = '×';
    this.close.addEventListener('click', (e) => {
      e.stopPropagation();
      onClose();
    });

    this.root.append(this.message, this.close);
    layer.appendChild(this.root);
    this.last = '';
    this.side = null;
  }

  /** Position relative to the lit area; hidden when `hole` is null. */
  place(hole, vp) {
    if (!hole) {
      this.root.classList.add('sh-hidden');
      return;
    }
    this.root.classList.remove('sh-hidden');
    this.root.style.maxWidth = `${Math.min(440, vp.width - 24)}px`;
    const size = { width: this.root.offsetWidth, height: this.root.offsetHeight };
    const p = placeLabel(hole, size, vp);
    const key = `${p.left}|${p.top}`;
    if (key === this.last) return;
    this.last = key;
    this.side = p.side;
    this.root.style.left = `${p.left}px`;
    this.root.style.top = `${p.top}px`;
    this.root.dataset.side = p.side;
  }

  setVisible(visible) {
    this.root.classList.toggle('sh-on', visible);
  }

  rect() {
    return {
      left: parseFloat(this.root.style.left) || 0,
      top: parseFloat(this.root.style.top) || 0,
      width: this.root.offsetWidth,
      height: this.root.offsetHeight,
      visible: !this.root.classList.contains('sh-hidden') && this.root.offsetWidth > 0,
      side: this.side
    };
  }

  remove() {
    this.root.remove();
  }
}

export class NumberMarkers {
  constructor(layer, count) {
    this.items = Array.from({ length: count }, (_, i) => {
      const m = document.createElement('div');
      m.className = 'sh-marker';
      m.setAttribute('aria-hidden', 'true');
      m.textContent = String(i + 1);
      layer.appendChild(m);
      return m;
    });
  }

  place(holes, vp) {
    holes.forEach((hole, i) => {
      const m = this.items[i];
      m.classList.toggle('sh-hidden', !hole);
      if (!hole) return;
      const p = placeMarker(hole, MARKER_SIZE, vp);
      m.style.left = `${p.left}px`;
      m.style.top = `${p.top}px`;
    });
  }

  setVisible(visible) {
    this.items.forEach((m) => m.classList.toggle('sh-on', visible));
  }

  remove() {
    this.items.forEach((m) => m.remove());
  }
}

