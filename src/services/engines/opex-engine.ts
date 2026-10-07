// ---------------------------------------------------------------------------
// OpEx Formula Engine
//
// Pure TypeScript module (client + server). Implements:
// - Safe formula parser (recursive descent, NO eval)
// - DAG construction with forward + reverse adjacency
// - Topological sort (Kahn's algorithm)
// - Dirty-flag propagation for O(k) value updates
// - Cycle detection (DFS coloring)
// - KPI extraction from designated output cells
//
// Max formula depth: 20 levels
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FORMULA_DEPTH = 20;

// Whitelist of allowed function names (case-insensitive matching at parse time)
const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  'SUM', 'IF', 'ROUND', 'MIN', 'MAX', 'ABS', 'FLOOR', 'CEIL',
]);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CellValue {
  key: string;
  value: number | null;
  error?: string; // '#REF', '#CIRC', '#DIV/0', '#ERR'
}

export interface CellDefinition {
  key: string;
  cellType: 'INPUT' | 'COMPUTED' | 'CONSTANT';
  formula: string | null;
  value: number | null;
}

export interface DAGNode {
  key: string;
  formula: string | null;
  dependsOn: string[];    // forward: cells this reads FROM
  consumers: string[];     // reverse: cells that read FROM this
  value: number | null;
  error?: string;
}

export interface EvaluationResult {
  updatedCells: CellValue[];
  kpis: Record<string, number | null>;
}

export interface OpExEngine {
  buildGraph(cells: CellDefinition[]): void;
  updateValue(key: string, value: number): EvaluationResult;
  updateFormula(key: string, formula: string): EvaluationResult;
  evaluateAll(): EvaluationResult;
  getCellValue(key: string): CellValue;
  getAllValues(): Map<string, CellValue>;
  setKPICells(keys: string[]): void;
  validateFormula(key: string, formula: string): { valid: boolean; error?: string; dependsOn: string[] };
}

// ---------------------------------------------------------------------------
// Token types for the formula lexer
// ---------------------------------------------------------------------------

const enum TokenType {
  Number,
  CellRef,
  FunctionName,
  Plus,
  Minus,
  Star,
  Slash,
  LParen,
  RParen,
  Comma,
  // Comparison operators (for IF conditions)
  LessThan,
  LessThanEq,
  GreaterThan,
  GreaterThanEq,
  EqualEqual,
  NotEqual,
  EOF,
}

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

// ---------------------------------------------------------------------------
// parseDependencies
// ---------------------------------------------------------------------------

/**
 * Extract cell key references from a formula string.
 * Cell keys are dotted paths like "core.yield_lbs" or "cultivation-env.hvac_monthly_maint".
 * Must not match standalone numbers, function names, or numeric literals.
 */
export function parseDependencies(formula: string): string[] {
  // Match dotted key paths: one-or-more word-chars-or-hyphens, dot, one-or-more word-chars
  // The segment before the dot must start with a lowercase letter.
  // The segment after the dot must start with a lowercase letter or underscore.
  // Negative lookbehind for letters prevents matching function names like SUM.something
  const keyPattern = /(?<![a-zA-Z])([a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z_][a-z0-9_]*)/g;
  const deps = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(formula)) !== null) {
    deps.add(match[1]);
  }
  return Array.from(deps);
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = formula.length;

  while (i < len) {
    const ch = formula[i];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Numbers (integer or decimal)
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && formula[i + 1] >= '0' && formula[i + 1] <= '9')) {
      const start = i;
      while (i < len && ((formula[i] >= '0' && formula[i] <= '9') || formula[i] === '.')) {
        i++;
      }
      tokens.push({ type: TokenType.Number, value: formula.slice(start, i), pos: start });
      continue;
    }

    // Identifiers: cell references or function names
    // Cell refs start with lowercase letter, function names start with uppercase
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      const start = i;
      while (i < len && (
        (formula[i] >= 'a' && formula[i] <= 'z') ||
        (formula[i] >= 'A' && formula[i] <= 'Z') ||
        (formula[i] >= '0' && formula[i] <= '9') ||
        formula[i] === '_' ||
        formula[i] === '-' ||
        formula[i] === '.'
      )) {
        i++;
      }
      const word = formula.slice(start, i);
      const upper = word.toUpperCase();

      // Check if it is a known function name
      if (ALLOWED_FUNCTIONS.has(upper) && i < len && formula[i] === '(') {
        tokens.push({ type: TokenType.FunctionName, value: upper, pos: start });
      } else if (word.indexOf('.') !== -1) {
        // Contains a dot => cell reference
        tokens.push({ type: TokenType.CellRef, value: word, pos: start });
      } else {
        // Bare identifier with no dot -- treat as cell ref (may resolve to #REF)
        tokens.push({ type: TokenType.CellRef, value: word, pos: start });
      }
      continue;
    }

    // Operators and punctuation
    const pos = i;
    switch (ch) {
      case '+': tokens.push({ type: TokenType.Plus, value: '+', pos }); i++; continue;
      case '-': tokens.push({ type: TokenType.Minus, value: '-', pos }); i++; continue;
      case '*': tokens.push({ type: TokenType.Star, value: '*', pos }); i++; continue;
      case '/': tokens.push({ type: TokenType.Slash, value: '/', pos }); i++; continue;
      case '(': tokens.push({ type: TokenType.LParen, value: '(', pos }); i++; continue;
      case ')': tokens.push({ type: TokenType.RParen, value: ')', pos }); i++; continue;
      case ',': tokens.push({ type: TokenType.Comma, value: ',', pos }); i++; continue;
      case '<':
        if (i + 1 < len && formula[i + 1] === '=') {
          tokens.push({ type: TokenType.LessThanEq, value: '<=', pos }); i += 2;
        } else {
          tokens.push({ type: TokenType.LessThan, value: '<', pos }); i++;
        }
        continue;
      case '>':
        if (i + 1 < len && formula[i + 1] === '=') {
          tokens.push({ type: TokenType.GreaterThanEq, value: '>=', pos }); i += 2;
        } else {
          tokens.push({ type: TokenType.GreaterThan, value: '>', pos }); i++;
        }
        continue;
      case '=':
        if (i + 1 < len && formula[i + 1] === '=') {
          tokens.push({ type: TokenType.EqualEqual, value: '==', pos }); i += 2;
        } else {
          // Single = treated as ==
          tokens.push({ type: TokenType.EqualEqual, value: '=', pos }); i++;
        }
        continue;
      case '!':
        if (i + 1 < len && formula[i + 1] === '=') {
          tokens.push({ type: TokenType.NotEqual, value: '!=', pos }); i += 2;
        } else {
          throw new Error('Unexpected character "!" at position ' + pos);
        }
        continue;
      default:
        throw new Error('Unexpected character "' + ch + '" at position ' + pos);
    }
  }

  tokens.push({ type: TokenType.EOF, value: '', pos: i });
  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive Descent Parser + Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a formula string against a values map.
 * Returns the numeric result or an error string.
 * Uses recursive descent parsing with operator precedence:
 *   comparison < addition < multiplication < unary < primary
 *
 * NO eval() is used anywhere.
 */
export function evaluateFormula(
  formula: string,
  values: Map<string, number | null>,
): { result: number | null; error?: string } {
  if (!formula || formula.trim() === '') {
    return { result: null, error: '#ERR' };
  }

  let tokens: Token[];
  try {
    tokens = tokenize(formula);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: null, error: '#ERR: ' + msg };
  }

  let cursor = 0;

  function peek(): Token {
    return tokens[cursor];
  }

  function advance(): Token {
    const t = tokens[cursor];
    cursor++;
    return t;
  }

  function expect(type: TokenType): Token {
    const t = peek();
    if (t.type !== type) {
      throw new Error(
        'Expected token type ' + type + ' but got ' + t.type + ' ("' + t.value + '") at position ' + t.pos
      );
    }
    return advance();
  }

  // Grammar:
  //   expression     → comparison
  //   comparison     → addition ( ( '<' | '<=' | '>' | '>=' | '==' | '!=' ) addition )*
  //   addition       → multiplication ( ( '+' | '-' ) multiplication )*
  //   multiplication → unary ( ( '*' | '/' ) unary )*
  //   unary          → ( '-' | '+' ) unary | primary
  //   primary        → NUMBER | CELL_REF | FUNCTION '(' args ')' | '(' expression ')'

  function parseExpression(): number {
    return parseComparison();
  }

  function parseComparison(): number {
    let left = parseAddition();

    while (true) {
      const t = peek();
      if (
        t.type === TokenType.LessThan ||
        t.type === TokenType.LessThanEq ||
        t.type === TokenType.GreaterThan ||
        t.type === TokenType.GreaterThanEq ||
        t.type === TokenType.EqualEqual ||
        t.type === TokenType.NotEqual
      ) {
        const op = advance();
        const right = parseAddition();
        switch (op.type) {
          case TokenType.LessThan: left = left < right ? 1 : 0; break;
          case TokenType.LessThanEq: left = left <= right ? 1 : 0; break;
          case TokenType.GreaterThan: left = left > right ? 1 : 0; break;
          case TokenType.GreaterThanEq: left = left >= right ? 1 : 0; break;
          case TokenType.EqualEqual: left = left === right ? 1 : 0; break;
          case TokenType.NotEqual: left = left !== right ? 1 : 0; break;
        }
      } else {
        break;
      }
    }

    return left;
  }

  function parseAddition(): number {
    let left = parseMultiplication();

    while (true) {
      const t = peek();
      if (t.type === TokenType.Plus) {
        advance();
        left = left + parseMultiplication();
      } else if (t.type === TokenType.Minus) {
        advance();
        left = left - parseMultiplication();
      } else {
        break;
      }
    }

    return left;
  }

  function parseMultiplication(): number {
    let left = parseUnary();

    while (true) {
      const t = peek();
      if (t.type === TokenType.Star) {
        advance();
        left = left * parseUnary();
      } else if (t.type === TokenType.Slash) {
        advance();
        const right = parseUnary();
        if (right === 0) {
          left = NaN; // Division by zero -> NaN
        } else {
          left = left / right;
        }
      } else {
        break;
      }
    }

    return left;
  }

  function parseUnary(): number {
    const t = peek();
    if (t.type === TokenType.Minus) {
      advance();
      return -parseUnary();
    }
    if (t.type === TokenType.Plus) {
      advance();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parseArgList(): number[] {
    const args: number[] = [];
    // Handle empty arg list
    if (peek().type === TokenType.RParen) {
      return args;
    }
    args.push(parseExpression());
    while (peek().type === TokenType.Comma) {
      advance(); // consume comma
      args.push(parseExpression());
    }
    return args;
  }

  function parsePrimary(): number {
    const t = peek();

    // Number literal
    if (t.type === TokenType.Number) {
      advance();
      return parseFloat(t.value);
    }

    // Function call
    if (t.type === TokenType.FunctionName) {
      const funcName = advance().value;
      expect(TokenType.LParen);
      const args = parseArgList();
      expect(TokenType.RParen);

      switch (funcName) {
        case 'SUM': {
          let sum = 0;
          for (let a = 0; a < args.length; a++) {
            sum += isNaN(args[a]) ? 0 : args[a];
          }
          return sum;
        }
        case 'IF': {
          if (args.length < 3) {
            throw new Error('IF requires 3 arguments: IF(condition, trueVal, falseVal)');
          }
          // Condition: non-zero = true
          return args[0] !== 0 ? args[1] : args[2];
        }
        case 'ROUND': {
          if (args.length < 2) {
            throw new Error('ROUND requires 2 arguments: ROUND(value, decimals)');
          }
          const factor = Math.pow(10, Math.floor(args[1]));
          return Math.round(args[0] * factor) / factor;
        }
        case 'MIN': {
          if (args.length === 0) return 0;
          let min = args[0];
          for (let a = 1; a < args.length; a++) {
            if (args[a] < min) min = args[a];
          }
          return min;
        }
        case 'MAX': {
          if (args.length === 0) return 0;
          let max = args[0];
          for (let a = 1; a < args.length; a++) {
            if (args[a] > max) max = args[a];
          }
          return max;
        }
        case 'ABS': {
          if (args.length < 1) throw new Error('ABS requires 1 argument');
          return Math.abs(args[0]);
        }
        case 'FLOOR': {
          if (args.length < 1) throw new Error('FLOOR requires 1 argument');
          return Math.floor(args[0]);
        }
        case 'CEIL': {
          if (args.length < 1) throw new Error('CEIL requires 1 argument');
          return Math.ceil(args[0]);
        }
        default:
          throw new Error('Unknown function: ' + funcName);
      }
    }

    // Cell reference
    if (t.type === TokenType.CellRef) {
      const key = advance().value;
      const val = values.get(key);
      if (val === undefined) {
        throw new ReferenceError('Unknown cell: ' + key);
      }
      // null cell value resolves to 0
      return val === null ? 0 : val;
    }

    // Parenthesized expression
    if (t.type === TokenType.LParen) {
      advance();
      const val = parseExpression();
      expect(TokenType.RParen);
      return val;
    }

    throw new Error('Unexpected token "' + t.value + '" at position ' + t.pos);
  }

  // Execute the parser
  try {
    const result = parseExpression();

    // Ensure we consumed all tokens
    if (peek().type !== TokenType.EOF) {
      return { result: null, error: '#ERR: Unexpected token "' + peek().value + '" at position ' + peek().pos };
    }

    // Handle NaN from division by zero
    if (isNaN(result)) {
      return { result: NaN, error: '#DIV/0' };
    }

    return { result };
  } catch (e: unknown) {
    if (e instanceof ReferenceError) {
      return { result: null, error: '#REF' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { result: null, error: '#ERR: ' + msg };
  }
}

// ---------------------------------------------------------------------------
// detectCycle — DFS with white/gray/black coloring
// ---------------------------------------------------------------------------

/**
 * Detect a cycle starting from `startKey` in the adjacency map.
 * adjacency maps a node key to the list of keys it depends on (forward edges).
 * Returns the cycle path if found, null if no cycle.
 */
export function detectCycle(
  startKey: string,
  adjacency: Map<string, string[]>,
): string[] | null {
  // Colors: 0 = white (unvisited), 1 = gray (in stack), 2 = black (done)
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  function dfs(key: string): string[] | null {
    color.set(key, 1); // gray

    const deps = adjacency.get(key);
    if (deps) {
      for (let i = 0; i < deps.length; i++) {
        const dep = deps[i];
        const depColor = color.get(dep);

        if (depColor === 1) {
          // Found cycle -- reconstruct path
          const cycle: string[] = [dep, key];
          let cur = key;
          while (cur !== dep) {
            const p = parent.get(cur);
            if (p === undefined || p === null) break;
            cycle.push(p);
            cur = p;
          }
          cycle.reverse();
          return cycle;
        }

        if (depColor === undefined || depColor === 0) {
          parent.set(dep, key);
          const result = dfs(dep);
          if (result !== null) return result;
        }
      }
    }

    color.set(key, 2); // black
    return null;
  }

  parent.set(startKey, null);
  return dfs(startKey);
}

// ---------------------------------------------------------------------------
// topologicalSort — Kahn's algorithm
// ---------------------------------------------------------------------------

/**
 * Topological sort using Kahn's algorithm.
 * `nodes` maps key to its forward dependencies (dependsOn).
 * Returns the evaluation order and whether a cycle was detected.
 */
export function topologicalSort(
  nodes: Map<string, { dependsOn: string[] }>,
): { order: string[]; hasCycle: boolean } {
  // In-degree of node A = number of A's dependencies that exist in the graph.
  // Edge direction: if A depends on B, then B -> A (B must be evaluated before A).
  // A node with in-degree 0 has no unsatisfied dependencies and can be evaluated first.
  const inDegree = new Map<string, number>();
  const allKeys: string[] = [];

  nodes.forEach(function (_node, key) {
    inDegree.set(key, 0);
    allKeys.push(key);
  });

  // For each node, in-degree = count of its dependencies that exist in the graph
  nodes.forEach(function (node, key) {
    let deg = 0;
    for (let i = 0; i < node.dependsOn.length; i++) {
      if (nodes.has(node.dependsOn[i])) {
        deg++;
      }
    }
    inDegree.set(key, deg);
  });

  // Queue starts with nodes that have in-degree 0 (no dependencies, or all deps are external)
  const queue: string[] = [];
  inDegree.forEach(function (deg, key) {
    if (deg === 0) {
      queue.push(key);
    }
  });

  // Build reverse adjacency: for each dependency edge A->B (A depends on B),
  // store B -> [A] so when B is "processed" we can decrement A's in-degree
  const reverseAdj = new Map<string, string[]>();
  nodes.forEach(function (node, key) {
    for (let i = 0; i < node.dependsOn.length; i++) {
      const dep = node.dependsOn[i];
      if (nodes.has(dep)) {
        let list = reverseAdj.get(dep);
        if (!list) {
          list = [];
          reverseAdj.set(dep, list);
        }
        list.push(key);
      }
    }
  });

  const order: string[] = [];
  let head = 0;

  while (head < queue.length) {
    const key = queue[head++];
    order.push(key);

    const consumers = reverseAdj.get(key);
    if (consumers) {
      for (let i = 0; i < consumers.length; i++) {
        const consumer = consumers[i];
        const newDeg = (inDegree.get(consumer) || 1) - 1;
        inDegree.set(consumer, newDeg);
        if (newDeg === 0) {
          queue.push(consumer);
        }
      }
    }
  }

  const hasCycle = order.length < allKeys.length;
  return { order, hasCycle };
}

// ---------------------------------------------------------------------------
// computeDepthMap — for enforcing MAX_FORMULA_DEPTH
// ---------------------------------------------------------------------------

function computeDepthMap(
  topoOrder: string[],
  adjacency: Map<string, string[]>,
): Map<string, number> {
  const depth = new Map<string, number>();

  for (let i = 0; i < topoOrder.length; i++) {
    const key = topoOrder[i];
    const deps = adjacency.get(key);
    let maxParentDepth = -1;

    if (deps) {
      for (let j = 0; j < deps.length; j++) {
        const d = depth.get(deps[j]);
        if (d !== undefined && d > maxParentDepth) {
          maxParentDepth = d;
        }
      }
    }

    depth.set(key, maxParentDepth + 1);
  }

  return depth;
}

// ---------------------------------------------------------------------------
// createOpExEngine
// ---------------------------------------------------------------------------

export function createOpExEngine(): OpExEngine {
  // ---- Internal state ----
  const nodes = new Map<string, DAGNode>();
  let topoOrder: string[] = [];
  // Map from key -> position in topoOrder for fast ordering of dirty sets
  let topoIndex = new Map<string, number>();
  // Forward adjacency: key -> keys it depends on
  let forwardAdj = new Map<string, string[]>();
  // Reverse adjacency: key -> keys that depend on it (consumers)
  let reverseAdj = new Map<string, Set<string>>();
  let kpiKeys: string[] = [];

  // ---- Helpers ----

  function rebuildReverseAdj(): void {
    reverseAdj = new Map<string, Set<string>>();

    // Initialize all keys with empty sets
    nodes.forEach(function (_node, key) {
      if (!reverseAdj.has(key)) {
        reverseAdj.set(key, new Set<string>());
      }
    });

    // Populate reverse edges
    nodes.forEach(function (node, key) {
      for (let i = 0; i < node.dependsOn.length; i++) {
        const dep = node.dependsOn[i];
        let consumers = reverseAdj.get(dep);
        if (!consumers) {
          consumers = new Set<string>();
          reverseAdj.set(dep, consumers);
        }
        consumers.add(key);
      }
    });

    // Also set consumers array on each node
    nodes.forEach(function (node, key) {
      const consumers = reverseAdj.get(key);
      node.consumers = consumers ? Array.from(consumers) : [];
    });
  }

  function rebuildTopoOrder(): void {
    const nodeMap = new Map<string, { dependsOn: string[] }>();
    nodes.forEach(function (node, key) {
      nodeMap.set(key, { dependsOn: node.dependsOn });
    });

    const result = topologicalSort(nodeMap);
    topoOrder = result.order;

    // Rebuild index
    topoIndex = new Map<string, number>();
    for (let i = 0; i < topoOrder.length; i++) {
      topoIndex.set(topoOrder[i], i);
    }

    // If cycle detected, mark nodes not in order as #CIRC
    if (result.hasCycle) {
      nodes.forEach(function (node, key) {
        if (!topoIndex.has(key)) {
          node.error = '#CIRC';
          node.value = null;
        }
      });
    }
  }

  function evaluateNode(key: string): void {
    const node = nodes.get(key);
    if (!node) return;

    // Non-formula cells keep their value
    if (!node.formula) {
      node.error = undefined;
      return;
    }

    // Check depth limit
    // (depth was precomputed but we can also check here for safety)

    // Check for missing dependencies (#REF)
    for (let i = 0; i < node.dependsOn.length; i++) {
      if (!nodes.has(node.dependsOn[i])) {
        node.value = null;
        node.error = '#REF';
        return;
      }
    }

    // Build values map for this evaluation
    const valuesMap = new Map<string, number | null>();
    nodes.forEach(function (n, k) {
      // If a dependency has a #DIV/0 error, cascade 0 to dependents
      if (n.error === '#DIV/0') {
        valuesMap.set(k, 0);
      } else if (n.error) {
        valuesMap.set(k, null);
      } else {
        valuesMap.set(k, n.value);
      }
    });

    const result = evaluateFormula(node.formula, valuesMap);

    if (result.error) {
      if (result.error === '#DIV/0') {
        node.value = NaN;
        node.error = '#DIV/0';
      } else if (result.error === '#REF') {
        node.value = null;
        node.error = '#REF';
      } else {
        node.value = null;
        node.error = result.error;
      }
    } else {
      node.value = result.result;
      node.error = undefined;
    }
  }

  function collectKPIs(): Record<string, number | null> {
    const kpis: Record<string, number | null> = {};
    for (let i = 0; i < kpiKeys.length; i++) {
      const node = nodes.get(kpiKeys[i]);
      if (node) {
        if (node.error === '#DIV/0' || (node.value !== null && isNaN(node.value))) {
          kpis[kpiKeys[i]] = null;
        } else {
          kpis[kpiKeys[i]] = node.value;
        }
      } else {
        kpis[kpiKeys[i]] = null;
      }
    }
    return kpis;
  }

  function nodeToCellValue(node: DAGNode): CellValue {
    const cv: CellValue = {
      key: node.key,
      value: node.value !== null && isNaN(node.value) ? null : node.value,
    };
    if (node.error) {
      cv.error = node.error;
    }
    return cv;
  }

  /**
   * Collect all downstream nodes from a given starting key using BFS on reverse adjacency.
   * Returns the set of all keys that transitively depend on startKey (inclusive).
   */
  function collectDirtySet(startKey: string): Set<string> {
    const dirty = new Set<string>();
    const queue: string[] = [startKey];
    let head = 0;

    while (head < queue.length) {
      const key = queue[head++];
      if (dirty.has(key)) continue;
      dirty.add(key);

      const consumers = reverseAdj.get(key);
      if (consumers) {
        consumers.forEach(function (consumer) {
          if (!dirty.has(consumer)) {
            queue.push(consumer);
          }
        });
      }
    }

    return dirty;
  }

  /**
   * Evaluate only the dirty nodes in topological order.
   * Returns CellValue[] for all nodes whose values changed.
   */
  function evaluateDirtySet(dirty: Set<string>): CellValue[] {
    // Sort dirty keys by their topological index
    const dirtyList: string[] = [];
    for (let i = 0; i < topoOrder.length; i++) {
      if (dirty.has(topoOrder[i])) {
        dirtyList.push(topoOrder[i]);
      }
    }

    const updated: CellValue[] = [];

    for (let i = 0; i < dirtyList.length; i++) {
      const key = dirtyList[i];
      const node = nodes.get(key);
      if (!node) continue;

      const oldValue = node.value;
      const oldError = node.error;

      evaluateNode(key);

      // Report if changed
      if (node.value !== oldValue || node.error !== oldError) {
        updated.push(nodeToCellValue(node));
      }
    }

    return updated;
  }

  // ---- Public API ----

  function buildGraph(cells: CellDefinition[]): void {
    nodes.clear();
    forwardAdj = new Map<string, string[]>();

    // Create all nodes first (so we know what keys exist)
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const deps = cell.formula ? parseDependencies(cell.formula) : [];
      const node: DAGNode = {
        key: cell.key,
        formula: cell.cellType === 'COMPUTED' ? cell.formula : null,
        dependsOn: deps,
        consumers: [], // populated by rebuildReverseAdj
        value: cell.cellType === 'COMPUTED' ? null : (cell.value ?? null),
        error: undefined,
      };
      nodes.set(cell.key, node);
      forwardAdj.set(cell.key, deps);
    }

    // Build reverse adjacency and topological order
    rebuildReverseAdj();
    rebuildTopoOrder();

    // Validate depth
    const depthMap = computeDepthMap(topoOrder, forwardAdj);
    depthMap.forEach(function (depth, key) {
      if (depth > MAX_FORMULA_DEPTH) {
        const node = nodes.get(key);
        if (node) {
          node.error = '#ERR: Exceeds max formula depth (' + MAX_FORMULA_DEPTH + ')';
          node.value = null;
        }
      }
    });
  }

  function updateValue(key: string, value: number): EvaluationResult {
    const node = nodes.get(key);
    if (!node) {
      return { updatedCells: [], kpis: collectKPIs() };
    }

    // Set the new value directly (O(1))
    node.value = value;
    node.error = undefined;

    // Collect dirty downstream subgraph (O(k))
    const dirty = collectDirtySet(key);
    // Remove the input node itself from dirty set -- we already set its value
    dirty.delete(key);

    // Evaluate dirty nodes in topo order
    const updated = evaluateDirtySet(dirty);

    // Include the input node itself in the results
    updated.unshift(nodeToCellValue(node));

    return { updatedCells: updated, kpis: collectKPIs() };
  }

  function updateFormula(key: string, formula: string): EvaluationResult {
    const node = nodes.get(key);
    if (!node) {
      return { updatedCells: [], kpis: collectKPIs() };
    }

    // Parse new dependencies from the formula
    const newDeps = parseDependencies(formula);

    // Update the node
    node.formula = formula;
    node.dependsOn = newDeps;

    // Update forward adjacency
    forwardAdj.set(key, newDeps);

    // Full rebuild of reverse adjacency and topological sort (O(n+E))
    rebuildReverseAdj();
    rebuildTopoOrder();

    // Validate depth after rebuild
    const depthMap = computeDepthMap(topoOrder, forwardAdj);
    depthMap.forEach(function (depth, k) {
      if (depth > MAX_FORMULA_DEPTH) {
        const n = nodes.get(k);
        if (n) {
          n.error = '#ERR: Exceeds max formula depth (' + MAX_FORMULA_DEPTH + ')';
          n.value = null;
        }
      }
    });

    // Collect dirty set from this node down and evaluate
    const dirty = collectDirtySet(key);
    const updated = evaluateDirtySet(dirty);

    return { updatedCells: updated, kpis: collectKPIs() };
  }

  function evaluateAll(): EvaluationResult {
    const updated: CellValue[] = [];

    for (let i = 0; i < topoOrder.length; i++) {
      const key = topoOrder[i];
      const node = nodes.get(key);
      if (!node) continue;

      evaluateNode(key);
      updated.push(nodeToCellValue(node));
    }

    return { updatedCells: updated, kpis: collectKPIs() };
  }

  function getCellValue(key: string): CellValue {
    const node = nodes.get(key);
    if (!node) {
      return { key, value: null, error: '#REF' };
    }
    return nodeToCellValue(node);
  }

  function getAllValues(): Map<string, CellValue> {
    const result = new Map<string, CellValue>();
    nodes.forEach(function (node, key) {
      result.set(key, nodeToCellValue(node));
    });
    return result;
  }

  function setKPICells(keys: string[]): void {
    kpiKeys = keys.slice();
  }

  function validateFormula(
    key: string,
    formula: string,
  ): { valid: boolean; error?: string; dependsOn: string[] } {
    // Parse dependencies
    const dependsOn = parseDependencies(formula);

    // Check for missing references
    for (let i = 0; i < dependsOn.length; i++) {
      if (!nodes.has(dependsOn[i])) {
        return { valid: false, error: '#REF: Unknown cell "' + dependsOn[i] + '"', dependsOn };
      }
    }

    // Check for self-reference
    if (dependsOn.indexOf(key) !== -1) {
      return { valid: false, error: '#CIRC: Formula references itself', dependsOn };
    }

    // Check for cycles: temporarily add the edge and run cycle detection
    const tempAdj = new Map<string, string[]>();
    nodes.forEach(function (node, k) {
      tempAdj.set(k, node.dependsOn.slice());
    });
    tempAdj.set(key, dependsOn);

    const cycle = detectCycle(key, tempAdj);
    if (cycle !== null) {
      return { valid: false, error: '#CIRC: Circular dependency detected: ' + cycle.join(' -> '), dependsOn };
    }

    // Check formula depth
    // Temporarily compute topo order with new deps
    const tempNodes = new Map<string, { dependsOn: string[] }>();
    nodes.forEach(function (node, k) {
      tempNodes.set(k, { dependsOn: k === key ? dependsOn : node.dependsOn.slice() });
    });
    const tempTopo = topologicalSort(tempNodes);
    if (tempTopo.hasCycle) {
      return { valid: false, error: '#CIRC: Circular dependency detected', dependsOn };
    }

    const tempForwardAdj = new Map<string, string[]>();
    tempNodes.forEach(function (node, k) {
      tempForwardAdj.set(k, node.dependsOn);
    });
    const depthMap = computeDepthMap(tempTopo.order, tempForwardAdj);
    const depth = depthMap.get(key);
    if (depth !== undefined && depth > MAX_FORMULA_DEPTH) {
      return {
        valid: false,
        error: '#ERR: Formula depth (' + depth + ') exceeds maximum (' + MAX_FORMULA_DEPTH + ')',
        dependsOn,
      };
    }

    // Try parsing the formula to check for syntax errors
    // Use a dummy values map with all keys resolving to 0
    const dummyValues = new Map<string, number | null>();
    nodes.forEach(function (_node, k) {
      dummyValues.set(k, 0);
    });
    const parseResult = evaluateFormula(formula, dummyValues);
    if (parseResult.error && parseResult.error !== '#DIV/0') {
      return { valid: false, error: parseResult.error, dependsOn };
    }

    return { valid: true, dependsOn };
  }

  return {
    buildGraph,
    updateValue,
    updateFormula,
    evaluateAll,
    getCellValue,
    getAllValues,
    setKPICells,
    validateFormula,
  };
}
