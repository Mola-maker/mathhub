import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TikzEngine } from './use-tikz-engine';
import { TikzToolPalette } from './tikz-tool-palette';

afterEach(cleanup);

function engineFixture(selectionCount: number): TikzEngine {
  return {
    activeTool: 'select',
    selectionTargets: Array.from({ length: selectionCount }, (_, index) => ({
      kind: 'entity' as const,
      sourceRevision: 0,
      stableId: `element:${index}`,
      semanticEntityId: `element:${index}`,
      stmtIndex: index,
      entityKind: 'element' as const,
      refs: [`P${index}`],
    })),
    setActiveTool: vi.fn(),
  } as unknown as TikzEngine;
}

describe('TikzToolPalette selection transform entry', () => {
  it('keeps the explicit entry disabled until the user has a selection', () => {
    render(<TikzToolPalette engine={engineFixture(0)} />);

    fireEvent.click(screen.getByRole('button', { name: '变换' }));

    expect(
      (screen.getByRole('button', { name: '整体变换' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('opens the transform controls only after an intentional click', () => {
    const onSelectionTransformRequest = vi.fn();
    render(
      <TikzToolPalette
        engine={engineFixture(3)}
        onSelectionTransformRequest={onSelectionTransformRequest}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '变换' }));
    const entry = screen.getByRole('button', { name: '整体变换' });
    expect((entry as HTMLButtonElement).disabled).toBe(false);
    expect(entry.textContent).toContain('3');
    expect(onSelectionTransformRequest).not.toHaveBeenCalled();

    fireEvent.click(entry);

    expect(onSelectionTransformRequest).toHaveBeenCalledTimes(1);
  });
});
