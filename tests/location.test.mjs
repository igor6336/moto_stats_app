import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/modules.mjs';

const tick = () => new Promise(setImmediate);
async function setup({ upsert = async () => ({ error: null }), remove = async () => ({ error: null }), clientReady = Promise.resolve() } = {}) {
  const recorder = Object.assign(new EventTarget(), {
    lastFix: { lat: 55, lon: 37, accuracy: 5, speed: 10 }, recording: true, startGps() {},
  });
  const settings = { shareLocation: true };
  const calls = [];
  const sb = { from: () => ({
    upsert: async (row) => { calls.push('upsert'); return upsert(row); },
    delete: () => ({ eq: async () => { calls.push('delete'); return remove(); } }),
  }) };
  const window = new EventTarget();
  const api = await loadModule('src/social/location.js', {
    'src/social/client.js': { getClient: async () => { await clientReady; return sb; }, getMe: () => ({ id: 'rider' }), onMeChange() {} },
    'src/recorder.js': { recorder },
    'src/settings.js': { getSettings: () => settings, saveSettings: async (patch) => Object.assign(settings, patch) },
    'src/format.js': { fmtSpeed: String, speedUnit: () => 'kmh' },
  }, { window });
  api.startLocationSharing();
  return { api, recorder, settings, calls, window };
}

test('ghost mode waits for an in-flight send and deletes after it completes', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const f = await setup({ upsert: () => pending });
  f.recorder.dispatchEvent(new Event('gps'));
  await tick();
  const disabled = f.api.setSharing(false);
  await tick();
  assert.deepEqual(f.calls, ['upsert']);
  finish({ error: null });
  await disabled;
  assert.deepEqual(f.calls, ['upsert', 'delete']);
  f.recorder.dispatchEvent(new Event('gps'));
  await tick();
  assert.deepEqual(f.calls, ['upsert', 'delete']);
});

test('failed deletion is reported, keeps publishing disabled and can retry', async () => {
  let offline = true;
  const f = await setup({ remove: async () => ({ error: offline ? new Error('offline') : null }) });
  await assert.rejects(f.api.setSharing(false), /offline/);
  assert.equal(f.settings.shareLocation, false);
  offline = false;
  await f.api.setSharing(false);
  assert.deepEqual(f.calls, ['delete', 'delete']);
});

test('coming online retries unconfirmed removal while sharing is disabled', async () => {
  const f = await setup();
  await f.api.setSharing(false);
  f.window.dispatchEvent(new Event('online'));
  await tick();
  assert.deepEqual(f.calls, ['delete', 'delete']);
});


test('disabling sharing while the client loads prevents a queued upload', async () => {
  let ready;
  const clientReady = new Promise((resolve) => { ready = resolve; });
  const f = await setup({ clientReady });
  f.recorder.dispatchEvent(new Event('gps'));
  const disabled = f.api.setSharing(false);
  await tick();
  ready();
  await disabled;
  assert.deepEqual(f.calls, ['delete']);
});
