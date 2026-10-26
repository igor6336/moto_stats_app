// Keeps the screen on. The lock is dropped by the browser whenever the page
// is hidden, so it is re-acquired when the page becomes visible again.
let sentinel = null;
let wanted = false;
const listeners = new Set();

export const wakeLockSupported = () => 'wakeLock' in navigator;

export function wakeLockState() {
  if (!wakeLockSupported()) return 'unsupported';
  return sentinel && !sentinel.released ? 'on' : wanted ? 'lost' : 'off';
}

export function onWakeLockChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const emit = () => listeners.forEach((fn) => fn(wakeLockState()));

async function acquire() {
  if (!wakeLockSupported() || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', emit);
  } catch (e) {
    console.warn('wake lock failed', e);
    sentinel = null;
  }
  emit();
}

export async function enableWakeLock() {
  wanted = true;
  await acquire();
}

export async function disableWakeLock() {
  wanted = false;
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) await s.release();
  emit();
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') acquire();
});
