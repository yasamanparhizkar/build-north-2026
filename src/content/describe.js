// Pure helpers for describing page elements (unit tested, no DOM access).

/** Map a normalized center point (0..1) to a human region like "top-left". */
export function regionFor(cx, cy) {
  const horiz = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
  const vert = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle';
  return `${vert}-${horiz}`;
}

/** Combine an element's accessible name and visible text into one short label. */
export function buildElementText(ariaOrTitle, inner, maxLength = 80) {
  return `${ariaOrTitle || ''} ${inner || ''}`.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

/** True if a rect overlaps the viewport and is bigger than a tiny icon-sized speck. */
export function isRectVisible(rect, vw, vh, minSize = 10) {
  return rect.width > minSize && rect.height > minSize &&
    rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
}
