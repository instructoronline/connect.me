-- Connect.Me Supabase schema
-- Run this in the Supabase SQL editor before loading the extension.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  first_name text not null check (char_length(first_name) between 1 and 50),
  last_name text not null check (char_length(last_name) between 1 and 50),
  place_of_work text not null check (char_length(place_of_work) between 1 and 120),
  education text not null check (char_length(education) between 1 and 120),
  current_location text not null check (char_length(current_location) between 1 and 120),
  headline text not null default '' check (char_length(headline) <= 120),
  bio text not null default '' check (char_length(bio) <= 280),
  avatar_path text not null default '',
  avatar_url text not null default '',
  share_avatar boolean not null default true,
  share_first_name boolean not null default true,
  share_last_name boolean not null default true,
  share_place_of_work boolean not null default true,
  share_education boolean not null default true,
  share_current_location boolean not null default true,
  share_bio boolean not null default true,
  share_professional_headline boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists share_avatar boolean not null default true;
alter table public.profiles add column if not exists share_first_name boolean not null default true;
alter table public.profiles add column if not exists share_last_name boolean not null default true;
alter table public.profiles add column if not exists share_place_of_work boolean not null default true;
alter table public.profiles add column if not exists share_education boolean not null default true;
alter table public.profiles add column if not exists share_current_location boolean not null default true;
alter table public.profiles add column if not exists share_bio boolean not null default true;
alter table public.profiles add column if not exists share_professional_headline boolean not null default true;

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
  presence_sharing_enabled boolean not null default false,
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

create table if not exists public.learning_modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  icon text,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.learning_module_topics (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete cascade,
  topic_title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (module_id, topic_title)
);

create table if not exists public.learning_module_connections (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  connected_at timestamptz not null default timezone('utc', now()),
  unique (module_id, user_id)
);

create index if not exists learning_modules_sort_idx on public.learning_modules (sort_order asc);
create index if not exists learning_module_topics_module_idx on public.learning_module_topics (module_id, sort_order asc);
create index if not exists learning_module_connections_module_idx on public.learning_module_connections (module_id, connected_at desc);
create index if not exists learning_module_connections_user_idx on public.learning_module_connections (user_id, connected_at desc);

grant select on public.learning_modules to anon, authenticated;
grant select on public.learning_module_topics to anon, authenticated;
grant select, insert on public.learning_module_connections to authenticated;

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
alter table public.learning_modules enable row level security;
alter table public.learning_module_topics enable row level security;
alter table public.learning_module_connections enable row level security;

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
    join public.profiles p on p.id = active_presence.user_id
    where ups.user_id = active_presence.user_id
      and ups.presence_sharing_enabled = true
      and ups.invisible_mode_enabled = false
      and ups.consent_granted = true
      and p.avatar_url <> ''
      and p.first_name <> ''
      and p.last_name <> ''
      and p.place_of_work <> ''
      and p.education <> ''
      and p.current_location <> ''
  )
);

drop policy if exists "users manage own browsing history" on public.browsing_history;
create policy "users manage own browsing history"
on public.browsing_history
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "learning modules are readable by everyone" on public.learning_modules;
create policy "learning modules are readable by everyone"
on public.learning_modules
for select
using (true);

drop policy if exists "learning module topics are readable by everyone" on public.learning_module_topics;
create policy "learning module topics are readable by everyone"
on public.learning_module_topics
for select
using (true);

drop policy if exists "users can read own learning module connections" on public.learning_module_connections;
create policy "users can read own learning module connections"
on public.learning_module_connections
for select
using (auth.uid() = user_id);

drop policy if exists "users can create own learning module connections" on public.learning_module_connections;
create policy "users can create own learning module connections"
on public.learning_module_connections
for insert
with check (auth.uid() = user_id);

create or replace function public.get_active_users_for_domain(requested_domain text)
returns table (
  id uuid,
  display_name text,
  email text,
  first_name text,
  last_name text,
  place_of_work text,
  education text,
  current_location text,
  headline text,
  professional_headline text,
  bio text,
  avatar_path text,
  avatar_url text,
  share_avatar boolean,
  share_first_name boolean,
  share_last_name boolean,
  share_place_of_work boolean,
  share_education boolean,
  share_current_location boolean,
  share_bio boolean,
  share_professional_headline boolean,
  last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         p.email,
         p.first_name,
         p.last_name,
         p.place_of_work,
         p.education,
         p.current_location,
         coalesce(p.headline, '') as headline,
         coalesce(p.headline, '') as professional_headline,
         p.bio,
         p.avatar_path,
         p.avatar_url,
         p.share_avatar,
         p.share_first_name,
         p.share_last_name,
         p.share_place_of_work,
         p.share_education,
         p.share_current_location,
         p.share_bio,
         coalesce(p.share_professional_headline, true) as share_professional_headline,
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

create or replace function public.get_learning_module_connected_users(requested_module_slug text)
returns table (
  module_id uuid,
  module_slug text,
  public_name text,
  avatar_url text,
  connected_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select lm.id as module_id,
         lm.slug as module_slug,
         coalesce(
           nullif(trim(concat(
             case when p.share_first_name then p.first_name else '' end,
             case when p.share_first_name and p.share_last_name then ' ' else '' end,
             case when p.share_last_name then p.last_name else '' end
           )), ''),
           'Connect.Me member'
         ) as public_name,
         case when p.share_avatar then p.avatar_url else '' end as avatar_url,
         lmc.connected_at
  from public.learning_module_connections lmc
  join public.learning_modules lm on lm.id = lmc.module_id
  join public.profiles p on p.id = lmc.user_id
  where lm.slug = requested_module_slug
  order by lmc.connected_at desc;
$$;

grant execute on function public.get_learning_module_connected_users(text) to anon, authenticated;

create or replace view public.top_active_sites as
select ap.domain,
       count(*)::int as active_user_count,
       max(ap.last_seen) as last_seen
from public.active_presence ap
join public.user_privacy_settings ups on ups.user_id = ap.user_id
join public.profiles p on p.id = ap.user_id
where ap.expires_at > timezone('utc', now())
  and ups.presence_sharing_enabled = true
  and ups.invisible_mode_enabled = false
  and ups.consent_granted = true
group by ap.domain
order by active_user_count desc, last_seen desc;

grant select on public.top_active_sites to anon, authenticated;

insert into public.learning_modules (slug, title, description, icon, sort_order)
values
  (
    'foundations-of-transformers',
    'Foundations of Transformers',
    'An introductory module covering the core ideas behind transformers, including sequence modeling, attention, tokens, embeddings, and why transformers became central to modern AI.',
    'book-open',
    1
  ),
  (
    'mathematical-foundations-of-transformers',
    'Mathematical Foundations of Transformers',
    'A mathematically focused module covering the linear algebra, probability, optimization, and matrix operations that support transformer models.',
    'book-open',
    2
  ),
  (
    'foundations-of-transformer-architecture',
    'Foundations of Transformer Architecture',
    'A structural module explaining the internal components of transformer systems, including attention blocks, feed-forward layers, residual connections, normalization, and multi-head mechanisms.',
    'book-open',
    3
  )
on conflict (slug) do update
set title = excluded.title,
    description = excluded.description,
    icon = excluded.icon,
    sort_order = excluded.sort_order;

with seeded_topics as (
  select 'foundations-of-transformers'::text as module_slug, 'What problems transformers solve'::text as topic_title, 1 as sort_order
  union all select 'foundations-of-transformers', 'Tokens and tokenization', 2
  union all select 'foundations-of-transformers', 'Embeddings and representation', 3
  union all select 'foundations-of-transformers', 'Self-attention basics', 4
  union all select 'foundations-of-transformers', 'Why transformers outperform older sequence models', 5
  union all select 'foundations-of-transformers', 'Overview of encoder and decoder ideas', 6
  union all select 'mathematical-foundations-of-transformers', 'Vectors, matrices, and tensor intuition', 1
  union all select 'mathematical-foundations-of-transformers', 'Dot products and similarity', 2
  union all select 'mathematical-foundations-of-transformers', 'Softmax and probability distributions', 3
  union all select 'mathematical-foundations-of-transformers', 'Matrix multiplication in attention', 4
  union all select 'mathematical-foundations-of-transformers', 'Gradients and backpropagation overview', 5
  union all select 'mathematical-foundations-of-transformers', 'Optimization basics for training transformers', 6
  union all select 'mathematical-foundations-of-transformers', 'Positional encoding mathematics', 7
  union all select 'foundations-of-transformer-architecture', 'Query, key, and value roles', 1
  union all select 'foundations-of-transformer-architecture', 'Multi-head attention', 2
  union all select 'foundations-of-transformer-architecture', 'Residual connections', 3
  union all select 'foundations-of-transformer-architecture', 'Layer normalization', 4
  union all select 'foundations-of-transformer-architecture', 'Feed-forward networks', 5
  union all select 'foundations-of-transformer-architecture', 'Encoder-only vs decoder-only vs encoder-decoder', 6
  union all select 'foundations-of-transformer-architecture', 'Information flow through transformer layers', 7
)
insert into public.learning_module_topics (module_id, topic_title, sort_order)
select lm.id,
       st.topic_title,
       st.sort_order
from seeded_topics st
join public.learning_modules lm on lm.slug = st.module_slug
on conflict (module_id, topic_title) do update
set sort_order = excluded.sort_order;

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

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'avatars') then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true);
  end if;
exception
  when undefined_table then
    raise notice 'Supabase storage metadata is unavailable in this environment. Create the avatars bucket manually if needed.';
end;
$$;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
on storage.objects
for select
using (bucket_id = 'avatars');

drop policy if exists "Authenticated users upload own avatar images" on storage.objects;
create policy "Authenticated users upload own avatar images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Authenticated users update own avatar images" on storage.objects;
create policy "Authenticated users update own avatar images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Authenticated users delete own avatar images" on storage.objects;
create policy "Authenticated users delete own avatar images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

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
