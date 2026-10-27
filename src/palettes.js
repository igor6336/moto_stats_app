// Colour palettes (accent colours; the theme sets the surfaces). The speed
// gauge runs through `stops`; CSS variables come from `css` and are written
// into styles.css by scripts/make_palettes.mjs (run it after editing here).
export const PALETTES = [
  {
    id: 'depth', name: 'Глубина',
    stops: { dark: ['#ffffff', '#7dd3fc', '#3b82f6', '#4f46e5', '#6d28d9'], light: ['#bae6fd', '#38bdf8', '#2563eb', '#4338ca', '#5b21b6'] },
    css: { accent: '#6d8bff', rgb: '91, 110, 245', grad: 'linear-gradient(135deg, #60a5fa 0%, #4f46e5 60%, #6d28d9 100%)', on: '#ffffff', lightAccent: '#4f46e5' },
  },
  {
    id: 'neon', name: 'Неон',
    stops: { dark: ['#ffffff', '#67e8f9', '#22d3ee', '#d946ef', '#db2777'], light: ['#a5f3fc', '#22d3ee', '#0891b2', '#c026d3', '#be185d'] },
    css: { accent: '#22d3ee', rgb: '168, 85, 247', grad: 'linear-gradient(135deg, #22d3ee 0%, #a855f7 55%, #db2777 100%)', on: '#ffffff', lightAccent: '#a21caf' },
  },
  {
    id: 'sunset', name: 'Закат',
    stops: { dark: ['#fff7ed', '#fdba74', '#fb7185', '#e11d48', '#7e22ce'], light: ['#fed7aa', '#fb923c', '#f43f5e', '#be123c', '#6b21a8'] },
    css: { accent: '#fb7185', rgb: '244, 63, 94', grad: 'linear-gradient(135deg, #fb923c 0%, #f43f5e 55%, #9333ea 100%)', on: '#ffffff', lightAccent: '#e11d48' },
  },
  {
    id: 'toxic', name: 'Токсик',
    stops: { dark: ['#f7fee7', '#d9f99d', '#a3e635', '#10b981', '#0f766e'], light: ['#d9f99d', '#a3e635', '#65a30d', '#059669', '#0f766e'] },
    css: { accent: '#a3e635', rgb: '34, 197, 94', grad: 'linear-gradient(135deg, #a3e635 0%, #22c55e 55%, #0d9488 100%)', on: '#052e16', lightAccent: '#15803d' },
  },
  {
    id: 'lava', name: 'Лава',
    stops: { dark: ['#ffffff', '#fde047', '#f97316', '#dc2626', '#991b1b'], light: ['#fef08a', '#facc15', '#f97316', '#dc2626', '#991b1b'] },
    css: { accent: '#fb923c', rgb: '249, 115, 22', grad: 'linear-gradient(135deg, #facc15 0%, #f97316 50%, #dc2626 100%)', on: '#1a0a00', lightAccent: '#c2410c' },
  },
  {
    id: 'aurora', name: 'Аврора',
    stops: { dark: ['#ecfeff', '#5eead4', '#14b8a6', '#6366f1', '#a21caf'], light: ['#99f6e4', '#2dd4bf', '#0d9488', '#4f46e5', '#86198f'] },
    css: { accent: '#2dd4bf', rgb: '99, 102, 241', grad: 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 55%, #a21caf 100%)', on: '#ffffff', lightAccent: '#0f766e' },
  },
  {
    id: 'carbon', name: 'Карбон',
    stops: { dark: ['#ffffff', '#e5e7eb', '#9ca3af', '#ef4444', '#b91c1c'], light: ['#cbd5e1', '#94a3b8', '#64748b', '#ef4444', '#b91c1c'] },
    css: { accent: '#f87171', rgb: '239, 68, 68', grad: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', on: '#ffffff', lightAccent: '#dc2626' },
  },
];

export const DEFAULT_PALETTE = 'depth';

export function getPalette(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

export function currentPalette() {
  return getPalette(document.documentElement.dataset.palette);
}

// Gauge stops as [offset, [r, g, b]] for the current theme.
export function gaugeStops(palette, theme) {
  const list = palette.stops[theme === 'light' ? 'light' : 'dark'];
  return list.map((hex, i) => [i / (list.length - 1), [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))]);
}
