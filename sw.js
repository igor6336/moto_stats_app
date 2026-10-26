// App shell is served from cache so the app starts without network.
// Bump VERSION (and APP_VERSION in src/version.js) on every deploy: the new
// worker re-downloads the whole shell, so files never mix across versions.
const VERSION = '0.5.2';
const SHELL_CACHE = `moto-shell-${VERSION}`;
const CDN_CACHE = 'moto-cdn-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './src/app.js',
  './src/version.js',
  './src/settings.js',
  './src/storage.js',
  './src/recorder.js',
  './src/wakelock.js',
  './src/export.js',
  './src/format.js',
  './src/map.js',
  './src/ui.js',
  './src/screens/record.js',
  './src/screens/history.js',
  './src/screens/ride.js',
  './src/screens/settings.js',
  './src/algo/schema.js',
  './src/algo/geo.js',
  './src/algo/stats.js',
  './src/algo/calibration.js',
  './src/algo/quality.js',
  './src/algo/leaderboard.js',
  './src/algo/accel.js',
  './src/config.js',
  './src/social/client.js',
  './src/social/friends.js',
  './src/social/location.js',
  './src/social/rides.js',
  './src/social/avatar.js',
  './src/social/route.js',
  './src/screens/account.js',
  './src/screens/friends.js',
  './src/screens/leaders.js',
  './src/screens/rider.js',
  './vendor/supabase.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('moto-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return fetch(req);
      }),
    );
    return;
  }

  // Leaflet from the CDN: cache after first load so the map script works offline.
  if (url.hostname === 'unpkg.com') {
    e.respondWith(
      caches.open(CDN_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
  }
  // Map tiles and everything else: network only.
});
