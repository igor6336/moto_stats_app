import { socialConfigured, getMe, humanError } from '../social/client.js';
import { listFriends, addFriend, acceptFriend, removeFriend } from '../social/friends.js';
import { watchLocations, setSharing, sharingEnabled, ONLINE_MS, lastSeen } from '../social/location.js';

export { lastSeen };
import { recorder } from '../recorder.js';
import { createMap } from '../map.js';
import { openFullscreenMap, expandable } from '../fullmap.js';
import { avatarHtml } from '../social/avatar.js';
import { copyCode } from './account.js';
import { escapeHtml, fmtSpeed, speedUnit } from '../format.js';
import { h, toast, actionSheet } from '../ui.js';
import { icon } from '../icons.js';
import { routeAction, routeSubtitle } from '../social/route.js';


export function mountFriends(root, { navigate }) {
  const el = h('<section class="screen friends"><h1>Друзья</h1><div data-body></div></section>');
  root.appendChild(el);
  const body = el.querySelector('[data-body]');
  let alive = true;
  // Each open map (the small one, the full-screen one) keeps its own markers.
  const views = []; // { map, markers: Map(user_id -> { m, lat, lon, html }), fitted }
  let closeFull = () => {};
  let disposeSmall = () => {};
  let locations = new Map();
  let data = { friends: [], incoming: [], outgoing: [] };
  let unwatch = () => {};

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
    <div class="map-wrap"><div class="map friends-map" data-map></div></div>
    <label class="switch-row">
      <span>Показывать меня друзьям<small>Только пока приложение открыто</small></span>
      <input type="checkbox" data-share ${sharingEnabled() ? 'checked' : ''}>
    </label>
    <div class="code-box">
      <span>Ваш код</span><b>${escapeHtml(me.public_id)}</b>
      <button class="btn" data-copy>${icon('copy')}Копировать</button>
    </div>
    <form class="add-friend" data-add>
      <input name="code" placeholder="Код друга" autocapitalize="characters" autocorrect="off" spellcheck="false" required>
      <button class="btn primary" type="submit" aria-label="Добавить">${icon('user-plus')}</button>
    </form>
    <div data-lists><div class="loading">Загрузка…</div></div>`;

  body.querySelector('[data-copy]').addEventListener('click', () => copyCode(me.public_id));
  body.querySelector('[data-share]').addEventListener('change', async (e) => {
    try {
      await setSharing(e.target.checked);
      updateMarkers();
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
    // Accepted friends open their profile; pending requests have nothing to show yet.
    box.querySelectorAll('.person').forEach((row) => {
      if (!data.friends.some((p) => p.id === row.dataset.id)) return;
      row.classList.add('tappable');
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        navigate(`#/rider/${row.dataset.id}`);
      });
    });
  }

  function profileOf(id) {
    if (id === me.id) return getMe();
    return data.friends.find((p) => p.id === id);
  }

  // Own marker comes from this phone's GPS, so it is shown even in ghost
  // mode or when the fix is too coarse to send; the server row is only a
  // fallback before the first fix.
  function visibleLocations() {
    const out = [...locations.values()].filter((l) => l.user_id !== me.id);
    const fix = recorder.lastFix;
    if (fix) {
      out.push({ user_id: me.id, lat: fix.lat, lon: fix.lon, speed: fix.speed, riding: recorder.recording, updated_at: new Date().toISOString(), self: true });
    } else if (locations.has(me.id)) {
      out.push({ ...locations.get(me.id), self: true });
    }
    return out;
  }

  function updateMarkers() {
    const locs = visibleLocations();
    for (const view of views) updateView(view, locs);
  }

  function updateView({ map, markers, ...view }, locs) {
    const seen = new Set();
    for (const loc of locs) {
      const p = profileOf(loc.user_id);
      if (!p) continue;
      seen.add(loc.user_id);
      const online = Date.now() - new Date(loc.updated_at).getTime() < ONLINE_MS;
      const ghost = loc.self && !sharingEnabled();
      const riding = loc.riding && online;
      const label = loc.self ? (ghost ? 'Вы · невидимка' : 'Вы') : p.name;
      const speed = riding && Number.isFinite(loc.speed) ? `<b>${fmtSpeed(loc.speed)}</b>` : '';
      const html = `<div class="fmark ${online ? 'on' : ''} ${riding ? 'riding' : ''} ${loc.self ? 'me' : ''} ${ghost ? 'ghost' : ''}">
          ${avatarHtml(p)}<span>${escapeHtml(label)}${speed ? ' · ' : ''}${speed}</span></div>`;
      const e = markers.get(loc.user_id);
      const open = () => {
        if (loc.self) { navigate('#/account'); return; }
        const cur = locations.get(loc.user_id) || loc;
        actionSheet(p.name, routeSubtitle(cur), [
          routeAction(cur),
          { label: 'Профиль', icon: 'user', onClick: () => navigate(`#/rider/${loc.user_id}`) },
        ]);
      };
      if (!e) markers.set(loc.user_id, { m: map.addMarker(loc.lat, loc.lon, html, open), lat: loc.lat, lon: loc.lon, html });
      else if (e.lat !== loc.lat || e.lon !== loc.lon || e.html !== html) {
        e.m.update(loc.lat, loc.lon, e.html !== html ? html : undefined);
        Object.assign(e, { lat: loc.lat, lon: loc.lon, html });
      }
    }
    for (const [id, e] of markers) if (!seen.has(id)) { e.m.remove(); markers.delete(id); }
    if (!view.state.fitted && markers.size) {
      view.state.fitted = true;
      const pts = [...markers.values()].map((e) => [e.lat, e.lon]);
      if (pts.length === 1) map.setView(pts[0][0], pts[0][1], 13);
      else map.fit(pts, 48);
    }
  }

  function addView(map) {
    const view = { map, markers: new Map(), state: { fitted: false } };
    views.push(view);
    updateView(view, visibleLocations());
    return () => {
      views.splice(views.indexOf(view), 1);
      map.destroy();
    };
  }

  const LEGEND = `<div class="map-legend-items friends-legend">
    <div class="ml-item"><span class="dot" style="border-color:#4aa3ff"></span><span class="ml-label">Вы</span></div>
    <div class="ml-item"><span class="dot" style="border-color:var(--accent)"></span><span class="ml-label">Едет</span></div>
    <div class="ml-item"><span class="dot" style="border-color:var(--ok)"></span><span class="ml-label">В сети</span></div>
    <div class="ml-item"><span class="dot" style="border-color:#555"></span><span class="ml-label">Давно не заходил</span></div>
  </div>`;

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
      const box = body.querySelector('[data-map]');
      const m = await createMap(box);
      if (!alive) { m.destroy(); return; }
      disposeSmall = addView(m);
      // Button only: a tap on the small map may be a tap on a friend.
      expandable(box, () => {
        closeFull = openFullscreenMap(async (c) => addView(await createMap(c)), LEGEND);
      });
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
  const onGps = () => updateMarkers();
  recorder.addEventListener('gps', onGps);

  return () => {
    alive = false;
    recorder.removeEventListener('gps', onGps);
    clearInterval(timer);
    unwatch();
    closeFull();
    disposeSmall();
  };
}
