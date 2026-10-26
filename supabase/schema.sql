-- Moto telemetry: social backend schema for Supabase.
-- Paste the whole file into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: drops and recreates policies and functions, keeps data.

-- ---------------------------------------------------------------- profiles
-- Short friend code like MOTO-7K3QX; no 0/O/1/I to avoid misreading.
create or replace function public.gen_public_id() returns text
language plpgsql volatile as $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate := 'MOTO-';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where public_id = candidate);
  end loop;
  return candidate;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id text unique not null,
  login text unique not null check (login ~ '^[a-z0-9_]{3,24}$'),
  name text not null check (char_length(name) between 1 and 40),
  bike text not null default '' check (char_length(bike) <= 60),
  avatar text check (avatar is null or char_length(avatar) < 200000), -- small JPEG data URL
  created_at timestamptz not null default now()
);

-- public_id is assigned by the server and login never changes.
create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.public_id := public.gen_public_id();
  else
    new.public_id := old.public_id;
    new.login := old.login;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ------------------------------------------------------------- friendships
create table if not exists public.friendships (
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- One row per pair, whoever asked first.
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

create or replace function public.is_friend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- --------------------------------------------------------------- locations
-- Last known position, one row per user. No row = not sharing (ghost mode).
create table if not exists public.locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  speed real,
  heading real,
  accuracy real,
  riding boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Server time, so a wrong phone clock cannot fake "online".
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists locations_touch on public.locations;
create trigger locations_touch before insert or update on public.locations
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------- rides
-- Ride summaries for leaderboards. Raw data stays on the phone.
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  local_id text not null,
  started_at timestamptz not null,
  duration_s real not null check (duration_s >= 0),
  moving_s real not null check (moving_s >= 0),
  distance_m real not null check (distance_m >= 0),
  max_speed_ms real not null check (max_speed_ms between 0 and 120),
  avg_moving_ms real not null check (avg_moving_ms between 0 and 120),
  bike text not null default '',
  algo_version int not null,
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);
create index if not exists rides_user_started on public.rides (user_id, started_at);

-- Large avatar for the full-screen photo view (added in app 0.6.2).
alter table public.profiles add column if not exists avatar_full text
  check (avatar_full is null or char_length(avatar_full) < 400000);

-- Best acceleration times per ride, seconds (added in app 0.4.0).
alter table public.rides add column if not exists accel_0_100_s real
  check (accel_0_100_s is null or accel_0_100_s between 2 and 60);
alter table public.rides add column if not exists accel_100_200_s real
  check (accel_100_200_s is null or accel_100_200_s between 2 and 60);
alter table public.rides add column if not exists accel_0_200_s real
  check (accel_0_200_s is null or accel_0_200_s between 2 and 60);

-- --------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.locations enable row level security;
alter table public.rides enable row level security;

drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
-- Profiles (name, bike, avatar, code) are visible to any signed-in rider,
-- so a friend can be found by code.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists friendships_read on public.friendships;
drop policy if exists friendships_request on public.friendships;
drop policy if exists friendships_accept on public.friendships;
drop policy if exists friendships_delete on public.friendships;
create policy friendships_read on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
create policy friendships_request on public.friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');
create policy friendships_accept on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

drop policy if exists locations_read on public.locations;
drop policy if exists locations_write on public.locations;
create policy locations_read on public.locations for select to authenticated
  using (user_id = auth.uid() or public.is_friend(auth.uid(), user_id));
create policy locations_write on public.locations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists rides_read on public.rides;
drop policy if exists rides_write on public.rides;
create policy rides_read on public.rides for select to authenticated
  using (user_id = auth.uid() or public.is_friend(auth.uid(), user_id));
create policy rides_write on public.rides for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- realtime
-- Friends' positions are pushed live; RLS above limits who receives what.
do $$
begin
  alter publication supabase_realtime add table public.locations;
exception when duplicate_object then null;
end $$;
