// The red pulsing highlight + label that follows its target element.
import { HIGHLIGHT_TIMEOUT_MS } from '../shared/constants.js';
import { showStatus } from './badge.js';

let currentTarget = null;
let hideTimer = null;

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

export function highlightElement(seniorId, instructionText) {
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
  hideTimer = setTimeout(clearHighlight, HIGHLIGHT_TIMEOUT_MS);
  showStatus(`✅ Pointing to: ${instructionText || 'this button'}`, 4000);
  return true;
}

export function clearHighlight() {
  clearTimeout(hideTimer);
  currentTarget = null;
  document.getElementById('senior-helper-pointer')?.remove();
}

