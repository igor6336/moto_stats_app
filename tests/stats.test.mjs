import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, offset } from '../src/algo/geo.js';
import { computeSummary, smoothByTime, zoneIndex, routeByZone, prepareTrack } from '../src/algo/stats.js';
import { computeCalibration, angleBetween } from '../src/algo/calibration.js';
import { rateFromTimes } from '../src/algo/quality.js';

const LAT0 = 55.75, LON0 = 37.61;

// Straight eastward track from a speed profile (m/s per second).
function track(speeds, { dt = 1, acc = 5, reportSpeed = true } = {}) {
  const rows = [];
  let east = 0;
  speeds.forEach((v, i) => {
    if (i > 0) east += ((speeds[i - 1] + v) / 2) * dt;
    const [lat, lon] = offset(LAT0, LON0, 0, east);
    const t = i * dt * 1000;
    rows.push([t, t, lat, lon, acc, 150, 3, reportSpeed ? v : null, 90]);
  });
  return rows;
}

test('haversine: 1 degree of latitude is ~111.2 km', () => {
  assert.ok(Math.abs(haversine(0, 0, 1, 0) - 111195) < 10);
});

test('offset and haversine agree', () => {
  const [lat, lon] = offset(LAT0, LON0, 300, 400);
  assert.ok(Math.abs(haversine(LAT0, LON0, lat, lon) - 500) < 0.5);
});

test('constant speed: distance, time, avg and max', () => {
  const rows = track(new Array(101).fill(20)); // 20 m/s for 100 s
  const s = computeSummary(rows, { zones: [30, 60, 90] });
  assert.ok(Math.abs(s.distance - 2000) < 1, `distance ${s.distance}`);
  assert.equal(s.movingTime, 100);
  assert.ok(Math.abs(s.avgMovingSpeed - 20) < 0.01);
  assert.ok(Math.abs(s.maxSpeed - 20) < 1e-9);
  // 72 km/h -> zone [60, 90)
  assert.equal(s.zones[2].time, 100);
  assert.ok(Math.abs(s.zones[2].distance - 2000) < 1);
});

test('stops are excluded from moving time and zones', () => {
  const rows = track([...new Array(31).fill(10), ...new Array(30).fill(0)]);
  const s = computeSummary(rows, { zones: [50] });
  assert.equal(s.movingTime, 31); // 30 s at 10 m/s + the 10->0 braking second
  assert.ok(s.stoppedTime >= 29);
  const zoneTime = s.zones.reduce((a, z) => a + z.time, 0);
  assert.equal(zoneTime, s.movingTime);
});

test('stationary GPS jitter does not add distance', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const [lat, lon] = offset(LAT0, LON0, Math.sin(i) * 4, Math.cos(i * 1.7) * 4);
    rows.push([i * 1000, i * 1000, lat, lon, 6, 0, 0, 0.2, null]);
  }
  assert.equal(computeSummary(rows).distance, 0);
});

test('inaccurate fixes are dropped', () => {
  const rows = track(new Array(11).fill(15));
  rows[5][4] = 80;
  rows[5][2] += 0.01; // ~1 km off
  const s = computeSummary(rows);
  assert.equal(s.points, 10);
  assert.ok(Math.abs(s.distance - 150) < 1);
});

test('gaps are excluded from time stats but distance is kept', () => {
  const rows = track(new Array(21).fill(20));
  // shift second half 60 s later, as if signal was lost
  for (let i = 11; i < rows.length; i++) { rows[i][0] += 60000; rows[i][1] += 60000; }
  const s = computeSummary(rows, { maxGap: 30 });
  assert.equal(s.gaps, 1);
  assert.equal(s.movingTime, 19);
  assert.ok(Math.abs(s.distance - 400) < 1);
});

test('max speed is smoothed: a single-sample spike is damped', () => {
  const speeds = new Array(21).fill(20);
  speeds[10] = 50;
  const s = computeSummary(track(speeds), { smoothWindow: 3 });
  assert.equal(s.maxSpeedRaw, 50);
  assert.ok(s.maxSpeed < 31 && s.maxSpeed > 20, `${s.maxSpeed}`);
});

test('speed is derived from positions when not reported', () => {
  const tr = prepareTrack(track(new Array(11).fill(12), { reportSpeed: false }));
  for (const v of tr.speed) assert.ok(Math.abs(v - 12) < 0.05, `${v}`);
});

test('duplicate and out-of-order fixes are skipped', () => {
  const rows = track(new Array(5).fill(10));
  rows.splice(2, 0, [...rows[1]]);
  assert.equal(prepareTrack(rows).n, 5);
});

test('smoothByTime: window by time, not by samples', () => {
  assert.deepEqual(smoothByTime([0, 1, 2, 10], [1, 2, 3, 100], 2), [1.5, 2, 2.5, 100]);
});

test('zoneIndex boundaries are inclusive at the lower edge', () => {
  assert.equal(zoneIndex(29.9, [30, 60]), 0);
  assert.equal(zoneIndex(30, [30, 60]), 1);
  assert.equal(zoneIndex(200, [30, 60]), 2);
});

test('routeByZone splits runs on zone change', () => {
  const runs = routeByZone(track([...new Array(10).fill(5), ...new Array(10).fill(30)]), [50]);
  assert.deepEqual(runs.map((r) => r.zone), [0, 1]);
  // runs share the boundary point so the line is continuous
  assert.deepEqual(runs[0].coords.at(-1), runs[1].coords[0]);
  assert.equal(runs[0].coords.length + runs[1].coords.length, 21);
});

test('empty input gives an empty summary', () => {
  const s = computeSummary([], { zones: [30] });
  assert.equal(s.points, 0);
  assert.equal(s.distance, 0);
  assert.equal(s.zones.length, 2);
});

test('calibration: still phone gives ok and the gravity vector', () => {
  const rows = [];
  for (let i = 0; i < 240; i++) rows.push([i * 16.7, 0, 0, 0, 0.01 * Math.sin(i), -9.8, 0.3, 0, 0, 0, 16.7]);
  const c = computeCalibration(rows);
  assert.ok(c.ok);
  assert.ok(Math.abs(c.gravity[1] + 9.8) < 0.01);
});

test('calibration: shaking is rejected', () => {
  const rows = [];
  for (let i = 0; i < 240; i++) rows.push([i * 16.7, 0, 0, 0, 2 * Math.sin(i), -9.8, 0, 0, 0, 0, 16.7]);
  assert.equal(computeCalibration(rows).ok, false);
});

test('angleBetween', () => {
  assert.ok(Math.abs(angleBetween([0, -1, 0], [1, 0, 0]) - 90) < 1e-9);
  assert.ok(Math.abs(angleBetween([0, -9.8, 0], [0, -9.8 * Math.cos(0.1), 9.8 * Math.sin(0.1)]) - 5.7296) < 1e-3);
});

test('rate tracker counts gaps', () => {
  const q = rateFromTimes([0, 16, 33, 50, 300, 316], 100);
  assert.equal(q.gaps, 1);
  assert.equal(q.maxDtMs, 250);
  assert.ok(Math.abs(q.hz - (5 * 1000) / 316) < 1e-9);
});
