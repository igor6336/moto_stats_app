import { getRide, getGpsData, putRide, deleteRide, sensorBytes, listRides } from '../storage.js';
import { rideRecords } from '../records.js';
import { ensureLean, applyLean, dropSensorData } from '../ridelean.js';
import { computeSummary, routeByZone, prepareTrack, approxSpans } from '../algo/stats.js';
import { bestAccelerationSpans } from '../algo/accel.js';
import { renderRideChart } from '../chart.js';
import { rideCard, openSharePreview } from '../share.js';
import { skeleton, countUp, flyMorphTo, confetti } from '../motion.js';
import { exportRideRaw } from '../export.js';
import { getSettings } from '../settings.js';
import { drawRoute, zoneColor, APPROX_COLOR } from '../map.js';
import { openFullscreenMap, expandable } from '../fullmap.js';
import { escapeHtml as esc } from '../format.js';
import { fmtSpeed, speedValue, speedUnit, fmtDistance, fmtDuration, fmtDate, zoneBound, escapeHtml, fmtBytes } from '../format.js';
import { h, toast, exportButton } from '../ui.js';
import { icon } from '../icons.js';
import { getMe } from '../social/client.js';
import { syncRides, deleteRemoteRide } from '../social/rides.js';

function leanHint(ride) {
  const l = ride.lean;
  if (!l && ride.sensorsDeleted) return 'Данные датчиков удалены до расчёта наклона.';
  if (l?.reason === 'no-data') return 'Нет данных датчиков: наклон не посчитать.';
  if (l?.reason === 'no-reference') return 'Наклон не посчитан: мало прямых участков с точным GPS, чтобы понять, как стоит телефон. Поможет калибровка перед стартом.';
  if (l?.reason === 'flat') return 'Наклон не посчитан: телефон лежал плашмя. Нужно крепление, где телефон стоит экраном к водителю.';
  const ref = l?.reference === 'manual' ? 'по калибровке перед стартом' : 'по прямым участкам поездки, калибровка не нужна';
  return `Наклон, удержанный 1,5 с и подтверждённый GPS: короткие пики не учитываются. Ноль определён ${ref}. Точность около ±5–8°. Телефон должен быть жёстко закреплён. Стойка появится позже.`;
}

export function mountRide(root, { params, navigate }) {
  const el = h(`<section class="screen ride">${skeleton('ride')}</section>`);
  root.appendChild(el);
  let disposeMap = () => {};
  let closeFullscreen = () => {};
  let closeShare = () => {};
  let disposeChart = () => {};
  let alive = true;

  (async () => {
    let ride = await getRide(params.id);
    if (!alive) return;
    if (!ride) { el.innerHTML = '<div class="empty">Поездка не найдена</div>'; return; }
    ride = await ensureLean(ride);
    const { gps } = await getGpsData(ride.id);
    if (!alive) return;
    const zones = getSettings().zones;
    const durationS = ride.endedAt ? (ride.endedAt - ride.startedAt) / 1000 : undefined;
    const s = applyLean(computeSummary(gps, { zones, durationS }), ride);
    // Keep the stored summary in step with the current algorithm and zones.
    if (ride.status !== 'recording' && JSON.stringify(s) !== JSON.stringify(ride.summary)) {
      ride.summary = s;
      putRide(ride);
    }
    const records = rideRecords({ ...ride, summary: s }, await listRides());
    if (!alive) return;
    render(ride, s, gps, zones, records);
  })().catch((e) => { el.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(e.message || e)}</div>`; });

  function render(ride, s, gps, zones, records = []) {
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
        <button class="btn ghost back" data-back>${icon('chevron-left')}История</button>
        <h1>${fmtDate(ride.startedAt)}</h1>
        ${ride.status === 'interrupted' ? '<div class="badge warn">Запись прервана, сохранено до последнего сброса</div>' : ''}
        ${records.length ? `<div class="record-banner">${icon('trophy')}<div><b>${records.length > 1 ? 'Личные рекорды' : 'Личный рекорд'}</b>
          <span>${records.map((r) => `${esc(r.metric.label)} <b>${esc(r.metric.fmt(r.value))}</b>`).join(' · ')}</span></div></div>` : ''}
        ${s.duration > 60 && (s.approxTime || 0) / s.duration > 0.1 ? `<div class="banner warn">
          ${fmtDuration(s.approxTime)} из ${fmtDuration(s.duration)} со слабым GPS (глушение, туннели). Маршрут там
          приблизительный (пунктир на карте), дистанция примерная, скорость и разгоны за этот отрезок не считаются.</div>` : ''}
        ${s.duration > 60 && (s.untrackedTime + s.gapTime) / s.duration > 0.2 ? `<div class="banner warn">
          ${fmtDuration(s.untrackedTime + s.gapTime)} из ${fmtDuration(s.duration)} без GPS совсем (помещение, туннели,
          сильное глушение). Дистанция и время в движении за этот отрезок не посчитаны.</div>` : ''}
      </div>
      <div class="map-wrap">
        <div class="map" data-map></div>
      </div>
      <div class="grid stats">
        <div class="stat"><div class="label">${icon('route')}Дистанция</div><div class="value">${fmtDistance(s.distance)}</div></div>
        <div class="stat"><div class="label">${icon('clock')}Время</div><div class="value">${fmtDuration(s.duration)}</div></div>
        <div class="stat"><div class="label">${icon('zap')}Макс.</div><div class="value">${fmtSpeed(s.maxSpeed)}<small>${u}</small></div></div>
        <div class="stat"><div class="label">${icon('activity')}Средняя</div><div class="value">${fmtSpeed(s.avgMovingSpeed)}<small>${u}</small></div></div>
        <div class="stat"><div class="label">${icon('timer')}В движении</div><div class="value">${fmtDuration(s.movingTime)}</div></div>
        <div class="stat"><div class="label">${icon('square')}Остановки</div><div class="value">${fmtDuration(s.stoppedTime)}</div></div>
      </div>
      <h2>Скорость${ride.lean?.series ? ' и наклон' : ''}</h2>
      <div class="ride-chart" data-chart></div>
      <p class="hint">Проведите пальцем по графику: точка на карте покажет, где это было.</p>
      <h2>Зоны скорости, ${u}</h2>
      <div class="zones">${zoneRows}</div>
      <h2>Разгоны (по GPS, лучшее за поездку)</h2>
      <div class="kv">
        ${[['0-100', '0–100 км/ч'], ['100-200', '100–200 км/ч'], ['0-200', '0–200 км/ч']].map(([k, label]) =>
          `<div><span>${label}</span><b>${s.accel?.[k] ? `${s.accel[k].toFixed(2)} с` : '—'}</b></div>`).join('')}
      </div>
      <h2>Наклон и стойка <span class="badge">бета</span></h2>
      <div class="kv">
        ${[['leanLeft', 'Наклон влево'], ['leanRight', 'Наклон вправо'], ['wheelie', 'Стойка']].map(([k, label]) =>
          `<div><span>${label}</span><b>${Number.isFinite(s[k]) ? `${Math.round(s[k])}°` : '—'}</b></div>`).join('')}
      </div>
      <p class="hint">${leanHint(ride)}</p>
      <h2>Качество данных</h2>
      <div class="kv">
        <div><span>Точек GPS</span><b>${s.points} из ${gps.length}</b></div>
        <div><span>GPS частота</span><b>${q.gps ? `${q.gps.hz.toFixed(2)} Гц, пауз >2 с: ${q.gps.gaps}` : '—'}</b></div>
        <div><span>Датчики движения</span><b>${q.motion ? `${q.motion.hz.toFixed(0)} Гц, пауз: ${q.motion.gaps}, макс. ${q.motion.maxDtMs} мс` : '—'}</b></div>
        <div><span>Потери сигнала GPS</span><b>${s.gaps} (${fmtDuration(s.gapTime)})</b></div>
        <div><span>Слабый GPS (приблизительно)</span><b>${s.approxTime ? `${fmtDuration(s.approxTime)}, ${fmtDistance(s.approxDistance)}` : '—'}</b></div>
        <div><span>Без GPS</span><b>${fmtDuration(s.untrackedTime + s.gapTime)}</b></div>
        <div><span>Пик скорости без сглаживания</span><b>${fmtSpeed(s.maxSpeedRaw)} ${u}</b></div>
        <div><span>Калибровка</span><b>${cal}</b></div>
        <div><span>Записей датчиков</span><b>${ride.sensorsDeleted ? 'удалены' : `${ride.counts?.motion ?? '—'} (~${fmtBytes(sensorBytes(ride))})`}</b></div>
      </div>
      <label class="switch-row">
        <span>Учитывать в рейтинге<small>Снимите, если ехали на машине или пассажиром</small></span>
        <input type="checkbox" data-counted ${ride.excluded ? '' : 'checked'}>
      </label>
      <div class="actions">
        <button class="btn primary" data-share-card>${icon('share')}Поделиться карточкой</button>
        <button class="btn" data-export></button>
        ${ride.sensorsDeleted || !ride.counts?.motion ? '' : '<button class="btn ghost" data-drop-sensors>Удалить данные датчиков</button>'}
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
    el.querySelector('[data-drop-sensors]')?.addEventListener('click', async () => {
      if (!confirm(`Удалить данные датчиков (~${fmtBytes(sensorBytes(ride))})? Маршрут, статистика и место в рейтинге останутся, `
        + 'но пересчитать наклон новой версией алгоритма будет нельзя.')) return;
      await dropSensorData(ride);
      toast('Данные датчиков удалены');
      navigate(`#/ride/${ride.id}`);
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
    const runs = routeByZone(gps, zones);
    const mapBox = el.querySelector('[data-map]');
    drawRoute(mapBox, runs, { animate: true }).then((d) => {
      if (alive) disposeMap = d; else d();
    });
    drawChart(ride, s, gps);
    flyMorphTo(mapBox);
    countUp(el.querySelectorAll('.grid.stats .value'));
    // Right after a recording: celebrate a new record once.
    let celebrate = null;
    try { celebrate = sessionStorage.getItem('celebrate'); sessionStorage.removeItem('celebrate'); } catch { /* private mode */ }
    if (celebrate === ride.id && records.length) {
      el.querySelector('.record-banner')?.classList.add('celebrate');
      confetti();
    }
    el.querySelector('[data-share-card]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const blob = await rideCard({ ride, s, runs, maxPos: maxSpeedPos(gps, s), me: getMe() });
        if (alive) closeShare = openSharePreview(blob, `moto-${new Date(ride.startedAt).toISOString().slice(0, 10)}.png`);
      } catch (err) {
        toast(`Не удалось сделать карточку: ${err.message || err}`);
      } finally {
        btn.disabled = false;
      }
    });
    const legend = s.zones.map((z, i) => ({
      color: zoneColor(i),
      label: z.to === null ? `${zoneBound(z.from)}+` : `${zoneBound(z.from)}–${zoneBound(z.to)}`,
      time: z.time,
    }));
    const legendHtml = `<div class="map-legend-title">Зоны скорости, ${esc(u)}</div>
      <div class="map-legend-items">${legend.map((z) => `
        <div class="ml-item ${z.time ? '' : 'ml-none'}">
          <span class="swatch" style="background:${z.color}"></span>
          <span class="ml-label">${esc(z.label)}</span>
          <span class="ml-time">${z.time ? fmtDuration(z.time) : '—'}</span>
        </div>`).join('')}
        ${runs.some((r) => r.approx) ? `<div class="ml-item">
          <span class="swatch dashed" style="--c:${APPROX_COLOR}"></span>
          <span class="ml-label">Слабый GPS</span>
          <span class="ml-time">${fmtDuration(s.approxTime)}</span>
        </div>` : ''}</div>`;
    expandable(mapBox, () => { closeFullscreen = openFullscreenMap((c) => drawRoute(c, runs), legendHtml); }, { tap: true });
  }

  // Where the max speed was: the precise fix nearest to its time.
  function maxSpeedPos(gps, s) {
    if (!Number.isFinite(s.maxSpeedT)) return null;
    const tr = prepareTrack(gps);
    let best = -1;
    for (let i = 0; i < tr.n; i++) if (best < 0 || Math.abs(tr.t[i] - s.maxSpeedT) < Math.abs(tr.t[best] - s.maxSpeedT)) best = i;
    return best < 0 ? null : [tr.lat[best], tr.lon[best]];
  }

  function drawChart(ride, s, gps) {
    const tr = prepareTrack(gps);
    const segments = [];
    let seg = [];
    for (let i = 0; i < tr.n; i++) {
      if (i && (tr.brk[i] || tr.t[i] - tr.t[i - 1] > 30)) { segments.push(seg); seg = []; }
      seg.push({ t: tr.t[i], v: speedValue(tr.smooth[i]) });
    }
    segments.push(seg);
    // Map position for a chart time: the nearest precise fix within 3 s.
    const posAt = (t) => {
      let lo = 0, hi = tr.n - 1;
      if (hi < 0) return null;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] < t) lo = m; else hi = m; }
      const i = Math.abs(tr.t[lo] - t) < Math.abs(tr.t[hi] - t) ? lo : hi;
      return Math.abs(tr.t[i] - t) <= 3 ? [tr.lat[i], tr.lon[i]] : null;
    };
    disposeChart = renderRideChart(el.querySelector('[data-chart]'), {
      segments,
      approx: approxSpans(gps),
      lean: ride.lean?.series || null,
      accel: bestAccelerationSpans(tr),
      max: Number.isFinite(s.maxSpeedT) && s.maxSpeed > 0 ? { t: s.maxSpeedT, v: speedValue(s.maxSpeed) } : null,
      unit: speedUnit(),
    }, { onScrub: (t) => disposeMap.cursor?.(t === null ? null : posAt(t)) });
  }

  return () => { alive = false; disposeMap(); closeFullscreen(); closeShare(); disposeChart(); };
}
