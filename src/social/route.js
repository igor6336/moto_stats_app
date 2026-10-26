// Hand-off to Yandex apps for directions to a friend. Empty start point in
// rtext means "from my location".
import { ONLINE_MS, lastSeen } from './location.js';

const fix = (v) => Number(v).toFixed(6);

export function yandexMapsRouteUrl(lat, lon) {
  return `https://yandex.ru/maps/?rtext=~${fix(lat)},${fix(lon)}&rtt=auto`;
}

export function yandexNaviRouteUrl(lat, lon) {
  return `yandexnavi://build_route_on_map?lat_to=${fix(lat)}&lon_to=${fix(lon)}`;
}

// The https link opens the Yandex Maps app if installed (universal link),
// otherwise the web version. The navigator only has a custom scheme.
export function openRoute(kind, lat, lon) {
  const url = kind === 'navi' ? yandexNaviRouteUrl(lat, lon) : yandexMapsRouteUrl(lat, lon);
  if (kind === 'navi') location.href = url;
  else window.open(url, '_blank', 'noopener');
}

export function routeActions(loc) {
  return [
    { label: 'Маршрут в Яндекс Картах', primary: true, onClick: () => openRoute('maps', loc.lat, loc.lon) },
    { label: 'Маршрут в Яндекс Навигаторе', onClick: () => openRoute('navi', loc.lat, loc.lon) },
  ];
}

export function routeSubtitle(loc) {
  const online = Date.now() - new Date(loc.updated_at).getTime() < ONLINE_MS;
  return online ? lastSeen(loc) : `Маршрут до последней позиции · ${lastSeen(loc)}`;
}
