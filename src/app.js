import { loadSettings } from './settings.js';
import { recorder, recoverInterrupted } from './recorder.js';
import { mountRecord } from './screens/record.js';
import { mountHistory } from './screens/history.js';
import { mountRide } from './screens/ride.js';
import { mountSettings } from './screens/settings.js';

const routes = [
  { re: /^#\/record$/, tab: 'record', mount: mountRecord },
  { re: /^#\/history$/, tab: 'history', mount: mountHistory },
  { re: /^#\/ride\/(.+)$/, tab: 'history', mount: mountRide, keys: ['id'] },
  { re: /^#\/settings$/, tab: 'settings', mount: mountSettings },
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

async function boot() {
  await loadSettings();
  await recorder.loadPendingCalibration();
  await recoverInterrupted();
  window.addEventListener('hashchange', render);
  render();
  registerServiceWorker();
}

boot().catch((e) => {
  view.innerHTML = `<div class="empty">Ошибка запуска: ${e.message || e}</div>`;
  console.error(e);
});
