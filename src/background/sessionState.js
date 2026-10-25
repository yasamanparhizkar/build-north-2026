// Pure session logic: status transitions, stale-work rejection, command dedupe.
import { DEDUPE_WINDOW_MS, MAX_CLIP_AGE_MS } from '../shared/constants.js';

export const STATUS = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  INTERRUPTED: 'interrupted',
  ERROR: 'error'
});

const ALLOWED = {
  idle: ['starting'],
  starting: ['listening', 'error', 'idle'],
  listening: ['processing', 'interrupted', 'error', 'idle'],
  processing: ['listening', 'interrupted', 'error', 'idle'],
  interrupted: ['starting', 'idle'],
  error: ['starting', 'idle']
};

export function canTransition(from, to) {
  return from === to || (ALLOWED[from] || []).includes(to);
}

export const INITIAL_SESSION = Object.freeze({
  status: STATUS.IDLE,
  detail: '',
  generation: 0, // bumps on every start/stop; work from older generations is discarded
  captureTabId: null,
  targetTabId: null,
  voiceMode: '', // 'wake' | 'clips' for the current session
  lastSeqHandled: -1,
  lastHighlightSeq: -1,
  lastTranscript: '', // in-memory (storage.session) only, cleared on stop
  recentCommands: [],
  rateLimitedUntil: 0
});

export function isListeningStatus(status) {
  return status === STATUS.LISTENING || status === STATUS.PROCESSING;
}

/**
 * Decide whether a captured clip should be skipped before calling Gemini.
 * @returns {string|null} reason, or null if it should be processed
 */
export function staleReason(job, session, now) {
  if (job.generation !== session.generation) return 'old-session';
  if (!isListeningStatus(session.status)) return 'not-listening';
  if (typeof job.seq === 'number' && job.seq <= session.lastSeqHandled) return 'already-handled';
  if (job.capturedAt && now - job.capturedAt > MAX_CLIP_AGE_MS) return 'too-old';
  if (session.rateLimitedUntil && now < session.rateLimitedUntil) return 'rate-limited';
  return null;
}

/** After Gemini answers: drop the result if the session moved on meanwhile. */
export function resultStaleReason(job, session) {
  if (job.generation !== session.generation) return 'old-session';
  if (!isListeningStatus(session.status)) return 'not-listening';
  if (typeof job.seq === 'number' && job.seq < session.lastHighlightSeq) return 'newer-highlight-shown';
  return null;
}

/** Normalize a command target for dedupe ("the Compose button" ~ "compose"). */
export function commandKey(target, elementName) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(target)}|${norm(elementName)}`;
}

export function isDuplicateCommand(recent, key, now, windowMs = DEDUPE_WINDOW_MS) {
  return recent.some((c) => c.key === key && now - c.at < windowMs);
}

export function rememberCommand(recent, key, now, windowMs = DEDUPE_WINDOW_MS) {
  return [...recent.filter((c) => now - c.at < windowMs), { key, at: now }].slice(-20);
}

