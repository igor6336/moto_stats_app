// Personal records over the rides stored on this phone (not excluded from
// the leaderboard, i.e. no car rides).
import { fmtSpeed, speedUnit, fmtDistance } from './format.js';

export const RECORD_METRICS = [
  { id: 'maxSpeed', label: 'Макс. скорость', get: (r) => r.summary?.maxSpeed, fmt: (v) => `${fmtSpeed(v)} ${speedUnit()}` },
  { id: 'a0_100', label: '0–100', get: (r) => r.summary?.accel?.['0-100'], lower: true, fmt: (v) => `${v.toFixed(2)} с` },
  { id: 'a100_200', label: '100–200', get: (r) => r.summary?.accel?.['100-200'], lower: true, fmt: (v) => `${v.toFixed(2)} с` },
  { id: 'a0_200', label: '0–200', get: (r) => r.summary?.accel?.['0-200'], lower: true, fmt: (v) => `${v.toFixed(2)} с` },
  { id: 'leanLeft', label: 'Наклон влево', get: (r) => r.lean?.left, fmt: (v) => `${Math.round(v)}°` },
  { id: 'leanRight', label: 'Наклон вправо', get: (r) => r.lean?.right, fmt: (v) => `${Math.round(v)}°` },
  { id: 'distance', label: 'Самая длинная', get: (r) => r.summary?.distance, fmt: (v) => fmtDistance(v) },
];

const counts = (r) => r.status !== 'recording' && !r.excluded && r.summary;
const valueOf = (m, r) => { const v = m.get(r); return Number.isFinite(v) && v > 0 ? v : null; };
const better = (m, a, b) => (m.lower ? a < b : a > b);

// metric id -> { metric, value, ride } for the best ride of each metric.
export function computeRecords(rides) {
  const out = {};
  for (const m of RECORD_METRICS) {
    for (const r of rides) {
      if (!counts(r)) continue;
      const v = valueOf(m, r);
      if (v === null) continue;
      if (!out[m.id] || better(m, v, out[m.id].value)) out[m.id] = { metric: m, value: v, ride: r };
    }
  }
  return out;
}

// Records this ride holds, among metrics some other ride also has: the very
// first ride is not "a record" in everything.
export function rideRecords(ride, rides) {
  if (!counts(ride)) return [];
  const others = rides.filter((r) => r.id !== ride.id && counts(r));
  const out = [];
  for (const m of RECORD_METRICS) {
    const v = valueOf(m, ride);
    if (v === null) continue;
    const prev = others.map((r) => valueOf(m, r)).filter((x) => x !== null);
    if (!prev.length) continue;
    if (prev.every((p) => better(m, v, p))) out.push({ metric: m, value: v });
  }
  return out;
}
