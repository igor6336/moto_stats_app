// Ride chart: speed over time with the best acceleration runs, the max
// speed and weak-GPS stretches marked, and lean below it. Drag across it to
// read values; onScrub(t) reports the time (null when released) so the map
// can follow.
import { currentPalette } from './palettes.js';
import { currentTheme } from './theme.js';

const SPEED_H = 150, GAP = 10, LEAN_H = 70, AXIS_H = 22, PAD_L = 4, PAD_R = 4;
const ACCEL_LABEL = { '0-100': '0–100', '100-200': '100–200', '0-200': '0–200' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// data: { segments: [[{t, v}]] speed in display units, approx: [[t0, t1]],
//   lean: { t0, dt, v } | null, accel: { id: { t0, t1, time } | null },
//   max: { t, v } | null, unit }
export function renderRideChart(box, data, { onScrub } = {}) {
  const W = Math.max(280, box.clientWidth || 340);
  const hasLean = !!data.lean?.v?.some((x) => x !== null);
  const H = SPEED_H + AXIS_H + (hasLean ? GAP + LEAN_H : 0);
  const pts = data.segments.flat();
  if (pts.length < 2) { box.innerHTML = ''; return () => {}; }
  const leanEnd = hasLean ? data.lean.t0 + data.lean.dt * (data.lean.v.length - 1) : 0;
  const tEnd = Math.max(pts[pts.length - 1].t, leanEnd, ...data.approx.map((a) => a[1]));
  const tStart = 0;
  const vMax = Math.max(10, ...pts.map((p) => p.v));
  const step = vMax > 200 ? 100 : vMax > 80 ? 50 : 20;
  const yTop = Math.ceil((vMax * 1.08) / step) * step;
  const x = (t) => PAD_L + ((t - tStart) / (tEnd - tStart || 1)) * (W - PAD_L - PAD_R);
  const y = (v) => 8 + (1 - v / yTop) * (SPEED_H - 8);
  const leanY0 = SPEED_H + AXIS_H + GAP + LEAN_H / 2;
  const LEAN_MAX = 50;
  const ly = (deg) => leanY0 - (Math.max(-LEAN_MAX, Math.min(LEAN_MAX, deg)) / LEAN_MAX) * (LEAN_H / 2);

  const stops = currentPalette().stops[currentTheme() === 'light' ? 'light' : 'dark'];
  const id = `c${Math.random().toString(36).slice(2, 8)}`;

  // Grid and axes.
  let grid = '';
  for (let v = step; v < yTop; v += step) {
    grid += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/>
      <text x="${PAD_L + 2}" y="${y(v) - 3}" class="ch-lbl">${v}</text>`;
  }
  const span = tEnd - tStart;
  const tStep = [60, 120, 300, 600, 900, 1800, 3600].find((s) => span / s <= 6) || 7200;
  let xt = '';
  for (let t = tStep; t < tEnd; t += tStep) {
    xt += `<line x1="${x(t)}" x2="${x(t)}" y1="8" y2="${SPEED_H}" class="ch-grid ch-v"/>
      <text x="${x(t)}" y="${SPEED_H + 16}" class="ch-lbl" text-anchor="middle">${Math.round(t / 60)} мин</text>`;
  }

  // Weak GPS: no speed is known there.
  const approx = data.approx.map(([a, b]) => `<rect x="${x(a)}" y="8" width="${Math.max(1, x(b) - x(a))}" height="${SPEED_H - 8}" fill="url(#${id}-hatch)"/>
    ${x(b) - x(a) > 60 ? `<text x="${(x(a) + x(b)) / 2}" y="${SPEED_H - 6}" class="ch-lbl" text-anchor="middle">слабый GPS</text>` : ''}`).join('');

  // Best acceleration runs: a light band and a bracket under the axis, one
  // row per run; the times are in the legend below the chart.
  const runs = Object.entries(data.accel || {}).filter(([, r]) => r);
  const runColor = (i) => stops[[2, 3, 4][i % 3]];
  const accel = runs.map(([, r], i) => {
    const x0 = x(r.t0), x1 = Math.max(x(r.t0) + 3, x(r.t1)), yb = SPEED_H + 3 + i * 4;
    return `<rect x="${x0}" y="8" width="${x1 - x0}" height="${SPEED_H - 8}" class="ch-run"/>
      <line x1="${x0}" x2="${x1}" y1="${yb}" y2="${yb}" stroke="${runColor(i)}" stroke-width="3" stroke-linecap="round"/>`;
  }).join('');
  const legend = runs.map(([k, r], i) => `<span><i style="background:${runColor(i)}"></i>${ACCEL_LABEL[k]} · ${r.time.toFixed(2)} с</span>`).join('');

  // Speed line and area, one path per continuous stretch.
  const line = data.segments.filter((s) => s.length > 1).map((s) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(''));
  const area = data.segments.filter((s) => s.length > 1).map((s) => `M${x(s[0].t).toFixed(1)} ${y(0)}${s.map((p) => `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')}L${x(s[s.length - 1].t).toFixed(1)} ${y(0)}Z`);
  const maxMark = data.max ? `<circle cx="${x(data.max.t)}" cy="${y(data.max.v)}" r="4.5" class="ch-max"/>
    <text x="${Math.min(W - 30, Math.max(18, x(data.max.t)))}" y="${y(data.max.v) - 9}" text-anchor="middle" class="ch-max-t">${Math.round(data.max.v)}</text>` : '';

  // Lean: right up, left down.
  let lean = '';
  if (hasLean) {
    const { t0, dt } = data.lean;
    // Shown smoothed over ~1.5 s, like the hold behind lean records.
    const v = data.lean.v.map((d, i, a) => {
      if (d === null) return null;
      const w = [a[i - 1], d, a[i + 1]].filter((q) => q !== null && q !== undefined);
      return w.reduce((s2, q) => s2 + q, 0) / w.length;
    });
    const parts = { r: '', l: '' };
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const top = run.map(([t, d], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${ly(Math.max(0, d)).toFixed(1)}`).join('');
        const bot = run.map(([t, d], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${ly(Math.min(0, d)).toFixed(1)}`).join('');
        parts.r += `${top}L${x(run[run.length - 1][0]).toFixed(1)} ${leanY0}L${x(run[0][0]).toFixed(1)} ${leanY0}Z`;
        parts.l += `${bot}L${x(run[run.length - 1][0]).toFixed(1)} ${leanY0}L${x(run[0][0]).toFixed(1)} ${leanY0}Z`;
      }
      run = [];
    };
    v.forEach((d, i) => { if (d === null) flush(); else run.push([t0 + i * dt, d]); });
    flush();
    lean = `<text x="${PAD_L + 2}" y="${leanY0 - LEAN_H / 2 + 9}" class="ch-lbl">вправо</text>
      <text x="${PAD_L + 2}" y="${leanY0 + LEAN_H / 2 - 2}" class="ch-lbl">влево</text>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${ly(30)}" y2="${ly(30)}" class="ch-grid ch-dash"/>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${ly(-30)}" y2="${ly(-30)}" class="ch-grid ch-dash"/>
      <text x="${W - PAD_R - 2}" y="${ly(30) - 3}" text-anchor="end" class="ch-lbl">30°</text>
      <text x="${W - PAD_R - 2}" y="${ly(-30) + 10}" text-anchor="end" class="ch-lbl">30°</text>
      <path d="${parts.r}" fill="${stops[3]}" opacity=".85"/><path d="${parts.l}" fill="${stops[2]}" opacity=".85"/>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${leanY0}" y2="${leanY0}" class="ch-axis"/>`;
  }

  box.innerHTML = `<div class="chart">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs>
        <linearGradient id="${id}-g" gradientUnits="userSpaceOnUse" x1="0" y1="${y(0)}" x2="0" y2="${y(yTop)}">
          ${stops.map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`).join('')}
        </linearGradient>
        <linearGradient id="${id}-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${stops[3]}" stop-opacity=".35"/><stop offset="1" stop-color="${stops[3]}" stop-opacity="0"/>
        </linearGradient>
        <pattern id="${id}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" class="ch-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="ch-hatch"/>
        </pattern>
      </defs>
      ${approx}${grid}${xt}${accel}
      <path d="${area.join('')}" fill="url(#${id}-a)"/>
      <path d="${line.join('')}" fill="none" stroke="url(#${id}-g)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(0)}" y2="${y(0)}" class="ch-axis"/>
      ${maxMark}${lean}
      <g class="ch-cursor" style="display:none"><line y1="8" y2="${H - (hasLean ? 0 : AXIS_H)}"/><circle r="4"/></g>
    </svg>
    <div class="ch-tip" hidden></div>
    ${legend ? `<div class="ch-legend">${legend}</div>` : ''}
  </div>`;

  // Scrubbing.
  const svg = box.querySelector('svg');
  const cursor = box.querySelector('.ch-cursor');
  const tip = box.querySelector('.ch-tip');
  const speedAt = (t) => {
    let best = null, bestDt = 3;
    for (const p of pts) { const d = Math.abs(p.t - t); if (d < bestDt) { bestDt = d; best = p; } }
    return best;
  };
  const leanAt = (t) => {
    if (!hasLean) return null;
    const i = Math.round((t - data.lean.t0) / data.lean.dt);
    return data.lean.v[i] ?? null;
  };
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const px = Math.max(PAD_L, Math.min(W - PAD_R, ((e.clientX - r.left) / r.width) * W));
    const t = tStart + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (tEnd - tStart);
    const p = speedAt(t), l = leanAt(t);
    cursor.style.display = '';
    cursor.querySelector('line').setAttribute('x1', px);
    cursor.querySelector('line').setAttribute('x2', px);
    const dot = cursor.querySelector('circle');
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', p ? y(p.v) : -10);
    tip.hidden = false;
    tip.innerHTML = `<b>${mmss(t)}</b> · ${p ? `${Math.round(p.v)} ${esc(data.unit)}` : 'нет скорости'}${l !== null ? ` · ${Math.abs(l)}° ${l >= 0 ? 'вправо' : 'влево'}` : ''}`;
    const left = (px / W) * r.width;
    tip.style.left = `${Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2))}px`;
    onScrub?.(t);
  };
  const hide = () => { cursor.style.display = 'none'; tip.hidden = true; onScrub?.(null); };
  svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); show(e); });
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') show(e); });
  svg.addEventListener('pointerup', hide);
  svg.addEventListener('pointercancel', hide);
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  return () => {};
}
