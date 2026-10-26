// Leaderboards from ride summaries (rows of the `rides` table).
// Pure functions: the caller passes the rides it can see (own + friends).

export const CATEGORIES = [
  { id: 'maxSpeed', label: 'Макс. скорость', kind: 'speed', per: 'ride', field: 'max_speed_ms' },
  { id: 'distance', label: 'Пробег', kind: 'distance', per: 'sum', field: 'distance_m' },
  { id: 'moving', label: 'Время в седле', kind: 'duration', per: 'sum', field: 'moving_s' },
  { id: 'rides', label: 'Поездок', kind: 'count', per: 'count' },
  { id: 'longest', label: 'Самая длинная поездка', kind: 'distance', per: 'ride', field: 'distance_m' },
  // Short rides make average speed meaningless, so only rides of 10 km+.
  { id: 'avgSpeed', label: 'Лучшая средняя', kind: 'speed', per: 'ride', field: 'avg_moving_ms', minDistance: 10000 },
  // Acceleration: best (lowest) time of any ride; rides without the run are skipped.
  { id: 'a0_100', label: '0–100', kind: 'time', per: 'ride', field: 'accel_0_100_s', lower: true },
  { id: 'a100_200', label: '100–200', kind: 'time', per: 'ride', field: 'accel_100_200_s', lower: true },
  { id: 'a0_200', label: '0–200', kind: 'time', per: 'ride', field: 'accel_0_200_s', lower: true },
];

export const PERIODS = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё время' },
];

// Start of the calendar week (Monday) or month, in local time.
export function periodStart(period, now = new Date()) {
  if (period === 'all') return -Infinity;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
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
