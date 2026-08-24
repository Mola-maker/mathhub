import type { Tree } from '@lezer/common';
import { parser } from '../editor/tikz-parser';
import { parseTikz } from '../subset/parser';
import type { SourceRange, Statement } from '../subset/ast';
import {
  composeTikzCoordinateTransforms,
  IDENTITY_TIKZ_COORDINATE_TRANSFORM,
  isIdentityTikzCoordinateTransform,
  projectTikzCoordinateTransformOptions,
  statementSupportsTikzCoordinateTransform,
  type TikzCoordinateTransform,
} from '../subset/coordinate-transform';
import { parseTikzOptionSequence, type TikzOptionSequence } from '../syntax/option-sequence';
import { isInteractivePresentationOption } from '../render/style-resolver';
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
  /** Static similarity CTM inherited from scopes and bounded path options. */
  coordinateTransform?: TikzCoordinateTransform;
  inheritedStyleRaw?: string;
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

const TRANSFORM_KEY = /^(?:\/tikz\/)?(?:xshift|yshift|shift|rotate|scale|xscale|yscale|xslant|yslant|cm|reset cm|transform canvas|rotate around|scale around)\b/iu;

function projectedStatement(
  statementSource: string,
  inherited: TikzCoordinateTransform,
): { statement: Statement; transform: TikzCoordinateTransform } | null {
  try {
    const parsed = parseTikz(
      `\\begin{tikzpicture}\n${statementSource}\n\\end{tikzpicture}`,
    );
    const statement = parsed.statements[0];
    if (!statement || parsed.statements.length !== 1) return null;
    let transform = inherited;
    const options = statement.kind === 'path' || statement.kind === 'graph'
      ? statement.options
      : null;
    if (options) {
      const projection = projectTikzCoordinateTransformOptions(options.sequence);
      if (projection.unsupportedEntries.some((entry) => TRANSFORM_KEY.test(entry.trim()))) {
        return null;
      }
      if (projection.recognizedCount > 0) {
        transform = composeTikzCoordinateTransforms(transform, projection.transform);
      }
    } else if (
      statement.kind === 'node'
      && statement.options?.sequence.entries.some((entry) => TRANSFORM_KEY.test(entry.interpreted.trim()))
    ) {
      return null;
    }
    if (!isIdentityTikzCoordinateTransform(transform)) {
      if (!statementSupportsTikzCoordinateTransform(statement, transform)) return null;
    }
    return { statement, transform };
  } catch {
    return null;
  }
}

function scopeOptionSequence(
  source: string,
  start: number,
  end: number,
): TikzOptionSequence | null {
  const opener = '\\begin{scope}';
  if (!source.startsWith(opener, start)) return null;
  let cursor = start + opener.length;
  while (cursor < end) {
    if (/\s/u.test(source[cursor]!)) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === '%') {
      while (cursor < end && source[cursor] !== '\n' && source[cursor] !== '\r') cursor += 1;
      continue;
    }
    break;
  }
  if (source[cursor] !== '[') return parseTikzOptionSequence('', cursor);
  const contentStart = cursor + 1;
  let depth = 1;
  let comment = false;
  for (cursor = contentStart; cursor < end; cursor += 1) {
    const char = source[cursor]!;
    if (comment) {
      if (char === '\n' || char === '\r') comment = false;
      continue;
    }
    if (char === '\\') {
      cursor += 1;
      continue;
    }
    if (char === '%') {
      comment = true;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (depth === 0) {
      return parseTikzOptionSequence(source.slice(contentStart, cursor), contentStart);
    }
  }
  return null;
}

export function parseTikzCst(source: string, existingTree?: Tree): TikzCst {
  const tree = existingTree ?? parser.parse(source);
  const sourceIndex = new SourceIndex(source);
  const statements: CstStatementNode[] = [];
  const errorRanges: SourceRange[] = [];
  const identityOccurrences = new Map<string, number>();
  const transformStack: TikzCoordinateTransform[] = [IDENTITY_TIKZ_COORDINATE_TRANSFORM];
  const styleStack: string[][] = [[]];
  const projectedScopes = new Set<string>();

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
        const sequence = scopeOptionSequence(source, node.from, node.to);
        const projection = sequence
          ? projectTikzCoordinateTransformOptions(sequence)
          : null;
        const presentationEntries = sequence?.entries
          .filter((entry) => isInteractivePresentationOption(entry.interpreted))
          .map((entry) => entry.interpreted) ?? [];
        const unsupported = projection?.unsupportedEntries.filter((entry) => (
          !isInteractivePresentationOption(entry)
        )) ?? [];
        if (!projection || unsupported.length > 0) {
          statements.push(createStatement(
            { start: node.from, end: node.to },
            {
              kind: 'opaque',
              recognition: 'static-structure',
              impact: 'scope',
              command: '\\begin{scope}',
            },
          ));
          return false;
        }
        const inherited = transformStack.at(-1) ?? IDENTITY_TIKZ_COORDINATE_TRANSFORM;
        transformStack.push(composeTikzCoordinateTransforms(inherited, projection.transform));
        styleStack.push([
          ...(styleStack.at(-1) ?? []),
          ...presentationEntries,
        ]);
        projectedScopes.add(`${node.from}:${node.to}`);
        return;
      }
      if (node.name !== 'Statement') return;
      const range = { start: node.from, end: node.to };
      const statementSource = source.slice(range.start, range.end);
      const command = commandOf(statementSource);
      const projection = projectedStatement(
        statementSource,
        transformStack.at(-1) ?? IDENTITY_TIKZ_COORDINATE_TRANSFORM,
      );
      const semantic = projection !== null;
      statements.push(createStatement(range, {
        kind: semantic ? 'semantic' : 'opaque',
        recognition: semantic ? 'semantic-plugin' : 'static-structure',
        impact: semantic ? 'local' : classifyImpact(command),
        command,
        ...(projection && !isIdentityTikzCoordinateTransform(projection.transform)
          ? { coordinateTransform: projection.transform }
          : {}),
        ...((styleStack.at(-1)?.length ?? 0) > 0
          ? { inheritedStyleRaw: styleStack.at(-1)!.join(',') }
          : {}),
      }));
      // A statement can contain groups with nested semicolon statements
      // (notably \foreach). Once the outer statement is opaque, interpreting
      // nested children independently would fabricate a false partial scene.
      return false;
    },
    leave(node) {
      if (node.name !== 'Scope' || !projectedScopes.has(`${node.from}:${node.to}`)) return;
      transformStack.pop();
      styleStack.pop();
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
