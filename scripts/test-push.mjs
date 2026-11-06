// Manual, targeted diagnostic. No fallback to a release broadcast.
import webpush from 'web-push';
import { SUPABASE_URL, VAPID_PUBLIC_KEY } from '../src/config.js';
import { sendTargetedTest } from './lib/push-test.mjs';

const privateKey = process.env.VAPID_PRIVATE_KEY;
if (!privateKey || !process.env.SUPABASE_SECRET_KEY) throw new Error('Push test credentials are missing');
webpush.setVapidDetails('https://igor6336.github.io/moto_stats_app/', VAPID_PUBLIC_KEY, privateKey);
try {
  const result = await sendTargetedTest({
    login: process.env.PUSH_TEST_LOGIN, requestId: process.env.PUSH_TEST_ID,
    supabaseUrl: SUPABASE_URL, apiKey: process.env.SUPABASE_SECRET_KEY,
    send: (...args) => webpush.sendNotification(...args),
  });
  console.log(JSON.stringify(result));
} catch (e) {
  // Do not log endpoints, subscription keys, response bodies or credentials.
  console.error('Targeted push test failed:', e.statusCode || e.message);
  process.exitCode = 1;
}
