const COMPLETION_STATES = [
  'not_started',
  'exploring',
  'partially_completed',
  'needs_review',
  'well_explained',
  'mastered'
];

const COLLABORATIVE_BLUEPRINTS = [
  {
    module_slug: 'foundations-of-transformers',
    workspace_overview: 'Build a shared understanding of the core transformer ideas and how they connect.',
    concepts: [
      {
        id: 'fnd-seq-modeling',
        title: 'Sequence modeling shift',
        simple_explanation: 'Transformers replaced recurrence with direct context lookup across a sequence.',
        formal_explanation: 'Given token embeddings X, self-attention computes token-to-token relevance with softmax(QK^T / sqrt(d_k)) and mixes V accordingly.',
        visual_intuition: 'Each token looks at a relevance heatmap over all tokens, then blends the most useful context.',
        formulas: ['Attn(X) = softmax(QK^T / sqrt(d_k))V', 'Q = XW_Q, K = XW_K, V = XW_V'],
        usage_in_transformers: 'Used in every encoder and decoder stack to model contextual dependencies.',
        related_concepts: ['fnd-attention', 'fnd-embeddings'],
        prerequisites: ['fnd-embeddings'],
        applications: ['fnd-positional-encoding'],
        suggested_links: {
          prerequisites: ['Token embeddings', 'Dot product similarity'],
          formulas: ['Scaled dot-product attention denominator'],
          related_explanations: ['Why recurrence bottlenecks long-context modeling'],
          usage_links: ['Context mixing inside each transformer block'],
          next_concept: 'fnd-attention'
        },
        tasks: [
          { id: 'fnd-seq-fill-expl', type: 'fill_explanation', prompt: 'Complete: Transformers are effective for long context because they ______ instead of passing one hidden state through every step.' },
          { id: 'fnd-seq-fill-formula', type: 'fill_formula', prompt: 'Fill the missing term: softmax(QK^T / ____ )V' },
          { id: 'fnd-seq-why-matters', type: 'why_matters', prompt: 'Explain in 1-2 lines why this shift changed practical model scaling.' }
        ]
      },
      {
        id: 'fnd-attention',
        title: 'Attention as retrieval',
        simple_explanation: 'Attention lets a token retrieve useful context from other tokens.',
        formal_explanation: 'Scores s_ij = q_i^T k_j are normalized to alpha_ij, then output o_i = Σ alpha_ij v_j.',
        visual_intuition: 'Imagine each token sending a query through a searchable memory table of keys and values.',
        formulas: ['s_ij = q_i^T k_j / sqrt(d_k)', 'o_i = Σ_j alpha_ij v_j'],
        usage_in_transformers: 'Core mechanism used for self-attention and cross-attention.',
        related_concepts: ['fnd-seq-modeling', 'fnd-positional-encoding'],
        prerequisites: ['fnd-seq-modeling'],
        applications: ['fnd-embeddings'],
        suggested_links: {
          prerequisites: ['Vector similarity', 'Softmax normalization'],
          formulas: ['Derive alpha_ij from s_ij'],
          related_explanations: ['Interpret attention matrix rows'],
          usage_links: ['Pronoun/coreference resolution behavior'],
          next_concept: 'fnd-positional-encoding'
        },
        tasks: [
          { id: 'fnd-attn-derive', type: 'derivation_step', prompt: 'Complete the missing derivation step from raw scores s_ij to normalized weights alpha_ij.' },
          { id: 'fnd-attn-connect', type: 'connect_concept', prompt: 'Connect this concept to one architecture block where it is directly applied.' },
          { id: 'fnd-attn-example', type: 'usage_example', prompt: 'Add one usage example from language modeling or translation.' }
        ]
      },
      {
        id: 'fnd-embeddings',
        title: 'Token + positional embeddings',
        simple_explanation: 'Embeddings convert tokens and positions into trainable vectors.',
        formal_explanation: 'Input representation x_i = e(token_i) + p(i), where p(i) encodes token order.',
        visual_intuition: 'Tokens become points in semantic space, then shifted with location information.',
        formulas: ['x_i = e_i + p_i'],
        usage_in_transformers: 'Provides the input signal consumed by attention and feed-forward layers.',
        related_concepts: ['fnd-seq-modeling', 'fnd-positional-encoding'],
        prerequisites: [],
        applications: ['fnd-seq-modeling'],
        suggested_links: {
          prerequisites: ['Vocabulary and tokenization'],
          formulas: ['Sinusoidal position encoding'],
          related_explanations: ['Why order must be injected explicitly'],
          usage_links: ['Embedding matrix as learned lookup table'],
          next_concept: 'fnd-seq-modeling'
        },
        tasks: [
          { id: 'fnd-embed-hidden-words', type: 'fill_explanation', prompt: 'Fill in: Without positional encodings, attention is largely ______ to token order.' },
          { id: 'fnd-embed-match', type: 'match_architecture', prompt: 'Match token embeddings, position embeddings, and output projection to their architecture blocks.' },
          { id: 'fnd-embed-why', type: 'why_matters', prompt: 'Why is embedding quality critical before any attention computation?' }
        ]
      },
      {
        id: 'fnd-positional-encoding',
        title: 'Positional encodings',
        simple_explanation: 'Positional signals inject order information into token representations.',
        formal_explanation: 'Sinusoidal encodings use frequencies PE(pos, 2i) = sin(pos / 10000^(2i/d_model)).',
        visual_intuition: 'Each position gets a unique, smooth waveform signature the model can compare.',
        formulas: ['PE(pos, 2i)=sin(pos/10000^(2i/d_model))', 'PE(pos, 2i+1)=cos(pos/10000^(2i/d_model))'],
        usage_in_transformers: 'Preserves ordering for sequence interpretation in self-attention.',
        related_concepts: ['fnd-embeddings', 'fnd-attention'],
        prerequisites: ['fnd-embeddings'],
        applications: [],
        suggested_links: {
          prerequisites: ['Periodic functions basics'],
          formulas: ['Even/odd dimensions sin-cos pair'],
          related_explanations: ['Relative vs absolute position encodings'],
          usage_links: ['Order-sensitive tasks'],
          next_concept: 'fnd-attention'
        },
        tasks: [
          { id: 'fnd-pos-formula-gap', type: 'fill_formula', prompt: 'Complete the odd-index formula term: PE(pos, 2i+1)= ____ (pos/10000^(2i/d_model))' },
          { id: 'fnd-pos-derive', type: 'derivation_step', prompt: 'Complete one derivation note explaining how sinusoidal features help extrapolate to longer sequences.' }
        ]
      }
    ]
  },
  {
    module_slug: 'mathematical-foundations-of-transformers',
    workspace_overview: 'Collaboratively complete the mathematical machinery that powers transformer training and inference.',
    concepts: [
      {
        id: 'math-linear-algebra',
        title: 'Linear algebra primitives',
        simple_explanation: 'Transformer layers are matrix-heavy linear operations plus nonlinearities.',
        formal_explanation: 'Most transformations are affine maps Y = XW + b applied over batched token matrices.',
        visual_intuition: 'Each layer rotates/scales token vectors to expose useful dimensions.',
        formulas: ['Y = XW + b'],
        usage_in_transformers: 'Used in projections for Q, K, V and feed-forward layers.',
        related_concepts: ['math-softmax', 'math-optimization'],
        prerequisites: [],
        applications: ['math-attention-math'],
        suggested_links: {
          prerequisites: ['Matrix multiplication rules'],
          formulas: ['Dimension-check for attention projections'],
          related_explanations: ['Why batched GEMM dominates runtime'],
          usage_links: ['Projection layers in multi-head attention'],
          next_concept: 'math-attention-math'
        },
        tasks: [
          { id: 'math-linalg-dims', type: 'fill_formula', prompt: 'Fill in dimensions for X(nxd_model) * W(d_model x ____ ) = Q.' },
          { id: 'math-linalg-usage', type: 'usage_example', prompt: 'Give one concrete usage example inside an encoder block.' }
        ]
      },
      {
        id: 'math-attention-math',
        title: 'Scaled dot-product attention math',
        simple_explanation: 'Attention weights come from scaled query-key similarity.',
        formal_explanation: 'Attention(Q,K,V)=softmax(QK^T/sqrt(d_k))V.',
        visual_intuition: 'Higher similarity produces higher influence after normalization.',
        formulas: ['Attention(Q,K,V)=softmax(QK^T/sqrt(d_k))V'],
        usage_in_transformers: 'Central formula in each attention head.',
        related_concepts: ['math-softmax', 'math-probability'],
        prerequisites: ['math-linear-algebra'],
        applications: ['math-multihead'],
        suggested_links: {
          prerequisites: ['Dot product geometry'],
          formulas: ['Why divide by sqrt(d_k)'],
          related_explanations: ['Score variance stabilization'],
          usage_links: ['Self-attention score matrix'],
          next_concept: 'math-softmax'
        },
        tasks: [
          { id: 'math-attn-missing-term', type: 'fill_formula', prompt: 'Complete: softmax(QK^T / ______ )V.' },
          { id: 'math-attn-derive-step', type: 'derivation_step', prompt: 'Add the derivation step that motivates the scaling factor.' }
        ]
      },
      {
        id: 'math-softmax',
        title: 'Softmax and probability simplex',
        simple_explanation: 'Softmax converts raw scores into nonnegative weights summing to 1.',
        formal_explanation: 'softmax(z_i)=exp(z_i)/Σ_j exp(z_j).',
        visual_intuition: 'It turns comparisons into attention shares across candidates.',
        formulas: ['softmax(z_i)=exp(z_i)/Σ_j exp(z_j)'],
        usage_in_transformers: 'Normalizes attention scores and output token logits.',
        related_concepts: ['math-attention-math', 'math-optimization'],
        prerequisites: ['math-attention-math'],
        applications: ['math-probability'],
        suggested_links: {
          prerequisites: ['Exponentials and normalization'],
          formulas: ['Numerically stable softmax'],
          related_explanations: ['Temperature effects on distributions'],
          usage_links: ['Attention row normalization'],
          next_concept: 'math-optimization'
        },
        tasks: [
          { id: 'math-softmax-hidden', type: 'fill_explanation', prompt: 'Complete: Softmax outputs are always ______ and sum to ______.' },
          { id: 'math-softmax-why', type: 'why_matters', prompt: 'Why does the simplex constraint matter for interpretability and stability?' }
        ]
      },
      {
        id: 'math-optimization',
        title: 'Optimization and gradients',
        simple_explanation: 'Training updates parameters via gradient-based optimization.',
        formal_explanation: 'θ_{t+1}=θ_t-η∇_θ L(θ_t), often with Adam-style adaptive moments.',
        visual_intuition: 'Loss landscapes are navigated using local slope information.',
        formulas: ['θ_{t+1}=θ_t-η∇_θ L(θ_t)'],
        usage_in_transformers: 'Used to train every projection and normalization parameter.',
        related_concepts: ['math-softmax', 'math-linear-algebra'],
        prerequisites: ['math-softmax'],
        applications: [],
        suggested_links: {
          prerequisites: ['Chain rule'],
          formulas: ['Adam update steps'],
          related_explanations: ['Learning-rate warmup rationale'],
          usage_links: ['Stabilizing early transformer training'],
          next_concept: 'math-multihead'
        },
        tasks: [
          { id: 'math-opt-derivation', type: 'derivation_step', prompt: 'Complete one gradient-flow step through attention weights.' },
          { id: 'math-opt-example', type: 'usage_example', prompt: 'Add one practical optimizer configuration used for transformer pretraining.' }
        ]
      },
      {
        id: 'math-multihead',
        title: 'Multi-head decomposition',
        simple_explanation: 'Multiple heads learn different attention patterns in parallel.',
        formal_explanation: 'head_h = Attention(XW_Q^h, XW_K^h, XW_V^h); MHA = Concat(head_h)W_O.',
        visual_intuition: 'Different heads act like specialized lenses over the same context.',
        formulas: ['MHA(X)=Concat(head_1,...,head_H)W_O'],
        usage_in_transformers: 'Combines diverse context signals before residual paths.',
        related_concepts: ['math-attention-math', 'math-linear-algebra'],
        prerequisites: ['math-attention-math'],
        applications: [],
        suggested_links: {
          prerequisites: ['Block matrix composition'],
          formulas: ['Head-wise projection equations'],
          related_explanations: ['Why single-head attention is limiting'],
          usage_links: ['Encoder attention block'],
          next_concept: 'math-optimization'
        },
        tasks: [
          { id: 'math-mha-match', type: 'match_architecture', prompt: 'Match each formula component to Q/K/V projections, head concat, and output projection.' }
        ]
      }
    ]
  },
  {
    module_slug: 'foundations-of-transformer-architecture',
    workspace_overview: 'Co-build structural understanding of transformer blocks and how data flows through them.',
    concepts: [
      {
        id: 'arch-block-flow',
        title: 'Transformer block data flow',
        simple_explanation: 'A block applies attention, residual addition, normalization, then feed-forward layers.',
        formal_explanation: 'x -> LN(x + MHA(x)) -> LN(x + FFN(x)).',
        visual_intuition: 'Information travels through two compute paths with shortcut highways.',
        formulas: ['y = LN(x + MHA(x))', 'z = LN(y + FFN(y))'],
        usage_in_transformers: 'Defines repeated backbone unit in encoder/decoder stacks.',
        related_concepts: ['arch-residuals', 'arch-layernorm'],
        prerequisites: [],
        applications: ['arch-encoder-decoder'],
        suggested_links: {
          prerequisites: ['Residual learning basics'],
          formulas: ['Pre-norm vs post-norm variants'],
          related_explanations: ['Why repeated depth works'],
          usage_links: ['Stacked encoder architecture'],
          next_concept: 'arch-residuals'
        },
        tasks: [
          { id: 'arch-flow-fill', type: 'fill_formula', prompt: 'Complete: z = LN(y + ____ (y))' },
          { id: 'arch-flow-why', type: 'why_matters', prompt: 'Why does this ordering help stable deep training?' }
        ]
      },
      {
        id: 'arch-residuals',
        title: 'Residual connections',
        simple_explanation: 'Residual paths preserve information and ease optimization.',
        formal_explanation: 'Residual mapping computes x + F(x), improving gradient propagation.',
        visual_intuition: 'A shortcut lane carries baseline information while learned transforms add refinements.',
        formulas: ['y = x + F(x)'],
        usage_in_transformers: 'Wraps attention and feed-forward sublayers.',
        related_concepts: ['arch-block-flow', 'arch-layernorm'],
        prerequisites: ['arch-block-flow'],
        applications: [],
        suggested_links: {
          prerequisites: ['Gradient flow intuition'],
          formulas: ['Residual Jacobian intuition'],
          related_explanations: ['Deep network degradation problem'],
          usage_links: ['Attention sublayer skip path'],
          next_concept: 'arch-layernorm'
        },
        tasks: [
          { id: 'arch-res-connect', type: 'connect_concept', prompt: 'Connect residuals to one training-stability benefit and one architecture block.' }
        ]
      },
      {
        id: 'arch-layernorm',
        title: 'Layer normalization',
        simple_explanation: 'LayerNorm stabilizes token representations by normalizing feature statistics.',
        formal_explanation: 'LN(x) = γ((x-μ)/sqrt(σ^2+ε)) + β.',
        visual_intuition: 'It keeps feature scales consistent so optimization stays stable across depth.',
        formulas: ['LN(x)=γ((x-μ)/sqrt(σ^2+ε))+β'],
        usage_in_transformers: 'Used in each block around attention/FFN composition.',
        related_concepts: ['arch-residuals', 'arch-ffn'],
        prerequisites: ['arch-residuals'],
        applications: [],
        suggested_links: {
          prerequisites: ['Mean and variance'],
          formulas: ['Per-token normalization axis'],
          related_explanations: ['Training instability without normalization'],
          usage_links: ['Pre-norm block layout'],
          next_concept: 'arch-ffn'
        },
        tasks: [
          { id: 'arch-ln-hidden-term', type: 'fill_formula', prompt: 'Fill the missing stabilizer term: sqrt(σ^2 + ____ )' }
        ]
      },
      {
        id: 'arch-ffn',
        title: 'Position-wise feed-forward network',
        simple_explanation: 'FFN applies nonlinear transformation to each token independently.',
        formal_explanation: 'FFN(x)=W_2 σ(W_1 x + b_1) + b_2.',
        visual_intuition: 'After context mixing, FFN enriches each token with learned feature composition.',
        formulas: ['FFN(x)=W_2σ(W_1x+b_1)+b_2'],
        usage_in_transformers: 'Second major sublayer in each transformer block.',
        related_concepts: ['arch-layernorm', 'arch-multihead-layout'],
        prerequisites: ['arch-layernorm'],
        applications: [],
        suggested_links: {
          prerequisites: ['Activation functions'],
          formulas: ['GELU-based FFN variant'],
          related_explanations: ['Why token-wise nonlinearity follows attention'],
          usage_links: ['MLP blocks in LLM architectures'],
          next_concept: 'arch-multihead-layout'
        },
        tasks: [
          { id: 'arch-ffn-derive', type: 'derivation_step', prompt: 'Complete the derivation for the two-layer MLP transformation in FFN.' }
        ]
      },
      {
        id: 'arch-multihead-layout',
        title: 'Multi-head attention layout',
        simple_explanation: 'Multi-head layout splits attention into parallel subspaces.',
        formal_explanation: 'Heads are projected, attended independently, concatenated, and projected back.',
        visual_intuition: 'Parallel branches each focus on different relation types and are merged.',
        formulas: ['Concat(head_1,...,head_H)W_O'],
        usage_in_transformers: 'Main attention substructure in encoder and decoder.',
        related_concepts: ['arch-block-flow', 'arch-encoder-decoder'],
        prerequisites: ['arch-ffn'],
        applications: ['arch-encoder-decoder'],
        suggested_links: {
          prerequisites: ['Projection matrices'],
          formulas: ['Head dimension relation d_model = H * d_head'],
          related_explanations: ['Interpretability of head specialization'],
          usage_links: ['Cross-attention in decoder'],
          next_concept: 'arch-encoder-decoder'
        },
        tasks: [
          { id: 'arch-mha-match', type: 'match_architecture', prompt: 'Match each pipeline stage: split -> score -> mix -> concat -> project.' }
        ]
      },
      {
        id: 'arch-encoder-decoder',
        title: 'Encoder-decoder composition',
        simple_explanation: 'The encoder builds context-rich representations; decoder generates outputs with self and cross attention.',
        formal_explanation: 'Decoder attends to prior outputs causally and to encoder outputs via cross-attention.',
        visual_intuition: 'Think of encoder as memory builder and decoder as guided generator.',
        formulas: ['Decoder block: CausalMHA + CrossAttn + FFN'],
        usage_in_transformers: 'Used in seq2seq tasks like translation and summarization.',
        related_concepts: ['arch-multihead-layout', 'arch-block-flow'],
        prerequisites: ['arch-multihead-layout'],
        applications: [],
        suggested_links: {
          prerequisites: ['Causal masking'],
          formulas: ['Cross-attention score equation'],
          related_explanations: ['Why decoder needs masked self-attention'],
          usage_links: ['Machine translation pipeline'],
          next_concept: 'arch-block-flow'
        },
        tasks: [
          { id: 'arch-encdec-example', type: 'usage_example', prompt: 'Add one end-to-end usage example showing what each side contributes.' },
          { id: 'arch-encdec-why', type: 'why_matters', prompt: 'Explain why cross-attention is essential in encoder-decoder tasks.' }
        ]
      }
    ]
  }
];

const clone = (value) => JSON.parse(JSON.stringify(value));

function normalizeTask(task = {}, conceptId = '') {
  return {
    id: task.id || `${conceptId}-task-${Math.random().toString(36).slice(2, 8)}`,
    type: task.type || 'fill_explanation',
    prompt: task.prompt || 'Add collaborative completion details.'
  };
}

function normalizeConcept(concept = {}) {
  const id = concept.id || `concept-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...concept,
    id,
    related_concepts: Array.isArray(concept.related_concepts) ? concept.related_concepts : [],
    prerequisites: Array.isArray(concept.prerequisites) ? concept.prerequisites : [],
    applications: Array.isArray(concept.applications) ? concept.applications : [],
    formulas: Array.isArray(concept.formulas) ? concept.formulas : [],
    tasks: (concept.tasks || []).map((task) => normalizeTask(task, id)),
    suggested_links: {
      prerequisites: concept.suggested_links?.prerequisites || [],
      formulas: concept.suggested_links?.formulas || [],
      related_explanations: concept.suggested_links?.related_explanations || [],
      usage_links: concept.suggested_links?.usage_links || [],
      next_concept: concept.suggested_links?.next_concept || ''
    }
  };
}

export function getCompletionStates() {
  return [...COMPLETION_STATES];
}

export function getCollaborativeModuleBlueprints() {
  return clone(COLLABORATIVE_BLUEPRINTS).map((module) => ({
    ...module,
    concepts: (module.concepts || []).map(normalizeConcept)
  }));
}

export function buildCollaborativeModuleIndex() {
  return new Map(getCollaborativeModuleBlueprints().map((module) => [module.module_slug, module]));
}
