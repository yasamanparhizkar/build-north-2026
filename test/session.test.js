import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_SESSION, STATUS, canTransition, commandKey, isDuplicateCommand, rememberCommand, resultStaleReason, staleReason
} from '../src/background/sessionState.js';
import { decideFromModel, decideFromText } from '../src/background/decision.js';
import { EMPTY_METRICS, bump, recordSample, summarize } from '../src/background/metrics.js';
import { isMeetUrl, isScriptableUrl } from '../src/shared/urls.js';

test('status transitions follow the state machine', () => {
  assert.ok(canTransition('idle', 'starting'));
  assert.ok(canTransition('starting', 'listening'));
  assert.ok(canTransition('listening', 'processing'));
  assert.ok(canTransition('processing', 'listening'));
  assert.ok(canTransition('listening', 'interrupted'));
  assert.ok(!canTransition('idle', 'listening'));
  assert.ok(!canTransition('idle', 'processing'));
  assert.ok(!canTransition('interrupted', 'listening'));
});

const listening = { ...INITIAL_SESSION, status: STATUS.LISTENING, generation: 3, lastSeqHandled: 4 };

test('staleReason rejects work from old sessions, after stop, duplicates, old clips, rate limit', () => {
  const now = 100000;
  assert.equal(staleReason({ generation: 3, seq: 5, capturedAt: now }, listening, now), null);
  assert.equal(staleReason({ generation: 2, seq: 5 }, listening, now), 'old-session');
  assert.equal(staleReason({ generation: 3, seq: 5 }, { ...listening, status: STATUS.IDLE }, now), 'not-listening');
  assert.equal(staleReason({ generation: 3, seq: 4 }, listening, now), 'already-handled');
  assert.equal(staleReason({ generation: 3, seq: 5, capturedAt: now - 20000 }, listening, now), 'too-old');
  assert.equal(staleReason({ generation: 3, seq: 5 }, { ...listening, rateLimitedUntil: now + 1 }, now), 'rate-limited');
});

test('resultStaleReason drops results that arrive after Stop or after a newer highlight', () => {
  assert.equal(resultStaleReason({ generation: 3, seq: 7 }, { ...listening, lastHighlightSeq: 6 }), null);
  assert.equal(resultStaleReason({ generation: 3, seq: 5 }, { ...listening, lastHighlightSeq: 6 }), 'newer-highlight-shown');
  assert.equal(resultStaleReason({ generation: 3, seq: 7 }, { ...listening, generation: 4 }), 'old-session');
  assert.equal(resultStaleReason({ generation: 3, seq: 7 }, { ...listening, status: STATUS.IDLE }), 'not-listening');
});

test('dedupe: the same command from overlapping clips is ignored within the window', () => {
  const key = commandKey('the Compose button', 'Compose');
  assert.equal(key, commandKey('the compose button', 'compose'));
  let recent = rememberCommand([], key, 1000);
  assert.ok(isDuplicateCommand(recent, key, 5000));
  assert.ok(!isDuplicateCommand(recent, key, 20000));
  assert.ok(!isDuplicateCommand(recent, commandKey('send', 'Send'), 5000));
  recent = rememberCommand(recent, 'x', 30000);
  assert.equal(recent.length, 1, 'expired entries are pruned');
});

const elements = [
  { id: 'el-1', role: 'button', name: 'Compose', region: 'top-left' },
  { id: 'el-4', role: 'button', name: 'Record', region: 'bottom-left' },
  { id: 'el-5', role: 'button', name: 'Record', region: 'bottom-right' }
];
const model = (over) => ({ transcript: 't', isCommand: true, target: '', region: 'none', matchedElementId: null, confidence: 0.9, label: 'Click', ...over });

test('decideFromModel: confident validated pick points directly (no second call)', () => {
  assert.deepEqual(decideFromModel(model({ matchedElementId: 'el-1' }), elements).ids, ['el-1']);
});

test('decideFromModel: conversation is ignored', () => {
  assert.equal(decideFromModel(model({ isCommand: false }), elements).kind, 'ignore');
});

test('decideFromModel: null id but clear target -> local matcher', () => {
  const d = decideFromModel(model({ target: 'Compose' }), elements);
  assert.equal(d.kind, 'point');
  assert.deepEqual(d.ids, ['el-1']);
});

test('decideFromModel: ambiguous target -> short candidate list, not an arbitrary pick', () => {
  const d = decideFromModel(model({ target: 'record' }), elements);
  assert.equal(d.kind, 'candidates');
  assert.deepEqual(d.ids.sort(), ['el-4', 'el-5']);
});

test('decideFromModel: spatial hint from the model resolves ambiguity', () => {
  const d = decideFromModel(model({ target: 'record', region: 'right' }), elements);
  assert.deepEqual(d.ids, ['el-5']);
});

test('decideFromModel: missing target -> no-match', () => {
  assert.equal(decideFromModel(model({ target: 'Print', transcript: 'print it' }), elements).kind, 'no-match');
});

test('decideFromText returns null when Gemini should be asked, or a best effort', () => {
  assert.equal(decideFromText('compose', elements).kind, 'point');
  assert.equal(decideFromText('click record', elements), null);
  assert.equal(decideFromText('click record', elements, { allowAmbiguous: true }).kind, 'candidates');
});

test('metrics summary computes medians and rates', () => {
  let m = { ...EMPTY_METRICS, startedAt: 1 };
  m = bump(bump(m, 'apiCalls'), 'apiCalls');
  m = bump(m, 'apiErrors');
  m = recordSample(m, { gemini: 1000, match: 20, total: 1800 });
  m = recordSample(m, { gemini: 1400, match: 30, total: 2200 });
  m = recordSample(m, { gemini: 1200, match: 25, total: null });
  const s = summarize(m, 60001);
  assert.equal(s.medianGeminiMs, 1200);
  assert.equal(s.medianTotalMs, 2000);
  assert.equal(s.apiCallsPerMinute, 2);
  assert.equal(s.apiErrorRate, 0.5);
});

test('isScriptableUrl allows ordinary pages only', () => {
  assert.ok(isScriptableUrl('https://mail.google.com/mail/u/0/#inbox'));
  assert.ok(isScriptableUrl('http://example.com'));
  assert.ok(!isScriptableUrl('chrome://extensions'));
  assert.ok(!isScriptableUrl('https://chromewebstore.google.com/detail/x'));
  assert.ok(!isScriptableUrl('https://chrome.google.com/webstore/detail/x'));
  assert.ok(!isScriptableUrl('file:///C:/x.html'));
  assert.ok(!isScriptableUrl('not a url'));
  assert.ok(isMeetUrl('https://meet.google.com/abc-defg-hij'));
  assert.ok(!isMeetUrl('https://mail.google.com'));
});
