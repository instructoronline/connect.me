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

create index if not exists learning_modules_sort_idx on public.learning_modules (sort_order asc);
create index if not exists learning_module_topics_module_idx on public.learning_module_topics (module_id, sort_order asc);
create index if not exists learning_module_cards_topic_idx on public.learning_module_cards (topic_id, sort_order asc);
create index if not exists learning_module_connections_module_idx on public.learning_module_connections (module_id, connected_at desc);
create index if not exists learning_module_connections_user_idx on public.learning_module_connections (user_id, connected_at desc);

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
