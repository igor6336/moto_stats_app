import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTargetedTest } from '../scripts/lib/push-test.mjs';
const userId = '11111111-2222-3333-4444-555555555555';
function fixture(overrides = {}) {
  const requests = [], sends = [];
  const options = {
    login: 'rider_test', requestId: 'test-1', supabaseUrl: 'https://test.supabase.co', apiKey: 'test-key',
    request: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.pathname.endsWith('/profiles') ? [{ id: userId }]
        : [{ user_id: userId, endpoint: 'https://web.push.apple.com/test', p256dh: 'key', auth: 'auth' }] };
    },
    send: async (...args) => { sends.push(args); return { statusCode: 201 }; },
    ...overrides,
  };
  return { options, requests, sends };
}

test('test sender filters exact login and UUID and sends one uniquely tagged message', async () => {
  const f = fixture(), result = await sendTargetedTest(f.options);
  assert.equal(f.requests[0].searchParams.get('login'), 'eq.rider_test');
  assert.equal(f.requests[1].searchParams.get('user_id'), `eq.${userId}`);
  assert.equal(f.requests[1].searchParams.get('limit'), '1');
  assert.equal(f.sends.length, 1);
  assert.equal(JSON.parse(f.sends[0][1]).tag, 'push-test-test-1');
  assert.equal(result.accepted, 1);
  assert.equal(result.statusCode, 201);
  assert.equal('endpoint' in result, false);
});

test('missing or invalid recipient never falls back to a broadcast', async () => {
  for (const login of ['', undefined, '*', 'rider_test&user_id=other']) {
    const f = fixture({ login });
    await assert.rejects(sendTargetedTest(f.options), /recipient/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.sends.length, 0);
  }
});

test('unknown recipient stops before reading any subscriptions', async () => {
  let reads = 0;
  const f = fixture({ request: async () => { reads++; return { ok: true, json: async () => [] }; } });
  await assert.rejects(sendTargetedTest(f.options), /recipient/);
  assert.equal(reads, 1);
  assert.equal(f.sends.length, 0);
});

test('subscription belonging to another account is rejected', async () => {
  const f = fixture({ request: async (url) => ({ ok: true, json: async () => url.pathname.endsWith('/profiles')
    ? [{ id: userId }] : [{ user_id: 'another-user' }] }) });
  await assert.rejects(sendTargetedTest(f.options), /recipient/);
  assert.equal(f.sends.length, 0);
});

test('untrusted push endpoint is rejected instead of making a server-side request', async () => {
  const f = fixture({ request: async (url) => ({ ok: true, json: async () => url.pathname.endsWith('/profiles')
    ? [{ id: userId }] : [{ user_id: userId, endpoint: 'https://evil.invalid/test', p256dh: 'key', auth: 'auth' }] }) });
  await assert.rejects(sendTargetedTest(f.options), /Unsupported/);
  assert.equal(f.sends.length, 0);
});

test('push service errors propagate and are never reported as accepted', async () => {
  const f = fixture({ send: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); } });
  await assert.rejects(sendTargetedTest(f.options), /gone/);
});
