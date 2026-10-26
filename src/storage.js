// IndexedDB storage. Rides hold metadata and summary; raw data lives in
// chunks so a long ride is written incrementally and GPS can be read
// without loading the much larger motion data.
const DB_NAME = 'moto-telemetry';
const DB_VERSION = 1;

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const rides = db.createObjectStore('rides', { keyPath: 'id' });
      rides.createIndex('startedAt', 'startedAt');
      db.createObjectStore('gps', { keyPath: ['rideId', 'seq'] });
      db.createObjectStore('sensor', { keyPath: ['rideId', 'seq'] });
      db.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

const rideRange = (id) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

export async function putRide(ride) {
  const db = await openDB();
  const tx = db.transaction('rides', 'readwrite');
  tx.objectStore('rides').put(ride);
  return done(tx);
}

export async function getRide(id) {
  const db = await openDB();
  return req(db.transaction('rides').objectStore('rides').get(id));
}

export async function listRides() {
  const db = await openDB();
  const all = await req(db.transaction('rides').objectStore('rides').getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

// Writes one chunk of raw data and the updated ride metadata atomically.
export async function writeChunk(ride, seq, { gps, events, motion, orient }) {
  const db = await openDB();
  const tx = db.transaction(['rides', 'gps', 'sensor'], 'readwrite');
  if (gps.length || events.length) tx.objectStore('gps').put({ rideId: ride.id, seq, gps, events });
  if (motion.length || orient.length) tx.objectStore('sensor').put({ rideId: ride.id, seq, motion, orient });
  tx.objectStore('rides').put(ride);
  return done(tx);
}

export async function getGpsChunks(id) {
  const db = await openDB();
  return req(db.transaction('gps').objectStore('gps').getAll(rideRange(id)));
}

export async function getGpsData(id) {
  const chunks = await getGpsChunks(id);
  return { gps: chunks.flatMap((c) => c.gps), events: chunks.flatMap((c) => c.events) };
}

// Visits sensor chunks one at a time so a long ride is never fully in memory.
export async function forEachSensorChunk(id, fn) {
  const db = await openDB();
  const keys = await req(db.transaction('sensor').objectStore('sensor').getAllKeys(rideRange(id)));
  for (const key of keys) {
    const chunk = await req(db.transaction('sensor').objectStore('sensor').get(key));
    await fn(chunk);
  }
}

export async function deleteRide(id) {
  const db = await openDB();
  const tx = db.transaction(['rides', 'gps', 'sensor'], 'readwrite');
  tx.objectStore('rides').delete(id);
  tx.objectStore('gps').delete(rideRange(id));
  tx.objectStore('sensor').delete(rideRange(id));
  return done(tx);
}

export async function kvGet(key) {
  const db = await openDB();
  return req(db.transaction('kv').objectStore('kv').get(key));
}

export async function kvSet(key, value) {
  const db = await openDB();
  const tx = db.transaction('kv', 'readwrite');
  if (value === undefined) tx.objectStore('kv').delete(key);
  else tx.objectStore('kv').put(value, key);
  return done(tx);
}
