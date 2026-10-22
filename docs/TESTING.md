# Manual end-to-end test: real Google Meet call

Automated tests cover the DOM, matching, pointer and pipeline logic (see `npm run test:integration`). They **cannot** cover tab audio capture, Meet playback or Gemini's audio understanding. Run this procedure and record the results in the table at the bottom. Do not mark an item as passed unless you actually ran it.

## Setup

- **Device A (senior):** Chrome 116+ with the extension loaded unpacked, a Gemini key saved, signed in to Gmail.
- **Device B (family member):** any device in the same Meet call. Use a different Google account, or a second Chrome profile with headphones to avoid echo.
- On A, open the popup and expand **Diagnostics** to read latencies.

## Steps

| # | Action | Expected |
|---|---|---|
| 1 | A joins Meet and presses **Start Listening** on the Meet tab | Badge shows **ON**, popup says *Listening*, the red pill appears |
| 2 | B talks | A still hears B clearly, with no echo or doubled audio |
| 3 | A switches to the Gmail tab | Pill visible on Gmail. Popup still *Listening* |
| 4 | B: "Click the Compose button." | Pointer on Gmail's **Compose** within a few seconds |
| 5 | A switches back to Meet. B: "Where is the microphone button?" | Pointer on Meet's microphone button |
| 6 | B chats normally for 1 minute ("How was lunch?") | No pointer appears |
| 7 | B says the same command twice within 5 s, then again after 15 s | One pointer for the first pair, a new one after 15 s |
| 8 | B speaks a long 10 s sentence ending with "…click Inbox" | Inbox highlighted once |
| 9 | B: "Click the Print button" (not on page) | "I couldn't find…" badge, no pointer |
| 10 | Open a Gmail dropdown (e.g. *More*), B: "click Mark all as read" | Pointer on the menu item |
| 11 | Scroll while a pointer is shown | Pointer stays on the element, disappears after ~20 s |
| 12 | Click the pill's **Stop** | Badge clears, audio continues normally, no more pointers |
| 13 | Start again, then close the Meet tab | Popup shows *Capture interrupted* |
| 14 | Start, then reload the extension at `chrome://extensions` | State becomes *interrupted* (no silent background capture) |
| 15 | During all of the above | No element is ever clicked, no text typed |

## Results log

Fill in with real observations. Latency values come from popup → Diagnostics.

| Date | Step | Pass/Fail | Gemini ms | Speech→pointer ms | Notes |
|---|---|---|---|---|---|
| | | | | | |

**Acceptance targets** (goals, not current results): ≥ 90% correct on a 20–30 command set, zero unintended clicks, no stale pointer after expiry, no duplicate highlight per utterance.
