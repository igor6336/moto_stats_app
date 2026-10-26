// Route map. Leaflet with OSM tiles when online; an SVG polyline otherwise,
// so the route is visible without network.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let leafletPromise = null;

export const ZONE_COLORS = ['#4aa3ff', '#3fd28b', '#c6e04a', '#ffc93d', '#ff8a3d', '#ff4d4d', '#e04ad6', '#a46bff'];
export const zoneColor = (i) => ZONE_COLORS[i % ZONE_COLORS.length];

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${LEAFLET}leaflet.css`;
    css.crossOrigin = 'anonymous';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `${LEAFLET}leaflet.js`;
    js.crossOrigin = 'anonymous';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletPromise = null; reject(new Error('leaflet not loaded')); };
    document.head.append(js);
    setTimeout(() => {
      if (window.L) return;
      leafletPromise = null;
      reject(new Error('leaflet timeout'));
    }, 8000);
  });
  return leafletPromise;
}

export async function drawRoute(container, runs) {
  const all = runs.flatMap((r) => r.coords);
  if (all.length < 2) {
    container.innerHTML = '<div class="map-empty">Нет точек маршрута</div>';
    return () => {};
  }
  try {
    const L = await loadLeaflet();
    container.innerHTML = '';
    const map = L.map(container, { zoomControl: true, attributionControl: true, preferCanvas: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    for (const r of runs) {
      L.polyline(r.coords, { color: zoneColor(r.zone), weight: 4, opacity: 0.95 }).addTo(map);
    }
    map.fitBounds(L.latLngBounds(all), { padding: [16, 16] });
    return () => map.remove();
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
  const lines = runs.map((r) => `<polyline points="${r.coords.map(pt).join(' ')}" stroke="${zoneColor(r.zone)}"/>`).join('');
  container.innerHTML = `<svg class="route-svg" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="xMidYMid meet">
    <g fill="none" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${lines}</g></svg>
    <div class="map-note">Карта недоступна без сети</div>`;
}
