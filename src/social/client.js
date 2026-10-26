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

async function loadProfile(sb, userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
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

export async function signUp({ login, password, name, bike, avatar }) {
  login = login.trim().toLowerCase();
  if (!LOGIN_RE.test(login)) throw new Error('Логин: 3–24 символа, латиница, цифры, _');
  if (!name.trim()) throw new Error('Укажите имя');
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({ email: emailFor(login), password });
  if (error) throw error;
  if (!data.session) throw new Error('В Supabase не отключено подтверждение e-mail (Confirm email)');
  const { data: profile, error: pErr } = await sb.from('profiles')
    .insert({ id: data.user.id, login, name: name.trim(), bike: bike.trim(), avatar: avatar || null })
    .select().single();
  if (pErr) throw pErr;
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
  const { data, error } = await sb.from('profiles').update(patch).eq('id', me.id).select().single();
  if (error) throw error;
  setMe(data);
  return data;
}
