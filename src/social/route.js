// Hand-off to Yandex Maps for directions to a friend. Empty start point in
// rtext means "from my location".
import { ONLINE_MS, lastSeen } from './location.js';

const fix = (v) => Number(v).toFixed(6);

export function yandexMapsRouteUrl(lat, lon) {
  return `https://yandex.ru/maps/?rtext=~${fix(lat)},${fix(lon)}&rtt=auto`;
}

// The https link opens the Yandex Maps app if installed (universal link),
// otherwise the web version.
export function routeAction(loc) {
  return {
    label: 'Маршрут в Яндекс Картах',
    icon: 'navigation',
    primary: true,
    onClick: () => window.open(yandexMapsRouteUrl(loc.lat, loc.lon), '_blank', 'noopener'),
  };
}

export function routeSubtitle(loc) {
  const online = Date.now() - new Date(loc.updated_at).getTime() < ONLINE_MS;
  return online ? lastSeen(loc) : `Маршрут до последней позиции · ${lastSeen(loc)}`;
}
