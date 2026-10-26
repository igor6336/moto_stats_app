import { listRides, getGpsData } from '../storage.js';
import { prepareTrack } from '../algo/stats.js';
import { routeThumb } from '../map.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration, fmtDate } from '../format.js';
import { icon } from '../icons.js';
import { h } from '../ui.js';

export function mountHistory(root, { navigate }) {
  const el = h('<section class="screen history"><h1>История</h1><div class="list" data-list><div class="loading">Загрузка</div></div></section>');
  root.appendChild(el);
  let alive = true;

  listRides().then(async (rides) => {
    if (!alive) return;
    const list = el.querySelector('[data-list]');
    if (!rides.length) {
      list.innerHTML = `<div class="empty">${icon('route', 'big')}<br>Поездок пока нет.<br>Запишите первую на вкладке «Запись».</div>`;
      return;
    }
    list.innerHTML = '';
    const thumbs = [];
    for (const r of rides) {
      const s = r.summary;
      const item = h(`
        <button class="ride-item">
          <div class="ri-thumb">${icon('route')}</div>
          <div class="ri-main">
            <div class="ri-date">${fmtDate(r.startedAt)}
              ${r.status === 'recording' ? '<span class="badge rec">идёт запись</span>' : ''}
              ${r.status === 'interrupted' ? '<span class="badge warn">прервана</span>' : ''}
            </div>
            <div class="ri-stats">
              <span>${icon('route')}${s ? fmtDistance(s.distance) : '—'}</span>
              <span>${icon('clock')}${s ? fmtDuration(s.duration) : '—'}</span>
              <span>${icon('zap')}${s ? fmtSpeed(s.maxSpeed) : '—'} ${speedUnit()}</span>
            </div>
          </div>
          <span class="ri-chev">${icon('chevron-right')}</span>
        </button>`);
      item.addEventListener('click', () => navigate(r.status === 'recording' ? '#/record' : `#/ride/${r.id}`));
      list.append(item);
      thumbs.push([r.id, item.querySelector('.ri-thumb')]);
    }
    // Route previews after the list is on screen, one ride at a time.
    for (const [id, box] of thumbs) {
      if (!alive) return;
      const tr = prepareTrack((await getGpsData(id)).gps);
      const svg = routeThumb(tr.lat.map((la, i) => [la, tr.lon[i]]));
      if (svg) box.innerHTML = svg;
    }
  });

  return () => { alive = false; };
}
