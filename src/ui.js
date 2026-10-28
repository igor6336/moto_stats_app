// Small DOM helpers shared by screens.
import { shareOrDownload } from './export.js';
import { fmtBytes } from './format.js';
import { icon } from './icons.js';

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(text, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

// Fires fn after the element is held for ms. Gloves and vibration make
// accidental taps likely, so destructive or modal-exit actions use this.
export function longPress(el, ms, fn) {
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('holding');
  };
  el.style.setProperty('--hold-ms', `${ms}ms`);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cancel();
    el.classList.add('holding');
    timer = setTimeout(() => { cancel(); navigator.vibrate?.(40); fn(); }, ms);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Preparing an export involves async reads, after which iOS no longer treats
// share() as user-initiated. So: first tap prepares, second tap saves.
const ICON_SAVE = icon('share');
const ICON_EXPORT = icon('download');

export function exportButton(btn, label, prepare) {
  let ready = null;
  const idle = () => { btn.innerHTML = `${ICON_EXPORT}${label}`; };
  idle();
  btn.addEventListener('click', async () => {
    if (ready) {
      const r = await shareOrDownload(ready);
      if (r !== 'cancelled') { ready = null; idle(); }
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Готовлю файл…';
    try {
      ready = await prepare();
      btn.innerHTML = `${ICON_SAVE}Сохранить файл (${fmtBytes(ready.blob.size)})`;
    } catch (e) {
      toast(`Ошибка экспорта: ${e.message || e}`);
      idle();
    } finally {
      btn.disabled = false;
    }
  });
}

// Bottom sheet with large buttons. actions: [{ label, onClick, primary }].
export function actionSheet(title, subtitle, actions) {
  const root = document.getElementById('overlay-root');
  const sheet = h(`<div class="sheet-backdrop">
    <div class="sheet">
      <div class="sheet-title"></div>
      <div class="sheet-sub"></div>
      <div class="sheet-actions"></div>
      <button class="btn ghost" data-cancel>Отмена</button>
    </div></div>`);
  sheet.querySelector('.sheet-title').textContent = title;
  sheet.querySelector('.sheet-sub').textContent = subtitle || '';
  const close = () => sheet.remove();
  for (const a of actions) {
    const b = h(`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger ghost' : ''}">${a.icon ? icon(a.icon) : ''}<span></span></button>`);
    b.querySelector('span').textContent = a.label;
    b.addEventListener('click', () => { close(); a.onClick(); });
    sheet.querySelector('.sheet-actions').append(b);
  }
  sheet.querySelector('[data-cancel]').addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  root.append(sheet);
}
