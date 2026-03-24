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

create index if not exists learning_modules_sort_idx on public.learning_modules (sort_order asc);
create index if not exists learning_module_topics_module_idx on public.learning_module_topics (module_id, sort_order asc);
create index if not exists learning_module_cards_topic_idx on public.learning_module_cards (topic_id, sort_order asc);
create index if not exists learning_module_connections_module_idx on public.learning_module_connections (module_id, connected_at desc);
create index if not exists learning_module_connections_user_idx on public.learning_module_connections (user_id, connected_at desc);

grant select on public.learning_modules to anon, authenticated;
grant select on public.learning_module_topics to anon, authenticated;
grant select on public.learning_module_cards to anon, authenticated;
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
alter table public.learning_module_cards enable row level security;
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

with seeded_cards as (
  select 'foundations-of-transformers'::text as module_slug, 'Why transformers changed sequence modeling'::text as topic_title, 'The core problem'::text as title, 'concept'::text as card_type, 1 as sort_order, '{"subtopic_title":"Long-range dependencies","sections":[{"label":"Short explanation","body":"Language, code, and multimodal tasks require a model to relate distant pieces of information."},{"label":"Example","body":"Pronouns, earlier assumptions, and prior code definitions often matter much later in the sequence."},{"label":"Key takeaway","body":"Transformers make long-range context lookup direct instead of forcing it through a narrow recurrent bottleneck."}]}'::jsonb as content
  union all select 'foundations-of-transformers', 'Why transformers changed sequence modeling', 'Why recurrence struggled', 'comparison', 2, '{"subtopic_title":"Sequential bottlenecks","sections":[{"label":"Short explanation","body":"RNNs and LSTMs process tokens one step at a time, which limits parallelism and makes long-range optimization harder."},{"label":"Pitfalls","body":"Important context can become diluted across many sequential updates."},{"label":"Connection to the broader problem","body":"Large modern AI systems benefit from architectures that scale efficiently across long sequences and large datasets."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Why transformers changed sequence modeling', 'Transformer mindset', 'intuition', 3, '{"subtopic_title":"Attend instead of compress","sections":[{"label":"Short explanation","body":"Each token can directly score and retrieve information from every other token through attention."},{"label":"Visual description","body":"Imagine every token drawing weighted links to the tokens it needs right now."},{"label":"Key takeaway","body":"Attention replaces a fragile single-memory path with flexible, content-based retrieval."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Tokens and embeddings', 'From text to tokens', 'concept', 1, '{"subtopic_title":"Tokenization","sections":[{"label":"Short explanation","body":"Text is split into reusable pieces such as words or subwords before entering the model."},{"label":"Example","body":"Rare words can be represented through combinations of known subword units."},{"label":"Pitfalls","body":"Tokenization choices affect efficiency, multilingual support, and how rare terms are represented."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Tokens and embeddings', 'Embeddings create meaning-rich vectors', 'concept', 2, '{"subtopic_title":"Representation space","sections":[{"label":"Short explanation","body":"Each token id maps to a dense vector in a learned representation space."},{"label":"Formula","body":"x_i = E[t_i], where E is the embedding matrix."},{"label":"Key takeaway","body":"Embeddings convert discrete symbols into trainable numerical representations."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Tokens and embeddings', 'Position still matters', 'concept', 3, '{"subtopic_title":"Ordering information","sections":[{"label":"Short explanation","body":"Positional information is added so the model can distinguish sequences that contain the same tokens in different orders."},{"label":"Example","body":"Positional encodings or learned position embeddings are combined with token embeddings."},{"label":"Connection to the broader problem","body":"Good sequence modeling requires both content and order."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Attention as the lesson engine', 'Self-attention basics', 'concept', 1, '{"subtopic_title":"Context weighting","sections":[{"label":"Short explanation","body":"Each token computes how much to focus on all other tokens in the sequence."},{"label":"Formula","body":"$$\operatorname{Attn}(Q, K, V) = \operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V.$$"},{"label":"Intuition","body":"Queries ask what a token wants, keys advertise what tokens contain, and values provide the retrievable information."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Attention as the lesson engine', 'Why scaling and softmax appear', 'math', 2, '{"subtopic_title":"Stable scoring","sections":[{"label":"Short explanation","body":"Scaling by sqrt(d_k) keeps attention logits from becoming excessively large before softmax."},{"label":"Derivation","body":"Dot-product variance tends to grow with dimension, so the scaling factor counteracts that growth."},{"label":"Key takeaway","body":"The scaling term helps attention remain trainable and avoids overly sharp early distributions."}]}'::jsonb
  union all select 'foundations-of-transformers', 'Attention as the lesson engine', 'Why transformers generalize well', 'synthesis', 3, '{"subtopic_title":"Flexible context use","sections":[{"label":"Short explanation","body":"Transformers can recompute which context matters at every layer instead of relying on a fixed memory path."},{"label":"Visual description","body":"Across layers, the model redraws an importance map over the sequence."},{"label":"Connection to the broader problem","body":"This flexibility is one reason transformers became foundational across modalities."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Vectors, matrices, and similarity', 'Vectors as feature bundles', 'concept', 1, '{"subtopic_title":"Coordinate meaning","sections":[{"label":"Short explanation","body":"A vector is an ordered collection of features that can represent token meaning or activation state."},{"label":"Example","body":"An embedding vector can encode many learned semantic and syntactic factors simultaneously."},{"label":"Intuition","body":"Each dimension is a dial the network can use while comparing or combining concepts."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Vectors, matrices, and similarity', 'Dot products measure alignment', 'math', 2, '{"subtopic_title":"Similarity scoring","sections":[{"label":"Formula","body":"$$a \cdot b = \sum_i a_i b_i.$$"},{"label":"Short explanation","body":"The dot product grows when two vectors point in similar directions."},{"label":"Connection to the broader problem","body":"Attention uses dot products to score how relevant one token is to another."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Vectors, matrices, and similarity', 'Matrices as batched transformations', 'concept', 3, '{"subtopic_title":"Linear maps","sections":[{"label":"Short explanation","body":"Matrices transform vectors by mixing, scaling, or rotating dimensions."},{"label":"Example","body":"$$Q = XW_Q, \qquad K = XW_K, \qquad V = XW_V.$$ These apply different learned transformations to the same token matrix."},{"label":"Key takeaway","body":"Matrix multiplication lets transformers process whole sequences in parallel."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Softmax and probability flow', 'What softmax does', 'math', 1, '{"subtopic_title":"Normalize scores","sections":[{"label":"Formula","body":"$$\operatorname{softmax}(z_i) = \frac{\exp(z_i)}{\sum_j \exp(z_j)}.$$"},{"label":"Short explanation","body":"Softmax turns raw scores into non-negative weights that sum to one."},{"label":"Example","body":"A higher compatibility score gives a token a larger share of the attention distribution."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Softmax and probability flow', 'Why softmax fits attention', 'intuition', 2, '{"subtopic_title":"Weighted focus","sections":[{"label":"Intuition","body":"Softmax converts context preferences into a usable distribution of focus."},{"label":"Pitfalls","body":"Very sharp or very flat attention distributions can both be problematic depending on the task."},{"label":"Key takeaway","body":"Softmax provides a differentiable balance between concentration and spread."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Softmax and probability flow', 'Expectation viewpoint', 'synthesis', 3, '{"subtopic_title":"Weighted averages","sections":[{"label":"Short explanation","body":"Attention outputs are weighted sums of value vectors and can be viewed as expectations over context candidates."},{"label":"Formula","body":"$$o_i = \sum_j \alpha_{ij} v_j.$$"},{"label":"Connection to the broader problem","body":"Attention is a differentiable retrieval mechanism built from linear algebra and probability normalization."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Optimization and training stability', 'Gradients tell parameters how to move', 'math', 1, '{"subtopic_title":"Backpropagation overview","sections":[{"label":"Short explanation","body":"Gradients quantify how changing each parameter affects the loss."},{"label":"Example","body":"Gradient descent moves weights in directions that reduce prediction error."},{"label":"Key takeaway","body":"Backpropagation makes large-scale learning computationally feasible."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Optimization and training stability', 'Why normalization and residuals help optimization', 'concept', 2, '{"subtopic_title":"Stable signal flow","sections":[{"label":"Short explanation","body":"Residual pathways and normalization reduce optimization instability in deep networks."},{"label":"Intuition","body":"A residual block can preserve useful information unless a learned correction improves it."},{"label":"Connection to the broader problem","body":"Stable training is essential for scaling transformers to practical sizes."}]}'::jsonb
  union all select 'mathematical-foundations-of-transformers', 'Optimization and training stability', 'Optimization in practice', 'synthesis', 3, '{"subtopic_title":"Scaling training","sections":[{"label":"Short explanation","body":"Large models rely on adaptive optimizers, schedules, initialization strategy, and clipping."},{"label":"Pitfalls","body":"Poor hyperparameters can cause divergence or slow convergence."},{"label":"Key takeaway","body":"Transformer success depends on optimization discipline as much as on architecture."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Query, key, and value roles', 'Three projections, three jobs', 'concept', 1, '{"subtopic_title":"Q, K, and V","sections":[{"label":"Short explanation","body":"Tokens are projected into query, key, and value vectors with different responsibilities."},{"label":"Formula","body":"$$Q = XW_Q, \qquad K = XW_K, \qquad V = XW_V.$$"},{"label":"Key takeaway","body":"Scoring relevance and carrying content are separated into complementary learned representations."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Query, key, and value roles', 'How a token chooses context', 'intuition', 2, '{"subtopic_title":"Compatibility scores","sections":[{"label":"Short explanation","body":"Each query compares against all keys to decide what context to retrieve."},{"label":"Example","body":"A pronoun token may strongly attend to a noun token that supplies its referent."},{"label":"Visual description","body":"One row of the attention matrix brightens where useful context lives."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Query, key, and value roles', 'Why values are separate', 'comparison', 3, '{"subtopic_title":"Retrieve versus score","sections":[{"label":"Short explanation","body":"Keys help rank relevance, while values store the content that gets blended into the output."},{"label":"Pitfalls","body":"Using the same representation for both jobs would reduce flexibility."},{"label":"Connection to the broader problem","body":"This separation makes attention expressive enough for complex reasoning patterns."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Multi-head attention and feed-forward blocks', 'Why multiple heads exist', 'concept', 1, '{"subtopic_title":"Parallel relationship detectors","sections":[{"label":"Short explanation","body":"Different heads can specialize in different patterns or relationships within the sequence."},{"label":"Example","body":"One head may focus on syntax while another tracks entities or positional structure."},{"label":"Key takeaway","body":"Multi-head attention expands representational capacity while staying computationally regular."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Multi-head attention and feed-forward blocks', 'Feed-forward layers after attention', 'concept', 2, '{"subtopic_title":"Per-token refinement","sections":[{"label":"Short explanation","body":"A position-wise feed-forward network transforms each token independently after context has been mixed through attention."},{"label":"Formula","body":"$$\operatorname{FFN}(x) = W_2 \sigma(W_1 x + b_1) + b_2.$$"},{"label":"Intuition","body":"Attention shares information across tokens, then the feed-forward block deepens each token representation."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Multi-head attention and feed-forward blocks', 'Putting heads back together', 'synthesis', 3, '{"subtopic_title":"Concatenate and project","sections":[{"label":"Short explanation","body":"Head outputs are concatenated and projected back into the model dimension."},{"label":"Connection to the broader problem","body":"Transformer layers repeatedly alternate between cross-token interaction and per-token computation."},{"label":"Key takeaway","body":"The full layer integrates several contextual views before moving onward."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Residuals, normalization, and model families', 'Residual connections preserve pathways', 'concept', 1, '{"subtopic_title":"Skip connections","sections":[{"label":"Short explanation","body":"Residual connections add a block’s input back to its output to preserve information and ease optimization."},{"label":"Formula","body":"$$y = x + F(x).$$"},{"label":"Intuition","body":"Each block learns a correction instead of rewriting the whole representation."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Residuals, normalization, and model families', 'Layer normalization steadies activations', 'concept', 2, '{"subtopic_title":"Stable scale","sections":[{"label":"Short explanation","body":"Layer normalization keeps activations in a more controlled range within each token representation."},{"label":"Pitfalls","body":"Without good normalization, deep networks become harder to train reliably."},{"label":"Key takeaway","body":"Normalization is a core ingredient of stable transformer training."}]}'::jsonb
  union all select 'foundations-of-transformer-architecture', 'Residuals, normalization, and model families', 'Encoder-only, decoder-only, and encoder-decoder', 'comparison', 3, '{"subtopic_title":"Architectural families","sections":[{"label":"Short explanation","body":"Encoder-only, decoder-only, and encoder-decoder systems use the same building blocks but different masking and information-flow patterns."},{"label":"Example","body":"BERT, GPT-style models, and T5-style models represent these three families."},{"label":"Connection to the broader problem","body":"Architectural family determines whether the model is best suited for representation, generation, or sequence-to-sequence tasks."}]}'::jsonb
)
insert into public.learning_module_cards (module_id, topic_id, title, card_type, sort_order, content)
select lm.id,
       lmt.id,
       sc.title,
       sc.card_type,
       sc.sort_order,
       sc.content
from seeded_cards sc
join public.learning_modules lm on lm.slug = sc.module_slug
join public.learning_module_topics lmt on lmt.module_id = lm.id and lmt.topic_title = sc.topic_title
on conflict (topic_id, sort_order) do update
set title = excluded.title,
    card_type = excluded.card_type,
    content = excluded.content;

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
