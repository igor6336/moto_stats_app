// Ride statistics from GPS rows. Pure functions, no browser APIs.
// All outputs are SI: metres, seconds, m/s.
import { G } from './schema.js';
import { haversine } from './geo.js';
import { bestAccelerations } from './accel.js';

export const ALGO_VERSION = 3;

export const DEFAULTS = Object.freeze({
  maxAccuracy: 25,    // m: fixes worse than this are dropped
  movingSpeed: 1.0,   // m/s: below this the bike is considered stopped
  maxGap: 30,         // s: longer interval between fixes = signal lost
  smoothWindow: 3,    // s: centred window for max speed
  maxSpeed: 100,      // m/s (360 km/h): faster jumps or Doppler values are GPS errors
  maxRejects: 5,      // after this many rejected fixes in a row, accept and re-anchor
});

// Cleans raw GPS rows into parallel arrays. Speed falls back to
// distance/time where the browser did not report Doppler speed.
// Fixes that imply an impossible jump (GPS spoofing, as in central Moscow)
// are dropped. If the jumps persist the track re-anchors at the new place;
// brk[i] marks such a point so no distance or time is counted across it.
export function prepareTrack(rows, opts = {}) {
  const { maxAccuracy, smoothWindow, maxSpeed, maxGap, maxRejects } = { ...DEFAULTS, ...opts };
  const t = [], lat = [], lon = [], speed = [], acc = [], brk = [];
  const reported = [];
  let rejected = 0;
  for (const r of rows) {
    const la = r[G.lat], lo = r[G.lon], a = r[G.acc];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (Number.isFinite(a) && a > maxAccuracy) continue;
    const ts = (Number.isFinite(r[G.gpsT]) ? r[G.gpsT] : r[G.t]) / 1000;
    const k = t.length - 1;
    if (k >= 0 && ts <= t[k]) continue; // duplicate or out of order fix
    let isBreak = false;
    if (k >= 0) {
      const dt = ts - t[k];
      if (dt <= maxGap && haversine(lat[k], lon[k], la, lo) / dt > maxSpeed) {
        if (++rejected < maxRejects) continue;
        isBreak = true;
      }
    }
    rejected = 0;
    t.push(ts); lat.push(la); lon.push(lo); acc.push(a); brk.push(isBreak);
    const s = r[G.speed];
    reported.push(Number.isFinite(s) && s >= 0 && s <= maxSpeed ? s : null);
  }
  const n = t.length;
  for (let i = 0; i < n; i++) {
    if (reported[i] !== null) { speed.push(reported[i]); continue; }
    // Neighbour on the same side of any break.
    const j = i > 0 && !brk[i] ? i - 1 : i + 1 < n && !brk[i + 1] ? i + 1 : -1;
    if (j < 0) { speed.push(0); continue; }
    const d = haversine(lat[i], lon[i], lat[j], lon[j]);
    speed.push(Math.min(maxSpeed, d / Math.abs(t[i] - t[j])));
  }
  return { n, t, lat, lon, acc, speed, brk, smooth: smoothByTime(t, speed, smoothWindow) };
}

// Centred moving average over a time window (not a sample count),
// so irregular GPS intervals do not distort it.
export function smoothByTime(t, v, window) {
  const out = new Array(v.length);
  const half = window / 2;
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < v.length; i++) {
    while (hi < v.length && t[hi] <= t[i] + half) sum += v[hi++];
    while (t[lo] < t[i] - half) sum -= v[lo++];
    out[i] = sum / (hi - lo);
  }
  return out;
}

// bounds: zone boundaries in km/h, ascending, e.g. [30, 60, 90].
export function zoneIndex(kmh, bounds) {
  let i = 0;
  while (i < bounds.length && kmh >= bounds[i]) i++;
  return i;
}

export function computeSummary(rows, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const bounds = o.zones || [];
  const tr = prepareTrack(rows, o);
  const zones = Array.from({ length: bounds.length + 1 }, (_, i) => ({
    from: i === 0 ? 0 : bounds[i - 1],
    to: i < bounds.length ? bounds[i] : null,
    time: 0,
    distance: 0,
  }));
  const s = {
    algoVersion: ALGO_VERSION,
    points: tr.n,
    distance: 0, duration: 0, trackedTime: 0, movingTime: 0, stoppedTime: 0,
    gapTime: 0, gaps: 0,
    untrackedTime: 0, // s of the ride with no usable fix (poor accuracy, GPS jamming)
    maxSpeed: 0, maxSpeedRaw: 0, maxSpeedT: null,
    avgMovingSpeed: 0, avgSpeed: 0,
    zones, bbox: null,
    accel: { '0-100': null, '100-200': null, '0-200': null }, // s, best per ride
  };
  if (tr.n === 0) {
    if (Number.isFinite(o.durationS)) s.duration = s.untrackedTime = o.durationS;
    return s;
  }

  let movingDistNoGap = 0;
  for (let i = 1; i < tr.n; i++) {
    const dt = tr.t[i] - tr.t[i - 1];
    if (tr.brk[i]) { s.gaps++; s.gapTime += dt; continue; }
    const d = haversine(tr.lat[i - 1], tr.lon[i - 1], tr.lat[i], tr.lon[i]);
    const v = (tr.speed[i - 1] + tr.speed[i]) / 2;
    const moving = v >= o.movingSpeed;
    // Distance across a gap is still counted (straight line, e.g. a tunnel),
    // but the gap is excluded from time-based stats.
    if (moving) s.distance += d;
    if (dt > o.maxGap) { s.gaps++; s.gapTime += dt; continue; }
    s.trackedTime += dt;
    if (!moving) { s.stoppedTime += dt; continue; }
    s.movingTime += dt;
    movingDistNoGap += d;
    const z = zones[zoneIndex(v * 3.6, bounds)];
    z.time += dt;
    z.distance += d;
  }

  for (let i = 0; i < tr.n; i++) {
    if (tr.smooth[i] > s.maxSpeed) { s.maxSpeed = tr.smooth[i]; s.maxSpeedT = tr.t[i]; }
    if (tr.speed[i] > s.maxSpeedRaw) s.maxSpeedRaw = tr.speed[i];
  }

  s.duration = Number.isFinite(o.durationS) ? o.durationS : tr.t[tr.n - 1] - tr.t[0];
  s.avgMovingSpeed = s.movingTime > 0 ? movingDistNoGap / s.movingTime : 0;
  s.avgSpeed = s.duration > 0 ? s.distance / s.duration : 0;
  s.untrackedTime = Math.max(0, s.duration - s.trackedTime - s.gapTime);
  s.accel = bestAccelerations(tr);
  s.bbox = [Math.min(...tr.lat), Math.min(...tr.lon), Math.max(...tr.lat), Math.max(...tr.lon)];
  return s;
}

// Splits the route into runs of the same speed zone, for colouring the map.
export function routeByZone(rows, bounds, opts = {}) {
  const tr = prepareTrack(rows, opts);
  const o = { ...DEFAULTS, ...opts };
  const runs = [];
  let cur = null;
  for (let i = 1; i < tr.n; i++) {
    const a = [tr.lat[i - 1], tr.lon[i - 1]], b = [tr.lat[i], tr.lon[i]];
    if (tr.brk[i] || tr.t[i] - tr.t[i - 1] > o.maxGap) { cur = null; continue; }
    const z = zoneIndex(((tr.speed[i - 1] + tr.speed[i]) / 2) * 3.6, bounds);
    if (!cur || cur.zone !== z) { cur = { zone: z, coords: [a] }; runs.push(cur); }
    cur.coords.push(b);
  }
  return runs;
}
