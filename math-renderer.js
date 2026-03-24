const richTextCache = new Map();
const mathMarkupCache = new Map();

const GREEK_LETTERS = new Map([
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'], ['varepsilon', 'ε'], ['zeta', 'ζ'],
  ['eta', 'η'], ['theta', 'θ'], ['vartheta', 'ϑ'], ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'],
  ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['phi', 'ϕ'], ['varphi', 'φ'],
  ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'], ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'],
  ['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω']
]);

const COMMAND_SYMBOLS = new Map([
  ['cdot', '·'], ['times', '×'], ['otimes', '⊗'], ['oplus', '⊕'], ['odot', '⊙'], ['pm', '±'], ['mp', '∓'],
  ['leq', '≤'], ['geq', '≥'], ['neq', '≠'], ['approx', '≈'], ['sim', '∼'], ['to', '→'], ['rightarrow', '→'],
  ['leftarrow', '←'], ['leftrightarrow', '↔'], ['mapsto', '↦'], ['in', '∈'], ['notin', '∉'], ['subset', '⊂'],
  ['subseteq', '⊆'], ['supset', '⊃'], ['supseteq', '⊇'], ['cup', '∪'], ['cap', '∩'], ['mid', '|'], ['vert', '|'],
  ['|', '∥'], ['Vert', '∥'], ['lVert', '∥'], ['rVert', '∥'], ['lvert', '|'], ['rvert', '|'], ['top', '⊤'],
  ['bot', '⊥'], ['infty', '∞'], ['partial', '∂'], ['nabla', '∇'], ['forall', '∀'], ['exists', '∃'],
  ['neg', '¬'], ['land', '∧'], ['lor', '∨'], ['ldots', '…'], ['cdots', '⋯'], ['vdots', '⋮'], ['ddots', '⋱'],
  ['sum', '∑'], ['prod', '∏'], ['int', '∫'], ['oint', '∮'], ['sqrt', '√']
]);

const OPERATOR_COMMANDS = new Set(['exp', 'log', 'ln', 'max', 'min', 'softmax', 'Attn', 'MHA', 'FFN', 'LN', 'Concat']);
const SPACING_COMMANDS = new Map([
  [',', '0.1667em'], [';', '0.2778em'], [':', '0.2222em'], ['quad', '1em'], ['qquad', '2em'], ['!', '-0.1667em']
]);
const MATRIX_ENVIRONMENTS = new Set(['matrix', 'pmatrix', 'bmatrix']);

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wrapMath(inner, displayMode = false) {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${displayMode ? 'block' : 'inline'}"><mrow>${inner || '<mrow></mrow>'}</mrow></math>`;
}

function hasKatexRenderer() {
  return typeof globalThis !== 'undefined'
    && globalThis.katex
    && typeof globalThis.katex.renderToString === 'function';
}

function normalizeFormulaToLatex(expression = '') {
  return String(expression || '')
    .replaceAll('Attention(Q,K,V)', '\\mathrm{Attention}(Q,K,V)')
    .replaceAll('Attn(X)', '\\mathrm{Attn}(X)')
    .replaceAll('softmax', '\\mathrm{softmax}')
    .replaceAll('sqrt(d_k)', '\\sqrt{d_k}')
    .replaceAll('QK^T', 'QK^{\\top}')
    .replaceAll('q_i^T', 'q_i^{\\top}')
    .replaceAll('Σ_j', '\\sum_j')
    .replaceAll('Σ', '\\sum')
    .replaceAll('alpha_ij', '\\alpha_{ij}')
    .replaceAll('theta', '\\theta')
    .replaceAll('η', '\\eta')
    .replaceAll('∇', '\\nabla')
    .replaceAll('γ', '\\gamma')
    .replaceAll('μ', '\\mu')
    .replaceAll('σ', '\\sigma')
    .replaceAll('ε', '\\varepsilon')
    .replaceAll('->', '\\to ');
}

function renderKaTeX(expression = '', { displayMode = false } = {}) {
  if (!hasKatexRenderer()) {
    return null;
  }
  try {
    return globalThis.katex.renderToString(normalizeFormulaToLatex(expression), {
      throwOnError: false,
      displayMode,
      strict: 'ignore',
      output: 'html'
    });
  } catch (_error) {
    return null;
  }
}

class LatexToMathMLParser {
  constructor(source = '') {
    this.source = String(source || '').trim();
    this.index = 0;
  }

  parse(displayMode = false) {
    const content = this.parseExpression(() => false);
    return wrapMath(content || '<mrow></mrow>', displayMode);
  }

  eof() {
    return this.index >= this.source.length;
  }

  peek(length = 1) {
    return this.source.slice(this.index, this.index + length);
  }

  consume(length = 1) {
    const value = this.source.slice(this.index, this.index + length);
    this.index += length;
    return value;
  }

  skipWhitespace() {
    while (!this.eof() && /\s/.test(this.peek())) {
      this.consume();
    }
  }

  parseExpression(shouldStop) {
    const nodes = [];
    while (!this.eof()) {
      this.skipWhitespace();
      if (this.eof() || shouldStop()) {
        break;
      }
      if (this.peek() === '}') {
        break;
      }

      const atom = this.parseAtom();
      if (!atom) {
        continue;
      }
      nodes.push(this.applyScripts(atom));
    }
    return nodes.join('');
  }

  parseAtom() {
    const char = this.peek();
    if (!char) {
      return '';
    }

    if (char === '{') {
      this.consume();
      const group = this.parseExpression(() => this.peek() === '}');
      if (this.peek() === '}') {
        this.consume();
      }
      return `<mrow>${group}</mrow>`;
    }

    if (char === '(' || char === ')' || char === '[' || char === ']' || char === '=' || char === '+' || char === '-' || char === '/' || char === ',' || char === ';' || char === ':' || char === '<' || char === '>') {
      this.consume();
      return `<mo>${escapeHtml(char)}</mo>`;
    }

    if (char === '&') {
      return '';
    }

    if (/[0-9]/.test(char)) {
      return this.parseNumber();
    }

    if (/[A-Za-z]/.test(char)) {
      return this.parseIdentifier();
    }

    if (char === '\\') {
      return this.parseCommand();
    }

    this.consume();
    return `<mo>${escapeHtml(char)}</mo>`;
  }

  parseNumber() {
    const start = this.index;
    while (!this.eof() && /[0-9.]/.test(this.peek())) {
      this.consume();
    }
    return `<mn>${escapeHtml(this.source.slice(start, this.index))}</mn>`;
  }

  parseIdentifier() {
    const start = this.index;
    while (!this.eof() && /[A-Za-z]/.test(this.peek())) {
      this.consume();
    }
    const identifier = this.source.slice(start, this.index);
    if (identifier.length === 1) {
      return `<mi>${escapeHtml(identifier)}</mi>`;
    }
    return `<mi mathvariant="normal">${escapeHtml(identifier)}</mi>`;
  }

  parseCommand() {
    this.consume();

    if (this.peek() === '\\') {
      this.consume();
      return '<mo linebreak="newline"></mo>';
    }

    if (/[^A-Za-z]/.test(this.peek())) {
      const symbol = this.consume();
      if (SPACING_COMMANDS.has(symbol)) {
        return `<mspace width="${SPACING_COMMANDS.get(symbol)}"></mspace>`;
      }
      const mapped = COMMAND_SYMBOLS.get(symbol);
      return mapped ? `<mo>${escapeHtml(mapped)}</mo>` : `<mo>${escapeHtml(symbol)}</mo>`;
    }

    const start = this.index;
    while (!this.eof() && /[A-Za-z]/.test(this.peek())) {
      this.consume();
    }
    const command = this.source.slice(start, this.index);

    if (GREEK_LETTERS.has(command)) {
      return `<mi>${GREEK_LETTERS.get(command)}</mi>`;
    }

    if (SPACING_COMMANDS.has(command)) {
      return `<mspace width="${SPACING_COMMANDS.get(command)}"></mspace>`;
    }

    if (command === 'frac') {
      const numerator = this.parseRequiredArgument();
      const denominator = this.parseRequiredArgument();
      return `<mfrac>${numerator}${denominator}</mfrac>`;
    }

    if (command === 'sqrt') {
      if (this.peek() === '[') {
        this.consume();
        const degree = this.parseExpression(() => this.peek() === ']');
        if (this.peek() === ']') {
          this.consume();
        }
        return `<mroot>${this.parseRequiredArgument()}<mrow>${degree}</mrow></mroot>`;
      }
      return `<msqrt>${this.parseRequiredArgument()}</msqrt>`;
    }

    if (command === 'bar' || command === 'overline') {
      return `<mover accent="true">${this.parseRequiredArgument()}<mo>¯</mo></mover>`;
    }

    if (command === 'hat') {
      return `<mover accent="true">${this.parseRequiredArgument()}<mo>^</mo></mover>`;
    }

    if (command === 'vec') {
      return `<mover accent="true">${this.parseRequiredArgument()}<mo>→</mo></mover>`;
    }

    if (command === 'mathbb') {
      return `<mi mathvariant="double-struck">${this.extractTextArgument()}</mi>`;
    }

    if (command === 'mathbf') {
      return `<mi mathvariant="bold">${this.extractTextArgument()}</mi>`;
    }

    if (command === 'operatorname' || OPERATOR_COMMANDS.has(command)) {
      const text = command === 'operatorname' ? this.extractTextArgument() : command;
      return `<mi mathvariant="normal">${escapeHtml(text)}</mi>`;
    }

    if (command === 'left' || command === 'right') {
      this.skipWhitespace();
      const delimiter = this.parseDelimiterToken();
      if (delimiter === '.') {
        return '';
      }
      return `<mo stretchy="true">${escapeHtml(delimiter)}</mo>`;
    }

    if (command === 'begin') {
      const envName = this.extractTextArgument();
      if (MATRIX_ENVIRONMENTS.has(envName)) {
        return this.parseMatrix(envName);
      }
      return `<mi mathvariant="normal">${escapeHtml(envName)}</mi>`;
    }

    if (command === 'end') {
      return '';
    }

    if (COMMAND_SYMBOLS.has(command)) {
      const symbol = COMMAND_SYMBOLS.get(command);
      const tag = ['sum', 'prod', 'int', 'oint'].includes(command) ? 'mo' : 'mo';
      return `<${tag}>${escapeHtml(symbol)}</${tag}>`;
    }

    return `<mi mathvariant="normal">${escapeHtml(command)}</mi>`;
  }

  parseDelimiterToken() {
    if (this.peek() === '\\') {
      this.consume();
      const next = this.consume();
      return next || '';
    }
    return this.consume();
  }

  parseRequiredArgument() {
    this.skipWhitespace();
    const node = this.parseArgumentNode();
    return node || '<mrow></mrow>';
  }

  parseArgumentNode() {
    this.skipWhitespace();
    if (this.peek() === '{') {
      this.consume();
      const group = this.parseExpression(() => this.peek() === '}');
      if (this.peek() === '}') {
        this.consume();
      }
      return `<mrow>${group}</mrow>`;
    }
    const atom = this.parseAtom();
    return this.applyScripts(atom);
  }

  extractTextArgument() {
    this.skipWhitespace();
    if (this.peek() !== '{') {
      return '';
    }
    this.consume();
    const start = this.index;
    let depth = 1;
    while (!this.eof() && depth > 0) {
      const char = this.consume();
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    const raw = this.source.slice(start, Math.max(start, this.index - 1));
    return raw.replace(/\\/g, '').trim();
  }

  parseMatrix(environment) {
    const rows = [];
    while (!this.eof()) {
      const cells = [];
      while (!this.eof()) {
        const cell = this.parseExpression(() => this.peek() === '&' || this.peek(2) === '\\\\' || this.peekEnvironmentEnd(environment));
        cells.push(`<mtd><mrow>${cell}</mrow></mtd>`);
        if (this.peek() === '&') {
          this.consume();
          continue;
        }
        break;
      }
      rows.push(`<mtr>${cells.join('')}</mtr>`);
      if (this.peek(2) === '\\\\') {
        this.consume(2);
        continue;
      }
      if (this.peekEnvironmentEnd(environment)) {
        this.consumeEnvironmentEnd(environment);
        break;
      }
      break;
    }

    const table = `<mtable>${rows.join('')}</mtable>`;
    if (environment === 'pmatrix') {
      return `<mrow><mo stretchy="true">(</mo>${table}<mo stretchy="true">)</mo></mrow>`;
    }
    if (environment === 'bmatrix') {
      return `<mrow><mo stretchy="true">[</mo>${table}<mo stretchy="true">]</mo></mrow>`;
    }
    return table;
  }

  peekEnvironmentEnd(environment) {
    return this.source.slice(this.index, this.index + environment.length + 6) === `\\end{${environment}}`;
  }

  consumeEnvironmentEnd(environment) {
    this.consume(environment.length + 6);
  }

  applyScripts(baseNode) {
    if (!baseNode) {
      return '';
    }

    let base = baseNode;
    let subscript = '';
    let superscript = '';

    while (!this.eof()) {
      this.skipWhitespace();
      const next = this.peek();
      if (next !== '_' && next !== '^') {
        break;
      }
      this.consume();
      const argument = this.parseArgumentNode();
      if (next === '_') {
        subscript = argument;
      } else {
        superscript = argument;
      }
    }

    if (subscript && superscript) {
      return `<msubsup>${base}${subscript}${superscript}</msubsup>`;
    }
    if (subscript) {
      return `<msub>${base}${subscript}</msub>`;
    }
    if (superscript) {
      return `<msup>${base}${superscript}</msup>`;
    }
    return base;
  }
}

export function renderMathToMarkup(expression = '', { displayMode = false } = {}) {
  const key = `${displayMode ? 'display' : 'inline'}:${expression}`;
  if (mathMarkupCache.has(key)) {
    return mathMarkupCache.get(key);
  }

  const katexMarkup = renderKaTeX(expression, { displayMode });
  if (katexMarkup) {
    mathMarkupCache.set(key, katexMarkup);
    return katexMarkup;
  }

  const parser = new LatexToMathMLParser(normalizeFormulaToLatex(expression));
  const markup = parser.parse(displayMode);
  mathMarkupCache.set(key, markup);
  return markup;
}

function isLikelyMathExpression(content = '') {
  const value = String(content || '').trim();
  if (!value) {
    return false;
  }
  return /[=^_\\]|sqrt|softmax|Attention|Attn|sum|prod|frac|[α-ωΑ-ΩΣθμσγερη∇]/i.test(value);
}

export function InlineMath(expression = '') {
  return `<span class="math-inline-shell math-inline-katex">${renderMathToMarkup(expression, { displayMode: false })}</span>`;
}

export function BlockMath(expression = '') {
  return `<div class="math-block-shell math-block-katex">${renderMathToMarkup(expression, { displayMode: true })}</div>`;
}

function renderInlineSegments(text = '') {
  const fragments = [];
  const source = String(text || '');
  const pattern = /(\$[^$]+\$)/g;
  let lastIndex = 0;
  let match = pattern.exec(source);

  while (match) {
    if (match.index > lastIndex) {
      fragments.push(escapeHtml(source.slice(lastIndex, match.index)));
    }

    const expression = match[0].slice(1, -1).trim();
    fragments.push(InlineMath(expression));
    lastIndex = match.index + match[0].length;
    match = pattern.exec(source);
  }

  if (lastIndex < source.length) {
    fragments.push(escapeHtml(source.slice(lastIndex)));
  }

  return fragments.join('')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function MathContentRenderer(text = '') {
  const source = String(text || '').trim();
  if (!source) {
    return '<p></p>';
  }

  if (richTextCache.has(source)) {
    return richTextCache.get(source);
  }

  const paragraphs = source.split(/\n\n+/).filter(Boolean);
  const html = paragraphs.map((paragraph) => {
    const trimmed = paragraph.trim();
    if (trimmed.split('\n').every((line) => line.trim().startsWith('- '))) {
      const items = trimmed
        .split('\n')
        .map((line) => `<li>${renderInlineSegments(line.trim().slice(2))}</li>`)
        .join('');
      return `<ul class="rich-list">${items}</ul>`;
    }

    const parts = trimmed.split(/(\$\$[\s\S]+?\$\$)/g).filter(Boolean);
    const rendered = parts.map((part) => {
      if (/^\$\$[\s\S]+\$\$$/.test(part)) {
        return BlockMath(part.slice(2, -2).trim());
      }
      return `<p>${part.split('\n').map((line) => renderInlineSegments(line)).join('<br />')}</p>`;
    }).join('');

    if (parts.length === 1 && isLikelyMathExpression(trimmed) && !trimmed.includes('$')) {
      return BlockMath(trimmed);
    }

    return rendered;
  }).join('');

  richTextCache.set(source, html);
  return html;
}

export function renderRichText(text = '') {
  return MathContentRenderer(text);
}
