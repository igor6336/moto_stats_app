import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecords, rideRecords } from '../src/records.js';

const ride = (id, maxSpeed, a0_100, extra = {}) => ({
  id, status: 'done', startedAt: 0,
  summary: { maxSpeed, distance: 1000, accel: { '0-100': a0_100, '100-200': null, '0-200': null } }, ...extra,
});

test('records pick the best ride per metric, lower is better for times', () => {
  const rides = [ride('a', 50, 5), ride('b', 60, 7), ride('car', 70, 4, { excluded: true })];
  const r = computeRecords(rides);
  assert.equal(r.maxSpeed.ride.id, 'b');
  assert.equal(r.a0_100.ride.id, 'a');
  assert.equal(r.a0_100.value, 5);
  assert.equal(r.a100_200, undefined);
});

test('a ride holds a record only against other rides', () => {
  const a = ride('a', 50, 5), b = ride('b', 60, 7);
  assert.deepEqual(rideRecords(a, [a]), []);
  assert.deepEqual(rideRecords(b, [a, b]).map((x) => x.metric.id), ['maxSpeed']);
  assert.deepEqual(rideRecords(a, [a, b]).map((x) => x.metric.id), ['a0_100']);
  assert.deepEqual(rideRecords({ ...b, excluded: true }, [a, b]), []);
});
