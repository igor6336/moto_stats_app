import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeanAccumulator, bikeAxes } from '../src/algo/lean.js';

const D2R = Math.PI / 180;
// Portrait phone on the handlebar, screen to the rider: iOS gravity is -y.
const CAL = { ok: true, gravity: [0, -9.81, 0] };

// leanAt(t) for the phone, gpsLeanAt(t) for the course the GPS sees.
function ride(seconds, leanAt, gpsLeanAt = leanAt, v = 20) {
  const motion = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const l = leanAt(t) * D2R;
    motion.push([t * 1000, 0, 0, 0, 9.81 * Math.sin(l), -9.81 * Math.cos(l), 0, 0, 0, 0, 1 / 60]);
  }
  const gps = [];
  let heading = 0;
  for (let t = 0; t <= seconds; t++) {
    gps.push([t * 1000, t * 1000, 55.75, 37.61, 5, 150, 3, v, (heading + 360) % 360]);
    heading += (9.81 * Math.tan(gpsLeanAt(t + 0.5) * D2R) / v) / D2R;
  }
  return { motion, gps };
}

function lean(r, cal = CAL) {
  const acc = new LeanAccumulator(cal);
  for (let i = 0; i < r.motion.length; i += 1000) acc.add(r.motion.slice(i, i + 1000));
  return acc.result(r.gps);
}

test('a held corner confirmed by GPS is the record', () => {
  const at = (t) => (t >= 20 && t < 26 ? 30 : 0);
  const res = lean(ride(60, at));
  assert.ok(Math.abs(res.right - 30) < 1, `right ${res.right}`);
  assert.equal(res.left, null);
});

test('a lean the GPS track does not confirm is ignored', () => {
  const phone = (t) => (t >= 40 && t < 42.5 ? -35 : 0);
  const res = lean(ride(60, phone, () => 0));
  assert.equal(res.left, null);
});

test('a short spike is not a record', () => {
  const at = (t) => (t >= 20 && t < 20.8 ? 40 : 0);
  assert.equal(lean(ride(60, at)).right, null);
});

test('no records near standstill', () => {
  const at = (t) => (t >= 20 && t < 26 ? 15 : 0);
  assert.equal(lean(ride(60, at, at, 3)).right, null);
});

test('mount offset is taken out using the straights', () => {
  const at = (t) => 4 + (t >= 30 && t < 36 ? -30 : 0);
  const gpsAt = (t) => (t >= 30 && t < 36 ? -30 : 0);
  const res = lean(ride(90, at, gpsAt));
  assert.ok(Math.abs(res.left - 30) < 1, `left ${res.left}`);
  assert.equal(res.reference, 'auto'); // the straights absorb the offset
  assert.ok(Math.abs(res.bias) < 0.5);
});

test('no calibration or a phone lying flat gives nothing', () => {
  const r = ride(30, () => 0);
  assert.equal(lean({ ...r, gps: [] }, null), null);
  assert.equal(bikeAxes([0, 0, -9.81]), null);
});

test('a few degrees of body roll (a car) is not a record', () => {
  const at = (t) => (t >= 20 && t < 26 ? 4 : 0);
  assert.equal(lean(ride(60, at)).right, null);
});

test('without calibration the straights give the upright reference', () => {
  // phone mounted 6 degrees rolled, no calibration
  const at = (t) => 6 + (t >= 40 && t < 46 ? 30 : 0);
  const gpsAt = (t) => (t >= 40 && t < 46 ? 30 : 0);
  const res = lean(ride(90, at, gpsAt), null);
  assert.equal(res.reference, 'auto');
  assert.ok(Math.abs(res.right - 30) < 1, `right ${res.right}`);
});

test('a short ride without straights falls back to the calibration', () => {
  const at = (t) => (t >= 5 && t < 12 ? 25 : 0);
  const res = lean(ride(15, at));
  assert.equal(res.reference, 'manual');
  assert.ok(Math.abs(res.right - 25) < 1, `right ${res.right}`);
});
