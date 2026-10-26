// Supabase client, loaded on demand so the app starts and records rides
// without it (and without network).
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_EMAIL_DOMAIN } from '../config.js';

export const socialConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);
export const LOGIN_RE = /^[a-z0-9_]{3,24}$/;

let clientPromise = null;
let me = null; // own profile row
const listeners = new Set();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('не удалось загрузить клиент сервера'));
    document.head.append(s);
  });
}

export function getClient() {
  if (!socialConfigured()) return Promise.reject(new Error('сервер не настроен'));
  if (!clientPromise) {
    clientPromise = loadScript('./vendor/supabase.js')
      .then(() => window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'moto-auth' },
      }))
      .catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

export function getMe() { return me; }

export function onMeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setMe(p) {
  me = p;
  listeners.forEach((fn) => fn(me));
}

// Translates Supabase errors into something a rider can act on.
export function humanError(e) {
  const msg = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(msg)) return 'Неверный логин или пароль';
  if (/already registered|already exists/i.test(msg)) return 'Такой логин уже занят';
  if (/Password should be/i.test(msg)) return 'Пароль слишком короткий (минимум 6 символов)';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Нет связи с сервером';
  if (/rate limit/i.test(msg)) return 'Слишком много попыток, подождите немного';
  return msg || 'Неизвестная ошибка';
}

const emailFor = (login) => `${login}@${LOGIN_EMAIL_DOMAIN}`;

// Not '*': the large avatar is only fetched for the photo viewer.
const OWN_COLS = 'id, public_id, login, name, bike, avatar, created_at';

async function loadProfile(sb, userId) {
  const { data, error } = await sb.from('profiles').select(OWN_COLS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// Restores the saved session on app start. Never throws: without network
// the app keeps working locally.
export async function initSession() {
  if (!socialConfigured()) return null;
  try {
    const sb = await getClient();
    const { data } = await sb.auth.getSession();
    if (data.session) setMe(await loadProfile(sb, data.session.user.id));
  } catch (e) {
    console.warn('session', e);
  }
  return me;
}

// Writes a profile row; drops avatar_full if the server schema predates it.
async function writeProfile(run, row) {
  let res = await run(row);
  if (res.error && /avatar_full/.test(res.error.message || '') && 'avatar_full' in row) {
    const { avatar_full: _, ...rest } = row;
    res = await run(rest);
  }
  if (res.error) throw res.error;
  return res.data;
}

export async function signUp({ login, password, name, bike, avatar, avatarFull }) {
  login = login.trim().toLowerCase();
  if (!LOGIN_RE.test(login)) throw new Error('Логин: 3–24 символа, латиница, цифры, _');
  if (!name.trim()) throw new Error('Укажите имя');
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({ email: emailFor(login), password });
  if (error) throw error;
  if (!data.session) throw new Error('В Supabase не отключено подтверждение e-mail (Confirm email)');
  const row = { id: data.user.id, login, name: name.trim(), bike: bike.trim(), avatar: avatar || null };
  if (avatarFull) row.avatar_full = avatarFull;
  const profile = await writeProfile((r) => sb.from('profiles').insert(r).select(OWN_COLS).single(), row);
  setMe(profile);
  return profile;
}

export async function signIn({ login, password }) {
  login = login.trim().toLowerCase();
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email: emailFor(login), password });
  if (error) throw error;
  const profile = await loadProfile(sb, data.user.id);
  if (!profile) throw new Error('Аккаунт есть, но профиль не создан. Зарегистрируйтесь заново с другим логином');
  setMe(profile);
  return profile;
}

export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
  setMe(null);
}

export async function updateProfile(patch) {
  const sb = await getClient();
  const data = await writeProfile((r) => sb.from('profiles').update(r).eq('id', me.id).select(OWN_COLS).single(), patch);
  setMe(data);
  return data;
}

// Large avatar of any rider, or null (none uploaded / old schema).
export async function fetchAvatarFull(id) {
  const sb = await getClient();
  const { data, error } = await sb.from('profiles').select('avatar_full').eq('id', id).maybeSingle();
  return error ? null : data?.avatar_full || null;
}
