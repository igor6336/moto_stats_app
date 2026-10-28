// Small animation helpers shared by screens. Everything is skipped when the
// system asks for reduced motion.
import { currentPalette } from './palettes.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t) => 1 - (1 - t) ** 3;

function tween(ms, fn, done) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    fn(k);
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

// Numbers count up from zero: the first number in each element's text
// ("14.8 км", "221", "6.58 с", "17:53", "1:02:10", "12 ч 05 мин").
export function countUp(elements, ms = 900) {
  if (reducedMotion()) return;
  for (const el of elements) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !/\d/.test(node.nodeValue));
    if (!node) continue;
    const text = node.nodeValue;
    const clock = text.match(/(\d+):(\d{2})(?::(\d{2}))?/);
    if (clock) {
      const total = clock[3] !== undefined ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3] : +clock[1] * 60 + +clock[2];
      const fmt = (s) => (clock[3] !== undefined
        ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      tween(ms, (k) => { node.nodeValue = text.replace(clock[0], fmt(Math.round(total * easeOut(k)))); });
      continue;
    }
    const num = text.match(/\d+(?:[.,]\d+)?/);
    const dec = (num[0].split(/[.,]/)[1] || '').length;
    const sep = num[0].includes(',') ? ',' : '.';
    const to = parseFloat(num[0].replace(',', '.'));
    tween(ms, (k) => { node.nodeValue = text.replace(num[0], (to * easeOut(k)).toFixed(dec).replace('.', sep)); });
  }
}

// Placeholder rows with a shimmer while data loads.
export function skeleton(kind = 'rows', n = 3) {
  if (kind === 'ride') {
    return `<div class="skel"><div class="sk" style="height:22px;width:55%"></div><div class="sk" style="height:34px;width:80%;margin-top:10px"></div>
      <div class="sk" style="height:260px;margin-top:16px;border-radius:var(--radius)"></div>
      <div class="skel-grid">${'<div class="sk" style="height:84px;border-radius:var(--radius)"></div>'.repeat(4)}</div></div>`;
  }
  const row = `<div class="skel-row"><div class="sk" style="width:46px;height:46px;border-radius:14px;flex:none"></div>
    <div style="flex:1;display:grid;gap:8px"><div class="sk" style="height:13px;width:62%"></div><div class="sk" style="height:10px;width:40%"></div></div></div>`;
  return `<div class="skel">${row.repeat(n)}</div>`;
}

// History -> ride: the route thumbnail grows into the ride map. The list
// remembers where the thumbnail was; the ride screen flies a copy from there.
let morph = null;
export function setMorphSource(el) {
  const r = el.getBoundingClientRect();
  morph = { rect: r, html: el.innerHTML, at: Date.now() };
}
export function flyMorphTo(target) {
  const m = morph;
  morph = null;
  if (!m || Date.now() - m.at > 3000 || reducedMotion() || !target) return;
  const to = target.getBoundingClientRect();
  if (!to.width) return;
  const fly = document.createElement('div');
  fly.className = 'morph-fly';
  fly.innerHTML = m.html;
  Object.assign(fly.style, { left: `${m.rect.left}px`, top: `${m.rect.top}px`, width: `${m.rect.width}px`, height: `${m.rect.height}px` });
  document.body.append(fly);
  const anim = fly.animate([
    { left: `${m.rect.left}px`, top: `${m.rect.top}px`, width: `${m.rect.width}px`, height: `${m.rect.height}px`, opacity: 1 },
    { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, opacity: 1, offset: 0.8 },
    { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  anim.onfinish = () => fly.remove();
}

// Confetti in the palette colours, once.
export function confetti() {
  if (reducedMotion()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.append(c);
  const dpr = window.devicePixelRatio || 1;
  const W = (c.width = window.innerWidth * dpr), H = (c.height = window.innerHeight * dpr);
  const g = c.getContext('2d');
  const colors = [...currentPalette().stops.dark, '#f5a623'];
  const parts = Array.from({ length: 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.2, y: H * 0.3,
    vx: (Math.random() - 0.5) * 18 * dpr, vy: (-Math.random() * 14 - 6) * dpr,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
    w: (5 + Math.random() * 5) * dpr, h: (8 + Math.random() * 7) * dpr,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const frame = (now) => {
    const life = (now - t0) / 1900;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.38 * dpr; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.globalAlpha = Math.max(0, 1 - life * life); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    }
    if (life < 1) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
