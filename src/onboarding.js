// First launch: three short screens on what the app does and how to ride
// with it. Shown once; the flag lives in localStorage.
import { h } from './ui.js';
import { icon } from './icons.js';

const KEY = 'onboarded';

const STEPS = [
  { icon: 'gauge', title: 'MotoHrust пишет каждую поездку',
    text: 'Маршрут, скорость, разгоны 0–100 и наклон в поворотах. Потом можно сравниться с друзьями в лидерах.' },
  { icon: 'smartphone', title: 'Закрепите телефон жёстко',
    text: 'Держатель на руле, экраном к себе. Если телефон болтается или лежит в кармане, наклон не посчитается.' },
  { icon: 'play', title: 'Нажмите «Начать поездку» и езжайте',
    text: 'Даже если GPS ещё слабый: точность догонит. Не сворачивайте приложение во время езды. Для удобства добавьте его на экран «Домой».' },
];

export function needsOnboarding() {
  try { return !localStorage.getItem(KEY); } catch { return false; }
}

// Riders who already have rides know the app: mark them as onboarded.
export function markOnboarded() {
  try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
}

export function showOnboarding() {
  const root = document.getElementById('overlay-root');
  let i = 0;
  const el = h(`<div class="onboarding" role="dialog" aria-modal="true">
    <button class="ob-skip" data-skip>Пропустить</button>
    <div class="ob-body" data-body></div>
    <div class="ob-dots">${STEPS.map(() => '<i></i>').join('')}</div>
    <button class="btn primary" data-next></button>
  </div>`);
  const done = () => { markOnboarded(); el.remove(); };
  const draw = () => {
    const s = STEPS[i];
    el.querySelector('[data-body]').innerHTML = `<div class="ob-icon">${icon(s.icon)}</div><h2></h2><p></p>`;
    el.querySelector('h2').textContent = s.title;
    el.querySelector('p').textContent = s.text;
    el.querySelectorAll('.ob-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
    el.querySelector('[data-next]').textContent = i === STEPS.length - 1 ? 'Начать' : 'Далее';
  };
  el.querySelector('[data-next]').addEventListener('click', () => { if (++i >= STEPS.length) done(); else draw(); });
  el.querySelector('[data-skip]').addEventListener('click', done);
  draw();
  root.append(el);
}
