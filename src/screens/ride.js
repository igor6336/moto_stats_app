import { getRide, getGpsData, putRide, deleteRide, sensorBytes, listRides } from '../storage.js';
import { rideRecords } from '../records.js';
import { ensureLean, applyLean, dropSensorData } from '../ridelean.js';
import { LEAN_VERSION } from '../algo/lean.js';
import { computeSummary, routeByZone, prepareTrack, approxSpans } from '../algo/stats.js';
import { bestAccelerationSpans } from '../algo/accel.js';
import { renderRideChart } from '../chart.js';
import { rideCard, openSharePreview } from '../share.js';
import { skeleton, countUp, confetti } from '../motion.js';
import { exportRideRaw, shareOrDownload } from '../export.js';
import { getSettings } from '../settings.js';
import { drawRoute, zoneColor, APPROX_COLOR } from '../map.js';
import { openFullscreenMap, expandable } from '../fullmap.js';
import { escapeHtml as esc } from '../format.js';
import { fmtSpeed, speedValue, speedUnit, fmtDistance, fmtDuration, fmtDate, zoneBound, escapeHtml, fmtBytes } from '../format.js';
import { h, toast, actionSheet } from '../ui.js';
import { rideName, previousRide } from '../ridename.js';
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
  return `Точность ±5–8°. <button class="more" data-more>Подробнее</button><span class="more-text" hidden> Учитывается наклон, удержанный 1,5 с и подтверждённый GPS: короткие пики отбрасываются. Ноль определён ${ref}. Телефон должен быть жёстко закреплён. Стойка появится позже.</span>`;
}

// A short banner; the long explanation opens on tap.
function banner(kind, short, more) {
  return `<div class="banner ${kind}">${short} <button class="more" data-more>Подробнее</button><span class="more-text" hidden> ${more}</span></div>`;
}

// "+12 км/ч к прошлой" chips against the previous ride.
function compareChips(s, prev) {
  if (!prev) return '';
  const p = prev.summary;
  const chips = [];
  const add = (label, cur, old, fmt, unit) => {
    if (!Number.isFinite(cur) || !Number.isFinite(old) || !old) return;
    const d = cur - old;
    if (Math.abs(fmt(Math.abs(d))) === 0 || fmt(Math.abs(d)) === '0') return;
    chips.push(`<span class="chip ${d > 0 ? 'up' : 'down'}">${label} ${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}${unit ? ` ${unit}` : ''}</span>`);
  };
  add('Макс.', s.maxSpeed, p.maxSpeed, fmtSpeed, speedUnit());
  add('Средняя', s.avgMovingSpeed, p.avgMovingSpeed, fmtSpeed, speedUnit());
  add('Дистанция', s.distance, p.distance, fmtDistance, '');
  return chips.length ? `<div class="compare"><span>К прошлой поездке</span>${chips.join('')}</div>` : '';
}

// "27 октября, 11:15"; the year only when it is not the current one.
function heroDate(ts) {
  const d = new Date(ts);
  const opts = { day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) };
  return `${d.toLocaleDateString('ru-RU', opts).replace(' г.', '')}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function recordBanner(records) {
  if (!records.length) return '';
  return `<div class="record-banner">${icon('trophy')}<div><b>${records.length > 1 ? 'Личные рекорды' : 'Личный рекорд'}</b>
    <span>${records.map((r) => `${esc(r.metric.label)} <b>${esc(r.metric.fmt(r.value))}</b>`).join(' · ')}</span></div></div>`;
}

function leanSection(ride, s, pending = false) {
  return `<div class="kv">
      ${[['leanLeft', 'Наклон влево'], ['leanRight', 'Наклон вправо'], ['wheelie', 'Стойка']].map(([k, label]) =>
        `<div><span>${label}</span><b>${pending && k !== 'wheelie' ? '<span class="sk" style="display:inline-block;width:42px;height:14px"></span>'
          : Number.isFinite(s[k]) ? `${Math.round(s[k])}°` : '—'}</b></div>`).join('')}
    </div>
    <p class="hint">${pending ? 'Считаю наклон по данным датчиков…' : leanHint(ride)}</p>`;
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
    // Lean needs all sensor data (tens of thousands of rows): the screen
    // shows at once and the lean section fills in when it is ready.
    const leanPending = ride.status !== 'recording' && !ride.sensorsDeleted && ride.lean?.v !== LEAN_VERSION;
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
    const all = await listRides();
    const records = rideRecords({ ...ride, summary: s }, all);
    if (!alive) return;
    render(ride, s, gps, zones, records, leanPending, ride.excluded ? null : previousRide(ride, all));
    if (leanPending) {
      await ensureLean(ride);
      if (!alive) return;
      applyLean(s, ride);
      ride.summary = s;
      putRide(ride);
      el.querySelector('[data-lean]').innerHTML = leanSection(ride, s);
      el.querySelector('[data-chart-title]').textContent = `Скорость${ride.lean?.series ? ' и наклон' : ''}`;
      disposeChart();
      drawChart(ride, s, gps);
      const fresh = rideRecords({ ...ride, summary: s }, await listRides());
      if (!alive) return;
      // Update the banner in place: replacing it would cut its celebration.
      const banner = el.querySelector('.record-banner');
      if (banner && fresh.length) banner.querySelector(':scope > div').innerHTML = h(recordBanner(fresh)).querySelector(':scope > div').innerHTML;
      else if (banner) banner.remove();
      else if (fresh.length) el.querySelector('.ride-head').insertAdjacentHTML('afterbegin', recordBanner(fresh));
    }
  })().catch((e) => { el.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(e.message || e)}</div>`; });

  function render(ride, s, gps, zones, records = [], leanPending = false, prev = null) {
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
      <div class="ride-hero">
        <div class="map" data-map></div>
        <div class="hero-shade"></div>
        <button class="hero-back" data-back>${icon('chevron-left')}История</button>
        <button class="hero-menu" data-menu aria-label="Действия">${icon('ellipsis')}</button>
        <div class="hero-title">
          <h1 data-name>${esc(rideName(ride))}</h1>
          <div class="hero-sub">${[heroDate(ride.startedAt), getMe()?.bike, `${fmtDuration(s.duration)} в пути`].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </div>
      <div class="ride-head">
        ${ride.status === 'interrupted' ? '<div class="badge warn">Запись прервана, сохранено до последнего сброса</div>' : ''}
        ${recordBanner(records)}
        ${s.duration > 60 && (s.approxTime || 0) / s.duration > 0.1 ? banner('warn',
          `Слабый GPS ${fmtDuration(s.approxTime)}: маршрут там приблизительный.`,
          'Глушение или туннели. На карте этот отрезок пунктиром, дистанция примерная, скорость и разгоны за него не считаются.') : ''}
        ${s.duration > 60 && (s.untrackedTime + s.gapTime) / s.duration > 0.2 ? banner('warn',
          `Без GPS ${fmtDuration(s.untrackedTime + s.gapTime)}: этот отрезок не посчитан.`,
          'Помещение, туннели или сильное глушение. Дистанция и время в движении за этот отрезок не учтены.') : ''}
        ${compareChips(s, prev)}
      </div>
      <div class="grid stats">
        <div class="stat"><div class="label">${icon('route')}Дистанция</div><div class="value">${fmtDistance(s.distance)}</div></div>
        <div class="stat"><div class="label">${icon('clock')}В пути</div><div class="value">${fmtDuration(s.duration)}</div></div>
        <div class="stat"><div class="label">${icon('zap')}Макс.</div><div class="value">${fmtSpeed(s.maxSpeed)}<small>${u}</small></div></div>
        <div class="stat"><div class="label">${icon('activity')}Средняя</div><div class="value">${fmtSpeed(s.avgMovingSpeed)}<small>${u}</small></div></div>
        <div class="stat"><div class="label">${icon('timer')}В движении</div><div class="value">${fmtDuration(s.movingTime)}</div></div>
        <div class="stat"><div class="label">${icon('square')}Остановки</div><div class="value">${fmtDuration(s.stoppedTime)}</div></div>
      </div>
      <h2 data-chart-title>Скорость${ride.lean?.series ? ' и наклон' : ''}</h2>
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
      <div data-lean>${leanSection(ride, s, leanPending)}</div>
      <details class="quality">
      <summary>Качество данных${icon('chevron-right')}</summary>
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
      </details>
      <label class="switch-row">
        <span>Учитывать в рейтинге<small>Снимите, если ехали на машине или пассажиром</small></span>
        <input type="checkbox" data-counted ${ride.excluded ? '' : 'checked'}>
      </label>
      <div class="actions">
        <button class="btn primary" data-share-card>${icon('share')}Поделиться карточкой</button>
      </div>`;
    el.querySelector('[data-back]').addEventListener('click', () => navigate('#/history'));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      b.nextElementSibling.hidden = false;
      b.remove();
    });
    el.querySelector('[data-menu]').addEventListener('click', () => {
      const sensors = !ride.sensorsDeleted && ride.counts?.motion;
      actionSheet(rideName(ride), heroDate(ride.startedAt), [
        { label: 'Переименовать', icon: 'pencil', onClick: rename },
        { label: 'Экспорт сырых данных', icon: 'download', onClick: exportRaw },
        ...(sensors ? [{ label: 'Удалить данные датчиков', icon: 'trash-2', onClick: dropSensors }] : []),
        { label: 'Удалить поездку', icon: 'trash-2', danger: true, onClick: removeRide },
      ]);
    });
    async function rename() {
      const name = prompt('Название поездки', rideName(ride));
      if (name === null) return;
      const fresh = (await getRide(ride.id)) || ride;
      fresh.name = ride.name = name.trim().slice(0, 60) || null;
      await putRide(fresh);
      el.querySelector('[data-name]').textContent = rideName(ride);
    }
    // Reading the export is async, after which iOS no longer treats share()
    // as user-initiated: a second sheet with one button makes a fresh tap.
    async function exportRaw() {
      toast('Готовлю файл…');
      try {
        const ready = await exportRideRaw(ride.id);
        if (!alive) return;
        actionSheet('Файл готов', fmtBytes(ready.blob.size), [
          { label: 'Сохранить файл', icon: 'share', primary: true, onClick: () => shareOrDownload(ready) },
        ]);
      } catch (e) {
        toast(`Ошибка экспорта: ${e.message || e}`);
      }
    }
    el.querySelector('[data-counted]').addEventListener('change', async (e) => {
      // Re-read: the sync may have updated the stored ride since this screen loaded it.
      const fresh = (await getRide(ride.id)) || ride;
      fresh.excluded = ride.excluded = !e.target.checked;
      if (!fresh.excluded) fresh.synced = null; // upload again
      await putRide(fresh);
      if (getMe()) syncRides().then(() => toast(ride.excluded ? 'Поездка убрана из рейтинга' : 'Поездка учтена в рейтинге'))
        .catch(() => toast('Нет связи с сервером, обновится позже'));
    });
    async function dropSensors() {
      if (!confirm(`Удалить данные датчиков (~${fmtBytes(sensorBytes(ride))})? Маршрут, статистика и место в рейтинге останутся, `
        + 'но пересчитать наклон новой версией алгоритма будет нельзя.')) return;
      await dropSensorData(ride);
      toast('Данные датчиков удалены');
      navigate(`#/ride/${ride.id}`);
    }
    async function removeRide() {
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
    }
    const runs = routeByZone(gps, zones);
    const mapBox = el.querySelector('[data-map]');
    drawRoute(mapBox, runs, { animate: true, bottom: 90 }).then((d) => { // the title covers the bottom
      if (alive) disposeMap = d; else d();
    });
    drawChart(ride, s, gps);
    countUp(el.querySelectorAll('.grid.stats .value, .record-banner span b'));
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
