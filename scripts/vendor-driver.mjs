// Copies the Driver.js browser build into the extension (MV3 forbids remote code,
// and the extension has no bundler). Run after installing/updating: npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'driver.js');
const dest = path.join(root, 'src', 'vendor', 'driver.js');
const files = [
  ['dist/driver.js.mjs', 'driver.js.mjs'],
  ['dist/driver.css', 'driver.css'],
  ['license', 'LICENSE']
];

if (!fs.existsSync(src)) {
  console.error('driver.js is not installed. Run: npm install');
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });
for (const [from, to] of files) fs.copyFileSync(path.join(src, from), path.join(dest, to));
const { version } = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(dest, 'VERSION'), `${version}\n`);
console.log(`Vendored driver.js ${version} -> src/vendor/driver.js/`);

