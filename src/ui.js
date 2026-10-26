// Small DOM helpers shared by screens.
import { shareOrDownload } from './export.js';
import { fmtBytes } from './format.js';

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
export function exportButton(btn, label, prepare) {
  let ready = null;
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    if (ready) {
      const r = await shareOrDownload(ready);
      if (r !== 'cancelled') { ready = null; btn.textContent = label; }
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Готовлю файл…';
    try {
      ready = await prepare();
      btn.textContent = `Сохранить файл (${fmtBytes(ready.blob.size)})`;
    } catch (e) {
      toast(`Ошибка экспорта: ${e.message || e}`);
      btn.textContent = label;
    } finally {
      btn.disabled = false;
    }
  });
}
