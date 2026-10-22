import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioMessage, buildSetupMessage, liveUrl, parseServerMessage } from '../src/voice/protocol.js';
import { UtteranceDetector } from '../src/voice/utteranceDetector.js';
import { LiveTranscriber } from '../src/voice/liveClient.js';

test('buildSetupMessage prefixes the model and requests input transcription', () => {
  const { setup } = buildSetupMessage('some-live-model');
  assert.equal(setup.model, 'models/some-live-model');
  assert.deepEqual(setup.inputAudioTranscription, {});
  assert.equal(buildSetupMessage('models/x').setup.model, 'models/x');
});

test('buildAudioMessage declares 16 kHz PCM', () => {
  const m = buildAudioMessage('QUJD');
  assert.equal(m.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
  assert.equal(m.realtimeInput.audio.data, 'QUJD');
});

test('liveUrl encodes the key', () => {
  assert.match(liveUrl('a b'), /BidiGenerateContent\?key=a%20b$/);
});

test('parseServerMessage extracts transcript, turn and setup flags', () => {
  assert.equal(parseServerMessage('{"setupComplete":{}}').setupComplete, true);
  const t = parseServerMessage('{"serverContent":{"inputTranscription":{"text":" hello"},"turnComplete":true}}');
  assert.equal(t.inputText, ' hello');
  assert.equal(t.turnComplete, true);
  assert.equal(parseServerMessage('{"goAway":{"timeLeft":"5s"}}').goAway, true);
  assert.equal(parseServerMessage('not json').inputText, '');
});

// --- UtteranceDetector with fake timers ---
function fakeTimers() {
  let pending = null;
  return {
    setTimer: (fn) => { pending = fn; return 1; },
    clearTimer: () => { pending = null; },
    fire: () => { const fn = pending; pending = null; if (fn) fn(); },
    hasPending: () => pending !== null
  };
}

test('UtteranceDetector joins fragments and emits once after silence', () => {
  const timers = fakeTimers();
  const out = [];
  const d = new UtteranceDetector({ onUtterance: (t) => out.push(t), ...timers });
  d.feed('the record');
  d.feed(' button is');
  d.feed(' on the left');
  assert.deepEqual(out, []);
  timers.fire();
  assert.deepEqual(out, ['the record button is on the left']);
});

test('UtteranceDetector flush emits immediately and ignores empty buffers', () => {
  const timers = fakeTimers();
  const out = [];
  const d = new UtteranceDetector({ onUtterance: (t) => out.push(t), ...timers });
  d.flush();
  d.feed('  click   compose ');
  d.flush();
  assert.deepEqual(out, ['click compose']);
  assert.equal(timers.hasPending(), false);
});

test('UtteranceDetector reset drops buffered text', () => {
  const timers = fakeTimers();
  const out = [];
  const d = new UtteranceDetector({ onUtterance: (t) => out.push(t), ...timers });
  d.feed('stale');
  d.reset();
  timers.fire();
  assert.deepEqual(out, []);
});

// --- LiveTranscriber with a fake WebSocket ---
class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 1; FakeWS.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  serverSays(obj) { return this.onmessage({ data: JSON.stringify(obj) }); }
}

function makeClient(extra = {}) {
  FakeWS.instances = [];
  const events = { text: [], status: [], turns: 0 };
  const client = new LiveTranscriber({
    apiKey: 'K',
    model: 'm',
    WebSocketImpl: FakeWS,
    onText: (t) => events.text.push(t),
    onTurnComplete: () => { events.turns++; },
    onStatus: (s, d) => events.status.push(d ? `${s}:${d}` : s),
    ...extra
  });
  return { client, events };
}

test('LiveTranscriber sends setup on open and drops audio until ready', async () => {
  const { client, events } = makeClient();
  client.start();
  const ws = FakeWS.instances[0];
  assert.match(ws.url, /key=K$/);

  ws.onopen();
  assert.ok(ws.sent[0].setup);

  client.sendAudio('early'); // not ready yet -> dropped
  assert.equal(ws.sent.length, 1);

  await ws.serverSays({ setupComplete: {} });
  assert.deepEqual(events.status, ['connecting', 'connected']);

  client.sendAudio('QUJD');
  assert.equal(ws.sent[1].realtimeInput.audio.data, 'QUJD');
});

test('LiveTranscriber forwards transcript fragments and turn completion', async () => {
  const { client, events } = makeClient();
  client.start();
  const ws = FakeWS.instances[0];
  await ws.serverSays({ serverContent: { inputTranscription: { text: 'hi' } } });
  await ws.serverSays({ serverContent: { turnComplete: true } });
  assert.deepEqual(events.text, ['hi']);
  assert.equal(events.turns, 1);
});

test('LiveTranscriber treats policy close codes (bad key) as fatal', () => {
  const { client, events } = makeClient();
  client.start();
  FakeWS.instances[0].onclose({ code: 1008, reason: 'API key not valid' });
  assert.equal(FakeWS.instances.length, 1);
  assert.deepEqual(events.status, ['connecting', 'error:API key not valid']);
});

test('LiveTranscriber reconnects after an unexpected close and stops cleanly', () => {
  const { client, events } = makeClient();
  client.start();
  FakeWS.instances[0].onclose({ code: 1006, reason: '' });
  assert.ok(events.status.includes('reconnecting'));
  client.stop();
  assert.equal(events.status.at(-1), 'stopped');
});
