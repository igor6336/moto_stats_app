// Maps. Yandex Maps (JS API v3) first; Leaflet with OpenStreetMap tiles if
// Yandex is unavailable (no key, network, daily limit); an SVG polyline when
// offline, so a ride route is always visible.
// Both engines sit behind the same small adapter:
//   addLine(coords, color, dashed), addMarker(lat, lon, html, onClick) -> {update, remove},
//   fit(points), setView(lat, lon, zoom), destroy()
// Coordinates are [lat, lon] everywhere in the app; Yandex wants [lon, lat].
import { YANDEX_MAPS_KEY } from './config.js';
import { viewForPoints } from './algo/geo.js';
import { currentTheme } from './theme.js';
import { currentPalette } from './palettes.js';

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
const LOAD_TIMEOUT_MS = 8000;
let leafletPromise = null;
let yandexPromise = null;

const START_HTML = '<div class="rmark start"><i></i><span>Старт</span></div>';
const FINISH_HTML = '<div class="rmark finish"><i></i><span>Финиш</span></div>';

const CURSOR_HTML = '<div class="cmark"></div>';

export const ZONE_COLORS = ['#4aa3ff', '#3fd28b', '#c6e04a', '#ffc93d', '#ff8a3d', '#ff4d4d', '#e04ad6', '#a46bff'];
export const zoneColor = (i) => ZONE_COLORS[i % ZONE_COLORS.length];
// Approximate part of a route (coarse fixes under GPS jamming): grey dashes.
export const APPROX_COLOR = '#9aa3b5';
const runColor = (r) => (r.approx ? APPROX_COLOR : zoneColor(r.zone));

function withTimeout(promise, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timeout`)), LOAD_TIMEOUT_MS)),
  ]);
}

function loadScript(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    if (crossOrigin) s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(s);
  });
}

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${LEAFLET}leaflet.css`;
    css.crossOrigin = 'anonymous';
    document.head.append(css);
    leafletPromise = withTimeout(loadScript(`${LEAFLET}leaflet.js`, true), 'leaflet')
      .then(() => window.L)
      .catch((e) => { leafletPromise = null; throw e; });
  }
  return leafletPromise;
}

// Loaded once per app start: the free Yandex plan counts API loads per day.
function loadYandex() {
  if (!YANDEX_MAPS_KEY) return Promise.reject(new Error('no yandex key'));
  if (!yandexPromise) {
    yandexPromise = withTimeout(
      loadScript(`https://api-maps.yandex.ru/v3/?apikey=${YANDEX_MAPS_KEY}&lang=ru_RU`)
        .then(() => window.ymaps3.ready)
        .then(() => window.ymaps3),
      'yandex',
    ).catch((e) => {
      // Do not retry in this session: a bad key or exhausted limit stays bad.
      console.warn('yandex maps unavailable, using OpenStreetMap', e);
      throw e;
    });
  }
  return yandexPromise;
}

function yandexAdapter(ym, container, center, zoom) {
  const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapFeature, YMapMarker } = ym;
  const ll = ([lat, lon]) => [lon, lat];
  const theme = currentTheme();
  const map = new YMap(container, { location: { center: ll(center), zoom }, theme });
  map.addChild(new YMapDefaultSchemeLayer({ theme }));
  map.addChild(new YMapDefaultFeaturesLayer());
  return {
    kind: 'yandex',
    addLine(coords, color, dashed) {
      map.addChild(new YMapFeature({
        geometry: { type: 'LineString', coordinates: coords.map(ll) },
        style: { stroke: [{ color, width: 4, ...(dashed ? { dash: [6, 6] } : {}) }] },
      }));
    },
    addMarker(lat, lon, html, onClick) {
      // Yandex puts the element's top-left corner at the point; the inner
      // wrapper centres the marker like Leaflet's iconAnchor.
      const el = document.createElement('div');
      el.className = 'ymark';
      el.innerHTML = html;
      if (onClick) el.addEventListener('click', onClick);
      const marker = new YMapMarker({ coordinates: [lon, lat] }, el);
      map.addChild(marker);
      return {
        update(lat2, lon2, html2) {
          marker.update({ coordinates: [lon2, lat2] });
          if (html2 !== undefined) el.innerHTML = html2;
        },
        remove() { map.removeChild(marker); },
      };
    },
    fit(points, padding = 32) {
      const v = viewForPoints(points, container.clientWidth, container.clientHeight, padding, 15);
      map.update({ location: { center: ll(v.center), zoom: v.zoom } });
    },
    setView(lat, lon, z) { map.update({ location: { center: [lon, lat], zoom: z, duration: 300 } }); },
    destroy() { map.destroy(); },
  };
}

function leafletAdapter(L, container, center, zoom) {
  // No animations and the SVG renderer: removing a map mid-animation or
  // with a canvas redraw pending (leaving the screen) throws inside Leaflet.
  const map = L.map(container, {
    zoomControl: false, attributionControl: true,
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
  }).setView(center, zoom);
  // Leaflet's default prefix (a link with a flag) is not required; the
  // OpenStreetMap credit is, so it stays.
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const icon = (html) => L.divIcon({ className: '', html: `<div class="ymark">${html}</div>`, iconSize: [0, 0] });
  return {
    kind: 'osm',
    addLine(coords, color, dashed) { L.polyline(coords, { color, weight: 4, opacity: 0.95, dashArray: dashed ? '6 8' : null }).addTo(map); },
    addMarker(lat, lon, html, onClick) {
      const m = L.marker([lat, lon], { icon: icon(html) }).addTo(map);
      if (onClick) m.on('click', onClick);
      return {
        update(lat2, lon2, html2) {
          m.setLatLng([lat2, lon2]);
          if (html2 !== undefined) m.setIcon(icon(html2));
        },
        remove() { m.remove(); },
      };
    },
    fit(points, padding = 32) {
      if (points.length === 1) map.setView(points[0], 15);
      else map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom: 15 });
    },
    setView(lat, lon, z) { map.setView([lat, lon], z); },
    destroy() { map.remove(); },
  };
}

// Creates an interactive map in the container, Yandex if possible.
export async function createMap(container, { center = [55.75, 37.62], zoom = 10 } = {}) {
  try {
    const ym = await loadYandex();
    container.innerHTML = '';
    return yandexAdapter(ym, container, center, zoom);
  } catch {
    const L = await loadLeaflet();
    container.innerHTML = '';
    return leafletAdapter(L, container, center, zoom);
  }
}

export async function drawRoute(container, runs) {
  const all = runs.flatMap((r) => r.coords);
  if (all.length < 2) {
    container.innerHTML = '<div class="map-empty">Нет точек маршрута</div>';
    return () => {};
  }
  try {
    const map = await createMap(container, { center: all[0], zoom: 13 });
    for (const r of runs) map.addLine(r.coords, runColor(r), r.approx);
    map.addMarker(all[0][0], all[0][1], START_HTML);
    map.addMarker(all.at(-1)[0], all.at(-1)[1], FINISH_HTML);
    map.fit(all, 48); // room for the start/finish labels and the expand button
    const dispose = () => map.destroy();
    // Position marker driven by the ride chart; null hides it.
    let cursor = null;
    dispose.cursor = (p) => {
      if (!p) { cursor?.remove(); cursor = null; return; }
      if (cursor) cursor.update(p[0], p[1]);
      else cursor = map.addMarker(p[0], p[1], CURSOR_HTML);
    };
    return dispose;
  } catch {
    drawSvg(container, runs, all);
    return () => {};
  }
}

function drawSvg(container, runs, all) {
  const lat0 = all.reduce((a, p) => a + p[0], 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p[1] * k), ys = all.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = 1000, hgt = 600, pad = 20;
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1e-9), (hgt - 2 * pad) / (maxY - minY || 1e-9));
  const ox = (w - (maxX - minX) * scale) / 2, oy = (hgt - (maxY - minY) * scale) / 2;
  const pt = (p) => `${((p[1] * k - minX) * scale + ox).toFixed(1)},${((-p[0] - minY) * scale + oy).toFixed(1)}`;
  const lines = runs.map((r) => `<polyline points="${r.coords.map(pt).join(' ')}" stroke="${runColor(r)}"${r.approx ? ' stroke-dasharray="12 12"' : ''}/>`).join('');
  const dot = (p, color) => { const [x, y] = pt(p).split(','); return `<circle cx="${x}" cy="${y}" r="11" fill="${color}" stroke="#fff" stroke-width="4"/>`; };
  container.innerHTML = `<svg class="route-svg" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="xMidYMid meet">
    <g fill="none" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${lines}</g>
    ${dot(all[0], '#3fd28b')}${dot(all.at(-1), '#ff4d4d')}</svg>
    <div class="map-note">Карта недоступна без сети</div>`;
}

// Small static route preview for history cards: [[lat, lon], ...] -> <svg>.
// The gradient is in user space: a bounding-box gradient vanishes on a
// perfectly straight (zero-height) route.
const thumbStops = () => {
  const c = currentPalette().stops[currentTheme()];
  return `<stop offset="0" stop-color="${c[1]}"/><stop offset=".55" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[4]}"/>`;
};

export function routeThumb(points, size = 60) {
  if (points.length < 2) return '';
  const step = Math.max(1, Math.floor(points.length / 160));
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 9, w = size - 2 * pad;
  const scale = w / Math.max(maxX - minX, maxY - minY, 1e-9);
  const ox = pad + (w - (maxX - minX) * scale) / 2, oy = pad + (w - (maxY - minY) * scale) / 2;
  const xy = (i) => [((xs[i] - minX) * scale + ox).toFixed(1), ((ys[i] - minY) * scale + oy).toFixed(1)];
  const line = pts.map((_, i) => xy(i).join(',')).join(' ');
  const [sx, sy] = xy(0), [ex, ey] = xy(pts.length - 1);
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><linearGradient id="tg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${size}" y2="${size}">${thumbStops()}</linearGradient></defs>
    <polyline points="${line}" fill="none" stroke="url(#tg)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${sx}" cy="${sy}" r="3" fill="#34d399"/><circle cx="${ex}" cy="${ey}" r="3" fill="#f87171"/></svg>`;
}
