// Status badge shown in the bottom-right corner of the page.
let badge = null;
let timer = null;

export function initBadge() {
  badge = document.createElement('div');
  badge.id = 'senior-voice-badge';
  document.body.appendChild(badge);
}

export function showStatus(text, autoHideMs) {
  if (!badge) initBadge();
  badge.style.display = 'block';
  badge.innerText = text;
  clearTimeout(timer);
  if (autoHideMs) timer = setTimeout(() => { badge.style.display = 'none'; }, autoHideMs);
}
