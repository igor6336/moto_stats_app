// Full-screen map overlay and the "expand" affordance on small maps.
import { h } from './ui.js';
import { icon } from './icons.js';

// draw(container) -> Promise<dispose>. legendHtml goes in a panel at the
// bottom. Returns a close function (also bound to the ✕ button).
export function openFullscreenMap(draw, legendHtml = '') {
  const o = h(`<div class="map-full">
    <div class="map-full-map" data-map></div>
    <button class="map-close" data-close aria-label="Закрыть">${icon('x')}</button>
    ${legendHtml ? `<div class="map-legend">${legendHtml}</div>` : ''}
  </div>`);
  document.getElementById('overlay-root').append(o);
  let dispose = () => {};
  let closed = false;
  Promise.resolve(draw(o.querySelector('[data-map]')))
    .then((d) => { if (closed) d?.(); else dispose = d || (() => {}); })
    .catch(() => { o.querySelector('[data-map]').innerHTML = '<div class="map-empty">Карта недоступна без сети</div>'; });
  const close = () => {
    if (closed) return;
    closed = true;
    dispose();
    o.remove();
  };
  o.querySelector('[data-close]').addEventListener('click', close);
  return close;
}

// Adds the ⤢ button next to a small map (the box must sit in a
// .map-wrap). With tap: true a short tap on the map opens it too; leave it
// off where taps on markers mean something else.
export function expandable(box, open, { tap = false } = {}) {
  const btn = h(`<button class="map-expand" aria-label="Карта на весь экран">${icon('maximize-2')}</button>`);
  btn.addEventListener('click', open);
  box.parentElement.append(btn);
  if (!tap) return;
  // Capture phase: the map engines stop the events they handle.
  let start = null;
  box.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
  box.addEventListener('pointerup', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8 && Date.now() - start.t < 400) open();
    start = null;
  }, true);
}
