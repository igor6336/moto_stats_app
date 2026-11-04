// Shares the rider's position with friends while the app is open, and
// streams friends' positions. A web app cannot send location in the
// background, so friends see "last seen" when the app is closed.
import { getClient, getMe, onMeChange } from './client.js';
import { recorder } from '../recorder.js';
import { getSettings, saveSettings } from '../settings.js';
import { fmtSpeed, speedUnit } from '../format.js';

// While riding friends watch the speed, so updates are frequent; otherwise
// a slow rate keeps the free Supabase realtime quota for the rides.
const SEND_RIDING_MS = 3000;
const SEND_IDLE_MS = 30000;
// Indoors iOS often reports 100 m+; for a friends map that is still useful.
const MAX_ACCURACY = 1000;
export const ONLINE_MS = 2 * 60 * 1000;

let lastSent = 0;
let lastRiding = null;
let sending = null;

export const sharingEnabled = () => getSettings().shareLocation !== false;

function push(force = false) {
  const me = getMe();
  const fix = recorder.lastFix;
  if (!me || !sharingEnabled() || !fix || sending) return;
  const riding = recorder.recording;
  const now = Date.now();
  if (!force && riding === lastRiding && now - lastSent < (riding ? SEND_RIDING_MS : SEND_IDLE_MS)) return;
  if (fix.accuracy > MAX_ACCURACY) return;
  sending = send().finally(() => { sending = null; });
  return sending;

  async function send() {
    try {
      const sb = await getClient();
      // Disabling sharing or switching accounts may have happened while loading.
      if (!sharingEnabled() || getMe()?.id !== me.id) return;
      const { error } = await sb.from('locations').upsert({
        user_id: me.id,
        lat: fix.lat, lon: fix.lon,
        speed: fix.speed, heading: null, accuracy: fix.accuracy,
        riding,
      });
      if (error) throw error;
      lastSent = now;
      lastRiding = riding;
    } catch (e) {
      console.warn('location', e);
    }
  }
}

export function startLocationSharing() {
  recorder.addEventListener('gps', () => push());
  recorder.addEventListener('change', () => push(true));
  const kick = () => {
    if (!getMe()) return;
    if (sharingEnabled()) recorder.startGps();
    else removeLocation().catch((e) => console.warn('location removal', e));
  };
  onMeChange(kick);
  window.addEventListener('online', kick);
  kick();
}

export async function setSharing(on) {
  await saveSettings({ shareLocation: on });
  if (on) {
    recorder.startGps();
    push(true);
    return;
  }
  await removeLocation();
}

async function removeLocation() {
  const me = getMe();
  if (!me) return;
  // No new send can start while sharing is disabled. Finish an existing send
  // before deleting so a late upsert cannot restore the location.
  await sending;
  const sb = await getClient();
  if (sharingEnabled() || getMe()?.id !== me.id) return;
  const { error } = await sb.from('locations').delete().eq('user_id', me.id);
  if (error) throw error;
  lastRiding = null;
}

// Calls fn(rows) with all visible positions (own + friends), then again
// on every change. Returns an unsubscribe function.
export async function watchLocations(fn) {
  const sb = await getClient();
  const rows = new Map();
  const emit = () => fn([...rows.values()]);
  const { data, error } = await sb.from('locations').select('*');
  if (error) throw error;
  for (const r of data) rows.set(r.user_id, r);
  emit();
  const channel = sb.channel('friend-locations')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (p) => {
      if (p.eventType === 'DELETE') rows.delete(p.old.user_id);
      else rows.set(p.new.user_id, p.new);
      emit();
    })
    .subscribe();
  return () => sb.removeChannel(channel);
}

export function lastSeen(loc) {
  if (!loc) return 'не делится местоположением';
  const ago = Date.now() - new Date(loc.updated_at).getTime();
  if (ago < ONLINE_MS) return loc.riding ? `в пути · ${fmtSpeed(loc.speed)} ${speedUnit()}` : 'в сети';
  const min = Math.round(ago / 60000);
  if (min < 60) return `был ${min} мин назад`;
  const hr = Math.round(min / 60);
  return hr < 48 ? `был ${hr} ч назад` : `был ${new Date(loc.updated_at).toLocaleDateString('ru-RU')}`;
}
