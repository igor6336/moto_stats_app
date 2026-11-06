// Web Push registration. A browser permission is not proof that the server
// stored the subscription, and server acceptance is not proof of delivery.
import { VAPID_PUBLIC_KEY } from './config.js';
import { getClient, getMe, onMeChange } from './social/client.js';
import { recorder } from './recorder.js';
import { APP_VERSION } from './version.js';

let state = { owner: null, checking: false, saved: false, error: false };
let revision = 0;
let pending = null;
let initialized = false;
const listeners = new Set();

export function onPushChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function update(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function pushSupported() {
  return !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushStatus() {
  if (!pushSupported()) return 'не поддерживаются';
  if (Notification.permission === 'denied') return 'запрещены в настройках устройства';
  if (Notification.permission !== 'granted') return 'нужно разрешение';
  const me = getMe();
  if (!me) return 'после входа в аккаунт';
  if (state.owner !== me.id) return 'подписка не проверена';
  if (state.checking) return 'проверяем подписку…';
  if (state.error) return 'не удалось сохранить подписку';
  return state.saved ? 'включены · подписка сохранена' : 'подписка не проверена';
}

function keyBytes(b64url) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('push timeout')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

// Never throws from background calls. The settings screen observes the result
// and can explicitly retry; failures must not look like an enabled subscription.
export function ensurePush() {
  const owner = getMe()?.id || null;
  if (!pushSupported() || Notification.permission !== 'granted' || !owner) {
    revision++;
    update({ owner, checking: false, saved: false, error: false });
    return Promise.resolve(false);
  }
  if (pending?.owner === owner && pending.token === revision) return pending.promise;
  const token = ++revision;
  const current = () => token === revision && getMe()?.id === owner && Notification.permission === 'granted';
  update({ owner, checking: true, saved: false, error: false });
  const promise = Promise.resolve().then(async () => {
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready);
      if (!current()) return false;
      const sub = await withTimeout((async () => (await reg.pushManager.getSubscription())
        || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))());
      if (!current()) return false;
      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('invalid push subscription');
      const sb = await withTimeout(getClient());
      if (!current()) return false;
      const { error } = await withTimeout(sb.from('push_subscriptions').upsert({
        endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
        user_id: owner, app_version: APP_VERSION, updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' }));
      if (error) throw error;
      if (!current()) return false;
      update({ checking: false, saved: true, error: false });
      return true;
    } catch {
      if (current()) update({ checking: false, saved: false, error: true });
      return false;
    } finally {
      if (pending?.promise === promise) pending = null;
      if (token === revision && state.checking) update({ checking: false, saved: false });
    }
  });
  pending = { owner, token, promise };
  return promise;
}

// Permission is requested synchronously from a tap, as required by iOS.
export function checkPush() {
  if (!pushSupported()) return Promise.resolve(false);
  if (Notification.permission === 'default') {
    return Notification.requestPermission().then(() => ensurePush()).catch(() => false);
  }
  return ensurePush();
}

const ASK_ON = '.tabbar a, .onboarding [data-next]';
export function initPush() {
  if (initialized || !pushSupported()) return;
  initialized = true;
  onMeChange(() => {
    if (state.owner !== (getMe()?.id || null)) {
      revision++;
      update({ owner: getMe()?.id || null, checking: false, saved: false, error: false });
    }
    ensurePush();
  });
  window.addEventListener('online', () => ensurePush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ensurePush(); });
  ensurePush();
  if (Notification.permission !== 'default') return;
  const ask = (e) => {
    if (!e.target.closest?.(ASK_ON) || recorder.recording) return;
    document.removeEventListener('click', ask, true);
    checkPush();
  };
  document.addEventListener('click', ask, true);
}
