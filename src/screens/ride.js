import { getRide, getGpsData, putRide, deleteRide } from '../storage.js';
import { computeSummary, routeByZone } from '../algo/stats.js';
import { exportRideRaw } from '../export.js';
import { getSettings } from '../settings.js';
import { drawRoute, zoneColor } from '../map.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration, fmtDate, zoneBound, escapeHtml } from '../format.js';
import { h, toast, exportButton } from '../ui.js';
import { getMe } from '../social/client.js';
import { syncRides, deleteRemoteRide } from '../social/rides.js';

export function mountRide(root, { params, navigate }) {
  const el = h('<section class="screen ride"><div class="loading">Загрузка…</div></section>');
  root.appendChild(el);
  let disposeMap = () => {};
  let alive = true;

  (async () => {
    const ride = await getRide(params.id);
    if (!alive) return;
    if (!ride) { el.innerHTML = '<div class="empty">Поездка не найдена</div>'; return; }
    const { gps } = await getGpsData(ride.id);
    if (!alive) return;
    const zones = getSettings().zones;
    const durationS = ride.endedAt ? (ride.endedAt - ride.startedAt) / 1000 : undefined;
    const s = computeSummary(gps, { zones, durationS });
    // Keep the stored summary in step with the current algorithm and zones.
    if (ride.status !== 'recording' && JSON.stringify(s) !== JSON.stringify(ride.summary)) {
      ride.summary = s;
      putRide(ride);
    }
    render(ride, s, gps, zones);
  })().catch((e) => { el.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(e.message || e)}</div>`; });

  function render(ride, s, gps, zones) {
    const u = speedUnit();
    const maxZone = Math.max(1e-9, ...s.zones.map((z) => z.time));
    const zoneRows = s.zones.map((z, i) => `
      <div class="zone-row">
        <div class="zone-name"><span class="swatch" style="background:${zoneColor(i)}"></span>
          ${z.to === null ? `${zoneBound(z.from)}+` : `${zoneBound(z.from)}–${zoneBound(z.to)}`}</div>
        <div class="zone-bar"><div style="width:${((z.time / maxZone) * 100).toFixed(1)}%;background:${zoneColor(i)}"></div></div>
        <div class="zone-val">${fmtDuration(z.time)}<small>${fmtDistance(z.distance)}</small></div>
      </div>`).join('');
    const q = ride.quality || {};
    const cal = ride.calibrations?.length
      ? ride.calibrations.map((c) => (c.ok ? 'OK' : 'шум')).join(', ')
      : 'нет';
    el.innerHTML = `
      <div class="ride-head">
        <button class="btn ghost back" data-back>‹ История</button>
        <h1>${fmtDate(ride.startedAt)}</h1>
        ${ride.status === 'interrupted' ? '<div class="badge warn">Запись прервана, сохранено до последнего сброса</div>' : ''}
        ${s.duration > 60 && (s.untrackedTime + s.gapTime) / s.duration > 0.2 ? `<div class="banner warn">
          ${fmtDuration(s.untrackedTime + s.gapTime)} из ${fmtDuration(s.duration)} без точного GPS (помещение, туннели,
          глушение в центре Москвы). Дистанция и время в движении за этот отрезок не посчитаны.</div>` : ''}
      </div>
      <div class="map" data-map></div>
      <div class="grid stats">
        <div class="stat"><div class="label">Дистанция</div><div class="value">${fmtDistance(s.distance)}</div></div>
        <div class="stat"><div class="label">Время</div><div class="value">${fmtDuration(s.duration)}</div></div>
        <div class="stat"><div class="label">Макс., ${u}</div><div class="value">${fmtSpeed(s.maxSpeed)}</div></div>
        <div class="stat"><div class="label">Средняя, ${u}</div><div class="value">${fmtSpeed(s.avgMovingSpeed)}</div></div>
        <div class="stat"><div class="label">В движении</div><div class="value">${fmtDuration(s.movingTime)}</div></div>
        <div class="stat"><div class="label">Остановки</div><div class="value">${fmtDuration(s.stoppedTime)}</div></div>
      </div>
      <h2>Зоны скорости, ${u}</h2>
      <div class="zones">${zoneRows}</div>
      <h2>Разгоны (по GPS)</h2>
      <div class="kv">
        ${[['0-100', '0–100 км/ч'], ['100-200', '100–200 км/ч'], ['0-200', '0–200 км/ч']].map(([k, label]) =>
          `<div><span>${label}</span><b>${s.accel?.[k] ? `${s.accel[k].toFixed(2)} с` : '—'}</b></div>`).join('')}
      </div>
      <h2>Качество данных</h2>
      <div class="kv">
        <div><span>Точек GPS</span><b>${s.points} из ${gps.length}</b></div>
        <div><span>GPS частота</span><b>${q.gps ? `${q.gps.hz.toFixed(2)} Гц, пауз >2 с: ${q.gps.gaps}` : '—'}</b></div>
        <div><span>Датчики движения</span><b>${q.motion ? `${q.motion.hz.toFixed(0)} Гц, пауз: ${q.motion.gaps}, макс. ${q.motion.maxDtMs} мс` : '—'}</b></div>
        <div><span>Потери сигнала GPS</span><b>${s.gaps} (${fmtDuration(s.gapTime)})</b></div>
        <div><span>Без точного GPS</span><b>${fmtDuration(s.untrackedTime + s.gapTime)}</b></div>
        <div><span>Пик скорости без сглаживания</span><b>${fmtSpeed(s.maxSpeedRaw)} ${u}</b></div>
        <div><span>Калибровка</span><b>${cal}</b></div>
        <div><span>Записей датчиков</span><b>${ride.counts?.motion ?? '—'}</b></div>
      </div>
      <label class="switch-row">
        <span>Учитывать в рейтинге<small>Снимите, если ехали на машине или пассажиром</small></span>
        <input type="checkbox" data-counted ${ride.excluded ? '' : 'checked'}>
      </label>
      <div class="actions">
        <button class="btn primary" data-export></button>
        <button class="btn danger ghost" data-delete>Удалить поездку</button>
      </div>`;
    el.querySelector('[data-back]').addEventListener('click', () => navigate('#/history'));
    exportButton(el.querySelector('[data-export]'), 'Экспорт сырых данных', () => exportRideRaw(ride.id));
    el.querySelector('[data-counted]').addEventListener('change', async (e) => {
      // Re-read: the sync may have updated the stored ride since this screen loaded it.
      const fresh = (await getRide(ride.id)) || ride;
      fresh.excluded = ride.excluded = !e.target.checked;
      if (!fresh.excluded) fresh.synced = null; // upload again
      await putRide(fresh);
      if (getMe()) syncRides().then(() => toast(ride.excluded ? 'Поездка убрана из рейтинга' : 'Поездка учтена в рейтинге'))
        .catch(() => toast('Нет связи с сервером, обновится позже'));
    });
    el.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm('Удалить поездку вместе с сырыми данными? Это необратимо.')) return;
      if (getMe()) { // the stored copy may have synced after this screen loaded
        try { await deleteRemoteRide(ride.id); } catch {
          toast('Нет связи с сервером: удалите поездку, когда появится интернет');
          return;
        }
      }
      await deleteRide(ride.id);
      toast('Поездка удалена');
      navigate('#/history');
    });
    drawRoute(el.querySelector('[data-map]'), routeByZone(gps, zones)).then((d) => {
      if (alive) disposeMap = d; else d();
    });
  }

  return () => { alive = false; disposeMap(); };
}
