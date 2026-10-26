import { recorder, isStandalone } from '../recorder.js';
import { wakeLockState, onWakeLockChange } from '../wakelock.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration } from '../format.js';
import { h, toast, longPress } from '../ui.js';

const STOP_HOLD_MS = 1200;
const UNLOCK_HOLD_MS = 1500;

export function mountRecord(root, { navigate }) {
  const el = h(`
    <section class="screen record">
      <div class="banner warn" data-standalone hidden>
        Откройте приложение с иконки на экране «Домой» (Поделиться → На экран «Домой»).
        Во вкладке Safari данные могут быть удалены.
      </div>
      <div class="banner error" data-error hidden></div>
      <div class="pills">
        <span class="pill" data-pill="gps">GPS</span>
        <span class="pill" data-pill="motion">Датчики</span>
        <span class="pill" data-pill="wake">Экран</span>
      </div>
      <div class="speed-block">
        <div class="speed" data-speed>—</div>
        <div class="speed-unit" data-unit></div>
      </div>
      <div class="rec-time" data-rectime></div>
      <div class="grid stats">
        <div class="stat"><div class="label">Дистанция</div><div class="value" data-v="distance">—</div></div>
        <div class="stat"><div class="label">В движении</div><div class="value" data-v="moving">—</div></div>
        <div class="stat"><div class="label">Макс.</div><div class="value" data-v="max">—</div></div>
        <div class="stat"><div class="label">Средняя</div><div class="value" data-v="avg">—</div></div>
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
    if (s.gps === 'ok' && recorder.gpsFresh()) {
      const acc = recorder.lastFix.accuracy;
      setPill('gps', acc <= 10 ? 'ok' : acc <= 25 ? 'mid' : 'bad', `GPS ±${Math.round(acc)} м`);
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

  function updateSpeed() {
    // No fresh fix: a small "нет GPS" instead of a number.
    const fresh = recorder.gpsFresh();
    const v = fresh ? fmtSpeed(recorder.lastFix.speed) : 'нет GPS';
    for (const node of [$('[data-speed]'), overlay?.speed]) {
      if (!node) continue;
      node.textContent = v;
      node.classList.toggle('stale', !fresh);
    }
    $('[data-unit]').textContent = speedUnit();
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
      box.innerHTML = recorder.state === 'idle' ? '' : 'Калибровки нет. Поставьте мотоцикл ровно (не на боковую подножку) и нажмите «Калибровка».';
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
      const b = h('<button class="btn primary xl">Включить датчики</button>');
      // prepare() must run synchronously in the tap handler for iOS.
      b.addEventListener('click', () => { recorder.prepare(); b.disabled = true; });
      box.append(b);
      return;
    }
    const calib = h('<button class="btn">Калибровка</button>');
    calib.disabled = !!recorder.calib;
    calib.addEventListener('click', runCalibration);
    if (state === 'ready') {
      const start = h('<button class="btn primary xl">Старт</button>');
      start.addEventListener('click', async () => {
        start.disabled = true;
        try { await recorder.start(); } catch (e) { toast(e.message); start.disabled = false; }
      });
      box.append(start, calib);
    } else if (state === 'recording') {
      const stop = h(`<button class="btn danger xl hold">Стоп<small>удерживайте</small></button>`);
      longPress(stop, STOP_HOLD_MS, async () => {
        const id = await recorder.stop();
        if (id) navigate(`#/ride/${id}`);
      });
      const black = h('<button class="btn">Чёрный<br>режим</button>');
      black.addEventListener('click', () => showOverlay('black'));
      const lock = h('<button class="btn">Блокировка</button>');
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
            <div class="hold-hint lock-badge">🔒 Заблокировано · удерживайте ${UNLOCK_HOLD_MS / 1000} с</div>
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
