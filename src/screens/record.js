import { recorder, isStandalone } from '../recorder.js';
import { wakeLockState, onWakeLockChange } from '../wakelock.js';
import { fmtSpeed, speedUnit, speedValue, fmtDistance, fmtDuration } from '../format.js';
import { getSettings } from '../settings.js';
import { currentTheme } from '../theme.js';
import { DEFAULTS } from '../algo/stats.js';
import { icon } from '../icons.js';
import { h, toast, longPress } from '../ui.js';

const STOP_HOLD_MS = 1200;

// Speed gauge: a 270° arc around the number, full at 240 km/h (150 mph).
const ARC = 'M 40.6 159.4 A 84 84 0 1 1 159.4 159.4';
const ARC_LEN = 84 * Math.PI * 1.5;
// Colour runs along the arc (SVG has no conic gradient): short segments
// coloured from white to violet, revealed by the arc-shaped mask.
// On a light background white would vanish: the light theme starts pale blue.
const GAUGE_STOPS = {
  dark: [[0, [255, 255, 255]], [0.3, [125, 211, 252]], [0.6, [59, 130, 246]], [0.82, [79, 70, 229]], [1, [109, 40, 217]]],
  light: [[0, [186, 230, 253]], [0.3, [56, 189, 248]], [0.6, [37, 99, 235]], [0.82, [67, 56, 202]], [1, [91, 33, 182]]],
};
function gaugeColor(f, stops) {
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < f) i++;
  const [f0, c0] = stops[i - 1], [f1, c1] = stops[i];
  const k = Math.min(1, Math.max(0, (f - f0) / (f1 - f0)));
  return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
}
function gaugeSegments(stops, n = 72) {
  const pt = (deg) => { const a = (deg * Math.PI) / 180; return `${(100 + 84 * Math.cos(a)).toFixed(2)} ${(100 + 84 * Math.sin(a)).toFixed(2)}`; };
  let out = '';
  for (let i = -2; i < n + 2; i++) { // a little past both ends for the round caps
    const a0 = 135 + (270 * i) / n, a1 = 135 + (270 * (i + 1.15)) / n;
    out += `<path d="M ${pt(a0)} A 84 84 0 0 1 ${pt(a1)}" stroke="${gaugeColor(Math.min(1, Math.max(0, (i + 0.5) / n)), stops)}"/>`;
  }
  return out;
}
const gaugeSvg = (theme) => `<svg class="gauge" viewBox="0 0 200 180" aria-hidden="true">
  <defs><mask id="gauge-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="180">
    <path class="bar" data-gauge d="${ARC}" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${ARC_LEN}" stroke-dashoffset="${ARC_LEN}" opacity="0"/>
  </mask></defs>
  <path class="track" d="${ARC}" fill="none" stroke-width="10" stroke-linecap="round"/>
  <path class="ticks" d="M 49.1 150.9 A 72 72 0 1 1 150.9 150.9" fill="none" stroke-width="5" stroke-dasharray="1.5 15.46"/>
  <g class="bar-glow"><g mask="url(#gauge-mask)" fill="none" stroke-width="14">${gaugeSegments(GAUGE_STOPS[theme])}</g></g>
</svg>`;
const UNLOCK_HOLD_MS = 1500;

export function mountRecord(root, { navigate }) {
  const el = h(`
    <section class="screen record">
      <div class="banner warn" data-standalone hidden>
        Откройте приложение с иконки на экране «Домой» (Поделиться → На экран «Домой»).
        Во вкладке Safari данные могут быть удалены.
      </div>
      <div class="banner error" data-error hidden></div>
      <div class="banner warn" data-weak hidden></div>
      <div class="pills">
        <span class="pill" data-pill="gps">GPS</span>
        <span class="pill" data-pill="motion">Датчики</span>
        <span class="pill" data-pill="wake">Экран</span>
      </div>
      <div class="speed-block">
        ${gaugeSvg(currentTheme())}
        <div class="speed-inner">
          <div class="speed" data-speed>—</div>
          <div class="speed-unit" data-unit></div>
        </div>
      </div>
      <div class="rec-time" data-rectime></div>
      <div class="grid stats">
        <div class="stat"><div class="label">${icon('route')}Дистанция</div><div class="value" data-v="distance">—</div></div>
        <div class="stat"><div class="label">${icon('timer')}В движении</div><div class="value" data-v="moving">—</div></div>
        <div class="stat"><div class="label">${icon('zap')}Макс.</div><div class="value" data-v="max">—</div></div>
        <div class="stat"><div class="label">${icon('activity')}Средняя</div><div class="value" data-v="avg">—</div></div>
      </div>
      <div class="calib" data-calib></div>
      <div class="actions" data-actions></div>
    </section>`);
  root.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const overlayRoot = document.getElementById('overlay-root');
  let overlay = null;
  let lastState = null;
  let calibCountdown = null;

  $('[data-standalone]').hidden = isStandalone();

  function setPill(name, cls, text) {
    const p = $(`[data-pill="${name}"]`);
    p.className = `pill ${cls}`;
    p.textContent = text;
  }

  function updatePills() {
    const s = recorder.status;
    const weak = weakGps();
    const banner = $('[data-weak]');
    banner.hidden = !weak;
    if (weak) {
      banner.textContent = recorder.recording
        ? 'Глушение GPS: маршрут пишется приблизительно, скорость и разгоны не замеряются. Запись продолжается.'
        : 'Слабый GPS: скорость не показывается. Начинайте запись — маршрут запишется приблизительно, замеры включатся сами, когда сигнал вернётся.';
    }
    if (s.gps === 'ok' && recorder.gpsFresh()) {
      const acc = recorder.lastFix.accuracy;
      setPill('gps', acc <= 10 ? 'ok' : 'mid', `GPS ${weak ? 'слабый ' : ''}±${Math.round(acc)} м`);
    } else if (s.gps === 'denied') setPill('gps', 'bad', 'GPS запрещён');
    else if (s.gps === 'unsupported') setPill('gps', 'bad', 'GPS нет');
    else if (s.gps === 'off') setPill('gps', '', 'GPS');
    else setPill('gps', 'mid', s.gpsError === 'timeout' || s.gps === 'ok' ? 'GPS нет сигнала' : 'GPS поиск…');

    // Data actually arriving wins over the reported permission state.
    if (s.motion === 'ok') setPill('motion', recorder.motionHz >= 50 ? 'ok' : 'mid', `Датчики ${recorder.motionHz} Гц`);
    else if (s.permission === 'denied') setPill('motion', 'bad', 'Датчики запрещены');
    else if (s.motion === 'none') setPill('motion', 'bad', 'Датчики: нет данных');
    else if (s.motion === 'waiting') setPill('motion', 'mid', 'Датчики…');
    else setPill('motion', '', 'Датчики');

    const w = wakeLockState();
    setPill('wake', { on: 'ok', lost: 'mid', unsupported: 'bad', off: '' }[w],
      { on: 'Экран вкл', lost: 'Экран: повтор…', unsupported: 'Wake Lock нет', off: 'Экран' }[w]);
  }

  // A fix worse than the algorithm accepts (Wi-Fi/cell position under GPS
  // jamming): its speed is position noise, so none is shown.
  const weakGps = () => recorder.gpsFresh() && recorder.lastFix.accuracy > DEFAULTS.maxAccuracy;

  function updateSpeed() {
    // No usable fix: a small "нет GPS" / "слабый GPS" instead of a number.
    const weak = weakGps();
    const fresh = recorder.gpsFresh() && !weak;
    const v = fresh ? fmtSpeed(recorder.lastFix.speed) : weak ? 'слабый GPS' : 'нет GPS';
    for (const node of [$('[data-speed]'), overlay?.speed]) {
      if (!node) continue;
      node.textContent = v;
      node.classList.toggle('stale', !fresh);
      node.classList.toggle('weak', weak);
    }
    $('[data-unit]').textContent = speedUnit();
    const full = getSettings().units === 'mph' ? 150 : 240;
    const frac = fresh ? Math.max(0, Math.min(1, speedValue(recorder.lastFix.speed) / full)) : 0;
    const bar = $('[data-gauge]');
    bar.setAttribute('stroke-dashoffset', String(ARC_LEN * (1 - frac)));
    bar.setAttribute('opacity', frac > 0.004 ? '1' : '0');
  }

  function updateStats() {
    const s = recorder.live;
    $('[data-v="distance"]').textContent = s ? fmtDistance(s.distance) : '—';
    $('[data-v="moving"]').textContent = s ? fmtDuration(s.movingTime) : '—';
    $('[data-v="max"]').textContent = s ? fmtSpeed(s.maxSpeed) : '—';
    $('[data-v="avg"]').textContent = s ? fmtSpeed(s.avgMovingSpeed) : '—';
    const rt = $('[data-rectime]');
    if (recorder.recording) {
      rt.innerHTML = `<span class="rec-dot"></span> ЗАПИСЬ ${fmtDuration((Date.now() - recorder.ride.startedAt) / 1000)}`;
    } else rt.textContent = '';
    if (overlay?.status) overlay.status.textContent = recorder.recording ? rt.textContent : '';
  }

  function updateCalib() {
    const c = recorder.calibration;
    const box = $('[data-calib]');
    if (recorder.calib) {
      box.innerHTML = `<b>Калибровка… ${calibCountdown ?? ''}</b><br>Мотоцикл ровно и вертикально, не трогать.`;
      return;
    }
    if (!c) {
      box.innerHTML = recorder.state === 'idle' ? '' : 'Калибровка не обязательна: наклон считается по прямым участкам поездки. Для коротких поездок по кругу — мотоцикл ровно (не на подножке) и «Калибровка».';
      return;
    }
    const dev = recorder.deviation();
    const age = Math.round((Date.now() - c.at) / 60000);
    box.innerHTML = `${c.ok ? 'Калибровка OK' : '<span class="bad-text">Калибровка с шумом: повторите</span>'}
      · ${age < 1 ? 'только что' : `${age} мин назад`}
      ${Number.isFinite(dev) ? `<br>Отклонение от калибровки: <b>${dev.toFixed(1)}°</b>` : ''}`;
  }

  function renderActions() {
    const box = $('[data-actions]');
    box.innerHTML = '';
    const state = recorder.state;
    if (state === 'idle') {
      const b = h(`<button class="btn primary xl">${icon('satellite')}Включить датчики</button>`);
      // prepare() must run synchronously in the tap handler for iOS.
      b.addEventListener('click', () => { recorder.prepare(); b.disabled = true; });
      box.append(b);
      return;
    }
    const calib = h(`<button class="btn">${icon('crosshair')}Калибровка</button>`);
    calib.disabled = !!recorder.calib;
    calib.addEventListener('click', runCalibration);
    if (state === 'ready') {
      const start = h(`<button class="btn primary xl">${icon('play')}Старт</button>`);
      start.addEventListener('click', async () => {
        start.disabled = true;
        try { await recorder.start(); } catch (e) { toast(e.message); start.disabled = false; }
      });
      box.append(start, calib);
    } else if (state === 'recording') {
      const stop = h(`<button class="btn danger xl hold">${icon('square')}<span class="stack">Стоп<small>удерживайте</small></span></button>`);
      longPress(stop, STOP_HOLD_MS, async () => {
        const id = await recorder.stop();
        if (id) navigate(`#/ride/${id}`);
      });
      const black = h(`<button class="btn">${icon('moon')}Чёрный режим</button>`);
      black.addEventListener('click', () => showOverlay('black'));
      const lock = h(`<button class="btn">${icon('lock')}Блокировка</button>`);
      lock.addEventListener('click', () => showOverlay('lock'));
      const row = h('<div class="row"></div>');
      row.append(black, lock, calib);
      box.append(stop, row);
    } else {
      box.append(h('<button class="btn xl" disabled>Сохранение…</button>'));
    }
  }

  async function runCalibration() {
    calibCountdown = 4;
    const timer = setInterval(() => { calibCountdown = Math.max(0, calibCountdown - 1); updateCalib(); }, 1000);
    const p = recorder.calibrate(4000);
    renderActions();
    updateCalib();
    const res = await p;
    clearInterval(timer);
    calibCountdown = null;
    renderActions();
    updateCalib();
    if (res && !res.ok) toast('Калибровка шумная или датчики не отвечают — повторите');
  }

  function showOverlay(kind) {
    hideOverlay();
    const o = kind === 'black'
      ? h(`<div class="overlay black hold-area">
            <div class="bm-status"></div>
            <div class="bm-speed">—</div>
            <div class="bm-unit">${speedUnit()}</div>
            <div class="hold-hint">удерживайте ${UNLOCK_HOLD_MS / 1000} с для выхода</div>
          </div>`)
      : h(`<div class="overlay lock hold-area">
            <div class="hold-hint lock-badge">${icon('lock')} Заблокировано · удерживайте ${UNLOCK_HOLD_MS / 1000} с</div>
          </div>`);
    overlayRoot.append(o);
    overlay = { el: o, speed: o.querySelector('.bm-speed'), status: o.querySelector('.bm-status') };
    longPress(o, UNLOCK_HOLD_MS, hideOverlay);
    updateSpeed();
    updateStats();
  }

  function hideOverlay() {
    overlay?.el.remove();
    overlay = null;
  }

  function onChange() {
    if (recorder.state !== lastState) {
      lastState = recorder.state;
      renderActions();
      if (recorder.state !== 'recording') hideOverlay();
    }
    const err = $('[data-error]');
    const st = recorder.status;
    const msg = st.storageError
      ? `Ошибка записи в память: ${st.storageError}`
      : st.permission === 'denied' && st.motion !== 'ok'
        ? 'Доступ к датчикам движения запрещён. Полностью закройте приложение (смахните), откройте снова и разрешите доступ.'
        : st.gps === 'denied'
          ? 'Доступ к геолокации запрещён: Настройки → Конфиденциальность → Службы геолокации → Safari / веб-сайты.'
          : '';
    err.hidden = !msg;
    err.textContent = msg;
    updatePills();
    updateCalib();
    updateStats();
  }
  function onGps() { updateSpeed(); updatePills(); updateStats(); }
  function onTick() { updatePills(); updateSpeed(); updateStats(); if (!recorder.calib) updateCalib(); }

  recorder.addEventListener('change', onChange);
  recorder.addEventListener('gps', onGps);
  recorder.addEventListener('tick', onTick);
  const offWake = onWakeLockChange(updatePills);
  onChange();
  updateSpeed();

  return () => {
    hideOverlay();
    recorder.removeEventListener('change', onChange);
    recorder.removeEventListener('gps', onGps);
    recorder.removeEventListener('tick', onTick);
    offWake();
  };
}
