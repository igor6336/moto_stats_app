const R = 6371008.8; // mean Earth radius, m
const RAD = Math.PI / 180;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Moves a point by (north, east) metres. Used by tests and synthetic tracks.
export function offset(lat, lon, north, east) {
  return [lat + (north / R) / RAD, lon + (east / (R * Math.cos(lat * RAD))) / RAD];
}

// Centre and zoom (Web Mercator, 256 px tiles) that fit the points into a
// width x height px box with padding, like fitBounds in map libraries.
export function viewForPoints(points, width, height, padding = 24, maxZoom = 17) {
  const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const y = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
  const fx = (maxLon - minLon) / 360;
  const fy = (y(maxLat) - y(minLat)) / (2 * Math.PI);
  const w = Math.max(1, width - 2 * padding), h = Math.max(1, height - 2 * padding);
  const zx = fx > 0 ? Math.log2(w / 256 / fx) : maxZoom;
  const zy = fy > 0 ? Math.log2(h / 256 / fy) : maxZoom;
  const zoom = Math.max(1, Math.min(maxZoom, zx, zy));
  const cy = (y(maxLat) + y(minLat)) / 2;
  const centerLat = (2 * Math.atan(Math.exp(cy)) - Math.PI / 2) / RAD;
  return { center: [centerLat, (minLon + maxLon) / 2], zoom };
}
