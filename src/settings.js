import { kvGet, kvSet } from './storage.js';

export const DEFAULT_SETTINGS = Object.freeze({
  zones: [30, 60, 90, 120, 150], // km/h
  units: 'kmh',                 // 'kmh' | 'mph'
  shareLocation: true,          // show position to friends while the app is open
  theme: 'system',              // 'system' | 'dark' | 'light'
  palette: 'depth',             // accent palette id, see src/palettes.js
});

let current = { ...DEFAULT_SETTINGS };

export async function loadSettings() {
  const saved = await kvGet('settings');
  current = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  return current;
}

export function getSettings() {
  return current;
}

export async function saveSettings(patch) {
  current = { ...current, ...patch };
  await kvSet('settings', current);
  return current;
}

// Parses "30, 60, 90" into a sorted list of unique positive numbers.
export function parseZones(text) {
  const list = String(text)
    .split(/[\s,;]+/)
    .map((s) => Number(s.replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v > 0);
  return [...new Set(list)].sort((a, b) => a - b);
}
