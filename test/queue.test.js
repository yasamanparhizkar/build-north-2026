import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatestJobQueue } from '../src/background/queue.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('runs a single job', async () => {
  const q = new LatestJobQueue();
  let ran = 0;
  await q.push(async () => { ran++; });
  assert.equal(ran, 1);
});

test('keeps only the newest job while busy', async () => {
  const q = new LatestJobQueue();
  const gate = deferred();
  const order = [];

  const first = q.push(async () => { await gate.promise; order.push('first'); });
  q.push(async () => { order.push('second'); }); // replaced
  q.push(async () => { order.push('third'); });
  gate.resolve();
  await first;

  assert.deepEqual(order, ['first', 'third']);
});

test('a failing job is reported and does not block the queue', async () => {
  const errors = [];
  const q = new LatestJobQueue((e) => errors.push(e.message));
  await q.push(async () => { throw new Error('boom'); });
  let ran = false;
  await q.push(async () => { ran = true; });
  assert.deepEqual(errors, ['boom']);
  assert.ok(ran);
});

