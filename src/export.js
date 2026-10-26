// Export and import of rides. The raw file is self-describing (columns and
// units included) so the offline tools in scripts/ can read it directly.
import {
  RAW_FORMAT, RAW_VERSION, GPS_COLUMNS, MOTION_COLUMNS, ORIENT_COLUMNS, EVENT_COLUMNS, UNITS,
} from './algo/schema.js';
import { computeSummary } from './algo/stats.js';
import { getRide, listRides, putRide, getGpsChunks, getGpsData, forEachSensorChunk, writeChunk } from './storage.js';
import { fileStamp } from './format.js';
import { APP_VERSION } from './version.js';
import { getSettings } from './settings.js';

const BACKUP_FORMAT = 'moto-backup';
const IMPORT_CHUNK_ROWS = 3000;

// Serialises a list of row arrays without building one huge string.
function pushRows(parts, chunks) {
  let first = true;
  for (const rows of chunks) {
    if (!rows.length) continue;
    const s = JSON.stringify(rows);
    parts.push(first ? s.slice(1, -1) : ',' + s.slice(1, -1));
    first = false;
  }
}

export async function exportRideRaw(id) {
  const ride = await getRide(id);
  if (!ride) throw new Error('поездка не найдена');
  const gpsChunks = await getGpsChunks(id);
  const motion = [], orient = [];
  await forEachSensorChunk(id, (c) => { motion.push(c.motion); orient.push(c.orient); });

  const header = {
    format: RAW_FORMAT, version: RAW_VERSION, exportedAt: Date.now(), appVersion: APP_VERSION,
    columns: { gps: GPS_COLUMNS, motion: MOTION_COLUMNS, orient: ORIENT_COLUMNS, events: EVENT_COLUMNS },
    units: UNITS,
    ride,
  };
  const parts = [JSON.stringify(header).slice(0, -1)];
  parts.push(',"gps":[');
  pushRows(parts, gpsChunks.map((c) => c.gps));
  parts.push('],"events":[');
  pushRows(parts, gpsChunks.map((c) => c.events));
  parts.push('],"motion":[');
  pushRows(parts, motion);
  parts.push('],"orient":[');
  pushRows(parts, orient);
  parts.push(']}');
  const blob = new Blob(parts, { type: 'application/json' });
  return { blob, name: `moto-raw-${fileStamp(ride.startedAt)}.json` };
}

// Backup without motion data: rides, summaries and GPS tracks. Small enough
// to make regularly; raw files are exported per ride.
export async function exportBackup() {
  const rides = await listRides();
  const parts = [JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), appVersion: APP_VERSION }).slice(0, -1), ',"rides":['];
  for (let i = 0; i < rides.length; i++) {
    const { gps, events } = await getGpsData(rides[i].id);
    parts.push((i ? ',' : '') + JSON.stringify({ ride: rides[i], gps, events }));
  }
  parts.push(']}');
  return { blob: new Blob(parts, { type: 'application/json' }), name: `moto-backup-${fileStamp(Date.now())}.json` };
}

async function storeRide(ride, gps, events, motion = [], orient = []) {
  if (await getRide(ride.id)) return false;
  const n = Math.max(1, Math.ceil(Math.max(gps.length, motion.length, orient.length) / IMPORT_CHUNK_ROWS));
  // Split each stream into the same number of chunks.
  const slice = (rows, i) => rows.slice(Math.floor((rows.length * i) / n), Math.floor((rows.length * (i + 1)) / n));
  if (!ride.summary) {
    ride.summary = computeSummary(gps, {
      zones: ride.settings?.zones || getSettings().zones,
      durationS: ride.endedAt ? (ride.endedAt - ride.startedAt) / 1000 : undefined,
    });
  }
  if (ride.status === 'recording') ride.status = 'interrupted';
  ride.chunks = n;
  for (let i = 0; i < n; i++) {
    await writeChunk(ride, i, {
      gps: slice(gps, i), events: i === 0 ? events : [],
      motion: slice(motion, i), orient: slice(orient, i),
    });
  }
  return true;
}

export async function importFile(file) {
  const data = JSON.parse(await file.text());
  if (data.format === RAW_FORMAT) {
    const added = await storeRide(data.ride, data.gps || [], data.events || [], data.motion || [], data.orient || []);
    return { added: added ? 1 : 0, skipped: added ? 0 : 1 };
  }
  if (data.format === BACKUP_FORMAT) {
    let added = 0, skipped = 0;
    for (const item of data.rides || []) {
      if (await storeRide(item.ride, item.gps || [], item.events || [])) added++;
      else skipped++;
    }
    return { added, skipped };
  }
  throw new Error('неизвестный формат файла');
}

// iOS: the share sheet is the reliable way to save a file from a
// home-screen app ("Save to Files"). Elsewhere fall back to a download.
export async function shareOrDownload({ blob, name }) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
