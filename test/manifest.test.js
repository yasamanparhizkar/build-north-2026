import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Catches broken manifests early (an invalid manifest makes Chrome silently
// refuse to load the extension, which shows up as integration-test timeouts).
const manifest = () => JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

test('manifest.json is valid JSON with MV3 basics', () => {
  const m = manifest();
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.type, 'module');
  for (const p of ['tabCapture', 'offscreen', 'storage', 'scripting']) assert.ok(m.permissions.includes(p), p);
});

test('every file referenced by the manifest exists', () => {
  const m = manifest();
  const files = [
    m.background.service_worker,
    m.action.default_popup,
    ...m.content_scripts.flatMap((c) => c.js),
    'src/offscreen/offscreen.html'
  ];
  for (const f of files) assert.ok(fs.existsSync(f), `missing ${f}`);
});
