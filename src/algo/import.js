// Validate untrusted exports before any IndexedDB writes. Derived summaries and
// sync markers are never trusted; the importer recomputes summaries from GPS.
import { RAW_FORMAT, RAW_VERSION, GPS_COLUMNS, MOTION_COLUMNS, ORIENT_COLUMNS } from './schema.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v);
const nullable = (v) => v === null || number(v);
const timestamp = (v) => number(v) && v >= 0 && v <= 8.64e15;
const fail = () => { throw new Error('Некорректный файл поездок'); };
const requireValue = (ok) => { if (!ok) fail(); };

function numericRows(rows, size) {
  requireValue(Array.isArray(rows));
  for (const row of rows) {
    requireValue(Array.isArray(row) && row.length === size && number(row[0]) && row.every(nullable));
  }
  return rows;
}

function entry(item) {
  requireValue(object(item) && object(item.ride));
  const source = item.ride;
  requireValue(typeof source.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(source.id));
  requireValue(timestamp(source.startedAt));
  requireValue(source.endedAt == null || (timestamp(source.endedAt) && source.endedAt >= source.startedAt));
  requireValue(['done', 'interrupted', 'recording'].includes(source.status));
  requireValue(source.schema === undefined || source.schema === 1);
  requireValue(source.name == null || (typeof source.name === 'string' && source.name.length <= 60));
  requireValue(source.excluded === undefined || typeof source.excluded === 'boolean');

  const gps = numericRows(item.gps ?? [], GPS_COLUMNS.length);
  for (const row of gps) {
    requireValue(number(row[2]) && Math.abs(row[2]) <= 90 && number(row[3]) && Math.abs(row[3]) <= 180);
    requireValue(row[4] === null || row[4] >= 0);
  }
  const motion = numericRows(item.motion ?? [], MOTION_COLUMNS.length);
  const orient = numericRows(item.orient ?? [], ORIENT_COLUMNS.length);
  const events = item.events ?? [];
  requireValue(Array.isArray(events));
  for (const row of events) {
    requireValue(Array.isArray(row) && row.length === 3 && number(row[0]) && typeof row[1] === 'string');
  }

  // Only supported metadata crosses the trust boundary. In particular, do not
  // restore a remote owner's `synced` marker or an attacker-supplied summary.
  const ride = { id: source.id, schema: 1, startedAt: source.startedAt,
    endedAt: source.endedAt ?? null, status: source.status, name: source.name ?? null,
    excluded: source.excluded ?? false,
    counts: { gps: gps.length, motion: motion.length, orient: orient.length, events: events.length } };
  if (source.appVersion !== undefined) {
    requireValue(typeof source.appVersion === 'string'); ride.appVersion = source.appVersion;
  }
  if (source.device !== undefined) { requireValue(object(source.device)); ride.device = source.device; }
  for (const field of ['lastFlushAt', 'sensorsDeleted']) {
    if (source[field] !== undefined) { requireValue(timestamp(source[field])); ride[field] = source[field]; }
  }
  if (source.settings !== undefined) {
    requireValue(object(source.settings) && Array.isArray(source.settings.zones));
    const zones = source.settings.zones;
    requireValue(zones.every((v, i) => number(v) && v > 0 && (!i || v > zones[i - 1])));
    ride.settings = { zones };
  }
  if (source.quality != null) {
    requireValue(object(source.quality));
    ride.quality = {};
    for (const kind of ['gps', 'motion', 'orient']) {
      const q = source.quality[kind];
      if (q == null) continue;
      requireValue(object(q));
      ride.quality[kind] = {};
      for (const key of ['count', 'hz', 'maxDtMs', 'gaps', 'gapMs']) {
        requireValue(number(q[key]) && q[key] >= 0);
        ride.quality[kind][key] = q[key];
      }
    }
  }
  if (source.lean != null) {
    const lean = source.lean;
    requireValue(object(lean) && Number.isInteger(lean.v) && lean.v >= 0);
    ride.lean = { v: lean.v };
    for (const key of ['left', 'right', 'bias']) {
      if (lean[key] !== undefined) { requireValue(nullable(lean[key])); ride.lean[key] = lean[key]; }
    }
    for (const key of ['reason', 'reference']) {
      if (lean[key] !== undefined) { requireValue(typeof lean[key] === 'string'); ride.lean[key] = lean[key]; }
    }
    if (lean.series != null) {
      const series = lean.series;
      requireValue(object(series) && number(series.t0) && number(series.dt) && series.dt > 0
        && Array.isArray(series.v) && series.v.every(nullable));
      ride.lean.series = { t0: series.t0, dt: series.dt, v: series.v };
    }
  }
  const calibrations = source.calibrations ?? [];
  requireValue(Array.isArray(calibrations));
  ride.calibrations = calibrations.map((c) => {
    requireValue(object(c) && typeof c.ok === 'boolean' && Array.isArray(c.gravity)
      && c.gravity.length === 3 && c.gravity.every(nullable));
    const calibration = { ok: c.ok, gravity: c.gravity };
    for (const key of ['at', 'durationMs', 'tBase', 'samples', 'gravityNorm', 'noise', 'beta', 'gamma']) {
      if (c[key] !== undefined) { requireValue(nullable(c[key])); calibration[key] = c[key]; }
    }
    if (c.motion !== undefined) calibration.motion = numericRows(c.motion, MOTION_COLUMNS.length);
    if (c.orient !== undefined) calibration.orient = numericRows(c.orient, ORIENT_COLUMNS.length);
    return calibration;
  });
  return { ride, gps, events, motion, orient };
}

export function validateImport(data) {
  requireValue(object(data));
  if (data.format === RAW_FORMAT) {
    requireValue(data.version === RAW_VERSION);
    if (data.columns !== undefined) {
      requireValue(object(data.columns));
      for (const [key, columns] of Object.entries({ gps: GPS_COLUMNS, motion: MOTION_COLUMNS, orient: ORIENT_COLUMNS })) {
        requireValue(JSON.stringify(data.columns[key]) === JSON.stringify(columns));
      }
    }
    return [entry(data)];
  }
  requireValue(data.format === 'moto-backup' && data.version === 1 && Array.isArray(data.rides));
  // Validate the entire backup before writing its first ride.
  return data.rides.map(entry);
}
