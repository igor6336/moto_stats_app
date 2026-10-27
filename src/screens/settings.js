import { getSettings, saveSettings, parseZones, DEFAULT_SETTINGS } from '../settings.js';
import { exportBackup, importFile } from '../export.js';
import { recoverInterrupted, isStandalone } from '../recorder.js';
import { listRides, sensorBytes } from '../storage.js';
import { dropSensorData } from '../ridelean.js';
import { fmtBytes } from '../format.js';
import { APP_VERSION } from '../version.js';
import { h, toast, exportButton } from '../ui.js';
import { getMe, socialConfigured } from '../social/client.js';
import { avatarHtml } from '../social/avatar.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

export function mountSettings(root, { navigate }) {
  const s = getSettings();
  const me = getMe();
  const el = h(`
    <section class="screen settings">
      <h1>Настройки</h1>
      ${socialConfigured() ? `<button class="account-row" data-account>
        ${me ? `${avatarHtml(me)}<span><b>${escapeHtml(me.name)}</b><small>${escapeHtml(me.public_id)} · аккаунт</small></span>`
          : '<span class="avatar avatar-empty">?</span><span><b>Войти / Регистрация</b><small>Друзья, карта и лидеры</small></span>'}
        <i>${icon('chevron-right')}</i>
      </button>` : ''}
      <h2>Запись</h2>
      <div class="group">
      <label class="field">
        <span>Границы зон скорости, км/ч</span>
        <input type="text" inputmode="decimal" data-zones value="${s.zones.join(', ')}">
        <small>Через запятую. По умолчанию: ${DEFAULT_SETTINGS.zones.join(', ')}</small>
      </label>
      <label class="field">
        <span>Единицы</span>
        <select data-units>
          <option value="kmh" ${s.units === 'kmh' ? 'selected' : ''}>км/ч, км</option>
          <option value="mph" ${s.units === 'mph' ? 'selected' : ''}>mph, мили</option>
        </select>
      </label>
      </div>
      <div class="actions"><button class="btn primary" data-save>${icon('check')}Сохранить</button></div>

      <h2>Данные</h2>
      <div class="kv" data-storage></div>
      <div class="actions">
        <button class="btn" data-backup></button>
        <button class="btn ghost" data-free></button>
        <label class="btn file-btn">${icon('upload')}Импорт файла<input type="file" accept=".json,application/json" data-import hidden></label>
      </div>
      <p class="hint">«Освободить» удаляет данные датчиков у поездок старше 30 дней: это ~95% занятого места.
        Резервная копия содержит поездки и GPS-треки без данных датчиков.
        Полные сырые данные экспортируются из экрана поездки.</p>

      <h2>О приложении</h2>
      <div class="kv">
        <div><span>Версия</span><b>${APP_VERSION}</b></div>
        <div><span>Запуск с экрана «Домой»</span><b>${isStandalone() ? 'да' : 'нет'}</b></div>
      </div>
    </section>`);
  root.appendChild(el);
  el.querySelector('[data-account]')?.addEventListener('click', () => navigate('#/account'));

  el.querySelector('[data-save]').addEventListener('click', async () => {
    const zones = parseZones(el.querySelector('[data-zones]').value);
    if (!zones.length) { toast('Укажите хотя бы одну границу зоны'); return; }
    await saveSettings({ zones, units: el.querySelector('[data-units]').value });
    el.querySelector('[data-zones]').value = zones.join(', ');
    toast('Сохранено');
  });

  exportButton(el.querySelector('[data-backup]'), 'Резервная копия', exportBackup);

  // Sensor rows are ~95% of the stored data. Keep the most recent rides
  // for algorithm work, offer to drop the rest.
  const KEEP_DAYS = 30;
  const oldRides = async () => (await listRides())
    .filter((r) => r.status !== 'recording' && sensorBytes(r) > 0 && Date.now() - r.startedAt > KEEP_DAYS * 864e5);
  const freeBtn = el.querySelector('[data-free]');
  async function showFree() {
    const rides = await oldRides();
    const bytes = rides.reduce((a, r) => a + sensorBytes(r), 0);
    freeBtn.textContent = rides.length ? `Освободить ~${fmtBytes(bytes)}` : 'Освобождать нечего';
    freeBtn.disabled = !rides.length;
  }
  freeBtn.addEventListener('click', async () => {
    const rides = await oldRides();
    if (!confirm(`Удалить данные датчиков у ${rides.length} поездок старше ${KEEP_DAYS} дней? `
      + 'Маршруты, статистика и рейтинг останутся.')) return;
    for (const r of rides) await dropSensorData(r);
    toast('Место освобождено');
    showFree();
    showStorage();
  });
  showFree();

  el.querySelector('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await importFile(file);
      await recoverInterrupted();
      toast(`Импорт: добавлено ${r.added}, пропущено (уже есть) ${r.skipped}`);
      showStorage();
    } catch (err) {
      toast(`Ошибка импорта: ${err.message || err}`);
    }
  });

  async function showStorage() {
    const box = el.querySelector('[data-storage]');
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const persisted = await navigator.storage?.persisted?.().catch(() => null);
    box.innerHTML = `
      <div><span>Занято</span><b>${est ? fmtBytes(est.usage) : '—'}</b></div>
      <div><span>Доступно</span><b>${est ? fmtBytes(est.quota) : '—'}</b></div>
      <div><span>Защита от очистки</span><b>${persisted === null ? '—' : persisted ? 'да' : 'нет'}</b></div>`;
  }
  showStorage();

  return () => {};
}
