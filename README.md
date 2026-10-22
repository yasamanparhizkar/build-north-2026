# Senior Helper Pointer

A Chrome extension (Manifest V3) that helps a senior navigate a web page. A family member talks over Google Meet while the senior shares her screen. The extension hears the instruction and draws a big pointer on the matching button, for example "the record button is on the left".

Near-zero cost: it uses the free tier of the Gemini API and has no backend.

## How it works

```
Meet tab audio ──► offscreen doc ──► background worker ──► Gemini ──► content script
(tabCapture)       6s WAV clips      builds prompt with      JSON:       highlights element
                   silence skipped   page elements           transcript, + label on the
                                                             command,    senior's page
                                                             element id
```

1. **Audio capture.** `chrome.tabCapture` records the Meet tab, which carries only the *remote* person's voice. An offscreen document cuts it into short 16 kHz WAV clips and skips silent ones.
2. **Understanding.** The background worker asks the content script for the visible interactive elements, including a region like `top-left` and normalized x/y. It then sends the clip and the element list to Gemini in one request. Gemini returns the transcript, whether it was a command, and the matched element id.
3. **Pointer.** The content script draws a pulsing red box and a label on the element, and keeps it attached while the page scrolls. It disappears after 20 seconds.

## Project layout

```
manifest.json
src/
  background/        service worker
    index.js           message routing (entry point)
    capture.js         start/stop tab capture, active-tab tracking
    pipeline.js        audio/text -> Gemini -> pointer orchestration
    gemini.js          Gemini REST client (fetch is injectable)
    prompt.js          prompt building + response parsing (pure)
    queue.js           keep-latest job queue
    session.js         session state in chrome.storage.session
    tabs.js            messaging to content scripts (auto-inject)
  offscreen/         audio capture document
    offscreen.js       capture + clip cutting
    audio.js           WAV encoding, downsampling, RMS (pure)
  content/           runs on web pages
    loader.js          classic script that imports main.js as a module
    main.js            entry, message handling
    elements.js        DOM scan for interactive elements
    describe.js        region/text helpers (pure)
    pointer.js         highlight + label overlay
    badge.js           status badge
    styles.js          injected CSS
  popup/             toolbar popup (API key, start/stop, test command)
  shared/            constants and message names
test/                unit tests (node:test)
```

Modules marked *pure* have no Chrome or DOM dependencies, so they are unit tested in Node.

## Install (unpacked)

1. Get a free API key at <https://aistudio.google.com>.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select this folder.
3. Click the extension icon and save your Gemini API key.

## Use

- **Quick test, no audio:** open Gmail, open the popup, type "click the compose button" and press **Highlight Element**.
- **Live:** on the **Meet tab**, open the popup and press **Start Listening**. Then switch to the page being shared. The pointer appears on whichever non-Meet tab is active, or on the Meet tab if there is none.

## Tests

Requires Node 20 or later. There are no dependencies to install.

```
npm test
```

## Known limitations

- Tab capture can only record the tab where **Start Listening** was pressed.
- A sentence split across two 6-second clips may be missed, and responses are delayed by a few seconds.
- Elements inside iframes are not scanned yet.
- Free-tier Gemini quotas apply. Silent clips are skipped to conserve them.
