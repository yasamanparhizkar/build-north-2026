# Wake-word test clips

16 kHz mono 16-bit WAV.

- `pos_*.wav`: contain "Hey Ollie", alone or followed by a request. The detector must fire.
- `neg_*.wav`: ordinary conversation, including "Hey John…" and "Hey, are you there?". It must not.

The `neg_*` clips are synthetic (espeak-ng), so they test the pipeline, not real-world accuracy.
Real voices over Google Meet are tested by hand (docs/TESTING.md).

| File | Text |
|---|---|
| pos_1 | Hey Ollie |
| pos_2 | Hey Ollie |
| pos_3 | Hey Ollie |
| pos_4 | Hey Ollie |
| pos_5 | Hey Ollie |
| pos_6 | Hey Ollie, click the compose button. |
| neg_1 | How was your day today, mom? |
| neg_2 | Hey John, did you see the news? |
| neg_3 | I think the weather is nice, can you help me with dinner? |
| neg_4 | Click the compose button on the left. |
| neg_5 | Hey, are you there? Can you hear me? |
