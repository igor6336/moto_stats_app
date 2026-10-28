import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, seasonByMonth, totalsStart } from '../src/totals.js';

const NOW = new Date(2026, 9, 28, 12); // 28 Oct 2026
const ride = (y, m, d, km, min, extra = {}) => ({
  status: 'done', startedAt: new Date(y, m, d, 10).getTime(),
  summary: { distance: km * 1000, movingTime: min * 60 }, ...extra,
});

test('totals per period skip car rides and other years', () => {
  const rides = [
    ride(2026, 9, 26, 15, 16), ride(2026, 9, 27, 20, 20),
    ride(2026, 5, 1, 100, 90), ride(2025, 7, 1, 50, 40),
    ride(2026, 9, 26, 21, 20, { excluded: true }),
  ];
  const m = computeTotals(rides, 'month', NOW);
  assert.equal(m.rides, 2);
  assert.equal(m.distance, 35000);
  assert.equal(m.movingTime, 36 * 60);
  assert.ok(Math.abs(m.avgSpeed - 35000 / 2160) < 1e-9);
  assert.equal(computeTotals(rides, 'season', NOW).rides, 3);
  assert.equal(computeTotals(rides, 'all', NOW).rides, 4);
});

test('season by month runs from January to the current month', () => {
  const months = seasonByMonth([ride(2026, 5, 1, 100, 90), ride(2026, 9, 2, 10, 9)], NOW);
  assert.equal(months.length, 10);
  assert.equal(months[5], 100000);
  assert.equal(months[9], 10000);
  assert.equal(totalsStart('season', NOW), new Date(2026, 0, 1).getTime());
});
