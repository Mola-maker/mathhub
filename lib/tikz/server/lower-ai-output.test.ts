import { describe, expect, it } from 'vitest';
import {
  isExplicitCreateGeometryIntent,
  isExplicitGeometryMutationIntent,
  isExplicitReadOnlyGeometryIntent,
  lowerAiSourceCandidate,
  type AiSourceCandidateBasis,
} from './lower-ai-output';

function basis(source: string, offset: number): AiSourceCandidateBasis {
  return {
    source,
    documentId: 'doc',
    epoch: 'epoch',
    revision: 3,
    sourceHash: 'source-hash',
    sourceId: 'source',
    hashAlgorithm: 'fnv1a64-utf8',
    readBindingIds: ['binding:document:tikzpicture-body-end'],
    bindings: [{
      bindingId: 'binding:document:tikzpicture-body-end',
      sourceId: 'source',
      range: { start: offset, end: offset },
      writable: true,
      opaque: false,
      insertionPolicy: source.trim() ? 'tikzpicture-body' : 'full-document',
    }],
  };
}

describe('lowerAiSourceCandidate', () => {
  it('separates direct create requests from questions about creating', () => {
    expect(isExplicitCreateGeometryIntent('画一个九点圆')).toBe(true);
    expect(isExplicitCreateGeometryIntent('请帮我画一个九点圆吗？')).toBe(true);
    expect(isExplicitCreateGeometryIntent('如何画一个九点圆？')).toBe(false);
    expect(isExplicitCreateGeometryIntent('解释 TikZ 怎么画圆')).toBe(false);
  });
  it('keeps explanations answer-only while recognizing explicit follow-up edits', () => {
    expect(isExplicitGeometryMutationIntent('九点圆是什么？')).toBe(false);
    expect(isExplicitGeometryMutationIntent('解释九点圆为什么共圆')).toBe(false);
    expect(isExplicitGeometryMutationIntent('把九点圆改为红色并加粗')).toBe(true);
    expect(isExplicitGeometryMutationIntent('给九点圆圆心增加标签')).toBe(true);
    expect(isExplicitGeometryMutationIntent('移动 A 到圆上')).toBe(true);
    expect(isExplicitGeometryMutationIntent('全部补上')).toBe(true);
    expect(isExplicitGeometryMutationIntent('清空画板然后做出这个图')).toBe(true);
  });
  it('recognizes common Chinese follow-up mutation forms without treating questions as writes', () => {
    expect(isExplicitGeometryMutationIntent(
      '\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272\u7c97\u7ebf',
    )).toBe(true);
    expect(isExplicitGeometryMutationIntent(
      '\u7ed9\u4e5d\u70b9\u5706\u52a0\u4e0a\u6807\u7b7e',
    )).toBe(true);
    expect(isExplicitGeometryMutationIntent(
      '\u4e3a\u4ec0\u4e48\u8981\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272\uff1f',
    )).toBe(false);
  });

  it('lets an explicit read-only instruction override ambiguous drawing words', () => {
    const flowRequest = '\u8bf7\u628a\u63a8\u5bfc\u62c6\u6210\u52a8\u6001\u51e0\u4f55\u6d41\u7a0b\u56fe\uff0c\u53ea\u8bfb\uff0c\u4e0d\u4fee\u6539\u753b\u677f\u3002';
    expect(isExplicitReadOnlyGeometryIntent(flowRequest)).toBe(true);
    expect(isExplicitCreateGeometryIntent(flowRequest)).toBe(false);
    expect(isExplicitGeometryMutationIntent(flowRequest)).toBe(false);
    expect(isExplicitGeometryMutationIntent('Draw an explanatory flow diagram, read-only.')).toBe(false);
  });

  it('does not mistake target-scoped preservation for a global no-write instruction', () => {
    const focusedEdit = '把已有的中线 CM 改成绿色并加粗，不要修改其他对象，也不要重画整幅图。';
    expect(isExplicitReadOnlyGeometryIntent(focusedEdit)).toBe(false);
    expect(isExplicitGeometryMutationIntent(focusedEdit)).toBe(true);
    expect(isExplicitGeometryMutationIntent(
      'Change CM to green and thick; do not modify other objects.',
    )).toBe(true);
    expect(isExplicitReadOnlyGeometryIntent('只解释，不要修改。')).toBe(true);
    expect(isExplicitReadOnlyGeometryIntent('Explain it; do not modify the canvas.')).toBe(true);
  });

  it('lowers multiple plain actions into one ordered atomic source operation', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
    const offset = source.indexOf('\\end{tikzpicture}');
    const result = lowerAiSourceCandidate([
      '```tikz-action',
      '\\coordinate (D) at (1,0);',
      '```',
      '```tikz-action',
      '\\draw (D) circle (1);',
      '```',
    ].join('\n'), { ...basis(source, offset), userIntent: 'draw a new nine-point circle' });
    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') return;
    expect(result.proposal.operations).toHaveLength(1);
    const insert = result.proposal.operations[0]!.insert;
    expect(insert.indexOf('\\coordinate (D)')).toBeLessThan(insert.indexOf('\\draw (D) circle'));
    expect(result.proposal.metadata).toMatchObject({
      actionBlockCount: 2,
      atomicBatch: true,
    });
  });

  it('rejects the whole batch when any plain action is unsafe', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
    const offset = source.indexOf('\\end{tikzpicture}');
    expect(lowerAiSourceCandidate([
      '```tikz-action\n\\coordinate (D) at (1,0);\n```',
      '```tikz-action\n\\input{secret}\n```',
    ].join('\n'), { ...basis(source, offset), userIntent: 'draw a new construction' }))
      .toMatchObject({ status: 'rejected' });
  });

  it('rejects mixed, empty, unclosed, oversized and empty-document batches', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const offset = source.indexOf('\\end{tikzpicture}');
    const current = { ...basis(source, offset), userIntent: 'draw a new construction' };
    expect(lowerAiSourceCandidate([
      '```tikz-action\n\\draw (0,0)--(1,1);\n```',
      '```tikz-patch\n{}\n```',
    ].join('\n'), current)).toMatchObject({ status: 'rejected' });
    expect(lowerAiSourceCandidate('```tikz-action\n```', current))
      .toMatchObject({ status: 'rejected' });
    expect(lowerAiSourceCandidate('```tikz-action\n\\draw (0,0)--(1,1);', current))
      .toMatchObject({ status: 'rejected' });
    const tooMany = Array.from({ length: 17 }, (_, index) => (
      `\`\`\`tikz-action\n\\coordinate (P${index}) at (${index},0);\n\`\`\``
    )).join('\n');
    expect(lowerAiSourceCandidate(tooMany, current)).toMatchObject({ status: 'rejected' });
    expect(lowerAiSourceCandidate([
      '```tikz-action\n\\begin{tikzpicture}\n```',
      '```tikz-action\n\\end{tikzpicture}\n```',
    ].join('\n'), basis('', 0))).toMatchObject({ status: 'rejected' });
  });

  it('turns a plain TikZ body into a host-authored insertion proposal', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
    const offset = source.indexOf('\\end{tikzpicture}');
    const result = lowerAiSourceCandidate(
      '可以。\n```tikz-action\n\\draw (A) circle (2);\n```',
      { ...basis(source, offset), userIntent: '新增一个以 A 为圆心的圆。' },
    );
    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') return;
    expect(result.proposal.operations[0]).toMatchObject({
      kind: 'insert',
      bindingId: 'binding:document:tikzpicture-body-end',
    });
    expect(result.proposal.operations[0].insert).toContain('\\draw (A) circle (2);');
    expect(result.proposal.basis).toMatchObject({
      documentId: 'doc',
      revision: 3,
      sourceId: 'source',
    });
  });

  it('rejects append-only lowering when the user asked to modify an existing object', () => {
    const source = '\\begin{tikzpicture}\n\\draw[green] (A)--(C);\n\\end{tikzpicture}';
    const offset = source.indexOf('\\end{tikzpicture}');
    lowerAiSourceCandidate(
      '```tikz-action\n\\draw[violet] (A)--(C);\n```',
      {
        ...basis(source, offset),
        userIntent: '把 A--C 的绿色线修改成紫色线，不要新增。',
      },
    );
    expect(lowerAiSourceCandidate(
      '```tikz-action\n\\draw[violet] (A)--(C);\n```',
      { ...basis(source, offset), userIntent: 'change the existing A--C line' },
    )).toMatchObject({ status: 'rejected' });
  });

  it.each(['移动 A 到圆上', '调整圆的半径', '把红色变成蓝色'])(
    'fails closed for an existing-object request: %s',
    (userIntent) => {
      const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
      const offset = source.indexOf('\\end{tikzpicture}');
      expect(lowerAiSourceCandidate(
        '```tikz-action\n\\coordinate (A) at (2,0);\n```',
        { ...basis(source, offset), userIntent },
      )).toMatchObject({ status: 'rejected' });
    },
  );

  it('accepts a full document only for an empty source', () => {
    const result = lowerAiSourceCandidate(
      '```tikz-action\n\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\n```',
      basis('', 0),
    );
    expect(result.status).toBe('proposal');
  });

  it('does not confuse whitespace-only source with the byte-empty capability', () => {
    const result = lowerAiSourceCandidate(
      '```tikz-action\n\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\n```',
      basis('\n', 0),
    );
    expect(result.status).toBe('rejected');
  });

  it('keeps forbidden or authority-widening output unapplied', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
    const offset = source.indexOf('\\end{tikzpicture}');
    expect(lowerAiSourceCandidate('```tikz-action\n\\input{secret}\n```', basis(source, offset)).status)
      .toBe('rejected');
    expect(lowerAiSourceCandidate(
      '```tikz-action\n\\begin{tikzpicture}\\coordinate (B) at (9,9);\\end{tikzpicture}\n```',
      basis(source, offset),
    ).status).toBe('rejected');
  });

  it('treats an ordinary conversational answer as a valid no-write result', () => {
    expect(lowerAiSourceCandidate('九点圆经过三边中点与三条高的垂足。', basis('', 0)))
      .toEqual({ status: 'none' });
  });

  it('never treats an explanatory TikZ example as write authorization', () => {
    expect(lowerAiSourceCandidate(
      '例如：\n```tikz\n\\draw (0,0)--(1,1);\n```',
      basis('', 0),
    )).toEqual({ status: 'none' });
  });
});
