import { parseTikzOptionSequence } from '../syntax/option-sequence';
import {
  ParseError,
  type GraphConnector,
  type GraphEdgeSpec,
  type GraphNodeSpec,
  type SourceRange,
  type StyleOptions,
} from './ast';

interface Scanner {
  readonly source: string;
  readonly baseOffset: number;
  index: number;
}

function absolute(scanner: Scanner, start: number, end: number): SourceRange {
  return { start: scanner.baseOffset + start, end: scanner.baseOffset + end };
}

function fail(scanner: Scanner, message: string, start = scanner.index, end = start + 1): never {
  throw new ParseError(
    message,
    scanner.baseOffset + Math.min(start, scanner.source.length),
    scanner.baseOffset + Math.min(end, scanner.source.length),
  );
}

function skipTrivia(scanner: Scanner): void {
  while (scanner.index < scanner.source.length) {
    if (/\s/u.test(scanner.source[scanner.index]!)) {
      scanner.index += 1;
      continue;
    }
    if (scanner.source[scanner.index] === '%') {
      while (
        scanner.index < scanner.source.length
        && scanner.source[scanner.index] !== '\n'
        && scanner.source[scanner.index] !== '\r'
      ) scanner.index += 1;
      continue;
    }
    break;
  }
}

function balancedSlice(
  scanner: Scanner,
  open: '[' | '{',
  close: ']' | '}',
): { raw: string; range: SourceRange; contentOffset: number } {
  const start = scanner.index;
  if (scanner.source[start] !== open) fail(scanner, `期望 '${open}'`, start);
  let depth = 1;
  let quote = false;
  let comment = false;
  scanner.index += 1;
  const contentStart = scanner.index;
  while (scanner.index < scanner.source.length) {
    const char = scanner.source[scanner.index]!;
    if (comment) {
      if (char === '\n' || char === '\r') comment = false;
      scanner.index += 1;
      continue;
    }
    if (char === '\\') {
      scanner.index += Math.min(2, scanner.source.length - scanner.index);
      continue;
    }
    if (char === '%') {
      comment = true;
      scanner.index += 1;
      continue;
    }
    if (char === '"') {
      quote = !quote;
      scanner.index += 1;
      continue;
    }
    if (!quote && char === open) depth += 1;
    if (!quote && char === close) depth -= 1;
    if (depth === 0) {
      const contentEnd = scanner.index;
      scanner.index += 1;
      return {
        raw: scanner.source.slice(contentStart, contentEnd),
        range: absolute(scanner, start, scanner.index),
        contentOffset: scanner.baseOffset + contentStart,
      };
    }
    scanner.index += 1;
  }
  fail(scanner, `'${open}' 未闭合`, start, scanner.source.length);
}

function options(scanner: Scanner): StyleOptions | null {
  skipTrivia(scanner);
  if (scanner.source[scanner.index] !== '[') return null;
  const value = balancedSlice(scanner, '[', ']');
  return {
    raw: value.raw,
    range: value.range,
    sequence: parseTikzOptionSequence(value.raw, value.contentOffset),
  };
}

function identifier(scanner: Scanner): { value: string; start: number; end: number } {
  skipTrivia(scanner);
  const start = scanner.index;
  const match = /^[A-Za-z][A-Za-z0-9_:-]*/u.exec(scanner.source.slice(start));
  if (!match) {
    const char = scanner.source[start] ?? '';
    if (char === '{' || char === '(' || char === '"') {
      fail(
        scanner,
        '交互 graph 子集暂不执行 group、匿名节点或 quoted node；源码仍可由精准编译器处理',
        start,
      );
    }
    fail(scanner, 'graph 节点必须使用静态名称', start);
  }
  scanner.index += match[0].length;
  return { value: match[0], start, end: scanner.index };
}

function label(scanner: Scanner, fallback: string): string {
  skipTrivia(scanner);
  if (scanner.source[scanner.index] !== '/') return fallback;
  scanner.index += 1;
  skipTrivia(scanner);
  if (scanner.source[scanner.index] === '"') {
    scanner.index += 1;
    let value = '';
    while (scanner.index < scanner.source.length) {
      const char = scanner.source[scanner.index]!;
      if (char === '\\' && scanner.index + 1 < scanner.source.length) {
        value += scanner.source.slice(scanner.index, scanner.index + 2);
        scanner.index += 2;
        continue;
      }
      if (char === '"') {
        scanner.index += 1;
        return value;
      }
      value += char;
      scanner.index += 1;
    }
    fail(scanner, 'graph 节点标签引号未闭合');
  }
  if (scanner.source[scanner.index] === '{') {
    return balancedSlice(scanner, '{', '}').raw;
  }
  const start = scanner.index;
  while (
    scanner.index < scanner.source.length
    && !/\s|\[|,|;/u.test(scanner.source[scanner.index]!)
    && !connectorAt(scanner)
  ) scanner.index += 1;
  const value = scanner.source.slice(start, scanner.index).trim();
  if (!value) fail(scanner, 'graph 节点标签不能为空', start);
  return value;
}

function connectorAt(scanner: Scanner): GraphConnector | null {
  const tail = scanner.source.slice(scanner.index);
  for (const connector of ['<->', '-!-', '->', '<-', '--'] as const) {
    if (tail.startsWith(connector)) return connector;
  }
  return null;
}

function node(scanner: Scanner): GraphNodeSpec {
  const name = identifier(scanner);
  const text = label(scanner, name.value);
  const contentEnd = scanner.index;
  const nodeOptions = options(scanner);
  return {
    name: name.value,
    text,
    options: nodeOptions,
    range: absolute(
      scanner,
      name.start,
      nodeOptions ? nodeOptions.range.end - scanner.baseOffset : contentEnd,
    ),
  };
}

function edge(
  scanner: Scanner,
  from: GraphNodeSpec,
  connector: GraphConnector,
  connectorStart: number,
  to: GraphNodeSpec,
  edgeOptions: StyleOptions | null,
): GraphEdgeSpec {
  return {
    from: from.name,
    to: to.name,
    connector,
    options: edgeOptions,
    range: absolute(scanner, connectorStart, to.range.end - scanner.baseOffset),
  };
}

interface GraphFragment {
  readonly entries: GraphNodeSpec[];
  readonly exits: GraphNodeSpec[];
}

const MAX_GRAPH_GROUP_DEPTH = 16;
const MAX_STATIC_GRAPH_NODES = 512;
const MAX_STATIC_GRAPH_EDGES = 4096;

/**
 * Parses the statically decidable topology part of the official graphs
 * library. Static chain groups are expanded according to their entry/exit
 * nodes. Subgraphs, quoted/anonymous nodes, foreach expansion and graphdrawing
 * algorithms stay lossless/opaque and are delegated to the exact compiler.
 */
export function parseStaticGraphBody(
  source: string,
  baseOffset: number,
): { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[] } {
  const scanner: Scanner = { source, baseOffset, index: 0 };
  const nodes = new Map<string, GraphNodeSpec>();
  const edges: GraphEdgeSpec[] = [];

  const remember = (value: GraphNodeSpec): GraphNodeSpec => {
    const existing = nodes.get(value.name);
    if (!existing) {
      if (nodes.size >= MAX_STATIC_GRAPH_NODES) {
        fail(scanner, `静态 graph 节点数不能超过 ${MAX_STATIC_GRAPH_NODES}`, value.range.start - baseOffset, value.range.end - baseOffset);
      }
      nodes.set(value.name, value);
      return value;
    }
    // A bare repeated name is an official reference to the existing graph
    // node, not a second declaration whose implicit label must equal the
    // original explicit label.
    if (value.text === value.name && value.options === null) return existing;
    if (
      value.text !== existing.text
      || value.options?.raw !== existing.options?.raw
    ) {
      fail(scanner, `graph 节点 '${value.name}' 的重复声明不一致`, value.range.start - baseOffset, value.range.end - baseOffset);
    }
    return existing;
  };

  const appendEdges = (
    from: readonly GraphNodeSpec[],
    connector: GraphConnector,
    connectorStart: number,
    to: readonly GraphNodeSpec[],
    edgeOptions: StyleOptions | null,
  ): void => {
    if (from.length * to.length > MAX_STATIC_GRAPH_EDGES - edges.length) {
      fail(scanner, `静态 graph 边数不能超过 ${MAX_STATIC_GRAPH_EDGES}`, connectorStart, scanner.index);
    }
    for (const sourceNode of from) {
      for (const targetNode of to) {
        edges.push(edge(scanner, sourceNode, connector, connectorStart, targetNode, edgeOptions));
      }
    }
  };

  const parseAtom = (depth: number): GraphFragment => {
    skipTrivia(scanner);
    if (scanner.source[scanner.index] !== '{') {
      const value = remember(node(scanner));
      return { entries: [value], exits: [value] };
    }
    if (depth >= MAX_GRAPH_GROUP_DEPTH) {
      fail(scanner, `静态 graph group 嵌套不能超过 ${MAX_GRAPH_GROUP_DEPTH} 层`);
    }
    const groupStart = scanner.index;
    scanner.index += 1;
    const value = parseGroup(depth + 1, '}');
    skipTrivia(scanner);
    if (scanner.source[scanner.index] !== '}') {
      fail(scanner, "graph group '}' 未闭合", groupStart, scanner.source.length);
    }
    scanner.index += 1;
    if (value.entries.length === 0) {
      fail(scanner, 'graph group 不能为空', groupStart, scanner.index);
    }
    return value;
  };

  const parseChain = (depth: number): GraphFragment => {
    const first = parseAtom(depth);
    let exits = first.exits;
    while (true) {
      skipTrivia(scanner);
      const connector = connectorAt(scanner);
      if (!connector) break;
      const connectorStart = scanner.index;
      scanner.index += connector.length;
      const edgeOptions = options(scanner);
      const next = parseAtom(depth);
      appendEdges(exits, connector, connectorStart, next.entries, edgeOptions);
      exits = next.exits;
    }
    return { entries: first.entries, exits };
  };

  function parseGroup(depth: number, closing: '}' | null): GraphFragment {
    const entries: GraphNodeSpec[] = [];
    const exits: GraphNodeSpec[] = [];
    let needsChain = true;

    while (true) {
      skipTrivia(scanner);
      const current = scanner.source[scanner.index];
      if (current === closing || (closing === null && scanner.index >= scanner.source.length)) break;
      if (scanner.index >= scanner.source.length) {
        fail(scanner, "graph group '}' 未闭合", scanner.source.length, scanner.source.length);
      }
      if (!needsChain) {
        fail(scanner, closing === null
          ? 'graph 节点后应为连接符、逗号或分号'
          : "graph group 中节点后应为连接符、逗号、分号或 '}'");
      }

      const chain = parseChain(depth);
      entries.push(...chain.entries);
      exits.push(...chain.exits);
      needsChain = false;

      skipTrivia(scanner);
      if (scanner.source[scanner.index] === ',' || scanner.source[scanner.index] === ';') {
        scanner.index += 1;
        needsChain = true;
      }
    }

    return { entries, exits };
  }

  const graph = parseGroup(0, null);
  skipTrivia(scanner);
  if (scanner.index < scanner.source.length) {
    fail(scanner, 'graph 末尾包含无法执行的静态语法');
  }

  if (graph.entries.length === 0 || nodes.size === 0) fail(scanner, 'graph 不能为空', 0, source.length);
  return { nodes: [...nodes.values()], edges };
}
