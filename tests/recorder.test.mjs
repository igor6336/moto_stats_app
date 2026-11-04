import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/modules.mjs';

async function setup() {
  const stored = new Map(), chunks = [];
  let failChunk = false, failFinal = false;
  const storage = {
    kvGet: async () => null, kvSet: async () => {}, listRides: async () => [], getGpsData: async () => ({ gps: [] }),
    putRide: async (ride) => {
      if (failFinal && ride.status === 'done') { failFinal = false; throw new Error('metadata failed'); }
      stored.set(ride.id, structuredClone(ride));
    },
    writeChunk: async (ride, seq, data) => {
      if (failChunk) { failChunk = false; throw new Error('quota'); }
      chunks.push(structuredClone({ seq, data }));
      stored.set(ride.id, structuredClone(ride));
    },
  };
  const { recorder } = await loadModule('src/recorder.js', {
    'src/storage.js': storage, 'src/settings.js': { getSettings: () => ({ zones: [30, 60] }) },
    'src/wakelock.js': { enableWakeLock() {} },
  });
  recorder.state = 'ready';
  await recorder.start();
  return { recorder, stored, chunks, failChunk: () => { failChunk = true; }, failFinal: () => { failFinal = true; } };
}

test('failed final chunk preserves data and checkpoint; retry saves exactly once', async () => {
  const f = await setup(), r = f.recorder;
  const before = structuredClone(r.ride);
  r.buf.motion.push([1, 0, 0, 0, 0, -9.81, 0, 0, 0, 0, 0.016]);
  f.failChunk();
  await assert.rejects(r.stop(), /quota/);
  assert.equal(r.state, 'save-error');
  assert.equal(r.buf.motion.length, 1);
  assert.equal(r.ride.chunks, before.chunks);
  assert.equal(r.ride.lastFlushAt, before.lastFlushAt);
  assert.deepEqual(JSON.parse(JSON.stringify(r.ride.counts)), before.counts);
  assert.equal(f.stored.get(r.ride.id).status, 'recording');
  await assert.rejects(r.start(), /not ready/);
  const stopAt = r.stopAt;
  const id = await r.stop();
  assert.equal(f.stored.get(id).status, 'done');
  assert.equal(f.stored.get(id).endedAt, stopAt);
  assert.equal(f.chunks.length, 1);
  assert.equal(f.chunks[0].data.motion.length, 1);
  assert.equal(f.chunks[0].data.events.filter((e) => e[1] === 'stop').length, 1);
  assert.equal(r.ride, null);
  assert.equal(r.state, 'ready');
});

test('metadata failure retains recording and retries without duplicating chunks', async () => {
  const f = await setup(), r = f.recorder;
  f.failFinal();
  await assert.rejects(r.stop(), /metadata failed/);
  assert.equal(r.state, 'save-error');
  assert.equal(r.ride.status, 'recording');
  assert.equal(f.chunks.length, 1);
  const id = await r.stop();
  assert.equal(f.chunks.length, 1);
  assert.equal(f.stored.get(id).status, 'done');
});

test('a failed background write does not prevent the next flush', async () => {
  const f = await setup(), r = f.recorder;
  f.failChunk();
  await assert.rejects(r.flush(), /quota/);
  r.buf.events.push([5, 'after-failure', null]);
  await r.flush();
  assert.deepEqual(f.chunks[0].data.events.map((e) => e[1]), ['start', 'after-failure']);
  assert.equal(r.status.storageError, null);
});
