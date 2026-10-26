import { socialConfigured, getMe, humanError } from '../social/client.js';
import { listFriends, addFriend, acceptFriend, removeFriend } from '../social/friends.js';
import { watchLocations, setSharing, sharingEnabled, ONLINE_MS } from '../social/location.js';
import { recorder } from '../recorder.js';
import { createMap } from '../map.js';
import { avatarHtml } from '../social/avatar.js';
import { copyCode } from './account.js';
import { escapeHtml, fmtSpeed, speedUnit } from '../format.js';
import { h, toast } from '../ui.js';

function lastSeen(loc) {
  if (!loc) return 'не делится местоположением';
  const ago = Date.now() - new Date(loc.updated_at).getTime();
  if (ago < ONLINE_MS) return loc.riding ? `в пути · ${fmtSpeed(loc.speed)} ${speedUnit()}` : 'в сети';
  const min = Math.round(ago / 60000);
  if (min < 60) return `был ${min} мин назад`;
  const hr = Math.round(min / 60);
  return hr < 48 ? `был ${hr} ч назад` : `был ${new Date(loc.updated_at).toLocaleDateString('ru-RU')}`;
}

export function mountFriends(root, { navigate }) {
  const el = h('<section class="screen friends"><h1>Друзья</h1><div data-body></div></section>');
  root.appendChild(el);
  const body = el.querySelector('[data-body]');
  let alive = true;
  let map = null;
  const markers = new Map(); // user_id -> { m: marker handle, lat, lon }
  let locations = new Map();
  let data = { friends: [], incoming: [], outgoing: [] };
  let unwatch = () => {};
  let fitted = false;

  if (!socialConfigured()) {
    body.innerHTML = '<div class="empty">Сервер друзей ещё не подключён.</div>';
    return () => {};
  }
  const me = getMe();
  if (!me) {
    body.innerHTML = `<div class="empty">Войдите или зарегистрируйтесь, чтобы видеть друзей на карте.</div>
      <button class="btn primary" data-go>Войти / Регистрация</button>`;
    body.querySelector('[data-go]').addEventListener('click', () => navigate('#/account'));
    return () => {};
  }

  recorder.startGps();
  body.innerHTML = `
    <div class="map friends-map" data-map></div>
    <label class="switch-row">
      <span>Показывать меня друзьям<small>Только пока приложение открыто</small></span>
      <input type="checkbox" data-share ${sharingEnabled() ? 'checked' : ''}>
    </label>
    <div class="code-box">
      <span>Ваш код</span><b>${escapeHtml(me.public_id)}</b>
      <button class="btn" data-copy>Скопировать</button>
    </div>
    <form class="add-friend" data-add>
      <input name="code" placeholder="Код друга" autocapitalize="characters" autocorrect="off" spellcheck="false" required>
      <button class="btn primary" type="submit">Добавить</button>
    </form>
    <div data-lists><div class="loading">Загрузка…</div></div>`;

  body.querySelector('[data-copy]').addEventListener('click', () => copyCode(me.public_id));
  body.querySelector('[data-share]').addEventListener('change', async (e) => {
    try {
      await setSharing(e.target.checked);
      toast(e.target.checked ? 'Друзья видят вас, пока приложение открыто' : 'Режим невидимки');
    } catch (err) { toast(humanError(err)); }
  });
  body.querySelector('[data-add]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.code;
    try {
      const r = await addFriend(input.value);
      input.value = '';
      toast(r.accepted ? `${r.profile.name} теперь в друзьях` : `Запрос отправлен: ${r.profile.name}`);
      refresh();
    } catch (err) { toast(humanError(err), 4000); }
  });

  function personRow(p, actions = '') {
    const loc = locations.get(p.id);
    const online = loc && Date.now() - new Date(loc.updated_at).getTime() < ONLINE_MS;
    return `<div class="person" data-id="${escapeHtml(p.id)}">
      ${avatarHtml(p)}
      <div class="person-main">
        <div class="person-name">${escapeHtml(p.name)}</div>
        <div class="person-sub">${escapeHtml(p.bike || '')}${p.bike ? ' · ' : ''}<span class="${online ? 'online' : ''}">${escapeHtml(lastSeen(loc))}</span></div>
      </div>
      ${actions}
    </div>`;
  }

  function renderLists() {
    const box = body.querySelector('[data-lists]');
    const { friends, incoming, outgoing } = data;
    box.innerHTML = `
      ${incoming.length ? `<h2>Запросы в друзья</h2>${incoming.map((p) => personRow(p,
        `<button class="btn small primary" data-accept="${escapeHtml(p.id)}">Принять</button>
         <button class="btn small ghost" data-remove="${escapeHtml(p.id)}">✕</button>`)).join('')}` : ''}
      <h2>Друзья (${friends.length})</h2>
      ${friends.length ? friends.map((p) => personRow(p, `<button class="btn small ghost" data-remove="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">⋯</button>`)).join('')
        : '<div class="hint">Пока никого. Обменяйтесь кодами с друзьями.</div>'}
      ${outgoing.length ? `<h2>Ожидают ответа</h2>${outgoing.map((p) => personRow(p,
        `<button class="btn small ghost" data-remove="${escapeHtml(p.id)}">Отменить</button>`)).join('')}` : ''}`;
    box.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
      try { await acceptFriend(b.dataset.accept); toast('Добавлен в друзья'); refresh(); } catch (err) { toast(humanError(err)); }
    }));
    box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.name && !confirm(`Удалить ${b.dataset.name} из друзей?`)) return;
      try { await removeFriend(b.dataset.remove); refresh(); } catch (err) { toast(humanError(err)); }
    }));
    box.querySelectorAll('.person').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const loc = locations.get(row.dataset.id);
      if (loc && map) { map.setView(loc.lat, loc.lon, 15); el.scrollTop = 0; document.getElementById('view').scrollTop = 0; }
    }));
  }

  function profileOf(id) {
    if (id === me.id) return getMe();
    return data.friends.find((p) => p.id === id);
  }

  function updateMarkers() {
    if (!map) return;
    const seen = new Set();
    for (const loc of locations.values()) {
      const p = profileOf(loc.user_id);
      if (!p) continue;
      seen.add(loc.user_id);
      const online = Date.now() - new Date(loc.updated_at).getTime() < ONLINE_MS;
      const html = `<div class="fmark ${online ? 'on' : ''} ${loc.riding && online ? 'riding' : ''} ${p.id === me.id ? 'me' : ''}">
          ${avatarHtml(p)}<span>${escapeHtml(p.id === me.id ? 'Вы' : p.name)}</span></div>`;
      const e = markers.get(loc.user_id);
      if (!e) markers.set(loc.user_id, { m: map.addMarker(loc.lat, loc.lon, html), lat: loc.lat, lon: loc.lon, html });
      else if (e.lat !== loc.lat || e.lon !== loc.lon || e.html !== html) {
        e.m.update(loc.lat, loc.lon, e.html !== html ? html : undefined);
        Object.assign(e, { lat: loc.lat, lon: loc.lon, html });
      }
    }
    for (const [id, e] of markers) if (!seen.has(id)) { e.m.remove(); markers.delete(id); }
    if (!fitted && markers.size) {
      fitted = true;
      const pts = [...markers.values()].map((e) => [e.lat, e.lon]);
      if (pts.length === 1) map.setView(pts[0][0], pts[0][1], 13);
      else map.fit(pts, 48);
    }
  }

  async function refresh() {
    try {
      data = await listFriends();
      if (!alive) return;
      renderLists();
      updateMarkers();
    } catch (err) {
      body.querySelector('[data-lists]').innerHTML = `<div class="empty">${escapeHtml(humanError(err))}</div>`;
    }
  }

  (async () => {
    try {
      const m = await createMap(body.querySelector('[data-map]'));
      if (!alive) { m.destroy(); return; }
      map = m;
    } catch {
      body.querySelector('[data-map]').innerHTML = '<div class="map-empty">Карта недоступна без сети</div>';
    }
    await refresh();
    try {
      unwatch = await watchLocations((rows) => {
        locations = new Map(rows.map((r) => [r.user_id, r]));
        if (!alive) return;
        updateMarkers();
        renderLists();
      });
      if (!alive) unwatch();
    } catch (err) { console.warn(err); }
  })();

  // "Online" and "last seen" age without new events.
  const timer = setInterval(() => { updateMarkers(); renderLists(); }, 30000);

  return () => {
    alive = false;
    clearInterval(timer);
    unwatch();
    map?.destroy();
  };
}
