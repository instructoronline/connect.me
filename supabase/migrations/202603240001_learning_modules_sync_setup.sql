-- Learning Modules sync backend setup repair migration.
-- Safe to run multiple times.

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
  summary text not null default '',
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

grant execute on function public.get_learning_module_connected_users(text) to anon, authenticated;

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

grant execute on function public.get_learning_module_connections(text) to anon, authenticated;

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
  select 'foundations-of-transformers'::text as module_slug, 'Why transformers changed sequence modeling'::text as topic_title, 1 as sort_order
  union all select 'foundations-of-transformers', 'Tokens and embeddings', 2
  union all select 'foundations-of-transformers', 'Attention as the lesson engine', 3
  union all select 'mathematical-foundations-of-transformers', 'Vectors, matrices, and similarity', 1
  union all select 'mathematical-foundations-of-transformers', 'Softmax and probability flow', 2
  union all select 'mathematical-foundations-of-transformers', 'Optimization and training stability', 3
  union all select 'foundations-of-transformer-architecture', 'Query, key, and value roles', 1
  union all select 'foundations-of-transformer-architecture', 'Multi-head attention and feed-forward blocks', 2
  union all select 'foundations-of-transformer-architecture', 'Residuals, normalization, and model families', 3
)
insert into public.learning_module_topics (module_id, topic_title, sort_order)
select lm.id,
       st.topic_title,
       st.sort_order
from seeded_topics st
join public.learning_modules lm on lm.slug = st.module_slug
on conflict (module_id, topic_title) do update
set sort_order = excluded.sort_order;
