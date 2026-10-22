// Content script entry: injects styles and answers messages from the background worker.
import { MSG } from '../shared/messages.js';
import { initBadge, showStatus } from './badge.js';
import { collectInteractiveElements } from './elements.js';
import { clearHighlight, highlightElement } from './pointer.js';
import { OVERLAY_CSS } from './styles.js';

if (!window.seniorHelperLoaded) {
  window.seniorHelperLoaded = true;

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
  initBadge();

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.action) {
      case MSG.GET_ELEMENTS:
        sendResponse({ elements: collectInteractiveElements() });
        break;
      case MSG.HIGHLIGHT:
        sendResponse({ ok: highlightElement(request.id, request.label) });
        break;
      case MSG.STATUS:
        showStatus(request.text, request.autoHideMs);
        sendResponse({ ok: true });
        break;
      case MSG.CLEAR_HIGHLIGHT:
        clearHighlight();
        sendResponse({ status: 'Cleared pointer' });
        break;
    }
  });
}

