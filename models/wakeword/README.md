# Wake-word models

These run on the user's computer, inside the extension's offscreen document
(`src/offscreen/wakeEngine.js`), with ONNX Runtime Web from `vendor/onnxruntime-web/`.
No audio leaves the computer until one of them hears the wake phrase.

| File | What it does | Origin | License |
|---|---|---|---|
| `melspectrogram.onnx` | 16 kHz audio → mel spectrogram | openWakeWord feature model | Apache-2.0 |
| `embedding_model.onnx` | mel frames → 96-dim speech embeddings | openWakeWord, derived from Google's `speech_embedding` | Apache-2.0 |
| `hey_ollie_v0.1.onnx` | embeddings → "Hey Ollie" score (0..1) | Trained by the project with openWakeWord's pipeline ([notebooks/hey_ollie_training.ipynb](../../notebooks/hey_ollie_training.ipynb)) | Project's own licence (see the note below) |

The Mel and embedding files were copied from the npm package `openwakeword-wasm-browser@0.1.1`, which
redistributes the openWakeWord release files. Their scores match the official Python
`openwakeword` 0.6.0 package exactly on `test/fixtures/audio/` (checked when they were added).

SHA-256:

```
ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f  melspectrogram.onnx
70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f  embedding_model.onnx
b2abee9d50269284af4278d70cca008451436fa1407524490b76291714bacb47  hey_ollie_v0.1.onnx
```

The "Hey Ollie" model is a single file with all weights inside. The extension loads only this file, so it must not depend on a separate `.data` file.

## Changing the wake phrase

1. Train a model for the new phrase with `notebooks/hey_ollie_training.ipynb`
   (or openWakeWord's own notebooks). It produces a single `<name>.onnx` file.
2. Put the file in this folder.
3. In `src/shared/constants.js`, set `WAKE_MODEL_FILE` to the file name and
   `WAKE_PHRASE` to the phrase (it is shown to users and given to Gemini).
4. Add test clips of the new phrase as `test/fixtures/audio/pos_*.wav`
   (16 kHz, mono, 16-bit), update `test/fixtures/audio/README.md`, and run `npm test`.

## Licence note

The openWakeWord pre-trained "Hey Jarvis" model that this folder used to contain was licensed
CC BY-NC-SA 4.0 (non-commercial), and has been removed. The "Hey Ollie" model was trained by the
project, but its training data is subject to its own terms (openWakeWord, AudioSet, and the
ACAV100M features). Check those terms before a commercial release.
