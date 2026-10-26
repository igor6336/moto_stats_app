import { listRides } from '../storage.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration, fmtDate } from '../format.js';
import { h } from '../ui.js';

export function mountHistory(root, { navigate }) {
  const el = h('<section class="screen history"><h1>История</h1><div class="list" data-list>Загрузка…</div></section>');
  root.appendChild(el);
  let alive = true;

  listRides().then((rides) => {
    if (!alive) return;
    const list = el.querySelector('[data-list]');
    if (!rides.length) {
      list.innerHTML = '<div class="empty">Поездок пока нет</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of rides) {
      const s = r.summary;
      const item = h(`
        <button class="ride-item">
          <div class="ri-date">${fmtDate(r.startedAt)}
            ${r.status === 'recording' ? '<span class="badge rec">идёт запись</span>' : ''}
            ${r.status === 'interrupted' ? '<span class="badge warn">прервана</span>' : ''}
          </div>
          <div class="ri-stats">
            <span>${s ? fmtDistance(s.distance) : '—'}</span>
            <span>${s ? fmtDuration(s.duration) : '—'}</span>
            <span>макс. ${s ? fmtSpeed(s.maxSpeed) : '—'} ${speedUnit()}</span>
          </div>
        </button>`);
      item.addEventListener('click', () => navigate(r.status === 'recording' ? '#/record' : `#/ride/${r.id}`));
      list.append(item);
    }
  });

  return () => { alive = false; };
}
