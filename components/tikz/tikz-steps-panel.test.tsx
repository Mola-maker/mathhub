import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TikzStepsPanel } from './tikz-steps-panel';
import type { TikzEngine } from './use-tikz-engine';

const basis = {
  documentId: 'steps-doc',
  epoch: 'steps-epoch',
  revision: 2,
  sourceHash: '0123456789abcdef',
  kernelHash: 'kernel-2',
  projectionHash: 'projection-2',
  pluginSetDigest: 'plugins-2',
};

function engineFor(nextBasis = basis): TikzEngine {
  return {
    geometryDoc: { basis: nextBasis },
    scene: null,
    stmts: null,
    setSelection: vi.fn(),
  } as unknown as TikzEngine;
}

function flowFor(nextBasis = basis) {
  return {
    kind: 'geometry-flow' as const,
    title: '当前几何推导',
    basis: nextBasis,
    steps: [
      {
        id: 'given',
        title: '已知',
        explanation: '读取三角形。',
        entityRefs: ['point:A'],
        state: 'given' as const,
      },
      {
        id: 'goal',
        title: '结论',
        explanation: '完成 $M_aM_b=M_aM_c$ 的推导。',
        entityRefs: ['circle:nine-point'],
        state: 'goal' as const,
        proof: {
          claimId: 'goal',
          kind: 'concyclic' as const,
          status: 'formally-proven' as const,
          evidenceIds: ['constraint:on-circle'],
          tolerance: 1e-7,
          residual: 0,
        },
      },
    ],
  };
}

function renderPanel(nextEngine = engineFor(), nextFlow = flowFor(), onFlowFocus = vi.fn()) {
  return render(
    <TikzStepsPanel
      engine={nextEngine}
      flow={nextFlow}
      onReveal={vi.fn()}
      onFlowFocus={onFlowFocus}
      onShowSourceSteps={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('TikzStepsPanel GeometryFlow basis gate', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders no stale flow and never focuses it', () => {
    const onFlowFocus = vi.fn();
    renderPanel(engineFor({ ...basis, revision: 3 }), flowFor(), onFlowFocus);
    expect(screen.queryByRole('complementary', { name: '动态几何推导' })).toBeNull();
    expect(onFlowFocus).not.toHaveBeenCalled();
  });

  it('autoplay focuses after state transition, outside the React updater', () => {
    vi.useFakeTimers();
    const onFlowFocus = vi.fn();
    renderPanel(engineFor(), flowFor(), onFlowFocus);
    expect(onFlowFocus).toHaveBeenCalledWith(['point:A']);
    onFlowFocus.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '▶ 自动演示' }));
    act(() => {
      vi.advanceTimersByTime(1_800);
    });
    expect(onFlowFocus).toHaveBeenCalledTimes(1);
    expect(onFlowFocus).toHaveBeenCalledWith(['circle:nine-point']);
    expect(screen.getAllByText(/语义证明/u).length).toBeGreaterThan(0);
    expect(document.querySelector('.tz-steps__flow-explanation .katex')).toBeTruthy();
  });

  it('stops an active autoplay immediately when the GeometryDoc basis changes', () => {
    vi.useFakeTimers();
    const onFlowFocus = vi.fn();
    const view = render(
      <TikzStepsPanel
        engine={engineFor()}
        flow={flowFor()}
        onReveal={vi.fn()}
        onFlowFocus={onFlowFocus}
        onShowSourceSteps={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    onFlowFocus.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '▶ 自动演示' }));
    view.rerender(
      <TikzStepsPanel
        engine={engineFor({ ...basis, sourceHash: 'fedcba9876543210' })}
        flow={flowFor()}
        onReveal={vi.fn()}
        onFlowFocus={onFlowFocus}
        onShowSourceSteps={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('complementary', { name: '动态几何推导' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(3_600);
    });
    expect(onFlowFocus).not.toHaveBeenCalled();
  });
});
