// Uploads ride summaries for leaderboards. Raw data never leaves the phone.
import { getClient, getMe } from './client.js';
import { listRides, putRide } from '../storage.js';

const MIN_DISTANCE_M = 500; // skips test recordings at home

const signature = (s) => `${s.algoVersion}:${Math.round(s.distance)}:${s.maxSpeed.toFixed(2)}`;

let syncing = null;

export function syncRides() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  const me = getMe();
  if (!me) return 0;
  const sb = await getClient();
  let n = 0;
  for (const ride of await listRides()) {
    const s = ride.summary;
    if (ride.status === 'recording' || !s || s.distance < MIN_DISTANCE_M) continue;
    const sig = signature(s);
    if (ride.synced === `${me.id}:${sig}`) continue;
    const { error } = await sb.from('rides').upsert({
      user_id: me.id,
      local_id: ride.id,
      started_at: new Date(ride.startedAt).toISOString(),
      duration_s: s.duration,
      moving_s: s.movingTime,
      distance_m: s.distance,
      max_speed_ms: Math.min(120, s.maxSpeed),
      avg_moving_ms: Math.min(120, s.avgMovingSpeed),
      bike: me.bike || '',
      algo_version: s.algoVersion,
    }, { onConflict: 'user_id,local_id' });
    if (error) { console.warn('ride sync', error); continue; }
    ride.synced = `${me.id}:${sig}`;
    await putRide(ride);
    n++;
  }
  return n;
}

// Ride summaries of the rider and friends, for leaderboards.
export async function fetchBoardData() {
  const sb = await getClient();
  const [rides, profiles] = await Promise.all([
    sb.from('rides').select('user_id, local_id, started_at, distance_m, moving_s, max_speed_ms, avg_moving_ms, bike'),
    sb.from('profiles').select('id, name, bike, avatar'),
  ]);
  if (rides.error) throw rides.error;
  if (profiles.error) throw profiles.error;
  return { rides: rides.data, profiles: new Map(profiles.data.map((p) => [p.id, p])) };
}
