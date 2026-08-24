import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TikzEngine } from './use-tikz-engine';
import { TikzSelectionTransform } from './tikz-selection-transform';

afterEach(cleanup);

function engineFixture(overrides: Partial<TikzEngine> = {}): TikzEngine {
  return {
    selectionTargets: [{
      kind: 'entity',
      sourceRevision: 0,
      stableId: 'element:3:0',
      semanticEntityId: 'element:3:0',
      stmtIndex: 3,
      entityKind: 'element',
      refs: ['A', 'B'],
    }],
    transformSelection: vi.fn(() => ({ handled: true, committed: true })),
    selectionTransformCapability: vi.fn(() => ({
      status: 'ready',
      selectedEntityIds: ['element:3:0'],
      variableEntityIds: ['point:A', 'point:B'],
      impactedEntityIds: ['element:3:0', 'point:A', 'point:B'],
      externalImpactedEntityIds: [],
      patchCount: 2,
    })),
    selectAllGeometry: vi.fn(),
    setSelectionTargets: vi.fn(),
    ...overrides,
  } as unknown as TikzEngine;
}

describe('TikzSelectionTransform', () => {
  it('applies translation to the current multi-object selection', () => {
    const engine = engineFixture();
    render(<TikzSelectionTransform engine={engine} open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('水平位移'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('垂直位移'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: '应用到 2 个驱动点' }));

    expect(engine.transformSelection).toHaveBeenCalledWith({
      kind: 'translate',
      dx: 2,
      dy: -3,
    });
    expect(screen.getByText('变换已同步到画板与 TikZ 源码。')).toBeTruthy();
  });

  it('uses the selection centroid for rotation and can clear the selection', () => {
    const engine = engineFixture();
    const onOpenChange = vi.fn();
    render(
      <TikzSelectionTransform
        engine={engine}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    fireEvent.change(screen.getByLabelText('变换类型'), { target: { value: 'rotate' } });
    fireEvent.change(screen.getByLabelText('旋转角度'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: '应用到 2 个驱动点' }));

    expect(engine.setSelectionTargets).toHaveBeenCalledWith([]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(engine.transformSelection).toHaveBeenCalledWith({
      kind: 'rotate',
      degrees: 45,
      center: 'selection',
    });
  });

  it('does not silently coerce invalid numeric input', () => {
    const engine = engineFixture();
    render(<TikzSelectionTransform engine={engine} open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('水平位移'), { target: { value: 'abc' } });

    expect(screen.getByText('请输入有效数字。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '应用到 0 个驱动点' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires an explicit acknowledgement for selection-external effects', () => {
    const engine = engineFixture({
      selectionTransformCapability: vi.fn(() => ({
        status: 'warning' as const,
        selectedEntityIds: ['element:3:0'],
        variableEntityIds: ['point:A', 'point:B'],
        impactedEntityIds: ['element:3:0', 'element:4:0', 'point:A', 'point:B'],
        externalImpactedEntityIds: ['element:4:0'],
        patchCount: 2,
      })),
    });
    render(<TikzSelectionTransform engine={engine} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '应用到 2 个驱动点' }));
    expect(engine.transformSelection).not.toHaveBeenCalled();
    expect(screen.getByText('请先确认选区外影响，再应用变换。')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('确认同步更新选区外 1 个依赖对象'));
    fireEvent.click(screen.getByRole('button', { name: '应用到 2 个驱动点' }));
    expect(engine.transformSelection).toHaveBeenCalledWith(
      { kind: 'translate', dx: 1, dy: 0 },
      ['element:4:0'],
    );
  });

  it('keeps a construction-created canonical selection without opening the transform card', () => {
    const engine = engineFixture({
      selectionTargets: [
        {
          kind: 'entity',
          sourceRevision: 0,
          stableId: 'managed:reflection:point:R1',
          semanticEntityId: 'managed:reflection:point:R1',
          stmtIndex: 8,
          entityKind: 'point',
          refs: ['R1'],
        },
        {
          kind: 'entity',
          sourceRevision: 0,
          stableId: 'managed:reflection:segment:AR1',
          semanticEntityId: 'managed:reflection:segment:AR1',
          stmtIndex: 9,
          entityKind: 'element',
          refs: ['A', 'R1'],
        },
      ],
    });
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TikzSelectionTransform
        engine={engine}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );

    expect(screen.queryByRole('region', { name: '选区变换' })).toBeNull();
    expect(engine.selectionTargets).toHaveLength(2);
    expect(engine.setSelectionTargets).not.toHaveBeenCalled();

    // This rerender models the visibility request emitted by an explicit
    // marquee/modifier selection. The canonical selection itself is retained.
    rerender(
      <TikzSelectionTransform
        engine={engine}
        open
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByRole('region', { name: '选区变换' })).toBeTruthy();
    expect(screen.getByText('2 个对象')).toBeTruthy();
  });

  it('lets the user collapse the transform controls without clearing Inspector selection', () => {
    const engine = engineFixture();
    const onOpenChange = vi.fn();
    render(
      <TikzSelectionTransform
        engine={engine}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起选区变换' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(engine.setSelectionTargets).not.toHaveBeenCalled();
  });
});
