// Sensor capture and ride recording. Raw rows are buffered and flushed to
// IndexedDB every few seconds, so a crash or a killed page loses at most
// one chunk.
import { computeSummary } from './algo/stats.js';
import { haversine } from './algo/geo.js';
import { computeCalibration, angleBetween } from './algo/calibration.js';
import { createRateTracker, trackSample, rateSummary } from './algo/quality.js';
import { putRide, writeChunk, listRides, getGpsData, kvGet, kvSet } from './storage.js';
import { enableWakeLock } from './wakelock.js';
import { getSettings } from './settings.js';
import { APP_VERSION } from './version.js';

const FLUSH_MS = 5000;
const STALE_MS = 3000;

const r = (v, k) => (Number.isFinite(v) ? Math.round(v * 10 ** k) / 10 ** k : null);
const nowAbs = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// DeviceMotion timeStamp is relative to timeOrigin in current browsers,
// but some older engines report epoch time.
const eventAbs = (e) => (e.timeStamp > 1e12 ? e.timeStamp : performance.timeOrigin + e.timeStamp);

const emptyBuffers = () => ({ gps: [], motion: [], orient: [], events: [] });

class Recorder extends EventTarget {
  constructor() {
    super();
    this.state = 'idle'; // idle | ready | recording | stopping
    this.status = { motion: 'off', orient: 'off', gps: 'off', permission: null, gpsError: null, storageError: null };
    this.motionHz = 0;
    this.orientHz = 0;
    this.lastFix = null;
    this.gravity = null;      // low-pass gravity vector, phone frame
    this.calibration = null;  // latest calibration (pending or in-ride)
    this.calib = null;        // calibration capture in progress
    this.ride = null;
    this.base = 0;            // abs time that row timestamps are relative to
    this.liveGps = [];
    this.live = null;         // live summary
    this.buf = emptyBuffers();
    this.seq = 0;
    this.flushChain = Promise.resolve();
    this.counters = { motion: 0, orient: 0, lastMotion: 0 };

    this.onMotion = this.onMotion.bind(this);
    this.onOrient = this.onOrient.bind(this);
    this.onPosition = this.onPosition.bind(this);
    this.onPositionError = this.onPositionError.bind(this);

    document.addEventListener('visibilitychange', () => {
      if (this.state !== 'recording') return;
      this.logEvent('visibility', document.visibilityState);
      if (document.visibilityState === 'hidden') this.flush();
    });
    window.addEventListener('pagehide', () => { if (this.state === 'recording') this.flush(); });
    setInterval(() => this.tick(), 1000);
  }

  emit(type) { this.dispatchEvent(new Event(type)); }

  get recording() { return this.state === 'recording'; }

  // Must be called synchronously inside a tap handler: iOS only shows the
  // motion permission prompt for a user gesture.
  prepare() {
    if (this.state !== 'idle') return Promise.resolve();
    const asks = [];
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      asks.push(DeviceMotionEvent.requestPermission());
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      asks.push(DeviceOrientationEvent.requestPermission());
    }
    this.startGps();
    enableWakeLock();
    navigator.storage?.persist?.().catch(() => {});
    return Promise.allSettled(asks).then((res) => {
      const denied = res.some((x) => x.status === 'rejected' || x.value !== 'granted');
      this.status.permission = asks.length ? (denied ? 'denied' : 'granted') : 'not-required';
      window.addEventListener('devicemotion', this.onMotion);
      window.addEventListener('deviceorientation', this.onOrient);
      this.status.motion = 'waiting';
      this.status.orient = 'waiting';
      this.state = 'ready';
      this.emit('change');
    });
  }

  startGps() {
    if (!('geolocation' in navigator)) { this.status.gps = 'unsupported'; return; }
    this.status.gps = 'waiting';
    this.gpsWatch = navigator.geolocation.watchPosition(this.onPosition, this.onPositionError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
    });
  }

  onMotion(e) {
    const abs = eventAbs(e);
    this.counters.motion++;
    this.counters.lastMotion = abs;
    const a = e.acceleration, g = e.accelerationIncludingGravity, rr = e.rotationRate;
    if (g && Number.isFinite(g.x)) {
      const v = [g.x, g.y, g.z];
      this.gravity = this.gravity ? this.gravity.map((p, i) => p + 0.05 * (v[i] - p)) : v;
    }
    const row = [
      r(abs - this.base, 1),
      r(a?.x, 4), r(a?.y, 4), r(a?.z, 4),
      r(g?.x, 4), r(g?.y, 4), r(g?.z, 4),
      r(rr?.alpha, 3), r(rr?.beta, 3), r(rr?.gamma, 3),
      r(e.interval, 5), // iOS reports seconds (0.01667), not ms
    ];
    if (this.state === 'recording') {
      this.buf.motion.push(row);
      trackSample(this.q.motion, row[0]);
    }
    if (this.calib) this.calib.motion.push(row);
  }

  onOrient(e) {
    this.counters.orient++;
    const row = [r(eventAbs(e) - this.base, 1), r(e.alpha, 3), r(e.beta, 3), r(e.gamma, 3)];
    if (this.state === 'recording') {
      this.buf.orient.push(row);
      trackSample(this.q.orient, row[0]);
    }
    if (this.calib) this.calib.orient.push(row);
  }

  onPosition(p) {
    const abs = nowAbs();
    const c = p.coords;
    const speed = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null;
    const heading = Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null;
    // Display only: when Doppler speed is missing (iOS reports -1 when it
    // cannot measure it, e.g. standing still), estimate it from the previous
    // fix. A shift smaller than the fix accuracy is jitter, not movement,
    // so it shows 0. Raw rows keep null.
    let shown = speed;
    const prev = this.lastFix;
    if (shown === null) {
      shown = 0;
      const dt = prev ? (p.timestamp - prev.ts) / 1000 : 0;
      if (dt > 0.2 && dt < 5) {
        const d = haversine(prev.lat, prev.lon, c.latitude, c.longitude);
        if (d > Math.max(c.accuracy, prev.accuracy)) shown = d / dt;
      }
    }
    this.status.gps = 'ok';
    this.status.gpsError = null;
    this.lastFix = { at: abs, ts: p.timestamp, lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, speed: shown };
    if (this.state === 'recording') {
      const row = [
        r(abs - this.base, 1), r(p.timestamp - this.base, 1),
        r(c.latitude, 7), r(c.longitude, 7), r(c.accuracy, 1),
        r(c.altitude, 1), r(c.altitudeAccuracy, 1),
        r(speed, 2), r(heading, 1),
      ];
      this.buf.gps.push(row);
      this.liveGps.push(row);
      trackSample(this.q.gps, row[0]);
      this.live = computeSummary(this.liveGps, { zones: getSettings().zones });
    }
    this.emit('gps');
  }

  onPositionError(err) {
    const kind = { 1: 'denied', 2: 'unavailable', 3: 'timeout' }[err.code] || 'error';
    // Errors can alternate with fixes every second; log each kind at most every 10 s.
    const now = nowAbs(), last = this.gpsErrLog;
    if (!last || last.kind !== kind || now - last.at > 10000) {
      this.logEvent('gps-error', kind);
      this.gpsErrLog = { kind, at: now };
    }
    this.status.gpsError = kind;
    if (kind === 'denied') this.status.gps = 'denied';
    this.emit('gps');
  }

  tick() {
    if (this.state === 'idle') return;
    this.motionHz = this.counters.motion;
    this.orientHz = this.counters.orient;
    this.counters.motion = 0;
    this.counters.orient = 0;
    const now = nowAbs();
    if (this.status.motion !== 'off') {
      this.status.motion = this.motionHz > 0 ? 'ok' : now - this.counters.lastMotion > STALE_MS ? 'none' : this.status.motion;
    }
    if (this.status.orient !== 'off') this.status.orient = this.orientHz > 0 ? 'ok' : 'none';
    this.emit('tick');
  }

  gpsFresh() {
    return this.lastFix && nowAbs() - this.lastFix.at < STALE_MS;
  }

  // Angle between the current gravity vector and the calibrated one: a quick
  // sanity check that does not depend on axis sign conventions.
  deviation() {
    if (!this.gravity || !this.calibration?.gravity) return NaN;
    return angleBetween(this.gravity, this.calibration.gravity);
  }

  logEvent(type, data = null) {
    if (this.state !== 'recording' && this.state !== 'stopping') return;
    this.buf.events.push([r(nowAbs() - this.base, 1), type, data]);
  }

  async start() {
    if (this.state !== 'ready') throw new Error('sensors not ready');
    const startedAt = Math.round(nowAbs());
    const pending = await kvGet('pendingCalibration');
    this.ride = {
      id: `ride-${startedAt}`,
      schema: 1,
      appVersion: APP_VERSION,
      startedAt,
      endedAt: null,
      lastFlushAt: startedAt,
      status: 'recording',
      device: {
        ua: navigator.userAgent,
        platform: navigator.platform,
        screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
        standalone: isStandalone(),
        motionPermission: this.status.permission,
      },
      settings: { zones: [...getSettings().zones] },
      calibrations: pending ? [pending] : [],
      counts: { gps: 0, motion: 0, orient: 0, events: 0 },
      quality: null,
      chunks: 0,
      summary: null,
    };
    await kvSet('pendingCalibration', undefined);
    await putRide(this.ride);
    this.base = startedAt;
    this.buf = emptyBuffers();
    this.seq = 0;
    this.liveGps = [];
    this.live = null;
    this.q = { gps: createRateTracker(2000), motion: createRateTracker(100), orient: createRateTracker(100) };
    this.state = 'recording';
    this.logEvent('start', { calibrated: !!pending });
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    this.emit('change');
  }

  flush() {
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  async doFlush() {
    const ride = this.ride;
    if (!ride) return;
    const data = this.buf;
    if (!data.gps.length && !data.motion.length && !data.orient.length && !data.events.length) return;
    this.buf = emptyBuffers();
    const prevCounts = { ...ride.counts };
    ride.counts.gps += data.gps.length;
    ride.counts.motion += data.motion.length;
    ride.counts.orient += data.orient.length;
    ride.counts.events += data.events.length;
    ride.quality = { gps: rateSummary(this.q.gps), motion: rateSummary(this.q.motion), orient: rateSummary(this.q.orient) };
    ride.lastFlushAt = Math.round(nowAbs());
    ride.chunks = this.seq + 1;
    try {
      await writeChunk(ride, this.seq, data);
      this.seq++;
      this.status.storageError = null;
    } catch (e) {
      console.error('flush failed', e);
      // Put the rows back so the next flush retries them.
      ride.counts = prevCounts;
      for (const k of Object.keys(data)) this.buf[k] = data[k].concat(this.buf[k]);
      this.status.storageError = String(e?.message || e);
      this.emit('change');
    }
  }

  async stop() {
    if (this.state !== 'recording') return null;
    this.logEvent('stop');
    this.state = 'stopping';
    clearInterval(this.flushTimer);
    await this.flush();
    const ride = this.ride;
    ride.endedAt = Math.round(nowAbs());
    ride.status = 'done';
    ride.summary = computeSummary(this.liveGps, {
      zones: ride.settings.zones,
      durationS: (ride.endedAt - ride.startedAt) / 1000,
    });
    await putRide(ride);
    this.ride = null;
    this.base = 0;
    this.liveGps = [];
    this.live = null;
    this.state = 'ready';
    this.emit('change');
    return ride.id;
  }

  async calibrate(ms = 4000) {
    if (this.calib || this.state === 'idle') return null;
    const at = Math.round(nowAbs());
    this.calib = { motion: [], orient: [] };
    this.emit('change');
    await sleep(ms);
    const { motion, orient } = this.calib;
    this.calib = null;
    const record = {
      at, durationMs: ms, tBase: this.base,
      ...computeCalibration(motion, orient),
      motion, orient,
    };
    this.calibration = record;
    if (this.state === 'recording') {
      this.ride.calibrations.push(record);
      this.logEvent('calibration', { ok: record.ok });
    } else {
      await kvSet('pendingCalibration', record);
    }
    this.emit('change');
    return record;
  }

  async loadPendingCalibration() {
    const pending = await kvGet('pendingCalibration');
    if (pending) this.calibration = pending;
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export const recorder = new Recorder();

// Rides left in "recording" state by a crash or a killed page get a summary
// from whatever was flushed.
export async function recoverInterrupted() {
  const rides = await listRides();
  for (const ride of rides) {
    if (ride.status !== 'recording' || ride.id === recorder.ride?.id) continue;
    const { gps } = await getGpsData(ride.id);
    ride.endedAt = ride.lastFlushAt || ride.startedAt;
    ride.status = 'interrupted';
    ride.summary = computeSummary(gps, {
      zones: ride.settings?.zones || getSettings().zones,
      durationS: (ride.endedAt - ride.startedAt) / 1000,
    });
    await putRide(ride);
  }
}
