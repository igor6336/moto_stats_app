// Profile: the account, season totals and personal records.
import { listRides } from '../storage.js';
import { socialConfigured, getMe, onMeChange, signOut, fetchAvatarFull } from '../social/client.js';
import { avatarHtml, safeAvatar, openAvatarViewer } from '../social/avatar.js';
import { shareInvite } from '../social/invite.js';
import { copyCode } from './account.js';
import { computeRecords, RECORD_METRICS } from '../records.js';
import { TOTAL_PERIODS, computeTotals, previousTotals, seasonByMonth } from '../totals.js';
import { fmtSpeed, speedUnit, fmtDistance, escapeHtml } from '../format.js';
import { countUp, skeleton } from '../motion.js';
import { h } from '../ui.js';
import { icon } from '../icons.js';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const PREV = { month: 'к прошлому месяцу', season: 'к прошлому сезону' };

// Time in motion: "12 ч 05 мин", or "45 мин" under an hour.
const hours = (s) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
};

// "+40% к прошлому месяцу" for distance; nothing without a previous period.
function trend(cur, prev, period) {
  if (!prev || !prev.distance) return '';
  const d = Math.round(((cur.distance - prev.distance) / prev.distance) * 100);
  return `<div class="trend ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}% пробега ${PREV[period]}</div>`;
}

export function mountProfile(root, { navigate }) {
  const el = h(`<section class="screen profile">
    <h1>Профиль</h1>
    <div data-account></div>
    <div data-totals>${skeleton('rows', 1)}</div>
    <div data-records></div>
  </section>`);
  root.appendChild(el);
  let rides = [];
  let period = 'season';
  let alive = true;

  function renderAccount() {
    const box = el.querySelector('[data-account]');
    if (!socialConfigured()) { box.innerHTML = ''; return; }
    const me = getMe();
    if (!me) {
      box.innerHTML = `<button class="account-row" data-login><span class="avatar avatar-empty">?</span>
        <span><b>Войти / Регистрация</b><small>Друзья, карта и лидеры</small></span><i>${icon('chevron-right')}</i></button>`;
      box.querySelector('[data-login]').addEventListener('click', () => navigate('#/account'));
      return;
    }
    box.innerHTML = `
      <div class="profile-card">
        ${avatarHtml(me, 'avatar xl')}
        <div>
          <div class="pc-name">${escapeHtml(me.name)}</div>
          <div class="pc-bike">${escapeHtml(me.bike || 'мотоцикл не указан')}</div>
          <div class="pc-login">@${escapeHtml(me.login)}</div>
        </div>
      </div>
      <div class="code-box">
        <span>Ваш код для друзей</span>
        <b>${escapeHtml(me.public_id)}</b>
        <div class="row">
          <button class="btn" data-copy>${icon('copy')}Копировать</button>
          <button class="btn primary" data-invite>${icon('share')}Пригласить</button>
        </div>
      </div>
      <div class="row profile-actions">
        <button class="btn" data-edit>${icon('pencil')}Изменить</button>
        <button class="btn danger ghost" data-logout>${icon('log-out')}Выйти</button>
      </div>`;
    box.querySelector('[data-copy]').addEventListener('click', () => copyCode(me.public_id));
    box.querySelector('[data-invite]').addEventListener('click', () => shareInvite(me));
    box.querySelector('[data-edit]').addEventListener('click', () => navigate('#/account'));
    box.querySelector('[data-logout]').addEventListener('click', async () => {
      if (!confirm('Выйти из аккаунта? Поездки на телефоне останутся.')) return;
      await signOut();
    });
    const photo = safeAvatar(me.avatar);
    if (photo) {
      const a = box.querySelector('.profile-card .avatar');
      a.classList.add('tappable');
      a.addEventListener('click', () => openAvatarViewer(photo, () => fetchAvatarFull(me.id)));
    }
  }

  function renderTotals() {
    const box = el.querySelector('[data-totals]');
    if (!rides.some((r) => r.summary && r.status !== 'recording')) {
      box.innerHTML = `<div class="empty">${icon('route', 'big')}<br>Здесь появятся пробег, время в движении и рекорды после первой поездки.</div>`;
      return;
    }
    const t = computeTotals(rides, period);
    const months = period === 'season' ? seasonByMonth(rides) : null;
    const maxM = months ? Math.max(1, ...months) : 1;
    box.innerHTML = `<h2>Статистика</h2><div class="totals">
      <div class="seg small">${TOTAL_PERIODS.map((p) => `<button data-tp="${p.id}" class="${p.id === period ? 'on' : ''}">${p.label}</button>`).join('')}</div>
      <div class="totals-grid">
        <div><span>Пробег</span><b>${fmtDistance(t.distance)}</b></div>
        <div><span>В движении</span><b>${hours(t.movingTime)}</b></div>
        <div><span>Поездок</span><b>${t.rides}</b></div>
        <div><span>Средняя</span><b>${t.rides ? `${fmtSpeed(t.avgSpeed)} <small>${speedUnit()}</small>` : '—'}</b></div>
      </div>
      ${trend(t, previousTotals(rides, period), period)}
      ${months ? `<div class="months">${months.map((d, i) => `<div class="mbar ${d ? '' : 'none'}">
        <i style="height:${Math.max(3, (d / maxM) * 100).toFixed(0)}%"></i><span>${MONTHS[i]}</span></div>`).join('')}</div>` : ''}
    </div>`;
    box.querySelectorAll('[data-tp]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.tp; renderTotals(); }));
    countUp(box.querySelectorAll('.totals-grid b'));
  }

  function renderRecords() {
    const box = el.querySelector('[data-records]');
    const rec = computeRecords(rides);
    const items = RECORD_METRICS.filter((m) => rec[m.id]);
    box.innerHTML = items.length ? `<h2>Личные рекорды</h2><div class="records">
      <div class="records-grid">${items.map((m) => `<button class="rec" data-ride="${rec[m.id].ride.id}">
        <span>${m.label}</span><b>${m.fmt(rec[m.id].value)}</b><small>${new Date(rec[m.id].ride.startedAt).toLocaleDateString('ru-RU')}</small>
      </button>`).join('')}</div></div>` : '';
    box.querySelectorAll('[data-ride]').forEach((b) => b.addEventListener('click', () => navigate(`#/ride/${b.dataset.ride}`)));
    countUp(box.querySelectorAll('.rec b'));
  }

  renderAccount();
  const off = onMeChange(() => { if (alive) renderAccount(); });
  listRides().then((r) => {
    if (!alive) return;
    rides = r;
    renderTotals();
    renderRecords();
  });
  return () => { alive = false; off(); };
}
