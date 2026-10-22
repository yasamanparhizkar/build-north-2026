// Offline command -> element matcher. No network, no API key, ~0 ms latency.
// Pure module (unit tested). Used first for typed/transcribed commands; Gemini is
// only consulted when this is not confident.

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'it', 'is', 'are', 'its',
  'this', 'that', 'there', 'here', 'your', 'you', 'my', 'me', 'please', 'now', 'then', 'just',
  'click', 'press', 'tap', 'hit', 'push', 'find', 'see', 'look', 'locate', 'open', 'select', 'choose',
  'button', 'icon', 'link', 'option', 'one', 'thing', 'where', 'can', 'will', 'should', 'need',
  'side', 'hand', 'corner', 'part', 'area', 'screen', 'page', 'of', 'with', 'next', 'bit',
  'left', 'right', 'center', 'centre', 'middle', 'top', 'bottom', 'upper', 'lower', 'up', 'down'
]);

const H_WORDS = { left: 'left', right: 'right', center: 'center', centre: 'center' };
const V_WORDS = { top: 'top', upper: 'top', up: 'top', bottom: 'bottom', lower: 'bottom', down: 'bottom', middle: 'middle' };

export const CONFIDENT_SCORE = 0.75;
export const CONFIDENT_MARGIN = 0.1;
export const MIN_SCORE = 0.35;

export function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

function stem(word) {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/** Extract spatial hints such as "on the left side" or "top right". */
export function spatialHints(tokens) {
  let horiz = null;
  let vert = null;
  for (const t of tokens) {
    if (H_WORDS[t]) horiz = H_WORDS[t];
    if (V_WORDS[t]) vert = V_WORDS[t];
  }
  return { horiz, vert };
}

function wordMatch(cmdWord, elWord) {
  if (cmdWord === elWord) return 1;
  if (cmdWord.length >= 4 && elWord.length >= 3 && (elWord.startsWith(cmdWord) || cmdWord.startsWith(elWord))) return 0.7;
  return 0;
}

export function scoreElement(contentTokens, hints, element) {
  const elTokens = tokenize(element.text).map(stem);
  if (!elTokens.length || !contentTokens.length) return 0;

  let matched = 0;
  for (const t of contentTokens) {
    matched += Math.max(0, ...elTokens.map((e) => wordMatch(t, e)));
  }
  if (matched === 0) return 0;

  const coverage = matched / contentTokens.length;
  const specificity = Math.min(1, matched / elTokens.length);
  let score = coverage * 0.8 + specificity * 0.2;

  const [vert, horiz] = (element.region || '').split('-');
  if (hints.horiz) score += horiz === hints.horiz ? 0.25 : -0.25;
  if (hints.vert) score += vert === hints.vert ? 0.25 : -0.25;
  return Math.max(0, Math.min(1, score));
}

function shortLabel(text) {
  return `Click ${text.split(' ').slice(0, 3).join(' ')}`;
}

/**
 * @returns {{result: {transcript, isCommand, matchedId, label}, score: number, confident: boolean}}
 */
export function matchLocal(command, elements) {
  const tokens = tokenize(command);
  const hints = spatialHints(tokens);
  const contentTokens = tokens.filter((t) => !STOP_WORDS.has(t)).map(stem);

  const scored = elements
    .map((el) => ({ el, score: scoreElement(contentTokens, hints, el) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const none = { result: { transcript: command, isCommand: true, matchedId: null, label: '' }, score: 0, confident: false };
  if (!best || best.score < MIN_SCORE) return none;

  const margin = best.score - (scored[1]?.score ?? 0);
  return {
    result: { transcript: command, isCommand: true, matchedId: best.el.id, label: shortLabel(best.el.text) },
    score: best.score,
    confident: best.score >= CONFIDENT_SCORE && margin >= CONFIDENT_MARGIN
  };
}
