// Story-sized ride card (1080x1920 PNG): route in speed-zone colours and
// the main numbers, to share to Telegram, Instagram or Photos.
import { zoneColor, APPROX_COLOR } from './map.js';
import { currentPalette } from './palettes.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration } from './format.js';
import { icon } from './icons.js';
import { YANDEX_STATIC_KEY } from './config.js';

const W = 1080, H = 1920;
const DISPLAY = "'Unbounded', 'Manrope', sans-serif", TEXT = "'Manrope', sans-serif";

// Yandex maps use the ellipsoidal Mercator (EPSG:3395), not Web Mercator:
// with the wrong one the route drifts off the roads at Moscow latitudes.
const E = 0.0818191908426;
const SCALE = 2; // Static API scale: zooms the content 2x, so labels stay readable on the card
const worldPx = (z) => 256 * SCALE * 2 ** z;
const projX = (lon, z) => ((lon + 180) / 360) * worldPx(z);
const projY = (lat, z) => {
  const f = (lat * Math.PI) / 180, es = E * Math.sin(f);
  const y = Math.log(Math.tan(Math.PI / 4 + f / 2) * ((1 - es) / (1 + es)) ** (E / 2));
  return (0.5 - y / (2 * Math.PI)) * worldPx(z);
};

function loadImage(src, ms = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => resolve(null), ms);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = src;
  });
}

// Inverse of projY: latitude for a pixel row (iterative, converges fast).
function unprojY(py, z) {
  const t = Math.exp(-(0.5 - py / worldPx(z)) * 2 * Math.PI);
  let f = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 6; i++) {
    const es = E * Math.sin(f);
    f = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (E / 2));
  }
  return (f * 180) / Math.PI;
}
const unprojX = (px, z) => (px / worldPx(z)) * 360 - 180;

// Dark Yandex map (Static API) with the route fitted in the panel; returns
// the projection. Without network or a key the panel stays plain.
//
// One image is at most 650x450, so the panel is four overlapping ones. In
// the order drawn, each later image covers the logo strip at the bottom of
// an earlier one; the Yandex logo and copyright of the last image stay
// visible in the bottom right corner, as the terms require.
const PIECE = [650, 450];
async function drawMap(g, panel, pts) {
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  const pad = 150;
  let z = 18;
  for (; z > 3; z--) {
    const w = projX(Math.max(...lons), z) - projX(Math.min(...lons), z);
    const h = projY(Math.min(...lats), z) - projY(Math.max(...lats), z);
    if (w <= panel.w - 2 * pad && h <= panel.h - 2 * pad) break;
  }
  const cx = (projX(Math.max(...lons), z) + projX(Math.min(...lons), z)) / 2;
  const cy = (projY(Math.max(...lats), z) + projY(Math.min(...lats), z)) / 2;
  // World pixel of the panel's top-left corner.
  const wx0 = cx - panel.w / 2, wy0 = cy - panel.h / 2;
  const xy = (p) => [panel.x + projX(p[1], z) - wx0, panel.y + projY(p[0], z) - wy0];

  const [pw, ph] = PIECE;
  const pieces = [[0, 0], [panel.w - pw, 0], [0, panel.h - ph], [panel.w - pw, panel.h - ph]];
  const imgs = YANDEX_STATIC_KEY ? await Promise.all(pieces.map(([dx, dy]) => {
    const lon = unprojX(wx0 + dx + pw / 2, z), lat = unprojY(wy0 + dy + ph / 2, z);
    return loadImage(`https://static-maps.yandex.ru/v1?ll=${lon.toFixed(6)},${lat.toFixed(6)}&z=${z}`
      + `&size=${pw},${ph}&scale=${SCALE}&theme=dark&lang=ru_RU&apikey=${YANDEX_STATIC_KEY}`);
  })) : [];
  g.save();
  roundRect(g, panel.x, panel.y, panel.w, panel.h, 26);
  g.clip();
  g.fillStyle = '#0e1116';
  g.fillRect(panel.x, panel.y, panel.w, panel.h);
  // All four or none: a partial map would show a hole or a stray logo.
  if (imgs.length && imgs.every(Boolean)) {
    imgs.forEach((img, i) => g.drawImage(img, panel.x + pieces[i][0], panel.y + pieces[i][1], pw, ph));
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2;
  roundRect(g, panel.x, panel.y, panel.w, panel.h, 26); g.stroke();
  return xy;
}

// A label in a dark pill above (or else below) a point, skipping places
// already taken by other labels.
function pill(g, x, y, text, color, taken) {
  g.font = `800 30px ${TEXT}`;
  const w = g.measureText(text).width + 36, h = 50;
  const px = Math.round(x - w / 2);
  const free = (py) => !taken.some((r) => px < r.x + r.w && px + w > r.x && py < r.y + r.h && py + h > r.y);
  const py = [Math.round(y - h - 26), Math.round(y + 26)].find(free);
  if (py === undefined) return;
  taken.push({ x: px, y: py, w, h });
  g.fillStyle = 'rgba(7,9,12,.88)';
  roundRect(g, px, py, w, h, 25); g.fill();
  g.strokeStyle = color; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#f3f5f8';
  g.fillText(text, px + 18, py + 35);
}

// ride, summary, route runs (routeByZone), maxPos ([lat, lon] of the max
// speed or null), me (profile or null)
export async function rideCard({ ride, s, runs, maxPos = null, me = null }) {
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
  const glow = g.createRadialGradient(W / 2, 200, 0, W / 2, 200, 900);
  glow.addColorStop(0, `${stops[3]}55`);
  glow.addColorStop(1, `${stops[3]}00`);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Header.
  g.fillStyle = '#8b95a7';
  g.font = `800 30px ${TEXT}`;
  g.fillText('MotoHrust', 80, 120);
  g.fillStyle = '#f3f5f8';
  g.font = `800 64px ${DISPLAY}`;
  g.fillText(new Date(ride.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', ''), 80, 205);
  if (me?.name) {
    g.fillStyle = '#8b95a7';
    g.font = `700 36px ${TEXT}`;
    g.fillText([me.name, me.bike].filter(Boolean).join(' · '), 80, 262);
  }

  // Route on the map.
  const pts = runs.flatMap((r) => r.coords);
  if (pts.length > 1) {
    const xy = await drawMap(g, { x: 60, y: 310, w: W - 120, h: 860 }, pts);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Dark outline under the whole route keeps it readable over the map.
    g.beginPath();
    runs.forEach((r) => r.coords.forEach((p, i) => { const [x, y] = xy(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }));
    g.strokeStyle = 'rgba(7,9,12,.85)'; g.lineWidth = 20; g.stroke();
    for (const r of runs) {
      g.beginPath();
      r.coords.forEach((p, i) => { const [x, y] = xy(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.setLineDash(r.approx ? [18, 18] : []);
      g.strokeStyle = r.approx ? APPROX_COLOR : zoneColor(r.zone);
      g.lineWidth = 10;
      g.stroke();
    }
    g.setLineDash([]);
    const dot = (p, col, r = 18) => {
      const [x, y] = xy(p);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = col; g.fill();
      g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
      return [x, y];
    };
    const start = dot(pts[0], '#3fd28b'), finish = dot(pts[pts.length - 1], '#ff4d4d');
    const m = maxPos && s.maxSpeed > 0 ? dot(maxPos, stops[3], 14) : null;
    const taken = [];
    if (m) pill(g, ...m, `${fmtSpeed(s.maxSpeed)} ${speedUnit()}`, stops[3], taken);
    pill(g, ...start, 'Старт', '#3fd28b', taken);
    if (Math.hypot(finish[0] - start[0], finish[1] - start[1]) > 60) pill(g, ...finish, 'Финиш', '#ff4d4d', taken);
  }

  // Numbers: 2 columns x 3 rows.
  const u = speedUnit();
  const deg = (v) => (Number.isFinite(v) ? `${Math.round(v)}°` : '—');
  const cells = [
    ['Дистанция', fmtDistance(s.distance)],
    ['Время', fmtDuration(s.duration)],
    ['Средняя', `${fmtSpeed(s.avgMovingSpeed)} ${u}`],
    ['Максимальная', `${fmtSpeed(s.maxSpeed)} ${u}`],
    ['Наклон влево', deg(s.leanLeft)],
    ['Наклон вправо', deg(s.leanRight)],
  ];
  const top = 1230;
  cells.forEach(([label, value], i) => {
    const x = 60 + (i % 2) * 490, y = top + Math.floor(i / 2) * 175;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(g, x, y, 470, 150, 32); g.fill();
    g.fillStyle = '#8b95a7'; g.font = `700 30px ${TEXT}`;
    g.fillText(label, x + 34, y + 52);
    g.fillStyle = '#f3f5f8'; g.font = `800 52px ${DISPLAY}`;
    g.fillText(value, x + 34, y + 118, 400);
  });

  // Footer: the speed-gauge arc in the palette.
  const fy = H - 80;
  const arc = g.createLinearGradient(80, 0, 200, 0);
  stops.forEach((col, i) => arc.addColorStop(i / (stops.length - 1), col));
  g.strokeStyle = arc; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.arc(120, fy, 34, Math.PI * 0.75, Math.PI * 2.0); g.stroke();
  g.fillStyle = '#5b6474'; g.font = `700 30px ${TEXT}`;
  g.fillText('записано в MotoHrust', 180, fy + 12);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
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
