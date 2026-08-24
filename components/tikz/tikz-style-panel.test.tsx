import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTikz } from '@/lib/tikz/subset/parser';
import { TikzStylePanel } from './tikz-style-panel';
import type { InspectorSourcePatchResult, TikzEngine } from './use-tikz-engine';

function engineFixture(
  overrides: Partial<TikzEngine> & Pick<TikzEngine, 'code' | 'revision'>,
): TikzEngine {
  return {
    interactiveWritebackSafe: true,
    stmts: [],
    selectedStmtIndex: null,
    // Deletion identity, distinct from the display-only `selection` refs. The
    // panel reads its length to decide whether to render the action row.
    selectionTargets: [],
    selection: [],
    inspectorSelection: {
      key: 'empty-selection',
      label: 'empty',
      refs: [],
      sourceBindingIds: [],
      statementIndex: null,
      semanticEntityId: null,
      sourceRange: null,
      statementRangeValidated: false,
      writeCapability: { mode: 'read-only', bindingIds: [] },
    },
    applySourcePatch: vi.fn(),
    setSelection: vi.fn(),
    ...overrides,
  } as unknown as TikzEngine;
}

// Testing Library only registers its own afterEach cleanup when vitest runs
// with `globals: true`; this project does not, so unmount explicitly or the
// previous test's inspector stays in the document and duplicates every query.
afterEach(cleanup);

describe('TikzStylePanel', () => {
  it('未选中可样式化元素时给出操作提示', async () => {
    render(<TikzStylePanel engine={engineFixture({
      code: '',
      revision: 0,
    })} />);
    // The inspector opens on the geometry tab; the style hint lives behind it.
    // AnimatePresence mode="wait" keeps the outgoing panel mounted until its
    // exit finishes, so the incoming panel only appears asynchronously.
    expect(screen.getByText('选择一个几何对象')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '样式' }));
    expect(await screen.findByText('该对象没有可写样式')).toBeTruthy();
  });

  it('修改颜色后把 options 原位补进源代码', async () => {
    const code = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}';
    const statements = parseTikz(code).statements;
    // Annotate the result: a bare literal widens `code` to string and no longer
    // satisfies the closed InspectorSourcePatchResult code union.
    const applyInspectorSourcePatch = vi.fn(
      (): InspectorSourcePatchResult => ({ ok: true, code: 'committed' }),
    );
    render(<TikzStylePanel engine={engineFixture({
      code,
      revision: 3,
      stmts: statements,
      selectedStmtIndex: 0,
      inspectorSelection: {
        state: 'single',
        key: 'element:0:0',
        label: 'segment',
        target: {
          kind: 'entity',
          sourceRevision: 0,
          stableId: 'element:0:0',
          stmtIndex: 0,
          entityKind: 'element',
          refs: [],
          semanticEntityId: 'element:0:0',
          sourceBindingIds: ['binding:element:0:0'],
          ...(statements[0]?.range ? { sourceRange: statements[0].range } : {}),
        },
        refs: [],
        // The panel reads only source identity and write capability; the
        // semantic/render projections stay null so a fixture drift there cannot
        // silently satisfy a future assertion.
        semanticEntity: null,
        renderPrimitive: null,
        sourceBindingIds: ['binding:element:0:0'],
        statementIndex: 0,
        statement: statements[0] ?? null,
        semanticEntityId: 'element:0:0',
        ...(statements[0]?.range ? { sourceRange: statements[0].range } : {}),
        statementRangeValidated: true,
        writeCapability: {
          mode: 'direct',
          bindingIds: ['binding:element:0:0'],
        },
      } satisfies TikzEngine['inspectorSelection'],
      applyInspectorSourcePatch,
    })} />);

    fireEvent.click(screen.getByRole('tab', { name: '样式' }));
    fireEvent.change(await screen.findByLabelText('颜色'), { target: { value: 'red' } });
    expect(applyInspectorSourcePatch).toHaveBeenCalledWith(
      expect.objectContaining({ insert: '[red]' }),
      'style',
      'style',
      3,
    );
  });
});
