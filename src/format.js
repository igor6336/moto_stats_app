import { getSettings } from './settings.js';

const MPH = 2.2369362920544;

export function speedUnit() {
  return getSettings().units === 'mph' ? 'mph' : 'км/ч';
}

// m/s -> display units
export function speedValue(ms) {
  if (!Number.isFinite(ms)) return NaN;
  return getSettings().units === 'mph' ? ms * MPH : ms * 3.6;
}

export function fmtSpeed(ms, digits = 0) {
  const v = speedValue(ms);
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

// km/h zone bound -> display units
export function zoneBound(kmh) {
  return getSettings().units === 'mph' ? Math.round(kmh / 1.609344) : kmh;
}

export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '—';
  if (getSettings().units === 'mph') {
    const mi = m / 1609.344;
    return mi < 10 ? `${mi.toFixed(2)} ми` : `${mi.toFixed(1)} ми`;
  }
  if (m < 1000) return `${Math.round(m)} м`;
  return m < 10000 ? `${(m / 1000).toFixed(2)} км` : `${(m / 1000).toFixed(1)} км`;
}

export function fmtDuration(s) {
  if (!Number.isFinite(s) || s < 0) return '—';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtBytes(b) {
  if (!Number.isFinite(b)) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} МБ`;
  return `${(b / 1024 ** 3).toFixed(2)} ГБ`;
}

export function fileStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
