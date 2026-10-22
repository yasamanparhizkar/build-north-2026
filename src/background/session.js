// Session state in chrome.storage.session (in memory, survives service-worker
// restarts, cleared when the browser closes, not readable by content scripts).
import { INITIAL_SESSION, canTransition } from './sessionState.js';

// Serialize read-modify-write so concurrent handlers don't lose updates.
let lock = Promise.resolve();
export function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

export async function getSession() {
  const { session } = await chrome.storage.session.get('session');
  return { ...INITIAL_SESSION, ...(session || {}) };
}

/** `patch` may be an object or a function (session) => object. */
export function updateSession(patch) {
  return withLock(async () => {
    const current = await getSession();
    const changes = typeof patch === 'function' ? patch(current) : patch;
    if (!changes) return current;
    if (changes.status && !canTransition(current.status, changes.status)) {
      console.warn(`[session] ignored transition ${current.status} -> ${changes.status}`);
      delete changes.status;
    }
    const next = { ...current, ...changes };
    await chrome.storage.session.set({ session: next });
    return next;
  });
}

export function resetSession(patch = {}) {
  return withLock(async () => {
    const current = await getSession();
    const next = { ...INITIAL_SESSION, generation: current.generation + 1, ...patch };
    await chrome.storage.session.set({ session: next });
    return next;
  });
}
