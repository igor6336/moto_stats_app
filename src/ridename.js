// Ride names: the rider's own, or one from the part of day it started in.
export function autoName(ts) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 12) return 'Утренняя поездка';
  if (h >= 12 && h < 18) return 'Дневная поездка';
  if (h >= 18 && h < 23) return 'Вечерняя поездка';
  return 'Ночная поездка';
}

export function rideName(ride) {
  return (ride.name || '').trim() || autoName(ride.startedAt);
}

// The ride before this one that counts (not a car ride, not recording).
export function previousRide(ride, rides) {
  let prev = null;
  for (const r of rides) {
    if (r.id === ride.id || r.excluded || r.status === 'recording' || !r.summary?.distance) continue;
    if (r.startedAt < ride.startedAt && (!prev || r.startedAt > prev.startedAt)) prev = r;
  }
  return prev;
}
