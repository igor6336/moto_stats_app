import { getClient, getMe } from './client.js';

const PROFILE_COLS = 'id, public_id, name, bike, avatar';

export async function findByCode(code) {
  const sb = await getClient();
  const { data, error } = await sb.from('profiles').select(PROFILE_COLS)
    .eq('public_id', code.trim().toUpperCase()).maybeSingle();
  if (error) throw error;
  return data;
}

// Returns accepted friends and pending requests in both directions.
export async function listFriends() {
  const sb = await getClient();
  const me = getMe();
  const { data: links, error } = await sb.from('friendships').select('*');
  if (error) throw error;
  const otherOf = (l) => (l.requester === me.id ? l.addressee : l.requester);
  const ids = [...new Set(links.map(otherOf))];
  let profiles = [];
  if (ids.length) {
    const res = await sb.from('profiles').select(PROFILE_COLS).in('id', ids);
    if (res.error) throw res.error;
    profiles = res.data;
  }
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const out = { friends: [], incoming: [], outgoing: [] };
  for (const l of links) {
    const p = byId.get(otherOf(l));
    if (!p) continue;
    if (l.status === 'accepted') out.friends.push(p);
    else if (l.addressee === me.id) out.incoming.push(p);
    else out.outgoing.push(p);
  }
  out.friends.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return out;
}

// Sends a request, or accepts theirs if they already asked.
export async function addFriend(code) {
  const me = getMe();
  const other = await findByCode(code);
  if (!other) throw new Error('Райдер с таким кодом не найден');
  if (other.id === me.id) throw new Error('Это ваш собственный код');
  const sb = await getClient();
  const { data: existing } = await sb.from('friendships').select('*')
    .or(`and(requester.eq.${me.id},addressee.eq.${other.id}),and(requester.eq.${other.id},addressee.eq.${me.id})`);
  const link = existing?.[0];
  if (link?.status === 'accepted') throw new Error(`${other.name} уже у вас в друзьях`);
  if (link && link.requester === me.id) throw new Error('Запрос уже отправлен');
  if (link) {
    await acceptFriend(other.id);
    return { profile: other, accepted: true };
  }
  const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: other.id });
  if (error) throw error;
  return { profile: other, accepted: false };
}

export async function acceptFriend(otherId) {
  const sb = await getClient();
  const { error } = await sb.from('friendships').update({ status: 'accepted' })
    .eq('requester', otherId).eq('addressee', getMe().id);
  if (error) throw error;
}

export async function removeFriend(otherId) {
  const sb = await getClient();
  const me = getMe().id;
  const { error } = await sb.from('friendships').delete()
    .or(`and(requester.eq.${me},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${me})`);
  if (error) throw error;
}

// Everything the profile screen shows about one rider (self or friend).
export async function fetchRider(id) {
  const sb = await getClient();
  const me = getMe().id;
  const [profile, rides, loc, link] = await Promise.all([
    sb.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle(),
    sb.from('rides').select('*').eq('user_id', id).order('started_at', { ascending: false }),
    sb.from('locations').select('*').eq('user_id', id).maybeSingle(),
    sb.from('friendships').select('*')
      .or(`and(requester.eq.${me},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${me})`),
  ]);
  for (const r of [profile, rides, loc, link]) if (r.error) throw r.error;
  return { profile: profile.data, rides: rides.data, location: loc.data, friendship: link.data?.[0] || null };
}
