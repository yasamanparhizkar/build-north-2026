@# Senior Helper popup — redesign spec

Hand this file to the Claude session working on the Senior Helper Chrome extension. It describes the new popup design exactly: layout, states, colors, type, motion and copy. Apply it to the existing popup (`popup.html` / `popup.css` / `popup.js` or whatever the repo calls them), keeping all existing behaviour wiring (start/stop listening, settings storage, diagnostics) and changing only the UI on top of it.

## 1. What changes

**Remove from the popup entirely**
- The "Senior Helper" header / emoji.
- The "Not listening" status pill and the red "Start Listening" button (replaced by the switch below).
- The orange "This tab is not Google Meet…" text (replaced by the disabled state below).
- "Test a command" text box, "Highlight Element", "Clear Pointer", "Open spotlight demo".
- The "Ready." status box.
- The collapsible "Settings" and "Diagnostics" `<details>` sections (moved to their own view).
- In settings: the **Voice mode**, **Live model** and **Pointer style** fields. The audio-clip / live mode choice is not exposed for now; keep whatever the code currently uses as the default and don't render these controls.

**The popup becomes two views in the same `popup.html`**
1. **Main view**: one large on/off switch, a status label, a waveform while listening, a one-line privacy note when off, and a small "Settings" link bottom-right.
2. **Settings view**: back arrow + "Settings" title, API key, Model, Save / Forget key, key-storage note, Diagnostics list.

Switch views by toggling `hidden` on two `<section>`s (no page navigation, no router). Default to the main view each time the popup opens.

## 2. Design tokens

Theme follows the system: light by default, dark under `@media (prefers-color-scheme: dark)`.

```css
:root {
  --bg: #FFFFFF;
  --text: #1D1D1F;
  --muted: #6E6E73;     /* all secondary/grey text */
  --track: #DCDCE1;     /* switch track when off */
  --green: #34B36F;     /* switch track when on + waveform */
  --field: #F5F5F7;     /* input + diagnostics card background */
  --border: #E3E3E8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1C1C1E;
    --text: #F2F2F7;
    --muted: #A1A1A6;
    --track: #3A3A3C;
    --green: #4CC38A;
    --field: #2C2C2E;
    --border: #3A3A3C;
  }
}
html, body { margin: 0; background: var(--bg); color: var(--text); }
body {
  width: 360px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

No other colors, no gradients, no emoji, no shadows except the switch knob.

**Type scale**
| Use | Size | Weight | Notes |
|---|---|---|---|
| Status label under switch | 15px | 500 | letter-spacing −0.01em, `--text` |
| Settings title | 15px | 600 | letter-spacing −0.01em |
| Inputs, buttons | 13px | 400 / 600 (Save) | |
| Field labels, hint, Settings link, diagnostics rows | 12px | 400 | `--muted` (diagnostic values in `--text`) |
| Privacy note, key note | 11px | 400 | line-height 1.5, `--muted` |
| "DIAGNOSTICS" section label | 11px | 600 | uppercase, letter-spacing 0.06em, `--muted` |

## 3. Main view (360 × 300)

```
┌──────────────────────────────────┐  padding: 20px 20px 10px
│                                  │
│            ( ●━━━━ )             │  switch 104×60, centered
│          Not listening           │  label, 14px gap above
│        ~~~~waveform~~~~          │  32px-tall slot (always reserved)
│                                  │
│  While listening, your Meet      │  privacy note (only when OFF and on Meet)
│  audio is shared with Google…    │
│                         Settings │  link, bottom-right
└──────────────────────────────────┘
```

Layout: the section is a flex column, `height: 300px; box-sizing: border-box; padding: 20px 20px 10px`. The top block (`flex: 1`) centers switch, label and the 32px waveform slot vertically with `gap: 14px`. The footer is a column with `gap: 6px`: privacy note, then a row `justify-content: flex-end` holding the Settings link.

### Markup

```html
<section id="main-view" class="main">
  <div class="main-center">
    <button id="listen-switch" class="switch" type="button" role="switch"
            aria-checked="false" aria-label="Listening">
      <span class="knob"></span>
    </button>
    <div id="status-label" class="status">Not listening</div>
    <div class="wave-slot">
      <svg id="wave" class="wave" width="180" height="32" viewBox="0 0 180 32" aria-hidden="true" hidden>
        <defs>
          <linearGradient id="waveFadeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0"    stop-color="#fff" stop-opacity="0"/>
            <stop offset="0.22" stop-color="#fff" stop-opacity="1"/>
            <stop offset="0.78" stop-color="#fff" stop-opacity="1"/>
            <stop offset="1"    stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
          <mask id="waveFade"><rect width="180" height="32" fill="url(#waveFadeGrad)"/></mask>
        </defs>
        <g mask="url(#waveFade)">
          <path class="wave-back"
                d="M0 16 Q14 9 28 16 T56 16 T84 16 T112 16 T140 16 T168 16 T196 16 T224 16 T252 16"/>
          <path class="wave-front"
                d="M0 16 Q10 5 20 16 T40 16 T60 16 T80 16 T100 16 T120 16 T140 16 T160 16 T180 16 T200 16 T220 16 T240 16"/>
        </g>
      </svg>
      <div id="meet-hint" class="hint" hidden>Open a Google Meet tab, then start here</div>
    </div>
  </div>
  <footer class="main-footer">
    <p id="privacy-note" class="privacy">While listening, your Meet audio is shared with Google Gemini.</p>
    <div class="footer-row">
      <button id="open-settings" class="link" type="button">Settings</button>
    </div>
  </footer>
</section>
```

### CSS

```css
.main { height: 300px; box-sizing: border-box; padding: 20px 20px 10px;
        display: flex; flex-direction: column; }
.main-center { flex: 1; display: flex; flex-direction: column;
               align-items: center; justify-content: center; gap: 14px; }

/* Switch */
.switch { position: relative; width: 104px; height: 60px; padding: 0; border: 0;
          border-radius: 30px; background: var(--track); cursor: pointer;
          transition: background .25s ease; }
.switch .knob { position: absolute; top: 4px; left: 4px; width: 52px; height: 52px;
                border-radius: 50%; background: #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,.18), 0 3px 10px rgba(0,0,0,.08);
                transition: transform .28s cubic-bezier(.3,.7,.4,1); }
.switch[aria-checked="true"] { background: var(--green); }
.switch[aria-checked="true"] .knob { transform: translateX(44px); }
.switch:disabled { opacity: .45; cursor: not-allowed; }
.switch:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }

.status { font-size: 15px; font-weight: 500; letter-spacing: -0.01em; }

/* Waveform slot keeps its height so nothing jumps when toggling */
.wave-slot { height: 32px; display: flex; align-items: center; justify-content: center; }
.hint { font-size: 12px; color: var(--muted); }

.wave path { fill: none; stroke: var(--green); stroke-linecap: round; }
.wave-back  { stroke-width: 2;    opacity: .35; animation: wave-back 2.6s linear infinite; }
.wave-front { stroke-width: 2.25;               animation: wave-front 1.4s linear infinite; }
@keyframes wave-back  { to { transform: translateX(-56px); } }  /* exactly one period */
@keyframes wave-front { to { transform: translateX(-40px); } }  /* exactly one period */
@media (prefers-reduced-motion: reduce) { .wave path { animation: none; } }

/* Footer */
.main-footer { display: flex; flex-direction: column; gap: 6px; }
.privacy { margin: 0; padding: 0 6px; font-size: 11px; line-height: 1.5;
           color: var(--muted); text-align: center; }
.footer-row { display: flex; justify-content: flex-end; }
.link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px;
        border: 0; background: none; font: inherit; font-size: 12px;
        color: var(--muted); cursor: pointer; }
.link:hover { color: var(--text); }
```

How the waveform works: each path is a sine drawn with `Q … T …` segments and is wider than the 180px viewBox. Translating it left by exactly one wavelength (40px front, 56px back) and looping makes it flow seamlessly. Two waves at different speeds and opacities give depth, and the mask fades both edges. Keep those numbers exactly.

### States (main view)

| State | Switch | Label | Wave slot | Privacy note |
|---|---|---|---|---|
| **Off** (on a Meet tab, not listening) | enabled, `aria-checked="false"`, grey track | "Not listening" | empty | **shown** |
| **Listening** | enabled, `aria-checked="true"`, green track, knob right | "Listening" | waveform shown, animating | **hidden** |
| **Not on Meet** (active tab isn't `https://meet.google.com/…`) | `disabled`, 45% opacity, off position | "Not on a Meet tab" | hint "Open a Google Meet tab, then start here" | **hidden** |

Rules:
- The privacy note shows **only** in the Off state.
- If the extension is listening on a Meet tab and the popup is opened on another tab, show the **Listening** state (the switch stays usable to stop). Use **Not on Meet** only when not listening and the current tab isn't Meet.
- Clicking the switch calls the existing start/stop logic. Update the UI from the actual listening state the background/service worker reports (and re-sync on popup open), not optimistically. If start fails, revert to Off and surface the error in the hint slot in `--muted` text.
- No "Ready." / status box anywhere.

## 4. Settings view (360 × ~580, fits Chrome's 600px popup max)

```
┌──────────────────────────────────┐  padding: 8px 20px 20px; gap 14px
│ ‹  Settings                      │  44×44 back button, title 15/600
│                                  │
│ Gemini API key                   │  label 12px muted, 4px gap
│ [••••••••••••••••••••••••]       │  input 34px
│ Model                            │
│ [gemini-flash-lite-latest ]      │  placeholder "gemini-flash-latest"
│                                  │
│ [      Save       ] [Forget key] │  40px buttons, 8px gap
│ Your key stays in this Chrome    │  11px muted note
│ profile's extension storage…     │
│ ──────────────────────────────── │  1px var(--border)
│ DIAGNOSTICS                      │
│ ┌──────────────────────────────┐ │  card: var(--field), radius 10, padding 4px 12px
│ │ Last heard               —   │ │  rows 26px, 12px; key muted, value text
│ │ Median Gemini      1411 ms   │ │
│ │ …                            │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

### Markup

```html
<section id="settings-view" class="settings" hidden>
  <div class="settings-header">
    <button id="back" class="icon-btn" type="button" aria-label="Back">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <h1>Settings</h1>
  </div>

  <div class="fields">
    <div class="field">
      <label for="api-key">Gemini API key</label>
      <input id="api-key" type="password" autocomplete="off" spellcheck="false">
    </div>
    <div class="field">
      <label for="model">Model</label>
      <input id="model" type="text" placeholder="gemini-flash-latest" spellcheck="false">
    </div>
  </div>

  <div class="actions-block">
    <div class="actions">
      <button id="save" class="btn-primary" type="button">Save</button>
      <button id="forget-key" class="btn-secondary" type="button">Forget key</button>
    </div>
    <p class="note">Your key stays in this Chrome profile’s extension storage, unencrypted. Use Forget key on shared computers.</p>
  </div>

  <hr class="divider">

  <div class="diag">
    <h2>Diagnostics</h2>
    <dl id="diag-list" class="diag-card"><!-- rows rendered by popup.js --></dl>
  </div>
</section>
```

### CSS

```css
.settings { box-sizing: border-box; padding: 8px 20px 20px;
            display: flex; flex-direction: column; gap: 14px; }
.settings-header { display: flex; align-items: center; gap: 2px; margin-left: -12px; }
.settings-header h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.icon-btn { width: 44px; height: 44px; display: inline-flex; align-items: center;
            justify-content: center; border: 0; background: none; color: var(--text);
            cursor: pointer; border-radius: 10px; }

.fields { display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 12px; color: var(--muted); }
.field input { height: 34px; box-sizing: border-box; padding: 0 10px; border-radius: 8px;
               border: 1px solid var(--border); background: var(--field); color: var(--text);
               font: inherit; font-size: 13px; }
.field input::placeholder { color: var(--muted); }
.field input:focus { outline: none; border-color: var(--green); }

.actions-block { display: flex; flex-direction: column; gap: 8px; }
.actions { display: flex; gap: 8px; }
.btn-primary { flex: 1; height: 40px; border: 0; border-radius: 10px;
               background: var(--text); color: var(--bg);
               font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-secondary { height: 40px; padding: 0 14px; border: 1px solid var(--border);
                 border-radius: 10px; background: transparent; color: var(--text);
                 font: inherit; font-size: 13px; cursor: pointer; }
.note { margin: 0; font-size: 11px; line-height: 1.5; color: var(--muted); }

.divider { border: 0; height: 1px; margin: 0; background: var(--border); }

.diag { display: flex; flex-direction: column; gap: 8px; }
.diag h2 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .06em;
           text-transform: uppercase; color: var(--muted); }
.diag-card { margin: 0; padding: 4px 12px; border-radius: 10px; background: var(--field); }
.diag-row { display: flex; justify-content: space-between; align-items: center;
            height: 26px; font-size: 12px; }
.diag-row dt { color: var(--muted); }
.diag-row dd { margin: 0; font-variant-numeric: tabular-nums; }
```

Diagnostics rows (`<div class="diag-row"><dt>…</dt><dd>…</dd></div>`), fed from the existing diagnostics data, in this order and wording:

| Label | Value format |
|---|---|
| Last heard | text or "—" |
| Median Gemini | `1411 ms` |
| Match + render | `16 ms` |
| Speech → pointer | `2162 ms` |
| API calls / min | `0.2 · 0 errors` |
| Clips | `3 received · 0 skipped` |
| Audio sent | `6.4 s` |
| Highlights | `3` |

Behaviour:
- **Save** writes API key + model with the existing storage code; its label changes to "Saved" for ~1.4s, then back to "Save". No other toast.
- **Forget key** uses the existing forget logic and clears the input.
- Blank model means the existing default (`gemini-flash-latest`); keep that behaviour.
- **Back** returns to the main view. The Settings link and Back button swap the two sections' `hidden` attributes.
- If Diagnostics updates live, re-render it while the settings view is visible.

## 5. Implementation notes

- **Manifest V3 CSP:** no inline `<script>` or inline `onclick`. All logic goes in `popup.js`, wired with `addEventListener`. Inline SVG and CSS animations are fine.
- Meet detection: reuse the existing check if there is one; otherwise `chrome.tabs.query({active: true, currentWindow: true})` and test `url.startsWith('https://meet.google.com/')`.
- Keep the popup at exactly 360px wide; the main view is 300px tall, and the settings view grows to fit its content (about 580px).
- Accessibility: the switch is a real `<button role="switch">` with `aria-checked` kept in sync; all clickable items are real buttons with ≥44px hit area; icon-only Back has `aria-label`; the waveform is `aria-hidden`; respect `prefers-reduced-motion`.
- Remove the now-unused CSS/JS for the deleted controls, but don't delete the underlying features (voice mode, pointer style, spotlight demo) from the background/content scripts unless asked. Just stop exposing them in the popup.
- After implementing, load the unpacked extension and check all three main-view states plus the settings view in both light and dark system themes.
