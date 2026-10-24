# Manual end-to-end test: real Google Meet call

Automated tests cover the DOM, matching, pointer and pipeline logic (see `npm run test:integration`). They **cannot** cover tab audio capture, Meet playback or Gemini's audio understanding. Run this procedure and record the results in the table at the bottom. Do not mark an item as passed unless you actually ran it.

## Setup

- **Device A (senior):** Chrome 116+ with the extension loaded unpacked, a Gemini key saved, signed in to Gmail.
- **Device B (family member):** any device in the same Meet call. Use a different Google account, or a second Chrome profile with headphones to avoid echo.
- On A, open the popup and expand **Diagnostics** to read latencies.

## Steps

| # | Action | Expected |
|---|---|---|
| 1 | A joins Meet and turns on the **switch** in the popup (on the Meet tab), with Settings → Listening mode = *Trigger word* | Badge shows **ON**, popup says *Say "Hey Jarvis"* with the waveform, the pill says *Say "Hey Jarvis"* |
| 2 | B talks | A still hears B clearly, with no echo or doubled audio |
| 3 | A switches to the Gmail tab | Pill visible on Gmail. Popup still *Listening* |
| 4 | B: "Hey Jarvis, click the Compose button." | Chime + *"I'm listening…"*, then pointer on Gmail's **Compose** within a few seconds |
| 5 | A switches back to Meet. B: "Hey Jarvis … (pause) … where is the microphone button?" | Chime after "Jarvis"; pointer on Meet's microphone button after the request |
| 6 | B chats normally for 1 minute ("How was lunch?"), including "click the Compose button" **without** the wake phrase | No chime, no pointer. Diagnostics: **API calls did not increase** |
| 7 | B: "Hey Jarvis, click Compose" twice, 5 s apart | Two chimes; the pointer is shown both times |
| 8 | B: "Hey Jarvis" and then says nothing | Chime, then after ~5 s *"I didn't hear a request…"*; no API call |
| 9 | B: "Hey Jarvis, click the Print button" (not on page) | "I couldn't find…" badge, no pointer |
| 10 | Open a Gmail dropdown (e.g. *More*), B: "Hey Jarvis, click Mark all as read" | Pointer on the menu item |
| 11 | Scroll while a pointer is shown | Pointer stays on the element, disappears after ~20 s |
| 12 | Click the pill's **Stop** | Badge clears, audio continues normally, no more pointers |
| 13 | Start again, then close the Meet tab | Popup shows *Capture interrupted* |
| 14 | Start, then reload the extension at `chrome://extensions` | State becomes *interrupted* (no silent background capture) |
| 15 | During all of the above | No element is ever clicked, no text typed |
| 16 | Settings → Listening mode = *Always listen*, turn the switch off and on. B: "Click the Compose button." (no wake phrase) | Pointer on **Compose**; no chime |

## Results log

Fill in with real observations. Latency values come from popup → Diagnostics.

| Date | Step | Pass/Fail | Gemini ms | Speech→pointer ms | Notes |
|---|---|---|---|---|---|
| | | | | | |

**Acceptance targets** (goals, not current results): ≥ 90% correct on a 20–30 command set, zero unintended clicks, no stale pointer after expiry, no duplicate highlight per utterance.

**Wake-word targets:** the wake phrase is heard on ≥ 9 of 10 tries (two different speakers), and 10 minutes of normal conversation produce at most 1 false chime. If it misses, lower `WAKE_THRESHOLD`; if it fires falsely, raise it (src/shared/constants.js).

