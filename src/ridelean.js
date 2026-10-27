// Lean angles of a stored ride. They need the raw sensor data, so they are
// computed once and kept on the ride (ride.lean), surviving the deletion of
// that data. The GPS summary is recomputed often; applyLean() merges them in.
import { getRide, putRide, getGpsData, forEachSensorChunk, deleteSensorData } from './storage.js';
import { LeanAccumulator, LEAN_VERSION } from './algo/lean.js';

// Computes ride.lean if missing or from an older algorithm; returns the ride.
export async function ensureLean(ride) {
  if (ride.status === 'recording' || ride.sensorsDeleted || ride.lean?.v === LEAN_VERSION) return ride;
  const calib = (ride.calibrations || []).find((c) => c.ok);
  let lean = { v: LEAN_VERSION, right: null, left: null, reason: 'no-calibration' };
  if (calib) {
    const acc = new LeanAccumulator(calib);
    await forEachSensorChunk(ride.id, (chunk) => acc.add(chunk.motion));
    const { gps } = await getGpsData(ride.id);
    lean = acc.result(gps) || { v: LEAN_VERSION, right: null, left: null, reason: 'no-data' };
  }
  // Re-read: the ride may have changed (sync, exclusion) while computing.
  const fresh = (await getRide(ride.id)) || ride;
  fresh.lean = lean;
  await putRide(fresh);
  ride.lean = lean;
  return ride;
}

export function applyLean(summary, ride) {
  if (!summary) return summary;
  summary.leanRight = ride.lean?.right ?? null;
  summary.leanLeft = ride.lean?.left ?? null;
  return summary;
}

// Frees space without losing the lean angles.
export async function dropSensorData(ride) {
  await ensureLean(ride);
  await deleteSensorData(ride.id);
}
