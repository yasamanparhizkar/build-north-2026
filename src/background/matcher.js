// Offline command -> element matcher. No network, no API key, ~0 ms.
// Level 1: exact/normalized name match.  Level 2: synonyms, role hints, position,
// enabled/visible state.  (Level 3, AI disambiguation, lives in pipeline.js.)
// Pure module (unit tested).
import { WAKE_PHRASE } from '../shared/constants.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'it', 'is', 'are', 'its', 'mom', 'mum', 'dad',
  'this', 'that', 'there', 'here', 'your', 'you', 'my', 'me', 'please', 'now', 'then', 'just', 'so', 'ok', 'okay',
  'click', 'press', 'tap', 'hit', 'push', 'find', 'see', 'look', 'locate', 'select', 'choose', 'go', 'where',
  'button', 'icon', 'link', 'option', 'one', 'thing', 'can', 'will', 'should', 'need', 'want', 'do', 'does',
  'side', 'hand', 'corner', 'part', 'area', 'screen', 'page', 'with', 'next', 'bit', 'little', 'small', 'big',
  'left', 'right', 'center', 'centre', 'middle', 'top', 'bottom', 'upper', 'lower', 'up', 'down', 'box', 'field', 'bar', 'tab',
  'hey', ...WAKE_PHRASE.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) // the wake phrase is never a button name
]);

const H_WORDS = { left: 'left', right: 'right', center: 'center', centre: 'center' };
const V_WORDS = { top: 'top', upper: 'top', up: 'top', bottom: 'bottom', lower: 'bottom', down: 'bottom', middle: 'middle' };

const ROLE_HINTS = {
  button: ['button'],
  link: ['link'],
  box: ['textbox', 'searchbox', 'combobox'],
  field: ['textbox', 'searchbox', 'combobox'],
  bar: ['textbox', 'searchbox', 'combobox'],
  tab: ['tab'],
  checkbox: ['checkbox'],
  menu: ['menuitem', 'button']
};

/** Words a family member may say -> words that appear in UI labels. */
export const SYNONYMS = {
  mic: ['microphone', 'mute', 'unmute'],
  microphone: ['mic', 'mute', 'unmute'],
  mute: ['microphone', 'mic', 'unmute'],
  unmute: ['microphone', 'mic', 'mute'],
  camera: ['video', 'cam'],
  video: ['camera', 'cam'],
  hang: ['leave', 'end'],
  leave: ['hang', 'end', 'exit'],
  end: ['leave', 'hang'],
  caption: ['subtitle', 'cc'],
  subtitle: ['caption', 'cc'],
  present: ['share', 'presenting'],
  share: ['present', 'presenting'],
  chat: ['message', 'messages'],
  message: ['chat'],
  trash: ['bin', 'delete'],
  bin: ['trash', 'delete'],
  delete: ['trash', 'bin', 'remove'],
  remove: ['delete'],
  setting: ['gear', 'option', 'preference'],
  gear: ['setting'],
  write: ['compose', 'new'],
  compose: ['write', 'new'],
  send: ['submit'],
  submit: ['send'],
  cart: ['basket', 'bag'],
  basket: ['cart', 'bag'],
  back: ['previous'],
  previous: ['back'],
  menu: ['hamburger', 'more', 'main'],
  more: ['option', 'menu'],
  attach: ['attachment', 'paperclip'],
  login: ['sign', 'signin'],
  signin: ['sign', 'login'],
  logout: ['sign', 'signout'],
  people: ['participant'],
  participant: ['people'],
  emoji: ['reaction', 'react'],
  reaction: ['emoji', 'react'],
  hand: ['raise'],
  raise: ['hand']
};

export const CONFIDENT_SCORE = 0.75;
export const CONFIDENT_MARGIN = 0.1;
export const MIN_SCORE = 0.35;
export const CANDIDATE_BAND = 0.1;

export function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
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

/** Accept region hints from Gemini like "top-left" / "left". */
export function hintsFromRegion(region) {
  if (!region || region === 'none') return { horiz: null, vert: null };
  return spatialHints(region.split('-'));
}

function roleHints(tokens) {
  const roles = new Set();
  for (const t of tokens) (ROLE_HINTS[t] || []).forEach((r) => roles.add(r));
  return roles;
}

function wordMatch(cmdWord, elWord) {
  if (cmdWord === elWord) return 1;
  if (cmdWord.length >= 4 && elWord.length >= 3 && (elWord.startsWith(cmdWord) || cmdWord.startsWith(elWord))) return 0.7;
  return 0;
}

function tokenScore(cmdWord, elTokens) {
  let best = Math.max(0, ...elTokens.map((e) => wordMatch(cmdWord, e)));
  if (best < 1) {
    for (const syn of SYNONYMS[cmdWord] || []) {
      best = Math.max(best, 0.85 * Math.max(0, ...elTokens.map((e) => wordMatch(syn, e))));
    }
  }
  return best;
}

export function scoreElement(contentTokens, hints, roles, element) {
  const elTokens = tokenize(element.name ?? element.text).map(stem);
  if (!elTokens.length || !contentTokens.length) return 0;

  let matched = 0;
  for (const t of contentTokens) matched += tokenScore(t, elTokens);
  if (matched === 0) return 0;

  const coverage = matched / contentTokens.length;
  const specificity = Math.min(1, matched / elTokens.length);
  let score = coverage * 0.8 + specificity * 0.2;

  const [vert, horiz] = (element.region || '').split('-');
  if (hints.horiz) score += horiz === hints.horiz ? 0.25 : -0.25;
  if (hints.vert) score += vert === hints.vert ? 0.25 : -0.25;
  if (roles.size && roles.has(element.role)) score += 0.2;
  if (element.enabled === false) score -= 0.15;
  if (element.visible === false) score -= 0.1;
  // No upper clamp: spatial/role bonuses must be able to separate equal names.
  return Math.max(0, score);
}

function shortLabel(name) {
  return `Click ${name.split(' ').slice(0, 3).join(' ')}`;
}

/**
 * @param {string} command  spoken/typed sentence, or a target name from Gemini
 * @param {Array<object>} elements
 * @param {{region?: string}} [opts] extra spatial hint (e.g. Gemini's region)
 * @returns {{result: {transcript, isCommand, matchedElementId, label}, score: number, confident: boolean,
 *            candidates: Array<{id: string, score: number}>}}
 */
export function matchLocal(command, elements, opts = {}) {
  const tokens = tokenize(command);
  let hints = spatialHints(tokens);
  if (!hints.horiz && !hints.vert && opts.region) hints = hintsFromRegion(opts.region);
  const roles = roleHints(tokens);
  const contentTokens = tokens.filter((t) => !STOP_WORDS.has(t)).map(stem);

  const scored = elements
    .map((el) => ({ el, score: scoreElement(contentTokens, hints, roles, el) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const none = {
    result: { transcript: command, isCommand: true, matchedElementId: null, label: '' },
    score: 0,
    confident: false,
    candidates: []
  };
  if (!best || best.score < MIN_SCORE) return none;

  const margin = best.score - (scored[1]?.score ?? 0);
  const candidates = scored
    .filter((s) => s.score >= MIN_SCORE && best.score - s.score <= CANDIDATE_BAND)
    .map((s) => ({ id: s.el.id, score: +s.score.toFixed(3) }));

  return {
    result: {
      transcript: command,
      isCommand: true,
      matchedElementId: best.el.id,
      label: shortLabel(best.el.name ?? best.el.text)
    },
    score: best.score,
    confident: best.score >= CONFIDENT_SCORE && margin >= CONFIDENT_MARGIN,
    candidates
  };
}
