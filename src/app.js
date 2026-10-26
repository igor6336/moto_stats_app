import { loadSettings } from './settings.js';
import { icon } from './icons.js';
import { recorder, recoverInterrupted } from './recorder.js';
import { mountRecord } from './screens/record.js';
import { mountHistory } from './screens/history.js';
import { mountRide } from './screens/ride.js';
import { mountSettings } from './screens/settings.js';
import { mountAccount } from './screens/account.js';
import { mountFriends } from './screens/friends.js';
import { mountLeaders } from './screens/leaders.js';
import { mountRider } from './screens/rider.js';
import { initSession } from './social/client.js';
import { startLocationSharing } from './social/location.js';
import { syncRides } from './social/rides.js';

const routes = [
  { re: /^#\/record$/, tab: 'record', mount: mountRecord },
  { re: /^#\/history$/, tab: 'history', mount: mountHistory },
  { re: /^#\/ride\/(.+)$/, tab: 'history', mount: mountRide, keys: ['id'] },
  { re: /^#\/friends$/, tab: 'friends', mount: mountFriends },
  { re: /^#\/leaders$/, tab: 'leaders', mount: mountLeaders },
  { re: /^#\/rider\/(.+)$/, tab: 'friends', mount: mountRider, keys: ['id'] },
  { re: /^#\/settings$/, tab: 'settings', mount: mountSettings },
  { re: /^#\/account$/, tab: 'settings', mount: mountAccount },
];

const view = document.getElementById('view');
let unmount = () => {};

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  const hash = location.hash || '#/record';
  const route = routes.find((r) => r.re.test(hash)) || routes[0];
  const m = hash.match(route.re) || [];
  const params = Object.fromEntries((route.keys || []).map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  unmount();
  view.innerHTML = '';
  view.scrollTop = 0;
  unmount = route.mount(view, { params, navigate }) || (() => {});
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === route.tab));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw', e));
  // A new version took over. Never reload during a ride.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const bar = document.getElementById('update');
    bar.hidden = false;
    bar.onclick = () => {
      if (recorder.state === 'recording') return;
      location.reload();
    };
  });
}

const TAB_ICONS = { record: 'gauge', history: 'history', friends: 'users', leaders: 'trophy', settings: 'settings-2' };
document.querySelectorAll('.tabbar a').forEach((a) => a.insertAdjacentHTML('afterbegin', icon(TAB_ICONS[a.dataset.tab])));

async function boot() {
  await loadSettings();
  await recorder.loadPendingCalibration();
  await recoverInterrupted();
  window.addEventListener('hashchange', render);
  render();
  registerServiceWorker();
  // Social features load in the background; recording never waits for them.
  initSession().then((me) => {
    startLocationSharing();
    recorder.addEventListener('ride-saved', () => syncRides().catch(() => {}));
    if (me) syncRides().catch(() => {});
    // Screens drawn before the session loaded show the logged-out state.
    if (!/^#\/(record|ride)/.test(location.hash || '#/record')) render();
  });
}

boot().catch((e) => {
  view.innerHTML = `<div class="empty">Ошибка запуска: ${e.message || e}</div>`;
  console.error(e);
});
