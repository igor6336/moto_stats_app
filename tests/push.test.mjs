import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/modules.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
async function setup(options = {}) {
  let me = { id: 'rider' }, failure = options.failure;
  const calls = [];
  const subscription = options.subscription || { toJSON: () => ({ endpoint: 'https://push.invalid/test', keys: { p256dh: 'key', auth: 'auth' } }) };
  const reg = { pushManager: {
    getSubscription: async () => options.create ? null : subscription,
    subscribe: async (settings) => { calls.push(['subscribe', settings]); return subscription; },
  } };
  const Notification = { permission: options.permission || 'granted', requestPermission: () => {
    calls.push(['permission']); Notification.permission = 'granted'; return Promise.resolve('granted');
  } };
  const api = await loadModule('src/push.js', {
    'src/social/client.js': { getMe: () => me, onMeChange() {}, getClient: async () => ({ from: () => ({
      upsert: async (row) => { calls.push(['save', row]); if (options.saveGate) await options.saveGate;
        return { error: failure ? new Error('save failed') : null }; },
    }) }) },
    'src/recorder.js': { recorder: { recording: false } },
  }, {
    atob, Notification,
    window: Object.assign(new EventTarget(), { PushManager: function () {}, Notification }),
    navigator: { serviceWorker: { ready: options.ready || Promise.resolve(reg) } },
  });
  return { api, calls, Notification, setMe: (value) => { me = value; }, setFailure: (value) => { failure = value; } };
}

test('permission alone is unverified; saving the subscription confirms status', async () => {
  const f = await setup();
  assert.equal(f.api.pushStatus(), 'подписка не проверена');
  assert.equal(await f.api.ensurePush(), true);
  assert.match(f.api.pushStatus(), /^включены/);
  assert.equal(f.calls[0][1].user_id, 'rider');
});

test('Supabase error result does not claim enabled; an explicit retry can recover', async () => {
  const f = await setup({ failure: true });
  assert.equal(await f.api.ensurePush(), false);
  assert.equal(f.api.pushStatus(), 'не удалось сохранить подписку');
  f.setFailure(false);
  assert.equal(await f.api.checkPush(), true);
  assert.match(f.api.pushStatus(), /^включены/);
});

test('concurrent checks share one registration and remain checking until server response', async () => {
  const gate = deferred(), f = await setup({ saveGate: gate.promise });
  const first = f.api.ensurePush(), second = f.api.ensurePush();
  assert.equal(first, second);
  await tick();
  assert.equal(f.api.pushStatus(), 'проверяем подписку…');
  assert.equal(f.calls.filter(([kind]) => kind === 'save').length, 1);
  gate.resolve();
  assert.equal(await first, true);
});

test('missing browser subscription is created and saved', async () => {
  const f = await setup({ create: true });
  assert.equal(await f.api.ensurePush(), true);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['subscribe', 'save']);
});

test('denied permission performs no storage request', async () => {
  const f = await setup({ permission: 'denied' });
  assert.equal(await f.api.ensurePush(), false);
  assert.equal(f.calls.length, 0);
  assert.match(f.api.pushStatus(), /запрещены/);
});

test('manual check requests permission synchronously inside the tap', async () => {
  const f = await setup({ permission: 'default' });
  const check = f.api.checkPush();
  assert.equal(f.calls[0][0], 'permission');
  assert.equal(await check, true);
});

test('logout while registration is pending prevents saving the old account', async () => {
  const ready = deferred(), f = await setup({ ready: ready.promise });
  const check = f.api.ensurePush();
  f.setMe(null);
  ready.resolve({});
  assert.equal(await check, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.api.pushStatus(), 'после входа в аккаунт');
});

test('late response for a previous account never confirms the new account', async () => {
  const gate = deferred(), f = await setup({ saveGate: gate.promise });
  const check = f.api.ensurePush();
  await tick();
  f.setMe({ id: 'another-rider' });
  gate.resolve();
  assert.equal(await check, false);
  assert.equal(f.api.pushStatus(), 'подписка не проверена');
});

test('broken subscriptions fail visibly without writing; status listeners can unsubscribe', async () => {
  const f = await setup({ subscription: { toJSON: () => ({ endpoint: 'https://push.invalid' }) } });
  let updates = 0;
  const off = f.api.onPushChange(() => { updates++; });
  assert.equal(await f.api.ensurePush(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.api.pushStatus(), 'не удалось сохранить подписку');
  assert.ok(updates >= 2);
  const before = updates;
  off();
  await f.api.ensurePush();
  assert.equal(updates, before);
});
