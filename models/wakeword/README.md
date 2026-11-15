# Wake-word models

These run on the user's computer, inside the extension's offscreen document
(`src/offscreen/wakeEngine.js`), with ONNX Runtime Web from `vendor/onnxruntime-web/`.
No audio leaves the computer until one of them hears the wake phrase.

| File | What it does | Origin | License |
|---|---|---|---|
| `melspectrogram.onnx` | 16 kHz audio → mel spectrogram | openWakeWord feature model | Apache-2.0 |
| `embedding_model.onnx` | mel frames → 96-dim speech embeddings | openWakeWord, derived from Google's `speech_embedding` | Apache-2.0 |
| `hey_ollie_v0.1.onnx` | embeddings → "Hey Ollie" score (0..1) | Trained by the project with openWakeWord's pipeline ([notebooks/hey_ollie_training.ipynb](../../notebooks/hey_ollie_training.ipynb)) | Project's own licence (see the note below) |
| `hey_jarvis_v0.1.onnx` | embeddings → "Hey Jarvis" score (0..1) | openWakeWord pre-trained model. Not used by the app now. | **CC BY-NC-SA 4.0 (non-commercial)** |

The Mel and embedding files were copied from the npm package `openwakeword-wasm-browser@0.1.1`, which
redistributes the openWakeWord release files. Their scores match the official Python
`openwakeword` 0.6.0 package exactly on `test/fixtures/audio/` (checked when they were added).

SHA-256:

```
ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f  melspectrogram.onnx
70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f  embedding_model.onnx
dcac1c44f0827611d18c065b78ea1eb85f5ef08fc099d837c2f2ee1cec77488a  hey_ollie_v0.1.onnx
94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb  hey_jarvis_v0.1.onnx
```

## Current state

The app uses `hey_ollie_v0.1.onnx` with `WAKE_PHRASE = "Hey Ollie"` (`src/shared/constants.js`).
The "Hey Ollie" model has not yet been checked on real recordings. Its tests use
`test/fixtures/audio/pos_*.wav`, which still contain "Hey Jarvis" and need to be replaced
with "Hey Ollie" recordings. Until then, the wake-word tests that use positive clips will fail.

Once the new model passes those checks, delete `hey_jarvis_v0.1.onnx`. That also removes the
non-commercial licence from the package.

## Changing the wake phrase

1. Train a model for the new phrase with `notebooks/hey_ollie_training.ipynb`
   (or openWakeWord's own notebooks). It produces `<name>.onnx`.
2. Put the file in this folder.
3. In `src/shared/constants.js`, set `WAKE_MODEL_FILE` to the file name and
   `WAKE_PHRASE` to the phrase (it is shown to users and given to Gemini).
4. Add test clips of the new phrase as `test/fixtures/audio/pos_*.wav`
   (16 kHz, mono, 16-bit) and run `npm test`.

## Licence note

A model trained by the project is not covered by the non-commercial licence of
`hey_jarvis_v0.1.onnx`. Its training data is, however, subject to its own terms (openWakeWord,
AudioSet, and the ACAV100M features). Check those terms before a commercial release.
