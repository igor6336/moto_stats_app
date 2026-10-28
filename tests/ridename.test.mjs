import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rideName, previousRide } from '../src/ridename.js';

test('auto name by part of day, own name wins', () => {
  assert.equal(rideName({ startedAt: new Date(2026, 9, 1, 8).getTime() }), 'Утренняя поездка');
  assert.equal(rideName({ startedAt: new Date(2026, 9, 1, 14).getTime() }), 'Дневная поездка');
  assert.equal(rideName({ startedAt: new Date(2026, 9, 1, 20).getTime() }), 'Вечерняя поездка');
  assert.equal(rideName({ startedAt: new Date(2026, 9, 1, 2).getTime() }), 'Ночная поездка');
  assert.equal(rideName({ name: ' Трек ', startedAt: 0 }), 'Трек');
});

test('previous ride skips excluded and later rides', () => {
  const s = { distance: 1000 };
  const rides = [
    { id: 'a', startedAt: 1, summary: s },
    { id: 'b', startedAt: 2, summary: s, excluded: true },
    { id: 'c', startedAt: 3, summary: s },
    { id: 'd', startedAt: 4, summary: s },
  ];
  assert.equal(previousRide(rides[2], rides).id, 'a');
  assert.equal(previousRide(rides[0], rides), null);
});
