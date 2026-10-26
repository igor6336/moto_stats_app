// Shares the rider's position with friends while the app is open, and
// streams friends' positions. A web app cannot send location in the
// background, so friends see "last seen" when the app is closed.
import { getClient, getMe, onMeChange } from './client.js';
import { recorder } from '../recorder.js';
import { getSettings, saveSettings } from '../settings.js';

const SEND_EVERY_MS = 10000;
const MAX_ACCURACY = 100;
export const ONLINE_MS = 2 * 60 * 1000;

let lastSent = 0;
let lastRiding = null;
let sending = false;

export const sharingEnabled = () => getSettings().shareLocation !== false;

async function push(force = false) {
  const me = getMe();
  const fix = recorder.lastFix;
  if (!me || !sharingEnabled() || !fix || sending) return;
  const riding = recorder.recording;
  const now = Date.now();
  if (!force && riding === lastRiding && now - lastSent < SEND_EVERY_MS) return;
  if (fix.accuracy > MAX_ACCURACY) return;
  sending = true;
  try {
    const sb = await getClient();
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
  } finally {
    sending = false;
  }
}

export function startLocationSharing() {
  recorder.addEventListener('gps', () => push());
  recorder.addEventListener('change', () => push(true));
  const kick = () => { if (getMe() && sharingEnabled()) recorder.startGps(); };
  onMeChange(kick);
  kick();
}

export async function setSharing(on) {
  await saveSettings({ shareLocation: on });
  if (on) {
    recorder.startGps();
    push(true);
    return;
  }
  const me = getMe();
  if (!me) return;
  const sb = await getClient();
  await sb.from('locations').delete().eq('user_id', me.id);
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
