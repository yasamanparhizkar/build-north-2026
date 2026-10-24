# ONNX Runtime Web 1.30.0 (wasm build)

Runs the wake-word models in the offscreen document. Vendored because Chrome
extensions may not load code from the network.

Files come from `node_modules/onnxruntime-web/dist/`. To update: change the
`onnxruntime-web` version in package.json, then run `npm install && npm run vendor:ort`.
`npm test` checks the vendored copy matches package.json.

ONNX Runtime is © Microsoft Corporation, MIT License (https://github.com/microsoft/onnxruntime/blob/main/LICENSE).
