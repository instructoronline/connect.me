-- Learning Modules compatibility repair.
-- Ensures required Learning Modules tables, RLS, and RPC functions exist.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

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

create table if not exists public.learning_module_cards (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete cascade,
  topic_id uuid not null references public.learning_module_topics(id) on delete cascade,
  title text not null,
  card_type text not null default 'concept',
  sort_order integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (topic_id, sort_order)
);

create table if not exists public.learning_module_connections (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  connected_at timestamptz not null default timezone('utc', now()),
  unique (module_id, user_id)
);

create index if not exists learning_modules_sort_idx
  on public.learning_modules (sort_order asc);
create index if not exists learning_module_topics_module_idx
  on public.learning_module_topics (module_id, sort_order asc);
create index if not exists learning_module_cards_topic_idx
  on public.learning_module_cards (topic_id, sort_order asc);
create index if not exists learning_module_connections_module_idx
  on public.learning_module_connections (module_id, connected_at desc);
create index if not exists learning_module_connections_user_idx
  on public.learning_module_connections (user_id, connected_at desc);

alter table public.learning_modules enable row level security;
alter table public.learning_module_topics enable row level security;
alter table public.learning_module_cards enable row level security;
alter table public.learning_module_connections enable row level security;

grant select on public.learning_modules to anon, authenticated;
grant select on public.learning_module_topics to anon, authenticated;
grant select on public.learning_module_cards to anon, authenticated;
grant select, insert on public.learning_module_connections to authenticated;

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

drop policy if exists "learning module cards are readable by everyone" on public.learning_module_cards;
create policy "learning module cards are readable by everyone"
on public.learning_module_cards
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
             case when coalesce(p.share_first_name, true) then coalesce(p.first_name, '') else '' end,
             case when coalesce(p.share_first_name, true) and coalesce(p.share_last_name, true) then ' ' else '' end,
             case when coalesce(p.share_last_name, true) then coalesce(p.last_name, '') else '' end
           )), ''),
           'Connect.Me member'
         ) as public_name,
         case when coalesce(p.share_avatar, false) then coalesce(p.avatar_url, '') else '' end as avatar_url,
         lmc.connected_at
  from public.learning_module_connections lmc
  join public.learning_modules lm on lm.id = lmc.module_id
  left join public.profiles p on p.id = lmc.user_id
  where lm.slug = requested_module_slug
  order by lmc.connected_at desc;
$$;

-- Compatibility alias for environments that call a legacy RPC name.
create or replace function public.get_learning_module_connections(requested_module_slug text)
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
  select *
  from public.get_learning_module_connected_users(requested_module_slug);
$$;

grant execute on function public.get_learning_module_connected_users(text) to anon, authenticated;
grant execute on function public.get_learning_module_connections(text) to anon, authenticated;
