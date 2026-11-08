// Turns a control's name or a short label into one complete instruction sentence.
// Pure (no browser APIs), so the background, content script and tests share one rule.
//
// Rules:
// - Anything in brackets is dropped ("Raise hand (ctrl + alt + h)" -> "Raise hand").
// - "unlabeled button" becomes "the button" (the helper's placeholder names read naturally).
// - A sentence starts with an action verb; "Click" is added when the label has none.
// - Names that are too long to show whole are replaced by a generic, complete sentence,
//   never cut in the middle of a word or a phrase.
// - Only the first word is capitalised; the other words are lowercase.

const ACTION = /^(click|press|tap|select|choose|type|open|scroll)\b/i;
const FALLBACK = 'Click the highlighted control.';
export const MAX_INSTRUCTION_WORDS = 6;
export const MAX_INSTRUCTION_CHARS = 50;

/**
 * @param {string} label  a control name ("Compose") or a short label ("Click Compose")
 * @returns {string} one sentence that starts with a capital letter and ends with a full stop
 */
export function instructionFor(label) {
  let s = String(label ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s*[([{<].*$/, '') // keyboard hints and asides, including unclosed ones
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^unlabeled\s+/i, 'the ')
    .replace(/[\s.,;:!?…"'-]+$/, '')
    .trim();
  if (!s) return FALLBACK;

  const words = s.split(' ');
  const hasAction = ACTION.test(s);
  const objectWords = hasAction ? words.length - 1 : words.length;
  if (objectWords < 1 || words.length > MAX_INSTRUCTION_WORDS || s.length > MAX_INSTRUCTION_CHARS) return FALLBACK;

  if (!hasAction) s = `Click ${s}`;
  return `${s[0].toUpperCase()}${s.slice(1).toLowerCase()}.`;
}
