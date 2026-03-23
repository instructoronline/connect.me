const starterModules = [
  {
    slug: 'foundations-of-transformers',
    title: 'Foundations of Transformers',
    description: 'An introductory module covering the core ideas behind transformers, including sequence modeling, attention, tokens, embeddings, and why transformers became central to modern AI.',
    icon: 'book-open',
    sort_order: 1,
    topics: [
      {
        topic_title: 'Why transformers changed sequence modeling',
        sort_order: 1,
        summary: 'Understand the limitations of older sequence models and why attention-based architectures scaled better.',
        cards: [
          {
            title: 'The core problem',
            card_type: 'concept',
            subtopic_title: 'Long-range dependencies',
            sections: [
              { label: 'Short explanation', body: 'Language, code, and multimodal tasks require a model to relate distant pieces of information. Earlier recurrent models processed tokens step-by-step, so far-away context often became harder to preserve.' },
              { label: 'Example', body: 'In “The animal didn’t cross the street because it was tired,” the word “it” depends on information that may be many tokens away.' },
              { label: 'Intuition', body: 'A useful learner should be able to quickly glance back at all relevant context instead of carrying everything through a single hidden-state bottleneck.' },
              { label: 'Key takeaway', body: 'Transformers were built to make context lookup direct, parallel, and scalable.' }
            ]
          },
          {
            title: 'Why recurrence struggled',
            card_type: 'comparison',
            subtopic_title: 'Sequential bottlenecks',
            sections: [
              { label: 'Short explanation', body: 'RNNs and LSTMs must process token 1 before token 2, token 2 before token 3, and so on. That slows training and makes optimization harder on long sequences.' },
              { label: 'Pitfalls', body: 'Even with gating, recurrent models can still suffer from vanishing gradients, limited parallelism, and compressed memory.' },
              { label: 'Connection to the broader problem', body: 'Modern AI workloads depend on large-scale training, so models that parallelize well have a major practical advantage.' }
            ]
          },
          {
            title: 'Transformer mindset',
            card_type: 'intuition',
            subtopic_title: 'Attend instead of compress',
            sections: [
              { label: 'Short explanation', body: 'A transformer treats each token representation as something that can interact with every other token representation through attention.' },
              { label: 'Visual description', body: 'Imagine a table of tokens where each token can draw weighted lines to the others, highlighting what matters for the current step.' },
              { label: 'Key takeaway', body: 'Attention replaces a narrow memory path with direct, content-based access to context.' }
            ]
          }
        ]
      },
      {
        topic_title: 'Tokens and embeddings',
        sort_order: 2,
        summary: 'Learn how raw text becomes vectors the model can reason about.',
        cards: [
          {
            title: 'From text to tokens',
            card_type: 'concept',
            subtopic_title: 'Tokenization',
            sections: [
              { label: 'Short explanation', body: 'Transformers do not read characters or words directly. They first map text into tokens such as words, subwords, or symbols.' },
              { label: 'Example', body: '“unbelievable” might be split into “un”, “believ”, and “able”, allowing the model to reuse known pieces across many words.' },
              { label: 'Pitfalls', body: 'Poor tokenization can make rare terms or multilingual text harder to represent efficiently.' }
            ]
          },
          {
            title: 'Embeddings create meaning-rich vectors',
            card_type: 'concept',
            subtopic_title: 'Representation space',
            sections: [
              { label: 'Short explanation', body: 'Each token is mapped to a dense vector. Nearby vectors can represent similar syntactic or semantic roles.' },
              { label: 'Intuition', body: 'Instead of storing a dictionary definition, the model stores a coordinate in a learned space where related concepts land near one another.' },
              { label: 'Formula', body: 'Embedding lookup can be written as x_i = E[t_i], where E is the embedding matrix and t_i is the token id.' },
              { label: 'Key takeaway', body: 'Embeddings turn discrete symbols into trainable numerical representations.' }
            ]
          },
          {
            title: 'Position still matters',
            card_type: 'concept',
            subtopic_title: 'Ordering information',
            sections: [
              { label: 'Short explanation', body: 'Attention alone is permutation-friendly, so transformers need position information to distinguish “dog bites man” from “man bites dog.”' },
              { label: 'Example', body: 'Positional encodings or learned positional embeddings are added to token embeddings before attention layers begin.' },
              { label: 'Connection to the broader problem', body: 'Sequence tasks require both content and order, so representation quality depends on combining them cleanly.' }
            ]
          }
        ]
      },
      {
        topic_title: 'Attention as the lesson engine',
        sort_order: 3,
        summary: 'See how self-attention scores relationships and why it powers guided reasoning through a sequence.',
        cards: [
          {
            title: 'Self-attention basics',
            card_type: 'concept',
            subtopic_title: 'Context weighting',
            sections: [
              { label: 'Short explanation', body: 'For each token, self-attention computes how strongly it should focus on every other token in the same sequence.' },
              { label: 'Formula', body: 'Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V.' },
              { label: 'Intuition', body: 'Queries ask “what am I looking for?”, keys advertise “what do I contain?”, and values carry the information that gets blended.' }
            ]
          },
          {
            title: 'Why scaling and softmax appear',
            card_type: 'math',
            subtopic_title: 'Stable scoring',
            sections: [
              { label: 'Short explanation', body: 'The dot product QK^T can grow with dimension. Dividing by sqrt(d_k) keeps logits from becoming too extreme before softmax.' },
              { label: 'Derivation', body: 'If query and key components are roughly unit-variance, their dot product variance grows with d_k, so scaling normalizes that growth.' },
              { label: 'Key takeaway', body: 'The scaling term helps attention stay trainable and avoids overly peaked distributions early in learning.' }
            ]
          },
          {
            title: 'Why transformers generalize well',
            card_type: 'synthesis',
            subtopic_title: 'Flexible context use',
            sections: [
              { label: 'Short explanation', body: 'Because each layer can recompute which context matters, transformers can build richer representations than fixed-window or purely sequential systems.' },
              { label: 'Visual description', body: 'Across layers, the network repeatedly redraws an importance map over the sequence, sharpening useful relationships.' },
              { label: 'Connection to the broader problem', body: 'This flexibility is a major reason transformers became the foundation for language, vision, audio, and multimodal systems.' }
            ]
          }
        ]
      }
    ]
  },
  {
    slug: 'mathematical-foundations-of-transformers',
    title: 'Mathematical Foundations of Transformers',
    description: 'A mathematically focused module covering the linear algebra, probability, optimization, and matrix operations that support transformer models.',
    icon: 'book-open',
    sort_order: 2,
    topics: [
      {
        topic_title: 'Vectors, matrices, and similarity',
        sort_order: 1,
        summary: 'Build intuition for the algebraic objects used throughout embedding and attention computations.',
        cards: [
          {
            title: 'Vectors as feature bundles',
            card_type: 'concept',
            subtopic_title: 'Coordinate meaning',
            sections: [
              { label: 'Short explanation', body: 'A vector is an ordered list of numbers representing features. In transformers, vectors describe token meaning, layer activations, and learned projections.' },
              { label: 'Example', body: 'A token embedding in R^d may encode tense, topic, syntax, and many other learned factors simultaneously.' },
              { label: 'Intuition', body: 'Think of each dimension as a dial the network can tune when comparing or combining concepts.' }
            ]
          },
          {
            title: 'Dot products measure alignment',
            card_type: 'math',
            subtopic_title: 'Similarity scoring',
            sections: [
              { label: 'Formula', body: 'For vectors a and b, the dot product is a · b = Σ_i a_i b_i.' },
              { label: 'Short explanation', body: 'Large positive dot products indicate alignment, small values indicate weak relation, and negative values indicate opposing directions.' },
              { label: 'Connection to the broader problem', body: 'Attention uses dot products to decide which tokens should influence one another.' }
            ]
          },
          {
            title: 'Matrices as batched transformations',
            card_type: 'concept',
            subtopic_title: 'Linear maps',
            sections: [
              { label: 'Short explanation', body: 'A matrix can rotate, scale, or mix vector dimensions. Transformers use matrices to project embeddings into query, key, and value spaces.' },
              { label: 'Example', body: 'If X is the token matrix, then Q = XW_Q, K = XW_K, and V = XW_V are three learned views of the same sequence.' },
              { label: 'Key takeaway', body: 'Matrix multiplication lets the model transform every token representation in parallel.' }
            ]
          }
        ]
      },
      {
        topic_title: 'Softmax and probability flow',
        sort_order: 2,
        summary: 'Understand how raw scores become normalized attention weights and output probabilities.',
        cards: [
          {
            title: 'What softmax does',
            card_type: 'math',
            subtopic_title: 'Normalize scores',
            sections: [
              { label: 'Formula', body: 'softmax(z_i) = exp(z_i) / Σ_j exp(z_j).' },
              { label: 'Short explanation', body: 'Softmax converts arbitrary logits into non-negative values that sum to one, making them behave like a distribution over choices.' },
              { label: 'Example', body: 'If one token receives a much larger compatibility score, softmax will assign that token a larger share of attention mass.' }
            ]
          },
          {
            title: 'Why softmax fits attention',
            card_type: 'intuition',
            subtopic_title: 'Weighted focus',
            sections: [
              { label: 'Intuition', body: 'Attention should decide how to distribute focus across context. Softmax gives a clean way to turn preferences into weights.' },
              { label: 'Pitfalls', body: 'Overly sharp softmax outputs can make a model attend too narrowly, while very flat outputs may dilute useful context.' },
              { label: 'Key takeaway', body: 'Softmax creates a learnable balance between concentration and spread.' }
            ]
          },
          {
            title: 'Expectation viewpoint',
            card_type: 'synthesis',
            subtopic_title: 'Weighted averages',
            sections: [
              { label: 'Short explanation', body: 'After softmax, attention forms a weighted sum of value vectors. This can be viewed as taking an expectation over candidate context vectors.' },
              { label: 'Formula', body: 'output_i = Σ_j α_ij v_j, where α_ij are normalized attention weights.' },
              { label: 'Connection to the broader problem', body: 'The entire attention mechanism is a differentiable way to retrieve relevant information by averaging over context.' }
            ]
          }
        ]
      },
      {
        topic_title: 'Optimization and training stability',
        sort_order: 3,
        summary: 'Review the gradient-based ideas that make large transformer training feasible.',
        cards: [
          {
            title: 'Gradients tell parameters how to move',
            card_type: 'math',
            subtopic_title: 'Backpropagation overview',
            sections: [
              { label: 'Short explanation', body: 'Training adjusts parameters to reduce loss. Gradients measure how sensitive the loss is to each parameter.' },
              { label: 'Example', body: 'If changing one weight slightly causes the loss to increase, gradient descent nudges that weight in the opposite direction.' },
              { label: 'Key takeaway', body: 'Backpropagation efficiently computes all these sensitivities across a deep network.' }
            ]
          },
          {
            title: 'Why normalization and residuals help optimization',
            card_type: 'concept',
            subtopic_title: 'Stable signal flow',
            sections: [
              { label: 'Short explanation', body: 'Deep models can become hard to train if activations explode, vanish, or drift. Residual pathways and normalization layers keep signal magnitudes more manageable.' },
              { label: 'Intuition', body: 'A residual path gives each layer a safe default behavior: keep useful information unless a learned transformation improves it.' },
              { label: 'Connection to the broader problem', body: 'Training stability is not just a math detail; it directly determines whether large transformers converge.' }
            ]
          },
          {
            title: 'Optimization in practice',
            card_type: 'synthesis',
            subtopic_title: 'Scaling training',
            sections: [
              { label: 'Short explanation', body: 'Large transformer training typically uses adaptive optimizers, learning-rate schedules, gradient clipping, and careful initialization.' },
              { label: 'Pitfalls', body: 'Unstable hyperparameters can lead to divergence, slow learning, or brittle generalization.' },
              { label: 'Key takeaway', body: 'Modern transformer performance depends on both architecture and disciplined optimization.' }
            ]
          }
        ]
      }
    ]
  },
  {
    slug: 'foundations-of-transformer-architecture',
    title: 'Foundations of Transformer Architecture',
    description: 'A structural module explaining the internal components of transformer systems, including attention blocks, feed-forward layers, residual connections, normalization, and multi-head mechanisms.',
    icon: 'book-open',
    sort_order: 3,
    topics: [
      {
        topic_title: 'Query, key, and value roles',
        sort_order: 1,
        summary: 'Break down the projections that let each token ask for and receive context.',
        cards: [
          {
            title: 'Three projections, three jobs',
            card_type: 'concept',
            subtopic_title: 'Q, K, and V',
            sections: [
              { label: 'Short explanation', body: 'Each token embedding is projected into a query, key, and value vector. Queries express what information the token is seeking, keys describe what each token offers, and values store the content that can be retrieved.' },
              { label: 'Formula', body: 'Q = XW_Q, K = XW_K, V = XW_V.' },
              { label: 'Key takeaway', body: 'The same sequence is viewed through three learned lenses to support content-based retrieval.' }
            ]
          },
          {
            title: 'How a token chooses context',
            card_type: 'intuition',
            subtopic_title: 'Compatibility scores',
            sections: [
              { label: 'Short explanation', body: 'A token compares its query to every key. Stronger similarity produces a larger attention score and more influence from that token’s value.' },
              { label: 'Example', body: 'A pronoun token may strongly attend to a noun token whose key matches the pronoun’s query for referential context.' },
              { label: 'Visual description', body: 'Picture one row of the attention matrix lighting up around the tokens most relevant to the current token.' }
            ]
          },
          {
            title: 'Why values are separate',
            card_type: 'comparison',
            subtopic_title: 'Retrieve versus score',
            sections: [
              { label: 'Short explanation', body: 'Scoring and retrieval are different jobs. Keys help rank relevance, while values carry the information that gets mixed into the output.' },
              { label: 'Pitfalls', body: 'If keys and values were forced to be the same representation, the model would have less flexibility in how it stores versus matches information.' },
              { label: 'Connection to the broader problem', body: 'Separating these roles is one reason attention is expressive enough to support complex reasoning patterns.' }
            ]
          }
        ]
      },
      {
        topic_title: 'Multi-head attention and feed-forward blocks',
        sort_order: 2,
        summary: 'See how a transformer learns several kinds of relationships at once, then refines them with per-token computation.',
        cards: [
          {
            title: 'Why multiple heads exist',
            card_type: 'concept',
            subtopic_title: 'Parallel relationship detectors',
            sections: [
              { label: 'Short explanation', body: 'Instead of learning one attention pattern, transformers split the model dimension across several heads. Each head can specialize in different relationships.' },
              { label: 'Example', body: 'One head may track syntax, another may align entities, and another may capture positional or long-range context.' },
              { label: 'Key takeaway', body: 'Multi-head attention increases representational diversity without abandoning efficient matrix operations.' }
            ]
          },
          {
            title: 'Feed-forward layers after attention',
            card_type: 'concept',
            subtopic_title: 'Per-token refinement',
            sections: [
              { label: 'Short explanation', body: 'After attention mixes information across tokens, a position-wise feed-forward network transforms each token representation independently.' },
              { label: 'Formula', body: 'FFN(x) = W_2 σ(W_1 x + b_1) + b_2.' },
              { label: 'Intuition', body: 'Attention shares information across tokens; the feed-forward block then deepens the local representation of each token.' }
            ]
          },
          {
            title: 'Putting heads back together',
            card_type: 'synthesis',
            subtopic_title: 'Concatenate and project',
            sections: [
              { label: 'Short explanation', body: 'Outputs from all heads are concatenated and linearly projected back into the model dimension, allowing the layer to combine multiple contextual views.' },
              { label: 'Connection to the broader problem', body: 'This “mix, then refine” pattern is repeated many times across the network and is central to transformer depth.' },
              { label: 'Key takeaway', body: 'The architecture alternates between cross-token interaction and per-token computation.' }
            ]
          }
        ]
      },
      {
        topic_title: 'Residuals, normalization, and model families',
        sort_order: 3,
        summary: 'Understand the scaffold that keeps transformer stacks trainable and how encoder/decoder variants differ.',
        cards: [
          {
            title: 'Residual connections preserve pathways',
            card_type: 'concept',
            subtopic_title: 'Skip connections',
            sections: [
              { label: 'Short explanation', body: 'A residual connection adds a block’s input back to its output. This helps information and gradients move through deep stacks.' },
              { label: 'Formula', body: 'y = x + F(x).' },
              { label: 'Intuition', body: 'Each block learns a correction to the current representation rather than rebuilding it from scratch.' }
            ]
          },
          {
            title: 'Layer normalization steadies activations',
            card_type: 'concept',
            subtopic_title: 'Stable scale',
            sections: [
              { label: 'Short explanation', body: 'Layer normalization rescales features within a token representation so activations stay in a more controlled range.' },
              { label: 'Pitfalls', body: 'Without good normalization strategy, deeper models are harder to optimize and more sensitive to initialization.' },
              { label: 'Key takeaway', body: 'Normalization and residual design are as important as attention itself for practical training.' }
            ]
          },
          {
            title: 'Encoder-only, decoder-only, and encoder-decoder',
            card_type: 'comparison',
            subtopic_title: 'Architectural families',
            sections: [
              { label: 'Short explanation', body: 'Encoder-only models excel at representation and classification, decoder-only models specialize in autoregressive generation, and encoder-decoder models map one sequence into another.' },
              { label: 'Example', body: 'BERT is encoder-only, GPT-style models are decoder-only, and T5-style systems use an encoder-decoder design.' },
              { label: 'Connection to the broader problem', body: 'These families share the same transformer building blocks but arrange masking and information flow differently for different tasks.' }
            ]
          }
        ]
      }
    ]
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStarterModules() {
  return starterModules.map((module, moduleIndex) => {
    const moduleId = `starter-module-${module.slug}`;
    const topics = (module.topics || []).map((topic, topicIndex) => {
      const topicId = `starter-topic-${module.slug}-${topicIndex + 1}`;
      const cards = (topic.cards || []).map((card, cardIndex) => ({
        id: `starter-card-${module.slug}-${topicIndex + 1}-${cardIndex + 1}`,
        module_id: moduleId,
        topic_id: topicId,
        sort_order: cardIndex + 1,
        sections: [],
        ...clone(card)
      }));

      return {
        id: topicId,
        module_id: moduleId,
        sort_order: topic.sort_order ?? topicIndex + 1,
        cards,
        ...clone(topic)
      };
    });

    return {
      id: moduleId,
      sort_order: module.sort_order ?? moduleIndex + 1,
      topics,
      ...clone(module)
    };
  });
}

const normalizedStarterModules = normalizeStarterModules();

export function getStarterLearningModules() {
  return clone(normalizedStarterModules);
}

export function getStarterLearningModuleBySlug(moduleSlug) {
  return getStarterLearningModules().find((module) => module.slug === moduleSlug) || null;
}
