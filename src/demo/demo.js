// Local demo for the spotlight module: no AI pipeline, no API key.
// Open via popup -> "Open spotlight demo", or chrome-extension://<id>/src/demo/demo.html
import { destroySpotlight, getSpotlightState, hideSpotlight, showSpotlight } from '../content/spotlight/index.js';

const $ = (id) => document.getElementById(id);
const log = (msg) => { $('log').textContent = msg; };

// ---- Page content ----
const box = $('scrollbox');
for (let i = 1; i <= 30; i++) {
  const row = document.createElement('div');
  if (i === 25) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.id = 'item25';
    b.textContent = 'Open message 25';
    row.appendChild(b);
  } else {
    row.textContent = `Message ${i}`;
  }
  box.appendChild(row);
}

// Simulates a framework re-render: the Save button node is replaced every 1.5 s.
function renderDynamic() {
  const b = document.createElement('button');
  b.className = 'btn primary';
  b.dataset.demo = 'save';
  b.textContent = 'Save draft';
  $('dynamicHost').replaceChildren(b);
}
renderDynamic();
setInterval(renderDynamic, 1500);

// Count every real click so we can see the spotlight never blocks the page.
window.__clicks = {};
document.addEventListener('click', (e) => {
  const id = e.target.closest('[id], [data-demo]')?.id || e.target.closest('[data-demo]')?.dataset.demo;
  if (id) window.__clicks[id] = (window.__clicks[id] || 0) + 1;
}, true);

// ---- Targets ----
const TARGETS = {
  record: { label: 'Simple button: Record', find: () => $('record'), text: 'Click the Record button.' },
  send: { label: 'Simple button: Send', find: () => $('send'), text: 'Click Send.' },
  compose: { label: 'Simple button: Compose', find: () => $('compose'), text: 'Click Compose to write an email.' },
  navSettings: { label: 'Navigation link: Settings', find: () => $('navSettings'), text: 'Click Settings at the top.' },
  item25: { label: 'Inside a scroll container', find: () => $('item25'), text: 'Click "Open message 25".' },
  fixedHelp: { label: 'Fixed-position button', find: () => $('fixedHelp'), text: 'Click Help in the corner.' },
  tilted: { label: 'Transformed element', find: () => $('tilted'), text: 'Click this button.' },
  dynamic: { label: 'Dynamic (re-rendered)', find: () => document.querySelector('[data-demo="save"]'), text: 'Click Save draft.', reacquire: true },
  frame: { label: 'Same-origin iframe', find: () => $('frame').contentDocument?.getElementById('frameBtn'), text: 'Click Reply in frame.' },
  corner: { label: 'Near the viewport edge', find: () => $('cornerBtn'), text: 'Click Account.' },
  bottom: { label: 'Far down (scrolls first)', find: () => $('bottomBtn'), text: 'Click Delete account.' },
  hidden: { label: 'Hidden element (should refuse)', find: () => $('hiddenBtn'), text: 'This should not show.' },
  missing: { label: 'Missing element (should refuse)', find: () => null, text: 'This should not show.' }
};
for (const [key, t] of Object.entries(TARGETS)) $('target').add(new Option(t.label, key));
$('target').addEventListener('change', () => { $('instruction').value = TARGETS[$('target').value].text; });

async function show(key, text, options = {}) {
  const t = TARGETS[key];
  const el = t?.find();
  if (!el) {
    log(`Not shown: target missing.`);
    return { ok: false, reason: 'missing' };
  }
  log(`Showing: ${t.label}`);
  const result = await showSpotlight(el, text ?? t.text, {
    dismissOnActivate: $('dismiss').checked,
    reacquire: t.reacquire ? () => t.find() : null,
    onClose: (reason) => log(`Closed: ${reason}`),
    ...options
  });
  log(result.ok ? `Shown: ${t.label}` : `Not shown: ${result.reason}`);
  return result;
}

$('show').addEventListener('click', () => show($('target').value, $('instruction').value));
$('hide').addEventListener('click', () => hideSpotlight('api'));

// Hook for automated tests.
window.__demo = {
  show: (key, text, options) => show(key, text, options),
  showSelector: (selector, text, options) => showSpotlight(selector, text, options),
  hide: () => hideSpotlight('api'),
  destroy: () => destroySpotlight(),
  state: () => getSpotlightState()
};
