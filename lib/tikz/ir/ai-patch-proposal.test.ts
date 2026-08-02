import { describe, expect, it } from 'vitest';
import { applyTextPatches } from '../document/source-transaction';
import {
  compileAiPatchProposal,
  type AiPatchBindingContext,
  type AiPatchProposal,
  type AiPatchProposalBasis,
} from './ai-patch-proposal';

const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (1,0);
\end{tikzpicture}`;

const basis: AiPatchProposalBasis = {
  documentId: 'document-1',
  epoch: 'epoch-1',
  revision: 4,
  sourceHash: 'source-hash',
  sourceId: 'document-1:tikz',
  hashAlgorithm: 'sha256-utf8',
  pluginSetDigest: 'plugins-1',
};

function binding(
  bindingId: string,
  start: number,
  end: number,
  insertionPolicy: AiPatchBindingContext['insertionPolicy'] = 'none',
): AiPatchBindingContext {
  return {
    bindingId,
    sourceId: basis.sourceId,
    range: { start, end },
    writable: true,
    opaque: false,
    insertionPolicy,
  };
}

function operation(
  operationId: string,
  bindingId: string,
  start: number,
  end: number,
  insert: string,
) {
  return {
    operationId,
    kind: start === end ? 'insert' as const : 'replace' as const,
    bindingId,
    sourceId: basis.sourceId,
    range: { start, end },
    insert,
    expectedText: source.slice(start, end),
    preconditions: {
      sourceId: basis.sourceId,
      range: { start, end },
      writable: true,
      opaque: false,
    },
  };
}

function proposal(
  readBindingIds: readonly string[],
  operations: AiPatchProposal['operations'],
): AiPatchProposal {
  return {
    schemaVersion: 'ai-patch-proposal/v1',
    proposalId: 'proposal-1',
    idempotencyKey: 'proposal-1',
    basis,
    focusBindingIds: readBindingIds,
    readBindingIds,
    operations,
  };
}

describe('binding-scoped AI patch proposal', () => {
  it('拒绝存在但不在服务端授权集合内的 binding', () => {
    const aStart = source.indexOf('\\coordinate (A)');
    const aEnd = source.indexOf('\n', aStart);
    const bStart = source.indexOf('\\coordinate (B)');
    const bEnd = source.indexOf('\n', bStart);
    const bindings = [
      binding('binding:A', aStart, aEnd),
      binding('binding:B', bStart, bEnd),
    ];

    const result = compileAiPatchProposal(
      proposal(
        ['binding:B'],
        [operation('op-B', 'binding:B', bStart, bEnd, '\\coordinate (B) at (2,0);')],
      ),
      {
        basis,
        bindings,
        allowedBindingIds: ['binding:A'],
        source,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => (
        error.code === 'binding-scope' && error.bindingId === 'binding:B'
      ))).toBe(true);
    }
  });

  it('把两个不相交的 binding 原子降低为一个多补丁事务', () => {
    const aStart = source.indexOf('(0,0)');
    const bStart = source.indexOf('(1,0)');
    const bindings = [
      binding('binding:A', aStart, aStart + 5),
      binding('binding:B', bStart, bStart + 5),
    ];
    const result = compileAiPatchProposal(
      proposal(
        ['binding:A', 'binding:B'],
        [
          operation('op-A', 'binding:A', aStart, aStart + 5, '(0,1)'),
          operation('op-B', 'binding:B', bStart, bStart + 5, '(2,0)'),
        ],
      ),
      {
        basis,
        bindings,
        allowedBindingIds: ['binding:A', 'binding:B'],
        source,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const patches = result.transaction.operations.flatMap((entry) => (
      entry.op === 'source-patch'
        ? entry.patches.map((patch) => ({
          from: patch.range.start,
          to: patch.range.end,
          insert: patch.insert,
        }))
        : []
    ));
    expect(applyTextPatches(source, patches)).toContain(
      '\\coordinate (A) at (0,1);',
    );
    expect(applyTextPatches(source, patches)).toContain(
      '\\coordinate (B) at (2,0);',
    );
  });

  it('空源码只接受一个完整 tikzpicture 环境', () => {
    const emptyBasis = { ...basis, revision: 0, sourceHash: 'empty-hash' };
    const documentBinding = {
      ...binding(
        'binding:document:tikzpicture-body-end',
        0,
        0,
        'full-document',
      ),
      sourceId: emptyBasis.sourceId,
    };
    const makeEmptyProposal = (insert: string): AiPatchProposal => ({
      ...proposal([], []),
      basis: emptyBasis,
      focusBindingIds: [documentBinding.bindingId],
      readBindingIds: [documentBinding.bindingId],
      operations: [{
        operationId: 'op-document',
        kind: 'insert',
        bindingId: documentBinding.bindingId,
        sourceId: emptyBasis.sourceId,
        range: { start: 0, end: 0 },
        insert,
        expectedText: '',
        preconditions: {
          sourceId: emptyBasis.sourceId,
          range: { start: 0, end: 0 },
          writable: true,
          opaque: false,
        },
      }],
    });
    const context = {
      basis: emptyBasis,
      bindings: [documentBinding],
      allowedBindingIds: [documentBinding.bindingId],
      source: '',
    };

    expect(compileAiPatchProposal(
      makeEmptyProposal(
        '\\begin{tikzpicture}\n\\draw (0,0) circle (1);\n\\end{tikzpicture}',
      ),
      context,
    ).ok).toBe(true);
    expect(compileAiPatchProposal(
      makeEmptyProposal(
        '% generated\n\\begin % comment\n {tikz% hidden newline\npicture}\n'
        + '\\draw (0,0) circle (1);\n\\end {tikzpicture}\n% eof',
      ),
      context,
    ).ok).toBe(true);
    const bodyOnly = compileAiPatchProposal(
      makeEmptyProposal('\\draw (0,0) circle (1);'),
      context,
    );
    expect(bodyOnly.ok).toBe(false);
    expect(compileAiPatchProposal(
      makeEmptyProposal(
        '\\begin{tikzpicture}\\begin {tikzpicture}'
        + '\\end{tikzpicture}\\end {tikzpicture}',
      ),
      context,
    ).ok).toBe(false);
  });

  it('非空源码的 body 插入拒绝嵌套 tikzpicture 环境', () => {
    const offset = source.lastIndexOf('\\end{tikzpicture}');
    const documentBinding = binding(
      'binding:document:tikzpicture-body-end',
      offset,
      offset,
      'tikzpicture-body',
    );
    const result = compileAiPatchProposal(
      proposal(
        [documentBinding.bindingId],
        [operation(
          'op-document',
          documentBinding.bindingId,
          offset,
          offset,
          '\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}',
        )],
      ),
      {
        basis,
        bindings: [documentBinding],
        allowedBindingIds: [documentBinding.bindingId],
        source,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'insertion-policy'))
        .toBe(true);
    }
    for (const disguisedEnvironment of [
      '\\begin {tikzpicture}\\draw (0,0);\\end {tikzpicture}',
      '\\begin% comment\n{tikzpicture}\\draw (0,0);\\end{tikzpicture}',
      '\\begin{tikz% comment\npicture}\\draw (0,0);\\end{tikzpicture}',
    ]) {
      const disguised = compileAiPatchProposal(
        proposal(
          [documentBinding.bindingId],
          [operation(
            `op-${disguisedEnvironment.length}`,
            documentBinding.bindingId,
            offset,
            offset,
            disguisedEnvironment,
          )],
        ),
        {
          basis,
          bindings: [documentBinding],
          allowedBindingIds: [documentBinding.bindingId],
          source,
        },
      );
      expect(disguised.ok).toBe(false);
    }
    const commentOnly = compileAiPatchProposal(
      proposal(
        [documentBinding.bindingId],
        [operation(
          'op-comment',
          documentBinding.bindingId,
          offset,
          offset,
          '% \\\\begin{tikzpicture} is documentation only\n\\draw (0,0);',
        )],
      ),
      {
        basis,
        bindings: [documentBinding],
        allowedBindingIds: [documentBinding.bindingId],
        source,
      },
    );
    expect(commentOnly.ok).toBe(true);

    const escapedControlSymbol = compileAiPatchProposal(
      proposal(
        [documentBinding.bindingId],
        [operation(
          'op-escaped-control-symbol',
          documentBinding.bindingId,
          offset,
          offset,
          String.raw`\\begin{tikzpicture} is text, not an environment`,
        )],
      ),
      {
        basis,
        bindings: [documentBinding],
        allowedBindingIds: [documentBinding.bindingId],
        source,
      },
    );
    expect(escapedControlSymbol.ok).toBe(true);

    // This narrow AI mutation boundary deliberately fails closed for TeX
    // literalizing constructs that would require macro or verbatim execution.
    // Exact compilation still accepts them; body patch authorization does not.
    for (const literalizingForm of [
      String.raw`\string\begin{tikzpicture}`,
      String.raw`\verb|\begin{tikzpicture}|`,
    ]) {
      const literalized = compileAiPatchProposal(
        proposal(
          [documentBinding.bindingId],
          [operation(
            `op-literal-${literalizingForm.length}`,
            documentBinding.bindingId,
            offset,
            offset,
            literalizingForm,
          )],
        ),
        {
          basis,
          bindings: [documentBinding],
          allowedBindingIds: [documentBinding.bindingId],
          source,
        },
      );
      expect(literalized.ok).toBe(false);
    }

    const crOnlyComment = compileAiPatchProposal(
      proposal(
        [documentBinding.bindingId],
        [operation(
          'op-cr-only-comment',
          documentBinding.bindingId,
          offset,
          offset,
          '% documentation only\r\\begin{tikzpicture}',
        )],
      ),
      {
        basis,
        bindings: [documentBinding],
        allowedBindingIds: [documentBinding.bindingId],
        source,
      },
    );
    expect(crOnlyComment.ok).toBe(false);
  });

  it('没有可信 hashSlice 时拒绝 hash-only guard', () => {
    const start = source.indexOf('(0,0)');
    const target = binding('binding:A', start, start + 5);
    const hashGuarded: AiPatchProposal = {
      ...proposal(['binding:A'], []),
      operations: [{
        operationId: 'op-A',
        kind: 'replace',
        bindingId: 'binding:A',
        sourceId: basis.sourceId,
        range: { start, end: start + 5 },
        insert: '(0,1)',
        expectedSliceHash: 'unverified',
        preconditions: {
          sourceId: basis.sourceId,
          range: { start, end: start + 5 },
          writable: true,
          opaque: false,
        },
      }],
    };

    const result = compileAiPatchProposal(hashGuarded, {
      basis,
      bindings: [target],
      allowedBindingIds: ['binding:A'],
      source,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'expected-guard'))
        .toBe(true);
    }

    const verifierWithoutSource = compileAiPatchProposal(hashGuarded, {
      basis,
      bindings: [target],
      allowedBindingIds: ['binding:A'],
      hashSlice: (slice) => `trusted:${slice}`,
    });
    expect(verifierWithoutSource.ok).toBe(false);
    if (!verifierWithoutSource.ok) {
      expect(verifierWithoutSource.errors.some(
        (error) => error.code === 'expected-guard',
      )).toBe(true);
    }
  });
});
