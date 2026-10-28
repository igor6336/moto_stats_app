// Best acceleration times (0-100, 100-200, 0-200 km/h) from GPS speed.
// GPS on iOS gives ~1 fix per second, so crossing times are interpolated
// linearly between fixes; expected error is a few tenths of a second.
// Pure functions over the output of prepareTrack().

// A run is timed from the last moment speed rose through the start level
// to reaching the target; slowing down on the way (traffic, braking) is
// allowed and just makes the time worse. A drop below the start level
// ends the attempt; the next rise starts a new one.
export const RUNS = [
  // min: faster is a GPS error. max: slower is not an acceleration at all.
  { id: '0-100', from: 0, to: 100, min: 2.5, max: 60 },
  { id: '100-200', from: 100, to: 200, min: 3, max: 120 },
  { id: '0-200', from: 0, to: 200, min: 6, max: 120 },
];

const START_KMH = 2;  // a standing start begins when speed rises through this
const MAX_DT = 2.5;   // s: a longer gap between fixes breaks the run
// After a short signal loss iOS snaps the speed to the real value (seen:
// 56 -> 148 km/h in 1 s). No bike accelerates faster than ~1.2 g, so a
// bigger step, or a fix degraded beyond this accuracy, breaks the run.
const MAX_STEP = 54;  // km/h per s, ~1.5 g
const MAX_ACC = 15;   // m

// Time when speed crossed `level` between two fixes.
function cross(t0, v0, t1, v1, level) {
  return v1 === v0 ? t1 : t0 + ((level - v0) / (v1 - v0)) * (t1 - t0);
}

export function bestAccelerations(track) {
  const out = {};
  for (const [id, span] of Object.entries(bestAccelerationSpans(track))) out[id] = span ? Math.round(span.time * 100) / 100 : null;
  return out;
}

// The best run of each kind with its start and end time (s), for charts.
export function bestAccelerationSpans(track) {
  const { n, t, brk } = track;
  const v = track.speed.map((s) => s * 3.6);
  const bad = (j) => brk[j] || t[j] - t[j - 1] > MAX_DT || track.acc?.[j] > MAX_ACC
    || Math.abs(v[j] - v[j - 1]) / (t[j] - t[j - 1]) > MAX_STEP;
  const out = {};
  for (const run of RUNS) {
    const startLevel = run.from === 0 ? START_KMH : run.from;
    let best = null, span = null;
    for (let i = 1; i < n; i++) {
      if (bad(i)) continue;
      if (!(v[i - 1] < startLevel && v[i] >= startLevel)) continue;
      const tStart = cross(t[i - 1], v[i - 1], t[i], v[i], startLevel);
      for (let j = i; j < n; j++) {
        if (j > i && bad(j)) break;
        if (v[j] < startLevel) break;
        if (t[j] - tStart > run.max) break;
        if (v[j] >= run.to) {
          const tEnd = j === i ? cross(t[i - 1], v[i - 1], t[i], v[i], run.to) : cross(t[j - 1], v[j - 1], t[j], v[j], run.to);
          const time = tEnd - tStart;
          if (time >= run.min && time <= run.max && (best === null || time < best)) { best = time; span = { t0: tStart, t1: tEnd, time }; }
          break;
        }
      }
    }
    out[run.id] = span;
  }
  return out;
}
