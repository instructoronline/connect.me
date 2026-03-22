-- Connect.Me Supabase schema
-- Run this in the Supabase SQL editor before loading the extension.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  headline text not null default '' check (char_length(headline) <= 120),
  bio text not null default '' check (char_length(bio) <= 280),
  avatar_url text not null default '',
  presence_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_granted boolean not null default false,
  tracking_enabled boolean not null default false,
  history_mode text not null default 'domain' check (history_mode in ('none', 'domain', 'path', 'full_url')),
  retention_unit text not null default 'days' check (retention_unit in ('hours', 'days', 'months')),
  retention_value integer not null default 7 check (
    (retention_unit = 'hours' and retention_value between 1 and 12) or
    (retention_unit = 'days' and retention_value between 1 and 30) or
    (retention_unit = 'months' and retention_value between 1 and 30)
  ),
  presence_sharing_enabled boolean not null default true,
  invisible_mode_enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.active_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  domain text not null,
  path text,
  full_url text,
  page_title text,
  last_seen timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '3 minutes'
);

create index if not exists active_presence_domain_idx on public.active_presence (domain);
create index if not exists active_presence_expires_idx on public.active_presence (expires_at);

create table if not exists public.browsing_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain text not null,
  path text,
  full_url text,
  page_title text,
  tracked_scope text not null check (tracked_scope in ('domain', 'path', 'full_url')),
  visited_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists browsing_history_user_idx on public.browsing_history (user_id, visited_at desc);
create index if not exists browsing_history_expiry_idx on public.browsing_history (expires_at);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row
execute procedure public.touch_updated_at();

drop trigger if exists privacy_touch_updated_at on public.user_privacy_settings;
create trigger privacy_touch_updated_at
before update on public.user_privacy_settings
for each row
execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.user_privacy_settings enable row level security;
alter table public.active_presence enable row level security;
alter table public.browsing_history enable row level security;

drop policy if exists "profiles are readable for active presence" on public.profiles;
create policy "profiles are readable for active presence"
on public.profiles
for select
using (true);

drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "users manage own privacy settings" on public.user_privacy_settings;
create policy "users manage own privacy settings"
on public.user_privacy_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users manage own presence" on public.active_presence;
create policy "users manage own presence"
on public.active_presence
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "presence visible only when still active" on public.active_presence;
create policy "presence visible only when still active"
on public.active_presence
for select
using (
  expires_at > timezone('utc', now()) and
  exists (
    select 1
    from public.user_privacy_settings ups
    where ups.user_id = active_presence.user_id
      and ups.presence_sharing_enabled = true
      and ups.invisible_mode_enabled = false
      and ups.consent_granted = true
  )
);

drop policy if exists "users manage own browsing history" on public.browsing_history;
create policy "users manage own browsing history"
on public.browsing_history
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.get_active_users_for_domain(requested_domain text)
returns table (
  id uuid,
  display_name text,
  headline text,
  bio text,
  last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         p.headline,
         p.bio,
         ap.last_seen
  from public.active_presence ap
  join public.profiles p on p.id = ap.user_id
  join public.user_privacy_settings ups on ups.user_id = ap.user_id
  where ap.domain = requested_domain
    and ap.expires_at > timezone('utc', now())
    and ups.presence_sharing_enabled = true
    and ups.invisible_mode_enabled = false
    and ups.consent_granted = true
  order by ap.last_seen desc;
$$;

grant execute on function public.get_active_users_for_domain(text) to anon, authenticated;

create or replace view public.top_active_sites as
select ap.domain,
       count(*)::int as active_user_count,
       max(ap.last_seen) as last_seen
from public.active_presence ap
join public.user_privacy_settings ups on ups.user_id = ap.user_id
where ap.expires_at > timezone('utc', now())
  and ups.presence_sharing_enabled = true
  and ups.invisible_mode_enabled = false
  and ups.consent_granted = true
group by ap.domain
order by active_user_count desc, last_seen desc;

grant select on public.top_active_sites to anon, authenticated;

create or replace function public.delete_my_history()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.browsing_history where user_id = auth.uid();
$$;

grant execute on function public.delete_my_history() to authenticated;

create or replace function public.clear_my_presence()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.active_presence where user_id = auth.uid();
$$;

grant execute on function public.clear_my_presence() to authenticated;

create or replace function public.purge_expired_history()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.browsing_history where expires_at <= timezone('utc', now());
  delete from public.active_presence where expires_at <= timezone('utc', now());
$$;

grant execute on function public.purge_expired_history() to anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'connectme-purge-expired-history') then
    perform cron.schedule(
      'connectme-purge-expired-history',
      '*/10 * * * *',
      $cron$select public.purge_expired_history();$cron$
    );
  end if;
exception
  when undefined_table then
    raise notice 'pg_cron metadata table is unavailable; rely on extension-side purging instead.';
end;
$$;

create or replace function public.delete_my_account_completely()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  delete from public.active_presence where user_id = current_user_id;
  delete from public.browsing_history where user_id = current_user_id;
  delete from public.user_privacy_settings where user_id = current_user_id;
  delete from public.profiles where id = current_user_id;
  delete from auth.users where id = current_user_id;
end;
$$;

grant execute on function public.delete_my_account_completely() to authenticated;
