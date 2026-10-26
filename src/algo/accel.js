// Best acceleration times (0-100, 100-200, 0-200 km/h) from GPS speed.
// GPS on iOS gives ~1 fix per second, so crossing times are interpolated
// linearly between fixes; expected error is a few tenths of a second.
// Pure functions over the output of prepareTrack().

export const RUNS = [
  // min/max: times outside are rejected as GPS errors or not a real launch.
  { id: '0-100', from: 0, to: 100, min: 2.5, max: 20 },
  { id: '100-200', from: 100, to: 200, min: 3, max: 40 },
  { id: '0-200', from: 0, to: 200, min: 6, max: 60 },
];

const START_KMH = 2;  // a standing start begins when speed rises through this
const DIP_KMH = 4;    // allowed drop during a run (gear changes)
const MAX_DT = 2.5;   // s: a longer gap between fixes breaks the run

// Time when speed crossed `level` between two fixes.
function cross(t0, v0, t1, v1, level) {
  return v1 === v0 ? t1 : t0 + ((level - v0) / (v1 - v0)) * (t1 - t0);
}

export function bestAccelerations(track) {
  const { n, t, brk } = track;
  const v = track.speed.map((s) => s * 3.6);
  const out = {};
  for (const run of RUNS) {
    const startLevel = run.from === 0 ? START_KMH : run.from;
    let best = null;
    for (let i = 1; i < n; i++) {
      if (brk[i] || t[i] - t[i - 1] > MAX_DT) continue;
      if (!(v[i - 1] < startLevel && v[i] >= startLevel)) continue;
      const tStart = cross(t[i - 1], v[i - 1], t[i], v[i], startLevel);
      let peak = v[i];
      for (let j = i; j < n; j++) {
        if (j > i && (brk[j] || t[j] - t[j - 1] > MAX_DT)) break;
        if (v[j] < peak - DIP_KMH) break;
        if (t[j] - tStart > run.max) break;
        peak = Math.max(peak, v[j]);
        if (v[j] >= run.to) {
          const tEnd = j === i ? cross(t[i - 1], v[i - 1], t[i], v[i], run.to) : cross(t[j - 1], v[j - 1], t[j], v[j], run.to);
          const time = tEnd - tStart;
          if (time >= run.min && time <= run.max && (best === null || time < best)) best = time;
          break;
        }
      }
    }
    out[run.id] = best === null ? null : Math.round(best * 100) / 100;
  }
  return out;
}
