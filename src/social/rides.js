// Uploads ride summaries for leaderboards. Raw data never leaves the phone.
import { getClient, getMe } from './client.js';
import { listRides, putRide, getGpsData } from '../storage.js';
import { computeSummary, ALGO_VERSION } from '../algo/stats.js';
import { getSettings } from '../settings.js';
import { ensureLean, applyLean } from '../ridelean.js';

const MIN_DISTANCE_M = 500; // skips test recordings at home

const signature = (s) => `${s.algoVersion}:${Math.round(s.distance)}:${s.maxSpeed.toFixed(2)}:${JSON.stringify(s.accel || {})}:${s.leanLeft}:${s.leanRight}`;

// Rides recorded before an algorithm update (e.g. without acceleration
// times) get their summary recomputed from the stored GPS track.
async function freshSummary(ride) {
  await ensureLean(ride);
  if (ride.summary?.algoVersion === ALGO_VERSION) return applyLean(ride.summary, ride);
  const { gps } = await getGpsData(ride.id);
  ride.summary = computeSummary(gps, {
    zones: ride.settings?.zones || getSettings().zones,
    durationS: ride.endedAt ? (ride.endedAt - ride.startedAt) / 1000 : undefined,
  });
  applyLean(ride.summary, ride);
  await putRide(ride);
  return ride.summary;
}

let accelColumns = true; // false if the server schema predates them
let leanColumns = true;

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
    if (ride.status === 'recording' || !ride.summary) continue;
    if (ride.excluded) {
      // Excluded from leaderboards (e.g. recorded in a car): remove the
      // uploaded summary once.
      if (ride.synced && ride.synced !== `${me.id}:excluded`) {
        const { error } = await sb.from('rides').delete().eq('user_id', me.id).eq('local_id', ride.id);
        if (error) { console.warn('ride unsync', error); continue; }
      }
      if (ride.synced !== `${me.id}:excluded`) { ride.synced = `${me.id}:excluded`; await putRide(ride); }
      continue;
    }
    const s = await freshSummary(ride);
    if (s.distance < MIN_DISTANCE_M) continue;
    const sig = signature(s);
    if (ride.synced === `${me.id}:${sig}`) continue;
    const row = {
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
    };
    if (accelColumns) {
      row.accel_0_100_s = s.accel?.['0-100'] ?? null;
      row.accel_100_200_s = s.accel?.['100-200'] ?? null;
      row.accel_0_200_s = s.accel?.['0-200'] ?? null;
    }
    if (leanColumns) {
      row.lean_left_deg = s.leanLeft ?? null;
      row.lean_right_deg = s.leanRight ?? null;
    }
    let { error } = await sb.from('rides').upsert(row, { onConflict: 'user_id,local_id' });
    if (error && /lean_/.test(error.message || '')) {
      // Server not migrated yet: upload without lean, retry later.
      leanColumns = false;
      delete row.lean_left_deg; delete row.lean_right_deg;
      ({ error } = await sb.from('rides').upsert(row, { onConflict: 'user_id,local_id' }));
      if (!error) continue;
    }
    if (error && /accel_/.test(error.message || '')) {
      // Server not migrated yet: upload without acceleration, retry later.
      accelColumns = false;
      delete row.accel_0_100_s; delete row.accel_100_200_s; delete row.accel_0_200_s;
      ({ error } = await sb.from('rides').upsert(row, { onConflict: 'user_id,local_id' }));
      if (!error) continue;
    }
    if (error) { console.warn('ride sync', error); continue; }
    ride.synced = `${me.id}:${sig}`;
    await putRide(ride);
    n++;
  }
  return n;
}

// Removes a ride's summary from the server, e.g. when the ride is deleted.
export async function deleteRemoteRide(localId) {
  const me = getMe();
  if (!me) return;
  const sb = await getClient();
  const { error } = await sb.from('rides').delete().eq('user_id', me.id).eq('local_id', localId);
  if (error) throw error;
}

// Ride summaries of the rider and friends, for leaderboards.
export async function fetchBoardData() {
  const sb = await getClient();
  const [rides, profiles] = await Promise.all([
    sb.from('rides').select('*'), // '*' keeps working before the accel columns exist
    sb.from('profiles').select('id, name, bike, avatar'),
  ]);
  if (rides.error) throw rides.error;
  if (profiles.error) throw profiles.error;
  return { rides: rides.data, profiles: new Map(profiles.data.map((p) => [p.id, p])) };
}
