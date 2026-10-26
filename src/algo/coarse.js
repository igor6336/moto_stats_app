// Approximate route where GPS is unusable (central Moscow jamming, tunnels,
// indoors): iOS then reports Wi-Fi/cell positions every few seconds with
// 50-300 m accuracy and no speed. Such fixes are too poor for speed, zones
// or acceleration, but over minutes they still show where the rider went.
//
// Distance is counted only between fixes that moved further apart than
// their accuracy (re-sampling), so jitter while standing adds nothing.
import { haversine } from './geo.js';
import { G } from './schema.js';

export const COARSE_MAX_ACCURACY = 300; // m: worse fixes are ignored entirely
const COARSE_GAP = 60;                  // s: longer silence ends an approximate run
const COARSE_MAX_SPEED = 70;            // m/s between kept fixes (250 km/h)

// precise: output of prepareTrack() for the same rows (fixes <= maxAccuracy).
export function coarseRuns(rows, precise, o) {
  // Time already covered by the precise track.
  const covered = [];
  for (let i = 1; i < precise.n; i++) {
    if (precise.brk[i] || precise.t[i] - precise.t[i - 1] > o.maxGap) continue;
    const last = covered[covered.length - 1];
    if (last && last[1] >= precise.t[i - 1]) last[1] = precise.t[i];
    else covered.push([precise.t[i - 1], precise.t[i]]);
  }
  const isCovered = (t) => covered.some(([a, b]) => t >= a && t <= b);

  const pts = [];
  for (const r of rows) {
    const acc = r[G.acc];
    if (!Number.isFinite(r[G.lat]) || !Number.isFinite(r[G.lon]) || !Number.isFinite(acc)) continue;
    if (acc <= o.maxAccuracy || acc > COARSE_MAX_ACCURACY) continue;
    const t = (Number.isFinite(r[G.gpsT]) ? r[G.gpsT] : r[G.t]) / 1000;
    if (isCovered(t) || (pts.length && t <= pts[pts.length - 1].t)) continue;
    pts.push({ t, lat: r[G.lat], lon: r[G.lon], acc });
  }

  // Group into runs separated by long silences.
  const groups = [];
  for (const p of pts) {
    const g = groups[groups.length - 1];
    if (g && p.t - g[g.length - 1].t <= COARSE_GAP) g.push(p);
    else groups.push([p]);
  }

  // Precise fixes just before and after a run connect it to the rest of the
  // route, so no distance is lost at the hand-over.
  const preciseAt = (i) => ({ t: precise.t[i], lat: precise.lat[i], lon: precise.lon[i], acc: precise.acc[i] || 10 });
  const anchorBefore = (t) => {
    for (let i = precise.n - 1; i >= 0; i--) if (precise.t[i] < t) return t - precise.t[i] <= COARSE_GAP ? preciseAt(i) : null;
    return null;
  };
  const anchorAfter = (t) => {
    for (let i = 0; i < precise.n; i++) if (precise.t[i] > t) return precise.t[i] - t <= COARSE_GAP ? preciseAt(i) : null;
    return null;
  };

  const runs = [];
  for (const g of groups) {
    const before = anchorBefore(g[0].t), after = anchorAfter(g[g.length - 1].t);
    const seq = [...(before ? [before] : []), ...g, ...(after ? [after] : [])];
    if (seq.length < 2) continue;
    const kept = [seq[0]];
    for (let i = 1; i < seq.length; i++) {
      const p = seq[i], last = kept[kept.length - 1];
      const d = haversine(last.lat, last.lon, p.lat, p.lon);
      const isEnd = i === seq.length - 1;
      if (!isEnd && d <= Math.max(last.acc, p.acc)) continue;
      if (d / Math.max(p.t - last.t, 1e-3) > COARSE_MAX_SPEED) continue; // a jump, not movement
      kept.push(p);
    }
    let distance = 0;
    for (let i = 1; i < kept.length; i++) distance += haversine(kept[i - 1].lat, kept[i - 1].lon, kept[i].lat, kept[i].lon);
    const time = seq[seq.length - 1].t - seq[0].t;
    runs.push({
      t0: seq[0].t, t1: seq[seq.length - 1].t, distance, time,
      moving: time > 0 && distance / time >= o.movingSpeed,
      coords: kept.map((p) => [p.lat, p.lon]),
    });
  }
  return runs;
}
