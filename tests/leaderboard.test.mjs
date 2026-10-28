import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeaderboard, periodStart } from '../src/algo/leaderboard.js';

const NOW = new Date(2026, 9, 28, 15, 0); // Wed 28 Oct 2026, local time
const at = (y, m, d) => new Date(y, m, d, 12).toISOString();
const ride = (user, started_at, distance_m, max_speed_ms, moving_s = 600, avg_moving_ms = 15) =>
  ({ user_id: user, started_at, distance_m, max_speed_ms, moving_s, avg_moving_ms });

const rides = [
  ride('a', at(2026, 9, 27), 20000, 50),   // this week
  ride('a', at(2026, 9, 20), 30000, 60),   // last week, this month
  ride('b', at(2026, 9, 26), 15000, 55),   // Monday this week
  ride('b', at(2026, 8, 30), 90000, 70),   // last month
  ride('c', at(2026, 9, 27), 5000, 40, 600, 25),
];

test('periodStart: day starts at midnight, week on Monday, month on the 1st', () => {
  const day = new Date(periodStart('day', NOW));
  assert.deepEqual([day.getDate(), day.getHours(), day.getMinutes()], [28, 0, 0]);
  assert.equal(new Date(periodStart('week', NOW)).getDate(), 26);
  assert.equal(new Date(periodStart('week', NOW)).getDay(), 1);
  assert.equal(new Date(periodStart('month', NOW)).getDate(), 1);
  assert.equal(periodStart('all', NOW), -Infinity);
});

test('max speed is the best single ride within the period', () => {
  const week = computeLeaderboard(rides, 'maxSpeed', 'week', NOW);
  assert.deepEqual(week.map((r) => [r.userId, r.value]), [['b', 55], ['a', 50], ['c', 40]]);
  const all = computeLeaderboard(rides, 'maxSpeed', 'all', NOW);
  assert.equal(all[0].userId, 'b');
  assert.equal(all[0].best.distance_m, 90000);
});

test('day period keeps only today', () => {
  const today = [ride('a', at(2026, 9, 28), 20000, 40), ride('b', at(2026, 9, 27), 20000, 90)];
  assert.deepEqual(computeLeaderboard(today, 'maxSpeed', 'day', NOW).map((r) => r.userId), ['a']);
});

test('equal values share a rank', () => {
  const same = [ride('a', at(2026, 9, 27), 20000, 50), ride('b', at(2026, 9, 27), 20000, 50), ride('c', at(2026, 9, 27), 20000, 40)];
  assert.deepEqual(computeLeaderboard(same, 'maxSpeed', 'all', NOW).map((x) => x.rank), [1, 1, 3]);
});

test('lean and wheelie categories exist and are empty until computed', () => {
  for (const id of ['leanRight', 'leanLeft', 'wheelie']) assert.deepEqual(computeLeaderboard(rides, id, 'all', NOW), []);
  const withLean = [{ ...ride('a', at(2026, 9, 27), 20000, 50), lean_right_deg: 41 }];
  assert.equal(computeLeaderboard(withLean, 'leanRight', 'all', NOW)[0].value, 41);
});

test('average speed ignores rides shorter than 10 km', () => {
  const r = computeLeaderboard(rides, 'avgSpeed', 'all', NOW);
  assert.ok(!r.find((x) => x.userId === 'c'));
});

test('acceleration: lowest time wins, rides without a run are skipped', () => {
  const rs = [
    { ...ride('a', at(2026, 9, 27), 20000, 50), accel_0_100_s: 3.9 },
    { ...ride('a', at(2026, 9, 27), 20000, 50), accel_0_100_s: 3.4 },
    { ...ride('b', at(2026, 9, 27), 20000, 50), accel_0_100_s: 3.1 },
    { ...ride('c', at(2026, 9, 27), 20000, 50), accel_0_100_s: null },
  ];
  const r = computeLeaderboard(rs, 'a0_100', 'all', NOW);
  assert.deepEqual(r.map((x) => [x.userId, x.value]), [['b', 3.1], ['a', 3.4]]);
  assert.equal(r[1].best.accel_0_100_s, 3.4);
});

test('empty input gives an empty board', () => {
  assert.deepEqual(computeLeaderboard([], 'maxSpeed', 'all', NOW), []);
  assert.throws(() => computeLeaderboard([], 'distance', 'all', NOW));
});

test('riderStats: totals, bests and period filter', async () => {
  const { riderStats } = await import('../src/algo/leaderboard.js');
  const rs = [
    { ...ride('a', at(2026, 9, 27), 20000, 50, 1000, 18), accel_0_100_s: 3.9 },
    { ...ride('a', at(2026, 9, 2), 8000, 60, 500, 25), accel_0_100_s: 3.4, accel_0_200_s: 9.1 },
    { ...ride('a', at(2026, 7, 1), 100000, 70, 7000, 16), accel_0_100_s: null },
  ];
  const all = riderStats(rs, 'all', NOW);
  assert.equal(all.rides, 3);
  assert.equal(all.distance, 128000);
  assert.equal(all.maxSpeed, 70);
  assert.equal(all.longest, 100000);
  assert.equal(all.bestAvg, 18); // the 8 km ride is too short to count
  assert.equal(all.a0_100, 3.4);
  assert.equal(all.a0_200, 9.1);
  assert.equal(all.a100_200, null);
  assert.equal(riderStats(rs, 'month', NOW).rides, 2);
  assert.equal(riderStats(rs, 'day', NOW).rides, 0);
  assert.equal(all.leanRight, 0);
  assert.equal(riderStats([{ ...rs[0], lean_left_deg: 38, wheelie_deg: 52 }]).leanLeft, 38);
});

test('my position: gap to the next place, lead when first', async () => {
  const { myPosition } = await import('../src/algo/leaderboard.js');
  const rows = [
    { userId: 'a', value: 50, rank: 1 },
    { userId: 'b', value: 40, rank: 2 },
    { userId: 'c', value: 40, rank: 2 },
    { userId: 'd', value: 30, rank: 4 },
  ];
  assert.deepEqual(myPosition(rows, 'd'), { rank: 4, total: 4, gap: 10, nextRank: 2 });
  assert.deepEqual(myPosition(rows, 'c'), { rank: 2, total: 4, gap: 10, nextRank: 1 });
  assert.deepEqual(myPosition(rows, 'a'), { rank: 1, total: 4, lead: 10 });
  assert.deepEqual(myPosition([rows[0]], 'a'), { rank: 1, total: 1, lead: null });
  assert.equal(myPosition(rows, 'x'), null);
});
