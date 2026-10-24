# Senior Helper popup — text input page (addendum)

Hand this file to the Claude session working on the Senior Helper Chrome extension. It adds a **third view** to the redesigned popup: a text box where the user types a question instead of speaking. It builds on `senior-helper-popup-style.md` (same tokens, type and spacing). If that redesign isn't implemented yet, do it first, then apply this.

Keep the existing command logic. The old popup's "Test a command" box + "Highlight Element" button already sends a typed command through the matching and highlighting pipeline; the new text page reuses that same code path, with only the UI changing.

## 1. Navigation

The popup now has three views in `popup.html`, toggled with the `hidden` attribute (no page loads):

```
Main (switch)  ──"Text"──▶  Text page
     ▲                          │
     └─────────"Audio"──────────┘
Main / Text  ──"Settings"──▶  Settings  ──‹ Back──▶  the view you came from
```

- **Main view footer:** add a grey **"Text"** link at the **bottom left**. "Settings" stays at the bottom right. Show "Text" in every main-view state (Off, Listening, Not on Meet).
- **Text view footer:** **"Audio"** at the bottom left (returns to the main view), **"Settings"** at the bottom right.
- **Back** on Settings returns to whichever view opened it (main or text). Track the previous view in a variable.
- The popup opens on the main view by default.
- Switching to the text view does not stop listening; the switch state is unaffected.

## 2. Tokens (same as the main spec)

```css
:root {
  --bg: #FFFFFF; --text: #1D1D1F; --muted: #6E6E73;
  --field: #F5F5F7; --border: #E3E3E8; --green: #34B36F;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1C1C1E; --text: #F2F2F7; --muted: #A1A1A6;
    --field: #2C2C2E; --border: #3A3A3C; --green: #4CC38A;
  }
}
```

## 3. Footer change on the main view

Replace the main view's footer row so it holds two links, spaced apart:

```html
<div class="footer-row">
  <button id="open-text" class="link" type="button">Text</button>
  <button id="open-settings" class="link" type="button">Settings</button>
</div>
```

```css
.footer-row { display: flex; justify-content: space-between; }
```

(`.link` is unchanged: 12px, `--muted`, no background, `min-height: 44px`, `padding: 0 6px`, hover → `--text`.)

## 4. Text view (360 × 300, same frame as the main view)

```
┌──────────────────────────────────┐  padding: 20px 20px 10px
│                                  │
│                                  │
│ ╭──────────────────────────────╮ │  pill input, 52px tall, full width
│ │ What do you need help with? (⌕)│ │  round 36px search button inside, right
│ ╰──────────────────────────────╯ │
│                                  │
│                                  │
│ Audio                   Settings │  footer links
└──────────────────────────────────┘
```

The input is vertically centered in the space above the footer, at the same height as the switch on the main view, so swapping views doesn't make content jump.

### Markup

```html
<section id="text-view" class="text-view" hidden>
  <div class="text-center">
    <form id="ask-form" class="ask" autocomplete="off">
      <input id="ask-input" class="ask-input" type="text"
             placeholder="What do you need help with?"
             aria-label="What do you need help with?" spellcheck="true">
      <button id="ask-submit" class="ask-btn" type="submit" aria-label="Search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/>
        </svg>
      </button>
    </form>
    <p id="ask-status" class="ask-status" aria-live="polite"></p>
  </div>
  <div class="footer-row">
    <button id="open-audio" class="link" type="button">Audio</button>
    <button id="open-settings-from-text" class="link" type="button">Settings</button>
  </div>
</section>
```

### CSS

```css
.text-view { height: 300px; box-sizing: border-box; padding: 20px 20px 10px;
             display: flex; flex-direction: column; }
.text-center { flex: 1; display: flex; flex-direction: column; justify-content: center; }

.ask { position: relative; margin: 0; }
.ask-input { width: 100%; height: 52px; box-sizing: border-box;
             padding: 0 56px 0 18px;               /* right padding clears the button */
             border-radius: 26px; border: 1px solid var(--border);
             background: var(--field); color: var(--text);
             font: inherit; font-size: 14px; outline: none;
             transition: border-color .15s ease; }
.ask-input::placeholder { color: var(--muted); }
.ask-input:focus { border-color: var(--green); }

.ask-btn { position: absolute; top: 8px; right: 8px;
           width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%;
           background: var(--text); color: var(--bg);   /* dark circle, light icon; inverts in dark mode */
           display: flex; align-items: center; justify-content: center;
           cursor: pointer; transition: opacity .15s ease, transform .1s ease; }
.ask-btn:hover { opacity: .85; }
.ask-btn:active { transform: scale(.94); }
.ask-btn:disabled { opacity: .35; cursor: default; }
.ask-btn:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

/* Empty by default, so the layout is identical to the mockup until there's something to say */
.ask-status { min-height: 16px; margin: 8px 0 0; padding: 0 18px;
              font-size: 12px; color: var(--muted); }
```

Design rules: no label above the box (the placeholder and `aria-label` carry it), no other buttons, and no privacy note on this page. The search button is the same dark-on-light treatment as the Save button in Settings, so the two match.

## 5. Behaviour

- **Submit** with Enter or the search button. `preventDefault()` on the form submit, trim the value, and ignore empty submissions.
- Disable the search button while the input is empty (`input` event toggles `disabled`), and while a request is in flight.
- On submit, send the text through the **existing typed-command path** (whatever "Highlight Element" called before). Don't write a new pipeline.
- While it runs, set `#ask-status` to "Looking…". On success, clear it (the highlight on the page is the feedback). On failure, show a short plain message, e.g. "Couldn't find that on this page." or the existing error text. Keep it to one line.
- Keep the typed text in the box after submitting so the user can tweak and resend. Select-all on focus is not needed.
- Focus the input automatically when the text view opens.
- Works on any tab: unlike listening, typed questions aren't tied to Google Meet, so don't disable this page on non-Meet tabs (unless the existing command path requires Meet; if so, reuse the main view's hint text in `#ask-status`).

### View switching (sketch for `popup.js`)

```js
const views = {
  main: document.getElementById('main-view'),
  text: document.getElementById('text-view'),
  settings: document.getElementById('settings-view'),
};
let current = 'main', beforeSettings = 'main';

function show(name) {
  if (name === 'settings') beforeSettings = current;
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  current = name;
  if (name === 'text') document.getElementById('ask-input').focus();
}

document.getElementById('open-text').addEventListener('click', () => show('text'));
document.getElementById('open-audio').addEventListener('click', () => show('main'));
document.getElementById('open-settings').addEventListener('click', () => show('settings'));
document.getElementById('open-settings-from-text').addEventListener('click', () => show('settings'));
document.getElementById('back').addEventListener('click', () => show(beforeSettings));

const input = document.getElementById('ask-input');
const submit = document.getElementById('ask-submit');
const status = document.getElementById('ask-status');
const syncButton = () => { submit.disabled = input.value.trim() === ''; };
input.addEventListener('input', syncButton);
syncButton();

document.getElementById('ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  submit.disabled = true;
  status.textContent = 'Looking…';
  try {
    await runTypedCommand(query);   // ← the existing function behind the old "Highlight Element" button
    status.textContent = '';
  } catch (err) {
    status.textContent = "Couldn't find that on this page.";
  } finally {
    syncButton();
  }
});
```

Rename `runTypedCommand` to the real function in the codebase. All of this lives in `popup.js` (Manifest V3 doesn't allow inline scripts or `onclick` attributes).

## 6. Check when done

Load the unpacked extension and verify, in both light and dark system themes:

1. The main view shows "Text" bottom-left and "Settings" bottom-right in Off, Listening and Not on Meet.
2. "Text" opens the text view with the input focused; "Audio" returns to the switch, and listening state is unchanged by the round trip.
3. Settings opened from the text view returns to the text view on Back.
4. Enter and the search button both submit; empty input does nothing; the highlight appears on the page.
5. The input, button and footer don't shift when switching between the main and text views.
