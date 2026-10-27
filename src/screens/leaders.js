import { socialConfigured, getMe, humanError } from '../social/client.js';
import { fetchBoardData, syncRides } from '../social/rides.js';
import { CATEGORIES, PERIODS, computeLeaderboard } from '../algo/leaderboard.js';
import { avatarHtml } from '../social/avatar.js';
import { escapeHtml, fmtSpeed, speedUnit, fmtDistance, fmtDuration } from '../format.js';
import { h } from '../ui.js';

let category = 'maxSpeed';
let period = 'month';

function fmtValue(kind, v) {
  if (kind === 'speed') return `${fmtSpeed(v)} ${speedUnit()}`;
  if (kind === 'distance') return fmtDistance(v);
  if (kind === 'duration') return fmtDuration(v);
  if (kind === 'time') return `${v.toFixed(2)} с`;
  if (kind === 'angle') return `${Math.round(v)}°`;
  return String(v);
}

export function mountLeaders(root, { navigate }) {
  const el = h('<section class="screen leaders"><h1>Лидеры</h1><div data-body></div></section>');
  root.appendChild(el);
  const body = el.querySelector('[data-body]');
  let alive = true;
  let board = null;

  if (!socialConfigured()) {
    body.innerHTML = '<div class="empty">Сервер друзей ещё не подключён.</div>';
    return () => {};
  }
  const me = getMe();
  if (!me) {
    body.innerHTML = `<div class="empty">Войдите, чтобы соревноваться с друзьями.</div>
      <button class="btn primary" data-go>Войти / Регистрация</button>`;
    body.querySelector('[data-go]').addEventListener('click', () => navigate('#/account'));
    return () => {};
  }

  body.innerHTML = `
    <div class="chips" data-cats>${CATEGORIES.map((c) => `<button data-cat="${c.id}">${c.label}</button>`).join('')}</div>
    <div class="seg" data-periods>${PERIODS.map((p) => `<button data-period="${p.id}">${p.label}</button>`).join('')}</div>
    <div class="board" data-board><div class="loading">Загрузка…</div></div>
    <p class="hint">Среди вас и ваших друзей. «Лучшая средняя» — поездки от 10 км.
      Разгоны считаются по GPS (1 раз в секунду), точность около ±0,3–0,6 с. Замеры — только на закрытой площадке.</p>`;

  body.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { category = b.dataset.cat; render(); }));
  body.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; render(); }));

  function render() {
    body.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === category));
    body.querySelectorAll('[data-period]').forEach((b) => b.classList.toggle('on', b.dataset.period === period));
    if (!board) return;
    const cat = CATEGORIES.find((c) => c.id === category);
    const rows = computeLeaderboard(board.rides, category, period);
    const box = body.querySelector('[data-board]');
    if (cat.pending && !rows.length) {
      box.innerHTML = `<div class="empty">Появится после настройки алгоритма стойки.<br>
        Для этого нужна поездка со стойкой и калибровкой перед стартом.</div>`;
      return;
    }
    if (!rows.length) { box.innerHTML = '<div class="empty">Нет поездок за этот период</div>'; return; }
    box.innerHTML = rows.map((r) => {
      const p = board.profiles.get(r.userId) || { name: '?' };
      const bike = r.best?.bike || p.bike || '';
      return `<div class="lb-row tappable ${r.userId === me.id ? 'me' : ''}" data-user="${escapeHtml(r.userId)}">
        <div class="lb-rank r${r.rank}">${r.rank}</div>
        ${avatarHtml(p)}
        <div class="person-main">
          <div class="person-name">${escapeHtml(p.name)}${r.userId === me.id ? ' (вы)' : ''}</div>
          <div class="person-sub">${escapeHtml(bike)}${r.best ? `${bike ? ' · ' : ''}${new Date(r.best.started_at).toLocaleDateString('ru-RU')}` : ''}</div>
        </div>
        <div class="lb-val">${fmtValue(cat.kind, r.value)}</div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-user]').forEach((row) => row.addEventListener('click', () => {
      navigate(row.dataset.user === me.id ? '#/account' : `#/rider/${row.dataset.user}`);
    }));
  }

  render();
  (async () => {
    try {
      await syncRides();
      board = await fetchBoardData();
      if (alive) render();
    } catch (err) {
      if (alive) body.querySelector('[data-board]').innerHTML = `<div class="empty">${escapeHtml(humanError(err))}</div>`;
    }
  })();

  return () => { alive = false; };
}
