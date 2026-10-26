// Zero-point calibration from a few seconds of the bike standing upright.
// Only stores the gravity vector in the phone frame; turning it into lean and
// pitch angles is stage 3, once the axis signs are confirmed on real data.
import { M, O } from './schema.js';

const DEG = 180 / Math.PI;

export function meanStd(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { mean: NaN, std: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, std };
}

export function computeCalibration(motionRows, orientRows = []) {
  const axes = [M.gx, M.gy, M.gz].map((k) => meanStd(motionRows.map((r) => r[k])));
  const gravity = axes.map((a) => a.mean);
  const noise = Math.hypot(...axes.map((a) => a.std));
  const norm = Math.hypot(...gravity);
  const beta = meanStd(orientRows.map((r) => r[O.beta]));
  const gamma = meanStd(orientRows.map((r) => r[O.gamma]));
  return {
    samples: motionRows.length,
    gravity,
    gravityNorm: norm,
    noise, // m/s2, combined std of the three axes
    beta: beta.mean, gamma: gamma.mean,
    // Gravity norm far from 9.81 or a noisy signal means the bike was moving
    // or the sensor data is not what we expect.
    ok: motionRows.length >= 20 && Math.abs(norm - 9.81) < 0.6 && noise < 0.35,
  };
}

export function angleBetween(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const n = Math.hypot(...a) * Math.hypot(...b);
  if (!n) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, dot / n))) * DEG;
}
