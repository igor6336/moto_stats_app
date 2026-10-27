// Colour theme: 'system' follows iOS, or forced 'dark' / 'light'. The choice
// is mirrored to localStorage for src/theme-boot.js (applied before paint).
const media = window.matchMedia('(prefers-color-scheme: light)');
let pref = 'system';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply() {
  const theme = pref === 'system' ? (media.matches ? 'light' : 'dark') : pref;
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  // iOS reads the status bar style at launch: a change shows on next start.
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eef1f7' : '#07090c');
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export function setThemePreference(value) {
  pref = ['dark', 'light'].includes(value) ? value : 'system';
  try { localStorage.setItem('theme', pref); } catch { /* private mode */ }
  apply();
}

export function setPalette(id) {
  try { localStorage.setItem('palette', id); } catch { /* private mode */ }
  if (document.documentElement.dataset.palette === id) return;
  document.documentElement.dataset.palette = id;
  window.dispatchEvent(new CustomEvent('themechange', { detail: currentTheme() }));
}

media.addEventListener('change', () => { if (pref === 'system') apply(); });
