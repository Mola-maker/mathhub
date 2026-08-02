import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { buildGeometryAiContext } from './ai-context';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';

function contextFor(source: string, focusRefs: readonly string[]) {
  const analysis = analyze(source, 3);
  return buildGeometryAiContext(
    projectTikzAnalysisToGeometryTruth({
      analysis,
      source,
      hashAlgorithm: 'sha256-utf8',
      basis: {
        documentId: 'document-1',
        epoch: 'epoch-1',
        revision: 3,
        sourceHash: 'source-hash',
        sourceId: 'document-1:tikz',
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    }),
    { focusRefs },
  );
}

describe('Geometry AI context write policy', () => {
  it('空源码公开 full-document 插入策略和唯一授权入口', () => {
    const context = contextFor('', []);
    const documentBinding = context.construction.sourceBindings.find(
      (binding) => binding.id === 'binding:document:tikzpicture-body-end',
    );

    expect(documentBinding).toMatchObject({
      range: { start: 0, end: 0 },
      writable: true,
      insertionPolicy: 'full-document',
      verbatim: '',
    });
    expect(context.construction.authorizedBindingIds).toEqual([
      'binding:document:tikzpicture-body-end',
    ]);
  });

  it('非空源码只授权焦点闭包和 body 插入入口', () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (1,0);
\end{tikzpicture}`;
    const context = contextFor(source, ['A']);
    const documentBinding = context.construction.sourceBindings.find(
      (binding) => binding.id === 'binding:document:tikzpicture-body-end',
    );
    const aBinding = context.construction.sourceBindings.find(
      (binding) => binding.entityIds.some((entityId) => (
        context.focus.closureEntityIds.includes(entityId)
      )),
    );

    expect(documentBinding?.insertionPolicy).toBe('tikzpicture-body');
    expect(aBinding?.verbatim).toContain('\\coordinate (A)');
    expect(context.construction.authorizedBindingIds).toContain(
      'binding:document:tikzpicture-body-end',
    );
    expect(context.construction.authorizedBindingIds).toContain(aBinding?.id);
    expect(context.construction.authorizedBindingIds).not.toContain(
      context.construction.sourceBindings.find((binding) => (
        binding.verbatim?.includes('\\coordinate (B)')
      ))?.id,
    );
  });
});
