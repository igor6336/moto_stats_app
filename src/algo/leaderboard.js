// Leaderboards from ride summaries (rows of the `rides` table).
// Pure functions: the caller passes the rides it can see (own + friends).

export const CATEGORIES = [
  { id: 'maxSpeed', label: 'Макс. скорость', kind: 'speed', per: 'ride', field: 'max_speed_ms' },
  // Short rides make average speed meaningless, so only rides of 10 km+.
  { id: 'avgSpeed', label: 'Лучшая средняя', kind: 'speed', per: 'ride', field: 'avg_moving_ms', minDistance: 10000 },
  // Acceleration: best (lowest) time of any ride; rides without the run are skipped.
  { id: 'a0_100', label: '0–100', kind: 'time', per: 'ride', field: 'accel_0_100_s', lower: true },
  { id: 'a100_200', label: '100–200', kind: 'time', per: 'ride', field: 'accel_100_200_s', lower: true },
  { id: 'a0_200', label: '0–200', kind: 'time', per: 'ride', field: 'accel_0_200_s', lower: true },
  // Lean: best of rides with a calibration (beta, stage 3).
  { id: 'leanRight', label: 'Наклон вправо', kind: 'angle', per: 'ride', field: 'lean_right_deg' },
  { id: 'leanLeft', label: 'Наклон влево', kind: 'angle', per: 'ride', field: 'lean_left_deg' },
  // Needs the wheelie algorithm; shown with a notice until then.
  { id: 'wheelie', label: 'Стойка', kind: 'angle', per: 'ride', field: 'wheelie_deg', pending: true },
];

export const PERIODS = [
  { id: 'day', label: 'День' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё время' },
];

// Start of the day, calendar week (Monday) or month, in local time.
export function periodStart(period, now = new Date()) {
  if (period === 'all') return -Infinity;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'day') return d.getTime();
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (period === 'month') d.setDate(1);
  return d.getTime();
}

export function computeLeaderboard(rides, categoryId, period, now = new Date()) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) throw new Error(`unknown category ${categoryId}`);
  const from = periodStart(period, now);
  const byUser = new Map();
  for (const r of rides) {
    if (new Date(r.started_at).getTime() < from) continue;
    if (cat.minDistance && r.distance_m < cat.minDistance) continue;
    const x = cat.field ? r[cat.field] : null;
    if (cat.per === 'ride' && !(x > 0)) continue;
    let e = byUser.get(r.user_id);
    if (!e) byUser.set(r.user_id, (e = { userId: r.user_id, value: 0, rides: 0, best: null }));
    e.rides++;
    if (cat.per === 'count') e.value = e.rides;
    else if (cat.per === 'sum') e.value += x;
    else if (!e.best || (cat.lower ? x < e.value : x > e.value)) { e.value = x; e.best = r; }
  }
  const rows = [...byUser.values()].filter((e) => e.value > 0)
    .sort((a, b) => (cat.lower ? a.value - b.value : b.value - a.value));
  // Equal values share a rank.
  rows.forEach((e, i) => { e.rank = i > 0 && rows[i - 1].value === e.value ? rows[i - 1].rank : i + 1; });
  return rows;
}

// Totals and personal bests of one rider, for the profile screen.
export function riderStats(rides, period = 'all', now = new Date()) {
  const from = periodStart(period, now);
  const s = {
    rides: 0, distance: 0, moving: 0, maxSpeed: 0, longest: 0, bestAvg: 0,
    a0_100: null, a100_200: null, a0_200: null,
    leanRight: 0, leanLeft: 0, wheelie: 0, // degrees, filled once stage 3 computes them
  };
  const minOf = (a, b) => (b > 0 && (a === null || b < a) ? b : a);
  for (const r of rides) {
    if (new Date(r.started_at).getTime() < from) continue;
    s.rides++;
    s.distance += r.distance_m;
    s.moving += r.moving_s;
    s.maxSpeed = Math.max(s.maxSpeed, r.max_speed_ms);
    s.longest = Math.max(s.longest, r.distance_m);
    if (r.distance_m >= 10000) s.bestAvg = Math.max(s.bestAvg, r.avg_moving_ms);
    s.a0_100 = minOf(s.a0_100, r.accel_0_100_s);
    s.a100_200 = minOf(s.a100_200, r.accel_100_200_s);
    s.a0_200 = minOf(s.a0_200, r.accel_0_200_s);
    s.leanRight = Math.max(s.leanRight, r.lean_right_deg || 0);
    s.leanLeft = Math.max(s.leanLeft, r.lean_left_deg || 0);
    s.wheelie = Math.max(s.wheelie, r.wheelie_deg || 0);
  }
  return s;
}
