# Wake-word models

These run on the user's computer, inside the extension's offscreen document
(`src/offscreen/wakeEngine.js`), with ONNX Runtime Web from `vendor/onnxruntime-web/`.
No audio leaves the computer until one of them hears the wake phrase.

| File | What it does | Origin | License |
|---|---|---|---|
| `melspectrogram.onnx` | 16 kHz audio → mel spectrogram | openWakeWord feature model | Apache-2.0 |
| `embedding_model.onnx` | mel frames → 96-dim speech embeddings | openWakeWord, derived from Google's `speech_embedding` | Apache-2.0 |
| `hey_jarvis_v0.1.onnx` | embeddings → "Hey Jarvis" score (0..1) | openWakeWord pre-trained model | **CC BY-NC-SA 4.0 (non-commercial)** |

The files were copied from the npm package `openwakeword-wasm-browser@0.1.1`, which
redistributes the openWakeWord release files. Their scores match the official Python
`openwakeword` 0.6.0 package exactly on `test/fixtures/audio/` (checked when they were added).

SHA-256:

```
ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f  melspectrogram.onnx
70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f  embedding_model.onnx
94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb  hey_jarvis_v0.1.onnx
```

## Changing the wake phrase

1. Train a model for the new phrase with openWakeWord's training notebook
   (`notebooks/automatic_model_training.ipynb` in github.com/dscripka/openWakeWord).
   It produces `<name>.onnx`.
2. Put the file in this folder.
3. In `src/shared/constants.js`, set `WAKE_MODEL_FILE` to the file name and
   `WAKE_PHRASE` to the phrase (it is shown to users and given to Gemini).
4. Add test clips of the new phrase as `test/fixtures/audio/pos_*.wav`
   (16 kHz, mono, 16-bit) and run `npm test`.

A model you train yourself can carry your own license, which removes the
non-commercial restriction of `hey_jarvis_v0.1.onnx`.
