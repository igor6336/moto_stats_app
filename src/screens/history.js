import { listRides, getGpsData, deleteRide } from '../storage.js';
import { computeRecords, RECORD_METRICS } from '../records.js';
import { prepareTrack } from '../algo/stats.js';
import { routeThumb } from '../map.js';
import { getMe } from '../social/client.js';
import { deleteRemoteRide } from '../social/rides.js';
import { fmtSpeed, speedUnit, fmtDistance, fmtDuration, fmtDate } from '../format.js';
import { icon } from '../icons.js';
import { h, toast } from '../ui.js';

export function mountHistory(root, { navigate }) {
  const el = h(`<section class="screen history">
    <div class="title-row"><h1>История</h1><button class="btn small ghost" data-select hidden>Выбрать</button></div>
    <div data-records></div>
    <div class="list" data-list><div class="loading">Загрузка</div></div>
  </section>`);
  root.appendChild(el);
  let alive = true;
  let rides = [];
  let selecting = false;
  const selected = new Set();
  const thumbCache = new Map(); // ride id -> svg, kept across re-renders
  let bar = null;

  const selectBtn = el.querySelector('[data-select]');
  selectBtn.addEventListener('click', () => (selecting ? stopSelecting() : startSelecting()));

  function startSelecting() {
    selecting = true;
    selected.clear();
    selectBtn.textContent = 'Отмена';
    el.classList.add('selecting');
    showBar();
    render();
  }

  function stopSelecting() {
    selecting = false;
    selected.clear();
    selectBtn.textContent = 'Выбрать';
    el.classList.remove('selecting');
    bar?.remove();
    bar = null;
    render();
  }

  const selectable = () => rides.filter((r) => r.status !== 'recording');

  function showBar() {
    bar = h(`<div class="select-bar">
      <button class="btn ghost" data-all></button>
      <button class="btn danger" data-del></button>
    </div>`);
    document.getElementById('overlay-root').append(bar);
    bar.querySelector('[data-all]').addEventListener('click', () => {
      const all = selectable();
      if (selected.size === all.length) selected.clear();
      else all.forEach((r) => selected.add(r.id));
      render();
    });
    bar.querySelector('[data-del]').addEventListener('click', removeSelected);
    updateBar();
  }

  function updateBar() {
    if (!bar) return;
    const n = selected.size;
    bar.querySelector('[data-all]').textContent = n && n === selectable().length ? 'Снять все' : 'Выбрать все';
    const del = bar.querySelector('[data-del]');
    del.innerHTML = `${icon('trash-2')}Удалить${n ? ` (${n})` : ''}`;
    del.disabled = !n;
  }

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const word = ids.length === 1 ? 'поездку' : ids.length < 5 ? 'поездки' : 'поездок';
    if (!confirm(`Удалить ${ids.length} ${word} вместе с данными? Это необратимо.`)) return;
    let failed = 0;
    for (const id of ids) {
      // Remove the leaderboard entry first; without network keep the ride
      // so it is not left orphaned on the server.
      if (getMe()) {
        try { await deleteRemoteRide(id); } catch { failed++; continue; }
      }
      await deleteRide(id);
      thumbCache.delete(id);
    }
    rides = await listRides();
    toast(failed
      ? `Удалено ${ids.length - failed}. ${failed} не удалось: нет связи с сервером`
      : `Удалено поездок: ${ids.length}`);
    stopSelecting();
  }

  function renderRecords() {
    const box = el.querySelector('[data-records]');
    const rec = computeRecords(rides);
    const items = RECORD_METRICS.filter((m) => rec[m.id]);
    box.innerHTML = items.length && !selecting ? `<div class="records">
      <div class="records-title">${icon('trophy')}Личные рекорды</div>
      <div class="records-grid">${items.map((m) => `<button class="rec" data-ride="${rec[m.id].ride.id}">
        <span>${m.label}</span><b>${m.fmt(rec[m.id].value)}</b><small>${new Date(rec[m.id].ride.startedAt).toLocaleDateString('ru-RU')}</small>
      </button>`).join('')}</div></div>` : '';
    box.querySelectorAll('[data-ride]').forEach((b) => b.addEventListener('click', () => navigate(`#/ride/${b.dataset.ride}`)));
  }

  function render() {
    renderRecords();
    const list = el.querySelector('[data-list]');
    selectBtn.hidden = !selectable().length;
    if (!rides.length) {
      list.innerHTML = `<div class="empty">${icon('route', 'big')}<br>Поездок пока нет.<br>Запишите первую на вкладке «Запись».</div>`;
      return;
    }
    list.innerHTML = '';
    const pending = [];
    for (const r of rides) {
      const s = r.summary;
      const locked = r.status === 'recording';
      const on = selected.has(r.id);
      const item = h(`
        <button class="ride-item ${on ? 'selected' : ''} ${selecting && locked ? 'locked' : ''}">
          ${selecting ? `<span class="check">${on ? icon('check') : ''}</span>` : ''}
          <div class="ri-thumb">${thumbCache.get(r.id) || icon('route')}</div>
          <div class="ri-main">
            <div class="ri-date">${fmtDate(r.startedAt)}
              ${locked ? '<span class="badge rec">идёт запись</span>' : ''}
              ${r.status === 'interrupted' ? '<span class="badge warn">прервана</span>' : ''}
            </div>
            <div class="ri-stats">
              <span>${icon('route')}${s ? fmtDistance(s.distance) : '—'}</span>
              <span>${icon('clock')}${s ? fmtDuration(s.duration) : '—'}</span>
              <span>${icon('zap')}${s ? fmtSpeed(s.maxSpeed) : '—'} ${speedUnit()}</span>
            </div>
          </div>
          ${selecting ? '' : `<span class="ri-chev">${icon('chevron-right')}</span>`}
        </button>`);
      item.addEventListener('click', () => {
        if (!selecting) { navigate(locked ? '#/record' : `#/ride/${r.id}`); return; }
        if (locked) return;
        if (selected.has(r.id)) selected.delete(r.id); else selected.add(r.id);
        render();
      });
      list.append(item);
      if (!thumbCache.has(r.id)) pending.push([r.id, item.querySelector('.ri-thumb')]);
    }
    updateBar();
    loadThumbs(pending);
  }

  // Route previews after the list is on screen, one ride at a time.
  async function loadThumbs(pending) {
    for (const [id, box] of pending) {
      if (!alive) return;
      const tr = prepareTrack((await getGpsData(id)).gps);
      const svg = routeThumb(tr.lat.map((la, i) => [la, tr.lon[i]]));
      thumbCache.set(id, svg || icon('route'));
      if (svg && box.isConnected) box.innerHTML = svg;
    }
  }

  listRides().then((r) => {
    if (!alive) return;
    rides = r;
    render();
  });

  return () => { alive = false; bar?.remove(); };
}
