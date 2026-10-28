// Lean angle from the phone's attitude (stage 3, beta).
//
// iOS fuses gyroscope and accelerometer into a gravity estimate
// (accelerationIncludingGravity - acceleration). Unlike the raw
// accelerometer, which in a balanced turn always points "down the bike",
// this estimate follows the real lean. Lean is the roll of that vector
// against the calibrated upright gravity, around the bike's forward axis.
//
// Checked on a real ride against GPS (atan(v * yaw rate / g)): corners of
// 25-35 degrees agree within a few degrees; on straights the estimate
// wobbles by 6-8 degrees. So a record needs the lean held for HOLD_S and a
// GPS track that also shows a turn that way. Integrating the gyroscope
// directly does not work with a handlebar mount: steering and vibration
// read as +-40 degrees at 200 km/h.
//
// Streaming: add() takes sensor chunks one at a time (a long ride is never
// fully in memory), result() finishes with the GPS rows.
import { G, M } from './schema.js';

export const LEAN_VERSION = 4;
const BIN_S = 0.1;         // resampling step
const HOLD_S = 1.5;        // a record must be held this long
const MIN_KMH = 20;        // no records near standstill (foot down, stand)
const MAX_LEAN = 65;       // more is a dropped or loose phone, not a corner
const MIN_LEAN = 10;       // less is body roll or noise (a car gives 3-4), not a record
const GPS_WINDOW = [-2, 3]; // s around the hold: GPS lags by 1-2 s
const GPS_SHARE = 0.4;     // GPS must show at least this share of the lean
const STRAIGHT_DEG = 3;    // GPS lean below this counts as riding straight
const FLAT_MOUNT = 0.8;    // |cos| of screen normal vs vertical: lying flat

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return n ? [v[0] / n, v[1] / n, v[2] / n] : null; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const R2D = 180 / Math.PI;

// Bike axes in the phone frame from the calibrated gravity. The mount is
// assumed upright with the screen towards the rider: forward is the back of
// the phone projected onto the horizontal plane. iOS reports gravity
// pointing down (z = -9.8 lying face up), right is then +x for a portrait
// phone. Returns null for a phone lying flat (no way to tell forward).
export function bikeAxes(gravity) {
  const down = norm(gravity);
  if (!down || Math.abs(down[2]) > FLAT_MOUNT) return null;
  const fwd = norm([down[2] * down[0], down[2] * down[1], down[2] * down[2] - 1]); // -(z - (z.d)d)
  return { down, fwd, right: norm(cross(down, fwd)) };
}

// Upright reference from the ride itself: the mean gravity direction on
// straights at a steady speed, where a motorcycle stands up. Needs at least
// AUTO_MIN_S of such riding; the manual calibration is the fallback.
const AUTO_MIN_S = 30;
const STEADY_ACCEL = 0.7;  // m/s2: harder acceleration or braking pitches the bike

export function autoReference(bins, gps) {
  const sum = [0, 0, 0];
  let n = 0;
  for (const g of gps) {
    if (g.kmh < MIN_KMH || Math.abs(g.lean) >= STRAIGHT_DEG || Math.abs(g.accel) > STEADY_ACCEL) continue;
    for (let b = Math.floor((g.t - 0.5) / BIN_S); b < Math.floor((g.t + 0.5) / BIN_S); b++) {
      const c = bins.get(b);
      if (!c) continue;
      const d = norm(c);
      if (!d) continue;
      sum[0] += d[0]; sum[1] += d[1]; sum[2] += d[2]; n++;
    }
  }
  return n * BIN_S >= AUTO_MIN_S ? norm(sum) : null;
}

export class LeanAccumulator {
  constructor(calibration) {
    this.calibration = calibration?.ok ? calibration.gravity : null;
    this.bins = new Map(); // bin index -> [sum gx, sum gy, sum gz, count]
  }

  add(motion) {
    if (!motion) return;
    for (const r of motion) {
      const gx = r[M.gx] - r[M.ax], gy = r[M.gy] - r[M.ay], gz = r[M.gz] - r[M.az];
      if (!Number.isFinite(gx + gy + gz)) continue;
      const b = Math.floor(r[M.t] / 1000 / BIN_S);
      const c = this.bins.get(b);
      if (c) { c[0] += gx; c[1] += gy; c[2] += gz; c[3]++; } else this.bins.set(b, [gx, gy, gz, 1]);
    }
  }

  // { left, right } in degrees (positive) or null where nothing qualified,
  // plus where the upright reference came from; null overall without sensor
  // data or any reference.
  result(gpsRows) {
    if (!this.bins.size) return null;
    const gps = gpsLean(gpsRows);
    const auto = autoReference(this.bins, gps);
    const reference = auto ? 'auto' : this.calibration ? 'manual' : null;
    const axes = bikeAxes(auto || this.calibration || [0, 0, 0]);
    if (!axes) return reference ? { v: LEAN_VERSION, right: null, left: null, reference, reason: 'flat' } : null;
    const leanAt = new Map();
    for (const [b, c] of this.bins) leanAt.set(b, Math.atan2(dot(c, axes.right), dot(c, axes.down)) * R2D);

    // Mount offset: median lean while GPS says riding straight.
    const straight = [];
    for (const g of gps) {
      if (g.kmh < MIN_KMH || Math.abs(g.lean) >= STRAIGHT_DEG) continue;
      const l = leanAt.get(Math.floor(g.t / BIN_S));
      if (l !== undefined) straight.push(l);
    }
    straight.sort((a, b) => a - b);
    const bias = straight.length >= 50 ? straight[straight.length >> 1] : 0;

    const kmhAt = (t) => {
      let best = null, bestDt = 1.5;
      for (const g of gps) { const dt = Math.abs(g.t - t); if (dt < bestDt) { bestDt = dt; best = g.kmh; } }
      return best;
    };
    const gpsPeak = (t0, t1, sign) => {
      let peak = 0;
      for (const g of gps) if (g.t >= t0 + GPS_WINDOW[0] && g.t <= t1 + GPS_WINDOW[1]) peak = Math.max(peak, sign * g.lean);
      return peak;
    };

    const hold = Math.round(HOLD_S / BIN_S);
    const keys = [...leanAt.keys()].sort((a, b) => a - b);
    const best = { right: null, left: null };
    for (const [side, sign] of [['right', 1], ['left', -1]]) {
      // Lean held over a window = the smallest lean inside it.
      for (let i = 0; i + hold <= keys.length; i++) {
        if (keys[i + hold - 1] - keys[i] !== hold - 1) continue; // sensor gap inside
        let held = Infinity;
        for (let k = i; k < i + hold; k++) held = Math.min(held, sign * (leanAt.get(keys[k]) - bias));
        if (!(held > 0) || held > MAX_LEAN || held <= (best[side] || 0)) continue;
        const t0 = keys[i] * BIN_S, t1 = keys[i + hold - 1] * BIN_S;
        const kmh = kmhAt((t0 + t1) / 2);
        if (kmh === null || kmh < MIN_KMH) continue;
        if (gpsPeak(t0, t1, sign) < held * GPS_SHARE) continue;
        best[side] = held;
      }
    }
    const round = (x) => (x === null || x < MIN_LEAN ? null : Math.round(x * 10) / 10);
    return { v: LEAN_VERSION, right: round(best.right), left: round(best.left), bias: Math.round(bias * 10) / 10, reference,
      series: leanSeries(leanAt, bias) };
  }
}

// Lean over time for the ride chart, SERIES_S apart, right positive, whole
// degrees; null where sensor data is missing. Kept on the ride (a few KB),
// so the chart survives deleting the raw sensor data.
const SERIES_S = 0.5;
function leanSeries(leanAt, bias) {
  const per = Math.round(SERIES_S / BIN_S);
  const groups = new Map();
  for (const [b, l] of leanAt) {
    const k = Math.floor(b / per);
    const g = groups.get(k);
    if (g) { g[0] += l; g[1]++; } else groups.set(k, [l, 1]);
  }
  const keys = [...groups.keys()];
  if (!keys.length) return null;
  const k0 = Math.min(...keys), k1 = Math.max(...keys);
  const v = [];
  for (let k = k0; k <= k1; k++) {
    const g = groups.get(k);
    v.push(g ? Math.round(g[0] / g[1] - bias) : null);
  }
  return { t0: k0 * SERIES_S, dt: SERIES_S, v };
}

// Lean the GPS track implies: atan(v * yaw rate / g), from consecutive
// precise fixes with a reported course. Lags reality by 1-2 s.
export function gpsLean(rows) {
  const out = [];
  let prev = null;
  for (const r of rows) {
    if (!(r[G.acc] <= 10) || r[G.heading] === null || r[G.heading] === undefined || !(r[G.speed] > 0)) { prev = null; continue; }
    const t = (Number.isFinite(r[G.gpsT]) ? r[G.gpsT] : r[G.t]) / 1000;
    if (prev && t > prev.t && t - prev.t <= 1.5) {
      const dh = ((r[G.heading] - prev.h + 540) % 360) - 180;
      const v = (r[G.speed] + prev.v) / 2;
      const rate = (dh / (t - prev.t)) / R2D;
      out.push({ t: (t + prev.t) / 2, kmh: v * 3.6, lean: Math.atan((v * rate) / 9.81) * R2D,
        accel: (r[G.speed] - prev.v) / (t - prev.t) });
    }
    prev = { t, h: r[G.heading], v: r[G.speed] };
  }
  return out;
}
