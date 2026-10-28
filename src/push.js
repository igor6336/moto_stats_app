// Push notifications about new versions, on by default. iOS allows them only
// for the app opened from the Home Screen and asks for permission only from
// a tap, so the system prompt is shown once, on the first tap on the tab bar
// (or on «Начать» in the onboarding). The subscription is stored in Supabase
// once signed in; a GitHub Action sends the pushes.
import { VAPID_PUBLIC_KEY } from './config.js';
import { getClient, getMe, onMeChange } from './social/client.js';
import { recorder } from './recorder.js';
import { APP_VERSION } from './version.js';

export function pushSupported() {
  return !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// For the «О приложении» row.
export function pushStatus() {
  if (!pushSupported()) return 'не поддерживаются';
  if (Notification.permission === 'denied') return 'запрещены в настройках iOS';
  if (Notification.permission !== 'granted') return 'спросим при следующем нажатии';
  return getMe() ? 'включены' : 'после входа в аккаунт';
}

function keyBytes(b64url) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// Subscribe if allowed and keep the stored copy current (the push service
// may rotate it). Silent: nothing to tell the rider if it fails.
export async function ensurePush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    const me = getMe();
    if (!me) return; // saved after sign-in
    const j = sub.toJSON();
    const sb = await getClient();
    await sb.from('push_subscriptions').upsert({
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      user_id: me.id, app_version: APP_VERSION, updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
  } catch { /* offline or push service unavailable */ }
}

const ASK_ON = '.tabbar a, .onboarding [data-next]';

export function initPush() {
  if (!pushSupported()) return;
  onMeChange((me) => { if (me) ensurePush(); });
  ensurePush();
  if (Notification.permission !== 'default') return;
  const ask = (e) => {
    if (!e.target.closest?.(ASK_ON) || recorder.recording) return;
    document.removeEventListener('click', ask, true);
    // Called synchronously inside the tap, or iOS ignores it.
    Notification.requestPermission().then((p) => { if (p === 'granted') ensurePush(); });
  };
  document.addEventListener('click', ask, true);
}
