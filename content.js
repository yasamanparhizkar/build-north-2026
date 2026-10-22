if (!window.seniorHelperLoaded) {
  window.seniorHelperLoaded = true;

let recognition = null;
let isListening = false;

// 1. Inject CSS for the Big Senior-Friendly Pointer & Floating Status Widget
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
    transition: all 0.3s ease;
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

// 2. Scan the DOM for visible interactive elements
function collectInteractiveElements() {
  const selectors = 'button, a, input, [role="button"], [aria-label], [data-tooltip]';
  const nodes = document.querySelectorAll(selectors);
  const elementsList = [];
  let idCounter = 1;

  nodes.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10 && rect.top >= 0 && rect.bottom <= window.innerHeight) {
      const aria = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '';
      const inner = (el.innerText || el.placeholder || '').trim();
      const text = `${aria} ${inner}`.trim().replace(/\s+/g, ' ').slice(0, 80);

      if (text) {
        const id = `sh-${idCounter++}`;
        el.setAttribute('data-senior-id', id);
        const position = rect.left < window.innerWidth / 3 ? 'left' : (rect.left > (window.innerWidth * 2 / 3) ? 'right' : 'center');
        elementsList.push({ id, tag: el.tagName.toLowerCase(), text, position });
      }
    }
  });
  return elementsList.slice(0, 100);
}

// 3. Draw the Highlighter & Pointer around the target element
function highlightElement(seniorId, instructionText) {
  clearHighlight();
  const target = document.querySelector(`[data-senior-id="${seniorId}"]`);
  if (!target) return false;

  const rect = target.getBoundingClientRect();

  const pointer = document.createElement('div');
  pointer.id = 'senior-helper-pointer';
  pointer.style.top = `${rect.top - 8}px`;
  pointer.style.left = `${rect.left - 8}px`;
  pointer.style.width = `${rect.width + 16}px`;
  pointer.style.height = `${rect.height + 16}px`;

  const label = document.createElement('div');
  label.id = 'senior-helper-label';
  label.innerText = `👆 ${instructionText || 'Click Here!'}`;
  pointer.appendChild(label);

  document.body.appendChild(pointer);
  return true;
}

function clearHighlight() {
  const existing = document.getElementById('senior-helper-pointer');
  if (existing) existing.remove();
}

// 4. Send transcript + DOM elements to Gemini via background.js
async function processCommandWithLLM(commandText) {
  const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
  if (!geminiApiKey) {
    badge.style.display = 'block';
    badge.innerText = '⚠️ Please save your Gemini API Key in the popup first!';
    return 'Missing API Key';
  }

  const elements = collectInteractiveElements();
  const prompt = `
You are an assistant helping a senior citizen find an element on a webpage based on a spoken instruction.
Spoken instruction: "${commandText}"
Available webpage elements: ${JSON.stringify(elements)}

Pick the best matching element ID and write a short 3-word label for the senior (e.g., "Click Captions Here").
Respond ONLY in valid JSON:
{"matchedId": "sh-12", "label": "Click Captions Here"}
`;

  badge.style.display = 'block';
  badge.innerText = `🤔 Thinking: "${commandText}"...`;

  return new Promise((resolve) => {
    // 10 second safety timer so it NEVER stays stuck on "Thinking..."
    const safetyTimer = setTimeout(() => {
      badge.innerText = '⏱️ Request timed out. Check Service Worker console.';
      resolve('Timed out');
    }, 10000);

    chrome.runtime.sendMessage(
      { action: 'CALL_GEMINI', apiKey: geminiApiKey, prompt },
      (response) => {
        clearTimeout(safetyTimer);

        if (chrome.runtime.lastError || !response) {
          badge.innerText = `❌ Extension error: ${chrome.runtime.lastError?.message || 'Reload page'}`;
          resolve('Extension error');
          return;
        }

        if (!response.success) {
          badge.innerText = `❌ API Error: ${response.error}`;
          resolve(`Error: ${response.error}`);
          return;
        }

        const parsed = response.data;
        if (parsed && parsed.matchedId) {
          highlightElement(parsed.matchedId, parsed.label);
          badge.innerText = `✅ Pointing to: ${parsed.label}`;
          resolve(`✅ Highlighted: ${parsed.label}`);
        } else {
          badge.innerText = `👂 Heard: "${commandText}" (No matching button found)`;
          resolve('No match found');
        }
      }
    );
  });
}

// 5. Continuous Voice Recognition
function toggleVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Web Speech API is not supported in this browser.');
    return 'Not supported';
  }

  if (isListening) {
    isListening = false;
    recognition.stop();
    badge.style.display = 'none';
    return '🛑 Voice stopped';
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    badge.style.display = 'block';
    badge.innerText = '🎤 Listening for instructions...';
  };

  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    processCommandWithLLM(transcript);
  };

  recognition.onend = () => {
    if (isListening) recognition.start();
  };

  recognition.start();
  return '🎤 Listening started on page!';
}

// 6. Listen for messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PROCESS_COMMAND') {
    processCommandWithLLM(request.command).then((status) => sendResponse({ status }));
    return true;
  } else if (request.action === 'TOGGLE_VOICE') {
    const status = toggleVoiceRecognition();
    sendResponse({ status });
  } else if (request.action === 'CLEAR_HIGHLIGHT') {
    clearHighlight();
    sendResponse({ status: 'Cleared pointer' });
  }
});