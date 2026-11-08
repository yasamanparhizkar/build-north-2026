// Offline detection of "scroll down" / "scroll up" requests (pure, unit tested).
// Runs before the element matcher, because "up" and "down" are matcher stop words.

const DOWN = /\b(scroll(ing)?\s+down|page\s+down|down\s+the\s+page|go\s+down|move\s+down)\b/;
const UP = /\b(scroll(ing)?\s+up|page\s+up|up\s+the\s+page|go\s+up|move\s+up)\b/;

/**
 * @param {string} text spoken or typed sentence
 * @returns {'up' | 'down' | null}
 */
export function detectScroll(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /\bscroll\s*bar\b/.test(t)) return null;
  const up = UP.test(t);
  const down = DOWN.test(t);
  if (up === down) return null;
  return up ? 'up' : 'down';
}
