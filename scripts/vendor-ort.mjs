// Copies the ONNX Runtime Web files the extension loads at run time from
// node_modules into vendor/ (extensions may not load code from the network).
// Run after changing the onnxruntime-web version: npm install && npm run vendor:ort
import fs from 'node:fs';
import path from 'node:path';

const from = path.join('node_modules', 'onnxruntime-web', 'dist');
const to = path.join('vendor', 'onnxruntime-web');
// The bundle still imports the .mjs loader from wasmPaths, so ship it too.
const files = ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

fs.mkdirSync(to, { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(from, f), path.join(to, f));
  console.log(`copied ${f}`);
}
