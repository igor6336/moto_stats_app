import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offset } from '../src/algo/geo.js';
import { computeSummary } from '../src/algo/stats.js';

const LAT0 = 55.75, LON0 = 37.61;

// Track from a speed function v(t) in m/s, sampled every dt seconds.
function track(vAt, seconds, dt = 1) {
  const rows = [];
  let east = 0, prev = vAt(0);
  for (let i = 0; i * dt <= seconds; i++) {
    const tt = i * dt, v = vAt(tt);
    if (i > 0) east += ((prev + v) / 2) * dt;
    prev = v;
    const [lat, lon] = offset(LAT0, LON0, 0, east);
    rows.push([tt * 1000, tt * 1000, lat, lon, 4, 150, 3, v, 90]);
  }
  return rows;
}

const kmh = (x) => x / 3.6;

test('constant acceleration: 0-100 and 0-200 match physics within GPS resolution', () => {
  const a = 8; // m/s2
  const launch = 5; // standing still for 5 s first
  const rows = track((t) => (t < launch ? 0 : Math.min(kmh(220), a * (t - launch))), 40);
  const { accel } = computeSummary(rows);
  const exact100 = kmh(100) / a; // 3.47 s
  const exact200 = kmh(200) / a; // 6.94 s
  // the launch is detected at 2 km/h, i.e. 0.07 s late
  assert.ok(Math.abs(accel['0-100'] - exact100) < 0.15, `0-100 ${accel['0-100']}`);
  assert.ok(Math.abs(accel['0-200'] - exact200) < 0.15, `0-200 ${accel['0-200']}`);
  assert.ok(Math.abs(accel['100-200'] - (exact200 - exact100)) < 0.1, `100-200 ${accel['100-200']}`);
});

test('best of several runs is kept', () => {
  // two launches: slow (4 m/s2) then fast (7 m/s2)
  const v = (t) => {
    if (t < 3) return 0;
    if (t < 13) return Math.min(kmh(110), 4 * (t - 3));
    if (t < 20) return Math.max(0, kmh(110) - 8 * (t - 13));
    if (t < 25) return 0;
    return Math.min(kmh(110), 7 * (t - 25));
  };
  const { accel } = computeSummary(track(v, 40));
  assert.ok(Math.abs(accel['0-100'] - kmh(100) / 7) < 0.15, `${accel['0-100']}`);
});

test('a run that never reaches the target gives null', () => {
  const { accel } = computeSummary(track((t) => Math.min(kmh(90), 5 * t), 30));
  assert.equal(accel['0-100'], null);
  assert.equal(accel['100-200'], null);
});

test('slowing down on the way counts, the time just gets worse', () => {
  // 0 -> 65 km/h, brake to 22, then on to 100+: timed from the standing start
  const v = (t) => (t < 3 ? 6 * t : t < 6 ? 18 - 4 * (t - 3) : 6 + 6 * (t - 6));
  const a = computeSummary(track(v, 20)).accel['0-100'];
  const exact = 6 + (kmh(100) - 6) / 6; // reaches 100 km/h at ~9.6 s
  assert.ok(Math.abs(a - exact) < 0.15, `${a}`);
});

test('stopping completely starts a new attempt', () => {
  // first attempt stops at 50 km/h -> 0, second goes 0 -> 100 at 5 m/s2
  const v = (t) => (t < 4 ? 3.5 * t : t < 8 ? Math.max(0, 14 - 4 * (t - 4)) : t < 10 ? 0 : 5 * (t - 10));
  const a = computeSummary(track(v, 30)).accel['0-100'];
  assert.ok(Math.abs(a - kmh(100) / 5) < 0.15, `${a}`);
});

test('a signal gap breaks the run', () => {
  const rows = track((t) => Math.min(kmh(120), 6 * t), 15);
  rows.splice(2, 3); // drop 3 fixes during the launch
  assert.equal(computeSummary(rows).accel['0-100'], null);
});

test('implausibly fast run is rejected', () => {
  // 0-100 in ~1.4 s: 20 m/s2, not a motorcycle
  assert.equal(computeSummary(track((t) => Math.min(kmh(120), 20 * t), 10)).accel['0-100'], null);
});

test('GPS catching up after a dropout does not count as acceleration', () => {
  // 0 -> 56 km/h in 8 s, signal degrades, then speed snaps to 148 km/h in 1 s
  const rows = track((t) => (t < 2 ? 0 : t < 10 ? kmh(7 * (t - 2)) : kmh(Math.min(160, 148 + (t - 11) * 3))), 25);
  rows.find((r) => r[0] === 11000)[2] += 0.0002;
  assert.equal(computeSummary(rows).accel['0-100'], null);
});

test('a degraded fix inside the run breaks it', () => {
  const rows = track((t) => (t < 2 ? 0 : Math.min(kmh(120), kmh(15 * (t - 2)))), 20);
  rows[5][4] = 20; // kept by the track filter (<= 25 m), too poor for timing
  assert.equal(computeSummary(rows).accel['0-100'], null);
});
