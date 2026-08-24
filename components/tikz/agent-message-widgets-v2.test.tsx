import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentMessageWidgets,
  parseAgentMessageWidget,
} from './agent-message-widgets-v2';

const callbacks = {
  onLocateCanvas: vi.fn(),
  onOpenExactPreview: vi.fn(),
  onOpenSource: vi.fn(),
};

describe('AgentMessageWidgets v2', () => {
  it('accepts proof badges only from the same-origin host SSE boundary', () => {
    const widget = {
      kind: 'geometry-flow',
      title: 'Host proof',
      steps: [{
        id: 'goal', title: 'Goal', explanation: 'D, E, F are collinear.', state: 'goal',
        proof: {
          claimId: 'goal', kind: 'collinear', status: 'formally-proven',
          evidenceIds: ['constraint:collinear'], tolerance: 1e-7, residual: 0,
        },
      }],
    };
    expect(parseAgentMessageWidget(widget)).toBeNull();
    expect(parseAgentMessageWidget(widget, 'host-sse')).toMatchObject({
      kind: 'geometry-flow',
      steps: [{ proof: { status: 'formally-proven' } }],
    });
  });

  it('renders a sampled function widget with local zoom controls', () => {
    render(<AgentMessageWidgets {...callbacks} widgets={[{
      kind: 'function-plot',
      title: '函数交点',
      expression: 'y=x^2',
      series: [{
        label: 'f(x)',
        color: 'blue',
        points: [{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }],
      }],
    }]} />);
    expect(screen.getByRole('img', { name: '函数交点 函数图' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('函数图缩放'), { target: { value: '2' } });
    expect((screen.getByLabelText('函数图缩放') as HTMLInputElement).value).toBe('2');
  });

  it('switches geometry proof steps without exposing TikZ code', () => {
    const { container } = render(<AgentMessageWidgets {...callbacks} widgets={[{
      kind: 'geometry-flow',
      title: '九点圆证明流程',
      steps: [
        { id: 'given', title: '已知', explanation: '给定三角形 ABC。', state: 'given' },
        {
          id: 'midpoints',
          title: '作中点',
          explanation: '由 $M_a=\\frac{B+C}{2}$ 作中点。',
          state: 'construction',
          proof: {
            claimId: 'midpoint-ma',
            kind: 'midpoint',
            status: 'numerically-satisfied',
            evidenceIds: [],
            tolerance: 1e-7,
            residual: 2e-10,
          },
        },
      ],
    }]} />);
    expect(screen.getByText('给定三角形 ABC。')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /作中点/u }));
    expect(container.querySelector('.tz-geometry-flow__explanation .katex')).toBeTruthy();
    expect(screen.getByText('数值验证')).toBeTruthy();
    expect(screen.getByText(/归一化残差/u)).toBeTruthy();
    expect(document.body.textContent).not.toContain('\\draw');
  });

  it('renders a host construction result with accessible follow-up actions', () => {
    const onLocateCanvas = vi.fn();
    render(<AgentMessageWidgets
      {...callbacks}
      onLocateCanvas={onLocateCanvas}
      widgets={[{
        kind: 'mutation',
        title: '九点圆已建立',
        detail: 'Canvas、TikZ 与 GeometryDoc 已同步。',
        revision: 4,
      }]}
    />);

    expect(screen.getByRole('status', { name: '构造结果' })).toBeTruthy();
    expect(screen.getByText('revision 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '定位画板' }));
    expect(onLocateCanvas).toHaveBeenCalledTimes(1);
  });

  it('focuses semantic entities when a proof-flow tab becomes active', () => {
    const onFocusEntityRefs = vi.fn();
    render(<AgentMessageWidgets {...callbacks} onFocusEntityRefs={onFocusEntityRefs} widgets={[{
      kind: 'geometry-flow',
      title: 'Nine-point circle proof',
      steps: [
        { id: 'given', title: 'Given', explanation: 'Triangle ABC.', state: 'given' },
        {
          id: 'midpoints',
          title: 'Midpoints',
          explanation: 'Construct the three side midpoints.',
          state: 'construction',
          entityRefs: ['point:M_a', 'point:M_b', 'point:M_c'],
        },
      ],
    }]} />);
    fireEvent.click(screen.getByRole('tab', { name: /Midpoints/u }));
    expect(onFocusEntityRefs).toHaveBeenCalledWith([
      'point:M_a',
      'point:M_b',
      'point:M_c',
    ]);
  });

  it('shows proof-step provenance and compact source identity without expanding TikZ', () => {
    render(<AgentMessageWidgets {...callbacks} widgets={[{
      kind: 'geometry-flow',
      title: 'Attributed proof',
      source: 'MathNet',
      sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=fixture',
      datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
      license: 'Creative Commons Attribution 4.0 International',
      licenseId: 'CC-BY-4.0',
      contentHash: '0123456789abcdef',
      contentHashAlgorithm: 'fnv1a64-utf8',
      solutionProvenance: 'dataset-provided',
      steps: [{
        id: 'source-step',
        title: 'Source construction',
        explanation: 'Construct the auxiliary circle.',
        provenance: 'source-solution',
        tikz: '\\draw (A) circle (1);',
        state: 'construction',
      }],
    }]} />);
    expect(screen.getByText('题源解答')).toBeTruthy();
    expect(screen.getByText(/CC-BY-4\.0/u)).toBeTruthy();
    expect(screen.getByText(/内容指纹 01234567/u)).toBeTruthy();
    expect(screen.getByText('本步源码已收纳到右侧动态推导面板。')).toBeTruthy();
    expect(screen.queryByText('\\draw (A) circle (1);')).toBeNull();
  });

  it('renders attributed problem candidates without exposing solutions or write controls', () => {
    render(<AgentMessageWidgets {...callbacks} widgets={[{
      kind: 'problem-search',
      title: '找到 1 道几何题',
      query: 'Simson line',
      results: [{
        id: 'olympiadbench:42',
        source: 'olympiadbench',
        title: 'Simson line problem',
        statementPreview: 'Point P lies on the circumcircle of triangle ABC.',
        sourceUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
        datasetUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
        licenseId: 'Apache-2.0',
        contentHash: '0123456789abcdef'.repeat(4),
        contentHashAlgorithm: 'sha256-utf8',
        contentHashScope: 'normalized-live-snapshot',
        admission: 'search-reference-only',
        rights: {
          sourceMaterialRights: 'review-required',
          redistribution: 'review-required',
          commercial: 'review-required',
          training: 'review-required',
        },
        hasImages: true,
        assetCount: 1,
        topics: ['Geometry', 'Triangle'],
      }],
      sourceStatus: [{
        id: 'olympiadbench',
        enabled: true,
        accessMode: 'live-search',
        sourceMaterialRights: 'review-required',
        detail: 'available',
      }],
    }]} />);
    expect(screen.getByText('Simson line problem')).toBeTruthy();
    expect(screen.getAllByText('OlympiadBench')).toHaveLength(2);
    expect(screen.getByText('含 1 个题图引用')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看题源' }).getAttribute('href'))
      .toBe('https://huggingface.co/datasets/Hothan/OlympiadBench');
    expect(document.body.textContent).not.toContain('not exposed solution');
    expect(screen.queryByText('应用')).toBeNull();
  });
});
