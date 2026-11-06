// Exactly one latest subscription of one explicitly selected account.
// All I/O is injected so tests never contact real push services.
export async function sendTargetedTest({ login, requestId, supabaseUrl, apiKey, request = fetch, send }) {
  login = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(login)) throw new Error('Explicit valid recipient login required');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId || '')) throw new Error('Explicit unique test ID required');
  if (!supabaseUrl || !apiKey || typeof send !== 'function') throw new Error('Push test is not configured');
  const base = new URL('/rest/v1/', supabaseUrl);
  const headers = { apikey: apiKey, ...(apiKey.startsWith('eyJ') ? { Authorization: `Bearer ${apiKey}` } : {}) };
  const read = async (table, params) => {
    const url = new URL(table, base);
    url.search = new URLSearchParams(params);
    const res = await request(url, { headers });
    if (!res.ok) throw new Error(`Push test lookup failed (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid lookup response');
    return data;
  };
  const profiles = await read('profiles', { select: 'id', login: `eq.${login}`, limit: '2' });
  if (profiles.length !== 1 || !/^[0-9a-f-]{36}$/i.test(profiles[0].id || '')) throw new Error('Unique recipient not found');
  const userId = profiles[0].id;
  const subs = await read('push_subscriptions', {
    select: 'user_id,endpoint,p256dh,auth', user_id: `eq.${userId}`, order: 'updated_at.desc', limit: '1',
  });
  if (subs.length !== 1 || subs[0].user_id !== userId) throw new Error('No subscription for this recipient');
  const sub = subs[0];
  const endpoint = new URL(sub.endpoint);
  const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port
    || !allowed.includes(endpoint.hostname)) throw new Error('Unsupported push service');
  if (!sub.p256dh || !sub.auth) throw new Error('Subscription keys missing');
  const payload = JSON.stringify({
    title: 'MotoHrust: проверка уведомлений',
    body: `Тест уведомлений. Код ${requestId}. Если видите это сообщение, доставка работает.`,
    tag: `push-test-${requestId}`, url: './#/settings',
  });
  const result = await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
    { TTL: 300, urgency: 'high' });
  if (!(result?.statusCode >= 200 && result.statusCode < 300)) throw new Error('Push service did not accept the test');
  return { requestId, accepted: 1, statusCode: result.statusCode, pushService: endpoint.hostname };
}
