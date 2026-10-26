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
