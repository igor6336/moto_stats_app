// Story-sized ride card (1080x1920 PNG): route in speed-zone colours and
// the main numbers, to share to Telegram, Instagram or Photos.
import { zoneColor, APPROX_COLOR } from './map.js';
import { currentPalette } from './palettes.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration } from './format.js';
import { icon } from './icons.js';

const W = 1080, H = 1920;
const DISPLAY = "'Unbounded', 'Manrope', sans-serif", TEXT = "'Manrope', sans-serif";

function project(points, box) {
  const lat0 = points.reduce((a, p) => a + p[0], 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[1] * k), ys = points.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(box.w / (maxX - minX || 1e-9), box.h / (maxY - minY || 1e-9));
  const ox = box.x + (box.w - (maxX - minX) * scale) / 2, oy = box.y + (box.h - (maxY - minY) * scale) / 2;
  return (p) => [(p[1] * k - minX) * scale + ox, (-p[0] - minY) * scale + oy];
}

// ride, summary, route runs (routeByZone), records (rideRecords), me (profile or null)
export async function rideCard({ ride, s, runs, records = [], me = null }) {
  await Promise.all([
    document.fonts.load(`800 80px ${DISPLAY}`, 'Дистанция 0123456789'),
    document.fonts.load(`700 40px ${TEXT}`, 'Дистанция 0123456789'),
  ]).catch(() => {});
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const stops = currentPalette().stops.dark;

  // Background: near black with a glow in the palette colour.
  g.fillStyle = '#07090c';
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 260, 0, W / 2, 260, 900);
  glow.addColorStop(0, `${stops[3]}55`);
  glow.addColorStop(1, `${stops[3]}00`);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Header.
  g.fillStyle = '#8b95a7';
  g.font = `800 30px ${TEXT}`;
  g.fillText('МОТО ТЕЛЕМЕТРИЯ', 80, 130);
  g.fillStyle = '#f3f5f8';
  g.font = `800 64px ${DISPLAY}`;
  g.fillText(new Date(ride.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', ''), 80, 215);
  if (me?.name) {
    g.fillStyle = '#8b95a7';
    g.font = `700 36px ${TEXT}`;
    g.fillText([me.name, me.bike].filter(Boolean).join(' · '), 80, 275);
  }

  // Route.
  const pts = runs.flatMap((r) => r.coords);
  if (pts.length > 1) {
    const box = { x: 100, y: 340, w: W - 200, h: 760 };
    const xy = project(pts, box);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Glow: the whole route as one path, so overlapping run ends do not
    // add up into beads.
    g.beginPath();
    runs.forEach((r) => r.coords.forEach((p, i) => { const [x, y] = xy(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }));
    g.strokeStyle = `${stops[3]}59`; g.lineWidth = 30; g.stroke();
    for (const r of runs) {
      g.beginPath();
      r.coords.forEach((p, i) => { const [x, y] = xy(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.setLineDash(r.approx ? [18, 18] : []);
      g.strokeStyle = r.approx ? APPROX_COLOR : zoneColor(r.zone);
      g.lineWidth = 10;
      g.stroke();
    }
    g.setLineDash([]);
    for (const [p, col] of [[pts[0], '#3fd28b'], [pts[pts.length - 1], '#ff4d4d']]) {
      const [x, y] = xy(p);
      g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2);
      g.fillStyle = col; g.fill();
      g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
    }
  }

  // Numbers: 2 columns x 3 rows.
  const u = speedUnit();
  const lean = [s.leanLeft, s.leanRight].map((v) => (Number.isFinite(v) ? `${Math.round(v)}°` : '—'));
  const cells = [
    ['Дистанция', fmtDistance(s.distance)],
    ['Время', fmtDuration(s.duration)],
    ['Макс. скорость', `${fmtSpeed(s.maxSpeed)} ${u}`],
    ['Средняя', `${fmtSpeed(s.avgMovingSpeed)} ${u}`],
    ['0–100', s.accel?.['0-100'] ? `${s.accel['0-100'].toFixed(2)} с` : '—'],
    ['Наклон Л / П', `${lean[0]} / ${lean[1]}`],
  ];
  const top = records.length ? 1160 : 1210;
  cells.forEach(([label, value], i) => {
    const x = 80 + (i % 2) * 470, y = top + Math.floor(i / 2) * 175;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(g, x, y, 440, 150, 32); g.fill();
    g.fillStyle = '#8b95a7'; g.font = `700 30px ${TEXT}`;
    g.fillText(label, x + 34, y + 52);
    g.fillStyle = '#f3f5f8'; g.font = `800 52px ${DISPLAY}`;
    g.fillText(value, x + 34, y + 118, 380);
  });

  // Records, if the ride holds any.
  if (records.length) {
    g.fillStyle = '#f5a623'; g.font = `800 34px ${TEXT}`;
    const text = `★ ${records.length > 1 ? 'Личные рекорды' : 'Личный рекорд'}: ${records.map((r) => r.metric.label.toLowerCase()).join(', ')}`;
    wrap(g, text, W - 160).slice(0, 2).forEach((line, i) => g.fillText(line, 80, top + 3 * 175 + 40 + i * 46));
  }

  // Footer: the speed-gauge arc in the palette.
  const fy = H - 70;
  const arc = g.createLinearGradient(80, 0, 200, 0);
  stops.forEach((col, i) => arc.addColorStop(i / (stops.length - 1), col));
  g.strokeStyle = arc; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.arc(120, fy, 34, Math.PI * 0.75, Math.PI * 2.0); g.stroke();
  g.fillStyle = '#5b6474'; g.font = `700 30px ${TEXT}`;
  g.fillText('записано в Мото телеметрии', 180, fy + 12);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

function wrap(g, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Preview with a share button (the share sheet needs a fresh tap).
export function openSharePreview(blob, name) {
  const url = URL.createObjectURL(blob);
  const o = document.createElement('div');
  o.className = 'share-view';
  o.innerHTML = `<img src="${url}" alt="Карточка поездки">
    <div class="share-actions">
      <button class="btn ghost" data-close>${icon('x')}Закрыть</button>
      <button class="btn primary" data-share>${icon('share')}Поделиться</button>
    </div>`;
  const close = () => { o.remove(); URL.revokeObjectURL(url); };
  o.querySelector('[data-close]').addEventListener('click', close);
  o.querySelector('[data-share]').addEventListener('click', async () => {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
    }
  });
  document.getElementById('overlay-root').append(o);
  return close;
}
