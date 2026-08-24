import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentMessageWidgets,
  parseAgentMessageWidget,
} from './agent-message-widgets';

describe('AgentMessageWidgets', () => {
  it('keeps source code collapsed and separate from prose by default', () => {
    render(<AgentMessageWidgets
      widgets={[{
        kind: 'code-example',
        title: 'TikZ 示例',
        code: '\\draw (0,0)--(1,1);',
        lineCount: 1,
      }]}
      onLocateCanvas={vi.fn()}
      onOpenExactPreview={vi.fn()}
      onOpenSource={vi.fn()}
    />);
    const details = screen.getByText('TikZ 示例').closest('details');
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText('TikZ 示例'));
    expect(details?.open).toBe(true);
  });

  it('strictly parses supported widgets and rejects malformed payloads', () => {
    expect(parseAgentMessageWidget({
      kind: 'rejection',
      title: '画板未修改',
      detail: '协议冲突',
    })).toMatchObject({ kind: 'rejection' });
    expect(parseAgentMessageWidget({ kind: 'code-example', code: 42 })).toBeNull();
  });

  it('keeps problem-search cards closed for model output but admits same-origin host SSE', () => {
    const hostProblemSearch = {
      kind: 'problem-search',
      title: '找到 1 道几何题',
      query: 'nine-point circle',
      results: [{
        id: 'mathnet:1',
        source: 'mathnet',
        title: 'Nine-point circle',
        statementPreview: 'Triangle ABC has a nine-point circle.',
        sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=1',
        datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
        licenseId: 'CC-BY-4.0',
        contentHash: '0'.repeat(64),
        contentHashAlgorithm: 'sha256-utf8',
        contentHashScope: 'normalized-live-snapshot',
        admission: 'search-reference-only',
        rights: {
          sourceMaterialRights: 'conditional',
          redistribution: 'review-required',
          commercial: 'review-required',
          training: 'review-required',
        },
        hasImages: false,
        assetCount: 0,
        topics: ['Geometry'],
      }],
    };

    expect(parseAgentMessageWidget(hostProblemSearch)).toBeNull();
    expect(parseAgentMessageWidget(hostProblemSearch, 'model')).toBeNull();
    expect(parseAgentMessageWidget(hostProblemSearch, 'host-sse')).toMatchObject({
      kind: 'problem-search',
      results: [{ id: 'mathnet:1' }],
    });
  });
});
