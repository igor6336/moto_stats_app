import { getMe, humanError } from '../social/client.js';
import { fetchRider, removeFriend } from '../social/friends.js';
import { ONLINE_MS } from '../social/location.js';
import { riderStats } from '../algo/leaderboard.js';
import { createMap } from '../map.js';
import { avatarHtml } from '../social/avatar.js';
import { lastSeen } from '../social/location.js';
import { escapeHtml, fmtSpeed, speedUnit } from '../format.js';
import { h, toast } from '../ui.js';
import { routeActions, routeSubtitle } from '../social/route.js';

const sec = (v) => (v ? `${v.toFixed(2)} с` : '—');

function statsGrid(s) {
  const u = speedUnit();
  const cell = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  const deg = (v) => (v ? `${Math.round(v)}°` : '—');
  // Same metrics as the leaderboard.
  return `<div class="grid stats">
    ${cell('Макс.', s.maxSpeed ? `${fmtSpeed(s.maxSpeed)}<small> ${u}</small>` : '—')}
    ${cell('Средняя', s.bestAvg ? `${fmtSpeed(s.bestAvg)}<small> ${u}</small>` : '—')}
    ${cell('Стойка', deg(s.wheelie))}
    ${cell('0–100', sec(s.a0_100))}
    ${cell('100–200', sec(s.a100_200))}
    ${cell('0–200', sec(s.a0_200))}
    ${cell('Наклон влево', deg(s.leanLeft))}
    ${cell('Наклон вправо', deg(s.leanRight))}
  </div>
  ${s.leanLeft || s.leanRight || s.wheelie ? '' : '<p class="hint">Наклон и стойка появятся после настройки алгоритма.</p>'}`;
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
      ${isFriend && loc ? `<div class="map rider-map" data-map></div>
        <div class="row route-row" data-route></div>
        <div class="hint route-hint">${escapeHtml(routeSubtitle(loc))}</div>` : ''}
      <div class="seg" data-periods>
        <button data-period="day" class="${period === 'day' ? 'on' : ''}">День</button>
        <button data-period="month" class="${period === 'month' ? 'on' : ''}">Месяц</button>
        <button data-period="all" class="${period === 'all' ? 'on' : ''}">Всё время</button>
      </div>
      ${statsGrid(riderStats(rides, period))}
      <div class="kv">
        <div><span>Код</span><b>${escapeHtml(p.public_id)}</b></div>
        ${friendship ? `<div><span>${isFriend ? 'Друзья с' : 'Запрос отправлен'}</span><b>${new Date(friendship.created_at).toLocaleDateString('ru-RU')}</b></div>` : ''}
      </div>
      ${friendship ? `<div class="actions"><button class="btn danger ghost" data-remove>${isFriend ? 'Удалить из друзей' : 'Отменить запрос'}</button></div>` : ''}`;

    el.querySelector('[data-back]').addEventListener('click', () => history.back());
    const routeBox = el.querySelector('[data-route]');
    if (routeBox) {
      // Only Yandex Maps here; the map marker sheet also offers the navigator.
      const maps = routeActions(loc)[0];
      const b = h('<button class="btn primary"></button>');
      b.textContent = maps.label;
      b.addEventListener('click', maps.onClick);
      routeBox.append(b);
    }
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
