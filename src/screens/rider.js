import { getMe, humanError } from '../social/client.js';
import { fetchRider, removeFriend } from '../social/friends.js';
import { ONLINE_MS } from '../social/location.js';
import { riderStats } from '../algo/leaderboard.js';
import { createMap } from '../map.js';
import { avatarHtml } from '../social/avatar.js';
import { lastSeen } from './friends.js';
import { escapeHtml, fmtSpeed, speedUnit, fmtDistance, fmtDuration, fmtDate } from '../format.js';
import { h, toast } from '../ui.js';

const RECENT = 10;

const sec = (v) => (v ? `${v.toFixed(2)} с` : '—');

function statsGrid(s) {
  const u = speedUnit();
  const cell = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  return `<div class="grid stats">
    ${cell('Поездок', s.rides)}
    ${cell('Пробег', fmtDistance(s.distance))}
    ${cell('В седле', fmtDuration(s.moving))}
    ${cell('Макс.', s.maxSpeed ? `${fmtSpeed(s.maxSpeed)}<small> ${u}</small>` : '—')}
    ${cell('Длиннейшая', s.longest ? fmtDistance(s.longest) : '—')}
    ${cell('Средняя', s.bestAvg ? `${fmtSpeed(s.bestAvg)}<small> ${u}</small>` : '—')}
    ${cell('0–100', sec(s.a0_100))}
    ${cell('100–200', sec(s.a100_200))}
    ${cell('0–200', sec(s.a0_200))}
  </div>`;
}

export function mountRider(root, { params, navigate }) {
  const el = h('<section class="screen rider"><div class="loading">Загрузка…</div></section>');
  root.appendChild(el);
  let alive = true;
  let map = null;
  let period = 'all';
  let info = null;

  const me = getMe();
  if (!me) { navigate('#/friends'); return () => {}; }
  if (params.id === me.id) { navigate('#/account'); return () => {}; }

  function render() {
    const { profile: p, rides, location: loc, friendship } = info;
    const online = loc && Date.now() - new Date(loc.updated_at).getTime() < ONLINE_MS;
    const isFriend = friendship?.status === 'accepted';
    el.innerHTML = `
      <button class="btn ghost back" data-back>‹ Назад</button>
      <div class="profile-card">
        ${avatarHtml(p, 'avatar xl')}
        <div>
          <div class="pc-name">${escapeHtml(p.name)}</div>
          <div class="pc-bike">${escapeHtml(p.bike || 'мотоцикл не указан')}</div>
          <div class="pc-login ${online ? 'online' : ''}">${escapeHtml(isFriend ? lastSeen(loc) : 'не в друзьях')}</div>
        </div>
      </div>
      ${isFriend && loc ? '<div class="map rider-map" data-map></div>' : ''}
      <div class="seg" data-periods>
        <button data-period="all" class="${period === 'all' ? 'on' : ''}">Всё время</button>
        <button data-period="month" class="${period === 'month' ? 'on' : ''}">Месяц</button>
        <button data-period="week" class="${period === 'week' ? 'on' : ''}">Неделя</button>
      </div>
      ${statsGrid(riderStats(rides, period))}
      <h2>Последние поездки</h2>
      ${rides.length ? rides.slice(0, RECENT).map((r) => `
        <div class="ride-item static">
          <div class="ri-date">${fmtDate(new Date(r.started_at).getTime())}</div>
          <div class="ri-stats">
            <span>${fmtDistance(r.distance_m)}</span>
            <span>${fmtDuration(r.moving_s)}</span>
            <span>макс. ${fmtSpeed(r.max_speed_ms)} ${speedUnit()}</span>
            ${r.accel_0_100_s ? `<span>0–100 ${sec(r.accel_0_100_s)}</span>` : ''}
          </div>
        </div>`).join('') : '<div class="hint">Поездок пока нет</div>'}
      <div class="kv">
        <div><span>Код</span><b>${escapeHtml(p.public_id)}</b></div>
        ${friendship ? `<div><span>${isFriend ? 'Друзья с' : 'Запрос отправлен'}</span><b>${new Date(friendship.created_at).toLocaleDateString('ru-RU')}</b></div>` : ''}
      </div>
      ${friendship ? `<div class="actions"><button class="btn danger ghost" data-remove>${isFriend ? 'Удалить из друзей' : 'Отменить запрос'}</button></div>` : ''}`;

    el.querySelector('[data-back]').addEventListener('click', () => history.back());
    el.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
      period = b.dataset.period;
      map?.destroy();
      map = null;
      render();
    }));
    el.querySelector('[data-remove]')?.addEventListener('click', async () => {
      if (isFriend && !confirm(`Удалить ${p.name} из друзей?`)) return;
      try {
        await removeFriend(p.id);
        toast('Готово');
        navigate('#/friends');
      } catch (err) { toast(humanError(err)); }
    });
    const box = el.querySelector('[data-map]');
    if (box) {
      createMap(box, { center: [loc.lat, loc.lon], zoom: 13 }).then((m) => {
        if (!alive || !box.isConnected) { m.destroy(); return; }
        map = m;
        m.addMarker(loc.lat, loc.lon, `<div class="fmark ${online ? 'on' : ''} ${loc.riding && online ? 'riding' : ''}">${avatarHtml(p)}</div>`);
      }).catch(() => { box.innerHTML = '<div class="map-empty">Карта недоступна без сети</div>'; });
    }
  }

  fetchRider(params.id).then((data) => {
    if (!alive) return;
    if (!data.profile) { el.innerHTML = '<div class="empty">Райдер не найден</div>'; return; }
    info = data;
    render();
  }).catch((err) => {
    if (alive) el.innerHTML = `<div class="empty">${escapeHtml(humanError(err))}</div>`;
  });

  return () => { alive = false; map?.destroy(); };
}
