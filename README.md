# Senior Helper Pointer

A Chrome extension (Manifest V3) that helps a senior navigate a web page. A family member talks over Google Meet while the senior shares her screen. The extension hears the instruction and draws a big pointer on the matching button, for example "the record button is on the left".

Near-zero cost: it uses the free tier of the Gemini API and has no backend. Typed commands need no API key at all.

## How it works

```
Meet tab audio ─► offscreen doc ─► Gemini Live ─► utterance ─► background ─► content script
(tabCapture)      ~43 ms PCM       (WebSocket,    detector     offline         highlights element
                  frames           live text)     (400 ms      matcher first,  + label on the
                                                  pause)       Gemini if unsure senior's page
```

1. **Streaming audio.** `chrome.tabCapture` records the Meet tab, which carries only the *remote* person's voice. The offscreen document streams it in small 16 kHz PCM frames over a WebSocket to the Gemini Live API. Live text comes back while the person is still talking, so there is no waiting for a whole clip.
2. **Utterances.** `UtteranceDetector` joins transcript fragments and treats a command as finished after about 400 ms without new text.
3. **Matching.** The background worker asks the content script for visible interactive elements (text, region like `top-left`, normalized x/y). The offline matcher (`matcher.js`) scores them in about 0 ms, using spatial hints like "on the left". Only if it is unsure does it ask Gemini (text request) to decide whether it was a command and which element.
4. **Pointer.** The content script draws a pulsing red box and label on the element and keeps it attached while the page scrolls. It disappears after 20 seconds.

## Project layout

```
manifest.json
src/
  background/        service worker
    index.js           message routing (entry point)
    capture.js         start/stop tab capture, active-tab tracking
    pipeline.js        text -> matcher/Gemini -> pointer orchestration
    matcher.js         offline command -> element matcher (pure)
    gemini.js          Gemini REST client (fetch is injectable)
    prompt.js          prompt building + response parsing (pure)
    queue.js           keep-latest job queue
    session.js         session state in chrome.storage.session
    tabs.js            messaging to content scripts (auto-inject)
  voice/             real-time speech-to-text module (no Chrome APIs)
    protocol.js        Gemini Live message builders/parsers (pure)
    liveClient.js      WebSocket client with auto-reconnect
    utteranceDetector.js  fragments -> finished commands (pure)
  offscreen/         audio capture document
    offscreen.js       tab audio -> PCM frames -> voice module
    audio.js           downsampling, PCM16, base64 (pure)
  content/           runs on web pages
    loader.js          classic script that imports main.js as a module
    main.js            entry, message handling
    elements.js        DOM scan for interactive elements
    describe.js        region/text helpers (pure)
    pointer.js         highlight + label overlay
    badge.js           status badge
    styles.js          injected CSS
  popup/             toolbar popup (settings, start/stop, test command)
  shared/            constants and message names
test/                unit tests (node:test)
```

Modules marked *pure* have no Chrome or DOM dependencies, so they are unit tested in Node. The `voice/` module is self-contained: the speech provider can be swapped by replacing `liveClient.js`.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select this folder.
2. For voice only: get a free API key at <https://aistudio.google.com> and save it in the popup.

## Use

- **Text, no API key:** open Gmail, open the popup, type "click the compose button" and press **Highlight Element**.
- **Voice:** on the **Meet tab**, open the popup and press **Start Listening**. A badge shows the connection state. Then switch to the page being shared. The pointer appears on whichever non-Meet tab is active, or on the Meet tab if there is none.

## Tests

Requires Node 20 or later. There are no dependencies to install.

```
npm test
```

## Known limitations

- The Gemini Live model name changes often. If voice fails to connect, set a current Live model in the popup ("Live model"). The default is in `src/shared/constants.js`.
- Live sessions answer with audio that we ignore. This may use some free-tier quota. Gemini Live has session time limits, handled by auto-reconnect.
- Tab capture can only record the tab where **Start Listening** was pressed.
- Elements inside iframes are not scanned yet.
- The voice path has unit tests but has not been tested against the real Gemini Live service.
