# Wake-word test clips

16 kHz mono 16-bit WAV, synthesized with espeak-ng (several voices, speeds and pitches).

- `pos_*.wav`: contain "Hey Jarvis", alone or followed by a request. The detector must fire.
- `neg_*.wav`: ordinary conversation, including "Hey John…" and "Hey, are you there?". It must not.

They are synthetic, so they test the pipeline, not real-world accuracy.
Real voices over Google Meet are tested by hand (docs/TESTING.md).

| File | Text |
|---|---|
| pos_1 | Hey Jarvis |
| pos_2 | Hey Jarvis, click the compose button. |
| pos_3 | Hey Jarvis. Where is the microphone? |
| pos_4 | Hey Jarvis, please show me the search box. |
| pos_5 | Hey Jarvis |
| neg_1 | How was your day today, mom? |
| neg_2 | Hey John, did you see the news? |
| neg_3 | I think the weather is nice, can you help me with dinner? |
| neg_4 | Click the compose button on the left. |
| neg_5 | Hey, are you there? Can you hear me? |
