import type { Tree } from '@lezer/common';
import { parser } from '../editor/tikz-parser';
import { parseTikz } from '../subset/parser';
import type { SourceRange } from '../subset/ast';
import {
  SourceIndex,
  type IndexedSourceRange,
} from './source-index';

export interface CstStatementNode {
  /**
   * Content-derived identity. It survives unrelated edits before the node.
   * Duplicate statements receive a deterministic occurrence suffix.
   */
  syntaxId: string;
  range: SourceRange;
  indexedRange: IndexedSourceRange;
  kind: 'semantic' | 'opaque';
  recognition: 'semantic-plugin' | 'static-structure' | 'tex-expansion';
  impact: 'local' | 'scope' | 'document';
  command: string;
}

export interface TikzCst {
  tree: Tree;
  sourceLength: { utf16: number; utf8: number };
  sourceIndex: SourceIndex;
  statements: CstStatementNode[];
  opaqueNodes: CstStatementNode[];
  errorRanges: SourceRange[];
  coverage: {
    statementCount: number;
    semanticStatementCount: number;
    opaqueStatementCount: number;
    semanticRatio: number;
  };
  safeForInteractiveWriteback: boolean;
}

function localFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function commandOf(source: string): string {
  return /^\\[A-Za-z@]+/.exec(source.trimStart())?.[0] ?? '';
}

function classifyImpact(command: string): CstStatementNode['impact'] {
  if (/^\\(?:global|tikzset|pgfkeys|colorlet|definecolor|catcode|def|gdef|edef|xdef)/.test(command)) {
    return 'document';
  }
  if (/^\\(?:clip|transform|pgftransform|begin|end)/.test(command)) {
    return 'scope';
  }
  return 'local';
}

function supportedStatement(statement: string): boolean {
  try {
    const parsed = parseTikz(
      `\\begin{tikzpicture}\n${statement}\n\\end{tikzpicture}`,
    );
    return parsed.statements.length === 1;
  } catch {
    return false;
  }
}

export function parseTikzCst(source: string, existingTree?: Tree): TikzCst {
  const tree = existingTree ?? parser.parse(source);
  const sourceIndex = new SourceIndex(source);
  const statements: CstStatementNode[] = [];
  const errorRanges: SourceRange[] = [];
  const identityOccurrences = new Map<string, number>();

  const createStatement = (
    range: SourceRange,
    node: Omit<CstStatementNode, 'syntaxId' | 'range' | 'indexedRange'>,
  ): CstStatementNode => {
    const raw = source.slice(range.start, range.end);
    const identityBase = `${node.command || 'statement'}:${localFingerprint(raw)}`;
    const occurrence = identityOccurrences.get(identityBase) ?? 0;
    identityOccurrences.set(identityBase, occurrence + 1);
    return {
      ...node,
      syntaxId: `tikz:${identityBase}:${occurrence}`,
      range,
      indexedRange: sourceIndex.range(range.start, range.end),
    };
  };

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        errorRanges.push({ start: node.from, end: node.to });
        return;
      }
      if (node.name === 'Scope') {
        statements.push(createStatement(
          { start: node.from, end: node.to },
          {
          kind: 'opaque',
          recognition: 'tex-expansion',
          impact: 'scope',
          command: '\\begin{scope}',
          },
        ));
        // Scope styles and transforms affect every nested statement. Keep the
        // whole region exact-only instead of projecting incorrect coordinates.
        return false;
      }
      if (node.name !== 'Statement') return;
      const range = { start: node.from, end: node.to };
      const statementSource = source.slice(range.start, range.end);
      const command = commandOf(statementSource);
      const semantic = supportedStatement(statementSource);
      statements.push(createStatement(range, {
        kind: semantic ? 'semantic' : 'opaque',
        recognition: semantic ? 'semantic-plugin' : 'static-structure',
        impact: semantic ? 'local' : classifyImpact(command),
        command,
      }));
      // A statement can contain groups with nested semicolon statements
      // (notably \foreach). Once the outer statement is opaque, interpreting
      // nested children independently would fabricate a false partial scene.
      return false;
    },
  });

  const opaqueNodes = statements.filter((statement) => statement.kind === 'opaque');
  const semanticStatementCount = statements.length - opaqueNodes.length;
  return {
    tree,
    sourceLength: {
      utf16: sourceIndex.utf16Length,
      utf8: sourceIndex.utf8Length,
    },
    sourceIndex,
    statements,
    opaqueNodes,
    errorRanges,
    coverage: {
      statementCount: statements.length,
      semanticStatementCount,
      opaqueStatementCount: opaqueNodes.length,
      semanticRatio: statements.length === 0
        ? 1
        : semanticStatementCount / statements.length,
    },
    safeForInteractiveWriteback: (
      errorRanges.length === 0
      && opaqueNodes.every((node) => node.impact === 'local')
    ),
  };
}
