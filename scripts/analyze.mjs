#!/usr/bin/env node
// Offline analysis of an exported raw ride file, without a browser.
// Usage: node scripts/analyze.mjs moto-raw-YYYYMMDD-HHMM.json [--zones 30,60,90]
import { readFileSync } from 'node:fs';
import { computeSummary } from '../src/algo/stats.js';
import { rateFromTimes } from '../src/algo/quality.js';
import { RAW_FORMAT, M } from '../src/algo/schema.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/analyze.mjs <moto-raw.json> [--zones 30,60,90]');
  process.exit(1);
}
const zi = args.indexOf('--zones');
const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.format !== RAW_FORMAT) {
  console.error(`not a ${RAW_FORMAT} file`);
  process.exit(1);
}
const zones = zi >= 0 ? args[zi + 1].split(',').map(Number) : data.ride.settings?.zones || [30, 60, 90, 120, 150];
const ride = data.ride;
const durationS = ride.endedAt ? (ride.endedAt - ride.startedAt) / 1000 : undefined;
const s = computeSummary(data.gps, { zones, durationS });

const kmh = (v) => (v * 3.6).toFixed(1);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

console.log(`Ride ${ride.id}  ${new Date(ride.startedAt).toISOString()}  status=${ride.status}`);
console.log(`Device: ${ride.device?.ua}`);
console.log('');
console.log(`Distance        ${(s.distance / 1000).toFixed(3)} km`);
console.log(`Duration        ${mmss(s.duration)}  moving ${mmss(s.movingTime)}  stopped ${mmss(s.stoppedTime)}`);
console.log(`Max speed       ${kmh(s.maxSpeed)} km/h (raw peak ${kmh(s.maxSpeedRaw)})`);
console.log(`Avg moving      ${kmh(s.avgMovingSpeed)} km/h`);
console.log(`GPS gaps        ${s.gaps} (${mmss(s.gapTime)})`);
console.log('');
console.log('Zones (km/h)    time     distance');
for (const z of s.zones) {
  const name = z.to === null ? `${z.from}+` : `${z.from}-${z.to}`;
  console.log(`  ${name.padEnd(13)} ${mmss(z.time).padStart(6)}   ${(z.distance / 1000).toFixed(2)} km`);
}
console.log('');
const gpsQ = rateFromTimes(data.gps.map((r) => r[0]), 2000);
const motQ = rateFromTimes(data.motion.map((r) => r[M.t]), 100);
const oriQ = rateFromTimes(data.orient.map((r) => r[0]), 100);
console.log(`GPS     ${gpsQ.count} rows, ${gpsQ.hz.toFixed(2)} Hz, gaps>2s ${gpsQ.gaps}, max dt ${gpsQ.maxDtMs} ms`);
console.log(`Motion  ${motQ.count} rows, ${motQ.hz.toFixed(1)} Hz, gaps>100ms ${motQ.gaps}, max dt ${motQ.maxDtMs} ms`);
console.log(`Orient  ${oriQ.count} rows, ${oriQ.hz.toFixed(1)} Hz, gaps>100ms ${oriQ.gaps}, max dt ${oriQ.maxDtMs} ms`);
const accs = data.gps.map((r) => r[4]).filter(Number.isFinite).sort((a, b) => a - b);
if (accs.length) {
  console.log(`GPS accuracy    median ${accs[accs.length >> 1]} m, p95 ${accs[Math.floor(accs.length * 0.95)]} m`);
}
console.log(`Calibrations    ${(ride.calibrations || []).map((c) => `${c.ok ? 'ok' : 'noisy'} g=[${c.gravity.map((v) => v.toFixed(2))}]`).join('; ') || 'none'}`);
console.log('');
console.log('Events:');
for (const [t, type, d] of data.events) console.log(`  ${mmss(t / 1000).padStart(7)}  ${type}${d === null ? '' : ' ' + JSON.stringify(d)}`);
