import { socialConfigured, getMe, humanError } from '../social/client.js';
import { fetchBoardData, syncRides } from '../social/rides.js';
import { CATEGORIES, PERIODS, computeLeaderboard, myPosition } from '../algo/leaderboard.js';
import { avatarHtml } from '../social/avatar.js';
import { escapeHtml, fmtSpeed, speedUnit, fmtDistance, fmtDuration } from '../format.js';
import { h } from '../ui.js';
import { skeleton, countUp } from '../motion.js';

let category = 'maxSpeed';
let period = 'month';

// "Вы 4-й · до 2-го места 0.30 с" above the table.
function positionLine(cat, pos) {
  if (!pos) return `<div class="my-pos none">У вас нет результата за этот период</div>`;
  if (pos.total === 1) return `<div class="my-pos">Вы 1-й · пока без соперников</div>`;
  const tail = pos.gap !== undefined
    ? `до ${pos.nextRank}-го места ${fmtValue(cat.kind, pos.gap)}`
    : pos.lead ? `отрыв от 2-го места ${fmtValue(cat.kind, pos.lead)}` : 'делите первое место';
  return `<div class="my-pos ${pos.rank === 1 ? 'first' : ''}">Вы ${pos.rank}-й из ${pos.total} · ${tail}</div>`;
}

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
    <div class="board" data-board>${skeleton('rows', 4)}</div>
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
        Для этого нужна поездка со стойкой.</div>`;
      return;
    }
    if (!rows.length) { box.innerHTML = '<div class="empty">Нет поездок за этот период</div>'; return; }
    box.innerHTML = positionLine(cat, myPosition(rows, me.id)) + rows.map((r) => {
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
    countUp(box.querySelectorAll('.lb-val'));
    box.querySelectorAll('[data-user]').forEach((row) => row.addEventListener('click', () => {
      navigate(row.dataset.user === me.id ? '#/profile' : `#/rider/${row.dataset.user}`);
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
