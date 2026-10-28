// Sends the "new version" push to every subscribed phone.
// Run by .github/workflows/release-push.yml after GitHub Pages serves the
// new version. Needs web-push installed and two secrets in the environment:
//   VAPID_PRIVATE_KEY   private half of VAPID_PUBLIC_KEY in src/config.js
//   SUPABASE_SECRET_KEY Supabase secret (service role) key: reads all
//                       subscriptions past RLS, removes dead ones
// SUPABASE_URL overrides the one in src/config.js (tests).
import webpush from 'web-push';
import { SUPABASE_URL as CONFIG_URL, VAPID_PUBLIC_KEY } from '../src/config.js';
import { APP_VERSION, RELEASE_NOTES } from '../src/version.js';

const SITE = 'https://igor6336.github.io/moto_stats_app/';
const URL_BASE = process.env.SUPABASE_URL || CONFIG_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (!RELEASE_NOTES) { console.log(`${APP_VERSION}: no release notes, no push`); process.exit(0); }
// Not configured yet: nobody to notify, and not a failure worth an e-mail.
if (!KEY || !PRIVATE) { console.log('SUPABASE_SECRET_KEY or VAPID_PRIVATE_KEY not set: no push'); process.exit(0); }

// New secret keys (sb_secret_…) go only in apikey; legacy JWT keys also as Bearer.
const headers = { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) };
const rest = (path, init = {}) => fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });

const res = await rest('push_subscriptions?select=endpoint,p256dh,auth');
if (!res.ok) { console.error('read subscriptions:', res.status, await res.text()); process.exit(1); }
const subs = await res.json();

webpush.setVapidDetails(SITE, VAPID_PUBLIC_KEY, PRIVATE);
const payload = JSON.stringify({ title: `MotoHrust ${APP_VERSION}`, body: RELEASE_NOTES, url: './', tag: 'release' });

let sent = 0, gone = 0, failed = 0;
for (const s of subs) {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3 * 86400 });
    sent++;
  } catch (e) {
    // 404/410: the app was removed or permission withdrawn: forget the phone.
    if (e.statusCode === 404 || e.statusCode === 410) {
      gone++;
      await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
    } else {
      failed++;
      console.error('push failed:', e.statusCode, e.body || e.message);
    }
  }
}
console.log(`${APP_VERSION}: ${subs.length} subscriptions, sent ${sent}, removed ${gone}, failed ${failed}`);
if (failed && !sent) process.exit(1);
