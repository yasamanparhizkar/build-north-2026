// Overlay/mask rendering: one SVG that dims the page and cuts soft, feathered,
// rounded openings with a warm-white glow. No viewBox: SVG user units equal CSS
// pixels, so openings line up exactly with getBoundingClientRect().
const NS = 'http://www.w3.org/2000/svg';
const BIG = 100000; // covers any viewport; mask/filter regions in user space

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export class SpotlightRenderer {
  /**
   * @param {HTMLElement} layer  container inside the closed shadow root
   * @param {{count: number, opacity: number, feather: number, radius: number}} opts
   */
  constructor(layer, { count, opacity, feather, radius }) {
    const id = `sh-spot-${Math.random().toString(36).slice(2, 9)}`;
    this.radius = radius;
    this.root = svg('svg', { class: 'sh-spot', 'aria-hidden': 'true', width: '100%', height: '100%' });
    const region = { filterUnits: 'userSpaceOnUse', x: -BIG, y: -BIG, width: BIG * 2, height: BIG * 2 };

    const defs = svg('defs');
    const featherFilter = svg('filter', { id: `${id}-feather`, ...region });
    featherFilter.appendChild(svg('feGaussianBlur', { stdDeviation: feather }));
    const glowFilter = svg('filter', { id: `${id}-glow`, ...region });
    glowFilter.appendChild(svg('feGaussianBlur', { stdDeviation: Math.max(4, feather * 0.9) }));

    const mask = svg('mask', { id: `${id}-mask`, maskUnits: 'userSpaceOnUse', x: -BIG, y: -BIG, width: BIG * 2, height: BIG * 2 });
    mask.appendChild(svg('rect', { x: -BIG, y: -BIG, width: BIG * 2, height: BIG * 2, fill: 'white' }));
    const holes = svg('g', { filter: `url(#${id}-feather)` });
    mask.appendChild(holes);
    defs.append(featherFilter, glowFilter, mask);

    const dim = svg('rect', { class: 'sh-dim', x: -BIG, y: -BIG, width: BIG * 2, height: BIG * 2, fill: '#000', 'fill-opacity': opacity, mask: `url(#${id}-mask)` });
    const glow = svg('g', { class: 'sh-glow', filter: `url(#${id}-glow)` });

    this.holes = [];
    this.rings = [];
    for (let i = 0; i < count; i++) {
      const hole = svg('rect', { fill: 'black', rx: radius, ry: radius });
      const ring = svg('rect', { fill: 'none', stroke: 'rgb(255, 238, 214)', 'stroke-opacity': 0.55, 'stroke-width': 3, rx: radius, ry: radius });
      holes.appendChild(hole);
      glow.appendChild(ring);
      this.holes.push(hole);
      this.rings.push(ring);
    }
    this.root.append(defs, dim, glow);
    this.cache = new Array(count).fill('');
    layer.appendChild(this.root);
  }

  /** @param {Array<{left:number, top:number, width:number, height:number}|null>} rects padded rects, null = hide */
  update(rects) {
    rects.forEach((r, i) => {
      const key = r ? `${r.left.toFixed(1)}|${r.top.toFixed(1)}|${r.width.toFixed(1)}|${r.height.toFixed(1)}` : 'hidden';
      if (key === this.cache[i]) return;
      this.cache[i] = key;
      for (const el of [this.holes[i], this.rings[i]]) {
        if (!r) {
          el.setAttribute('visibility', 'hidden');
          continue;
        }
        el.setAttribute('visibility', 'visible');
        el.setAttribute('x', r.left);
        el.setAttribute('y', r.top);
        el.setAttribute('width', Math.max(0, r.width));
        el.setAttribute('height', Math.max(0, r.height));
        const rr = Math.min(this.radius, r.width / 2, r.height / 2);
        el.setAttribute('rx', rr);
        el.setAttribute('ry', rr);
      }
    });
  }

  setVisible(visible) {
    this.root.classList.toggle('sh-on', visible);
  }

  remove() {
    this.root.remove();
  }
}

