// URL helpers (pure).

const BLOCKED_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com']);

/** True for pages where Chrome allows content scripts (ordinary http/https pages). */
export function isScriptableUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (BLOCKED_HOSTS.has(u.hostname) && (u.hostname !== 'chrome.google.com' || u.pathname.startsWith('/webstore'))) {
    return false;
  }
  return true;
}

export function isMeetUrl(url) {
  try {
    return new URL(url).hostname === 'meet.google.com';
  } catch {
    return false;
  }
}
