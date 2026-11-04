import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImport } from '../src/algo/import.js';
import { loadModule } from './helpers/modules.mjs';

const file = () => ({ format: 'moto-raw', version: 1,
  ride: { id: 'ride-123', schema: 1, startedAt: 1000, endedAt: 2000, status: 'done',
    settings: { zones: [30, 60] }, counts: { gps: 999 }, synced: 'other-account',
    summary: { distance: 999999, maxSpeed: 90 } },
  gps: [[0, 0, 55, 37, 5, null, null, 0, null]], motion: [], orient: [], events: [] });

test('valid export keeps telemetry and drops untrusted summary and sync ownership', () => {
  const data = file(), [entry] = validateImport(data);
  assert.deepEqual(entry.gps, data.gps);
  assert.equal(entry.ride.summary, undefined);
  assert.equal(entry.ride.synced, undefined);
  assert.equal(entry.ride.counts.gps, 1);
});

test('HTML identifiers, unexpected versions, malformed rows and metadata are rejected', () => {
  const changes = [
    (d) => { d.ride.id = '\"><img src=x onerror=alert(1)>'; },
    (d) => { d.version = 99; },
    (d) => { d.gps[0][2] = 100; },
    (d) => { d.motion = [[0, 'invalid']]; },
    (d) => { d.ride.quality = { gps: { hz: 1, gaps: '<img>' } }; },
    (d) => { d.ride.lean = { v: 4, right: '<img>' }; },
    (d) => { d.ride.endedAt = 0; },
  ];
  for (const change of changes) { const data = file(); change(data); assert.throws(() => validateImport(data)); }
});

test('backup keeps computed lean series after deleting raw sensors', () => {
  const item = file();
  item.ride.sensorsDeleted = 3000;
  item.ride.lean = { v: 4, left: 25, right: null, reference: 'auto', series: { t0: 0, dt: 0.5, v: [null, -25, 0] } };
  const [entry] = validateImport({ format: 'moto-backup', version: 1, rides: [item] });
  assert.deepEqual(entry.ride.lean, item.ride.lean);
  assert.equal(entry.ride.sensorsDeleted, 3000);
});

test('a malicious later backup entry is rejected before any storage access', async () => {
  const item = file(), bad = file(); bad.ride.id = '<img>';
  const api = await loadModule('src/export.js', { 'src/storage.js': {
    getRide() { assert.fail('validation must precede all storage access'); },
    kvGet() {}, kvSet() {}, listRides() {}, putRide() {}, getGpsChunks() {}, getGpsData() {}, forEachSensorChunk() {}, writeChunk() {},
  } });
  const backup = { format: 'moto-backup', version: 1, rides: [item, bad] };
  await assert.rejects(api.importFile({ text: async () => JSON.stringify(backup) }), /Некорректный/);
});
