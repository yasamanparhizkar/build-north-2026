// Pure geometry for the spotlight (no DOM; unit tested in test/spotlight-geometry.test.js).

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Rect grown by `pad` on every side. */
export function padRect(r, pad) {
  return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

export const right = (r) => r.left + r.width;
export const bottom = (r) => r.top + r.height;

export function intersects(a, b) {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top;
}

/** True if any part of the rect is inside the viewport. */
export function inViewport(r, vp) {
  return r.width >= 2 && r.height >= 2 && right(r) > 0 && bottom(r) > 0 && r.left < vp.width && r.top < vp.height;
}

/** Rects equal within half a pixel (used to detect scroll/animation settling). */
export function sameRect(a, b, eps = 0.5) {
  return !!a && !!b && Math.abs(a.left - b.left) <= eps && Math.abs(a.top - b.top) <= eps &&
    Math.abs(a.width - b.width) <= eps && Math.abs(a.height - b.height) <= eps;
}

/**
 * Place the instruction text next to the spotlight.
 * Tries below, above, right, left (in that order); picks the first side where the
 * text fits inside the viewport without touching the lit area, otherwise the side
 * with the most room, clamped to the viewport.
 * @param {{left:number, top:number, width:number, height:number}} hole  lit area (padded target)
 * @param {{width:number, height:number}} size  measured text block
 * @param {{width:number, height:number}} vp  viewport
 * @returns {{left:number, top:number, side:'below'|'above'|'right'|'left'}}
 */
export function placeLabel(hole, size, vp, { gap = 14, margin = 12 } = {}) {
  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const hx = clamp(cx - size.width / 2, margin, vp.width - size.width - margin);
  const vy = clamp(cy - size.height / 2, margin, vp.height - size.height - margin);

  const options = [
    { side: 'below', left: hx, top: bottom(hole) + gap, room: vp.height - margin - (bottom(hole) + gap) - size.height },
    { side: 'above', left: hx, top: hole.top - gap - size.height, room: hole.top - gap - size.height - margin },
    { side: 'right', left: right(hole) + gap, top: vy, room: vp.width - margin - (right(hole) + gap) - size.width },
    { side: 'left', left: hole.left - gap - size.width, top: vy, room: hole.left - gap - size.width - margin }
  ];
  const fit = options.find((o) => o.room >= 0) || options.reduce((a, b) => (b.room > a.room ? b : a));
  return {
    side: fit.side,
    left: Math.round(clamp(fit.left, margin, vp.width - size.width - margin)),
    top: Math.round(clamp(fit.top, margin, vp.height - size.height - margin))
  };
}

/** Small numbered marker for candidate targets: just outside the top-left corner, kept on screen. */
export function placeMarker(hole, size, vp, margin = 4) {
  return {
    left: Math.round(clamp(hole.left - size / 2, margin, vp.width - size - margin)),
    top: Math.round(clamp(hole.top - size / 2, margin, vp.height - size - margin))
  };
}

