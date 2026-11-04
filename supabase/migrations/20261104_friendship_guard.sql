-- Apply to the existing project after review. No tables or data are created.
begin;

-- Participants are immutable: RLS alone cannot compare OLD and NEW.
create or replace function public.friendships_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.requester is distinct from old.requester
     or new.addressee is distinct from old.addressee then
    raise exception 'friendship participants cannot change' using errcode = '23514';
  end if;
  if old.status <> 'pending' or new.status <> 'accepted' then
    raise exception 'only pending requests can be accepted' using errcode = '23514';
  end if;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists friendships_guard on public.friendships;
create trigger friendships_guard before update on public.friendships
  for each row execute function public.friendships_guard();

drop policy if exists friendships_accept on public.friendships;
create policy friendships_accept on public.friendships for update to authenticated
  using (addressee = auth.uid() and status = 'pending')
  with check (addressee = auth.uid() and status = 'accepted');

commit;
