// Combine Gemini's validated answer with the deterministic matcher (pure).
import { MAX_CANDIDATE_HIGHLIGHTS } from '../shared/constants.js';
import { matchLocal } from './matcher.js';

/** Below this, Gemini's pick is double-checked against the local matcher. */
export const LOW_CONFIDENCE = 0.45;

/**
 * @returns {{kind: 'point'|'candidates'|'no-match'|'ignore', ids: string[], label: string,
 *            target: string, transcript: string, source: string}}
 */
export function decideFromModel(result, elements) {
  const base = { transcript: result.transcript, target: result.target, label: result.label, ids: [], source: 'gemini' };
  if (!result.isCommand) return { ...base, kind: 'ignore' };

  if (result.matchedElementId && result.confidence >= LOW_CONFIDENCE) {
    return { ...base, kind: 'point', ids: [result.matchedElementId] };
  }

  // No (or low-confidence) pick: use the spoken target with the deterministic matcher.
  const query = result.target || result.transcript;
  const local = query ? matchLocal(query, elements, { region: result.region }) : null;

  if (local?.confident) {
    if (!result.matchedElementId || local.result.matchedElementId === result.matchedElementId) {
      return { ...base, kind: 'point', ids: [local.result.matchedElementId], source: 'gemini+local' };
    }
  }
  if (result.matchedElementId) {
    // Low-confidence model pick that the matcher doesn't contradict.
    const ids = [result.matchedElementId, ...(local?.candidates || []).map((c) => c.id)];
    const unique = [...new Set(ids)].slice(0, MAX_CANDIDATE_HIGHLIGHTS);
    return { ...base, kind: unique.length > 1 ? 'candidates' : 'point', ids: unique };
  }
  if (local && local.candidates.length > 1) {
    return { ...base, kind: 'candidates', ids: local.candidates.slice(0, MAX_CANDIDATE_HIGHLIGHTS).map((c) => c.id), source: 'local' };
  }
  if (local?.result.matchedElementId) {
    return { ...base, kind: 'point', ids: [local.result.matchedElementId], source: 'local' };
  }
  return { ...base, kind: 'no-match' };
}

/** Typed commands: Level 1/2 first. Returns null if Gemini (Level 3) should be asked. */
export function decideFromText(text, elements, { allowAmbiguous = false } = {}) {
  const local = matchLocal(text, elements);
  const base = { transcript: text, target: text, label: local.result.label, source: 'local' };
  if (local.confident) return { ...base, kind: 'point', ids: [local.result.matchedElementId] };
  if (!allowAmbiguous) return null;
  if (local.candidates.length > 1) {
    return { ...base, kind: 'candidates', ids: local.candidates.slice(0, MAX_CANDIDATE_HIGHLIGHTS).map((c) => c.id) };
  }
  if (local.result.matchedElementId) return { ...base, kind: 'point', ids: [local.result.matchedElementId] };
  return { ...base, kind: 'no-match', ids: [] };
}

