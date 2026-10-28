// Personal totals over a period (not leaderboards): distance, time in the
// saddle, number of rides. Car rides (excluded from the leaderboard) and
// rides still recording do not count. Pure functions over stored rides.

export const TOTAL_PERIODS = [
  { id: 'month', label: 'Месяц' },
  { id: 'season', label: 'Сезон' },
  { id: 'all', label: 'Всё время' },
];

const counts = (r) => r.status !== 'recording' && !r.excluded && r.summary;

// Start of the period in local time; the season is the calendar year.
export function totalsStart(period, now = new Date()) {
  if (period === 'all') return -Infinity;
  const d = new Date(now.getFullYear(), period === 'month' ? now.getMonth() : 0, 1);
  return d.getTime();
}

export function computeTotals(rides, period, now = new Date()) {
  const from = totalsStart(period, now);
  const t = { rides: 0, distance: 0, movingTime: 0, avgSpeed: 0 };
  for (const r of rides) {
    if (!counts(r) || r.startedAt < from) continue;
    t.rides++;
    t.distance += r.summary.distance || 0;
    t.movingTime += r.summary.movingTime || 0;
  }
  t.avgSpeed = t.movingTime > 0 ? t.distance / t.movingTime : 0;
  return t;
}

// Distance per month of the season (calendar year), January..current month.
export function seasonByMonth(rides, now = new Date()) {
  const year = now.getFullYear();
  const months = Array.from({ length: now.getMonth() + 1 }, () => 0);
  for (const r of rides) {
    if (!counts(r)) continue;
    const d = new Date(r.startedAt);
    if (d.getFullYear() !== year || d.getMonth() > now.getMonth()) continue;
    months[d.getMonth()] += r.summary.distance || 0;
  }
  return months;
}
