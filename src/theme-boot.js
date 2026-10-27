// Classic (non-module) script in <head>: applies the saved theme before the
// first paint, so the app never flashes dark before switching to light.
// The full logic lives in src/theme.js.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('theme') || 'system'; } catch (e) { /* private mode */ }
  var light = pref === 'light' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  var theme = light ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) bar.content = light ? 'default' : 'black-translucent';
  var color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = light ? '#eef1f7' : '#07090c';
})();
