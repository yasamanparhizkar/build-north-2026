// Listening-session state. Service workers are killed often, so it lives in storage.session.
const DEFAULTS = { active: false, captureTabId: null, targetTabId: null, lastTranscript: '' };

export async function getSession() {
  const { session } = await chrome.storage.session.get('session');
  return { ...DEFAULTS, ...(session || {}) };
}

export async function updateSession(patch) {
  const next = { ...(await getSession()), ...patch };
  await chrome.storage.session.set({ session: next });
  return next;
}
