if (!window.seniorHelperLoaded) {
  window.seniorHelperLoaded = true;

  let currentTarget = null;
  let hideTimer = null;
  let badgeTimer = null;

  // 1. Inject CSS for the big senior-friendly pointer & status badge
  const style = document.createElement('style');
  style.textContent = `
    @keyframes seniorPulse {
      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.8); }
      70% { transform: scale(1.05); box-shadow: 0 0 0 20px rgba(255, 0, 0, 0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
    }
    #senior-helper-pointer {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      border: 5px solid #ff0000;
      border-radius: 12px;
      background: rgba(255, 255, 0, 0.25);
      animation: seniorPulse 1.5s infinite;
    }
    #senior-helper-label {
      position: absolute;
      bottom: 110%;
      left: 50%;
      transform: translateX(-50%);
      background: #d93025;
      color: white;
      font-size: 20px;
      font-weight: bold;
      padding: 8px 14px;
      border-radius: 8px;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      font-family: Arial, sans-serif;
    }
    #senior-voice-badge {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      background: #202124;
      color: white;
      padding: 12px 18px;
      border-radius: 30px;
      font-family: Arial, sans-serif;
      font-size: 15px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: none;
    }
  `;
  document.head.appendChild(style);

  const badge = document.createElement('div');
  badge.id = 'senior-voice-badge';
  document.body.appendChild(badge);

  function showStatus(text, autoHideMs) {
    badge.style.display = 'block';
    badge.innerText = text;
    clearTimeout(badgeTimer);
    if (autoHideMs) badgeTimer = setTimeout(() => { badge.style.display = 'none'; }, autoHideMs);
  }

  // 2. Scan the DOM for visible interactive elements
  function collectInteractiveElements() {
    document.querySelectorAll('[data-senior-id]').forEach((el) => el.removeAttribute('data-senior-id'));

    const selectors = 'button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [aria-label], [data-tooltip]';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const list = [];
    let counter = 1;

    for (const el of document.querySelectorAll(selectors)) {
      if (list.length >= 150) break;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 10 && rect.height > 10 &&
        rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
      if (!visible) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;

      const aria = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '';
      const inner = (el.innerText || el.placeholder || el.value || '').trim();
      const text = `${aria} ${inner}`.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!text) continue;

      const cx = (rect.left + rect.width / 2) / vw;
      const cy = (rect.top + rect.height / 2) / vh;
      const horiz = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
      const vert = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle';

      const id = `sh-${counter++}`;
      el.setAttribute('data-senior-id', id);
      list.push({
        id,
        tag: el.tagName.toLowerCase(),
        text,
        region: `${vert}-${horiz}`,
        x: +cx.toFixed(2),
        y: +cy.toFixed(2)
      });
    }
    return list;
  }

  // 3. Draw the highlighter & pointer, and keep it glued to the element
  function positionPointer() {
    const pointer = document.getElementById('senior-helper-pointer');
    if (!pointer) return;
    if (!currentTarget || !currentTarget.isConnected) { clearHighlight(); return; }
    const rect = currentTarget.getBoundingClientRect();
    pointer.style.top = `${rect.top - 8}px`;
    pointer.style.left = `${rect.left - 8}px`;
    pointer.style.width = `${rect.width + 16}px`;
    pointer.style.height = `${rect.height + 16}px`;
    requestAnimationFrame(positionPointer);
  }

  function highlightElement(seniorId, instructionText) {
    clearHighlight();
    const target = document.querySelector(`[data-senior-id="${seniorId}"]`);
    if (!target) return false;

    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    currentTarget = target;

    const pointer = document.createElement('div');
    pointer.id = 'senior-helper-pointer';
    const label = document.createElement('div');
    label.id = 'senior-helper-label';
    label.innerText = `👆 ${instructionText || 'Click Here!'}`;
    pointer.appendChild(label);
    document.body.appendChild(pointer);

    positionPointer();
    hideTimer = setTimeout(clearHighlight, 20000); // auto-clear after 20s
    showStatus(`✅ Pointing to: ${instructionText || 'this button'}`, 4000);
    return true;
  }

  function clearHighlight() {
    clearTimeout(hideTimer);
    currentTarget = null;
    const existing = document.getElementById('senior-helper-pointer');
    if (existing) existing.remove();
  }

  // 4. Messages from background.js / popup.js (all LLM + audio work lives in background)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'GET_ELEMENTS':
        sendResponse({ elements: collectInteractiveElements() });
        break;
      case 'HIGHLIGHT':
        sendResponse({ ok: highlightElement(request.id, request.label) });
        break;
      case 'STATUS':
        showStatus(request.text, request.autoHideMs);
        sendResponse({ ok: true });
        break;
      case 'CLEAR_HIGHLIGHT':
        clearHighlight();
        sendResponse({ status: 'Cleared pointer' });
        break;
    }
  });
}
