import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioDocument } from '@/lib/tikz/document/studio-document';
import { TikzCodePanel } from './tikz-code-panel';

afterEach(() => cleanup());

describe('TikzCodePanel', () => {
  it('渲染 StudioDocument 初始源码', () => {
    const studioDocument = new StudioDocument('\\draw (A) -- (B);');
    render(<TikzCodePanel document={studioDocument} issues={[]} />);
    expect(screen.getByTestId('tikz-cm').textContent).toContain('\\draw (A) -- (B);');
    expect(screen.getByRole('textbox', { name: 'TikZ 源码编辑器' })).toBeTruthy();
  });

  it('AI/画布补丁经 CodeMirror transaction 同步并保留 origin', () => {
    const studioDocument = new StudioDocument('A');
    render(<TikzCodePanel document={studioDocument} issues={[]} />);
    act(() => {
      studioDocument.replaceSource('B', 'ai');
    });
    expect(screen.getByTestId('tikz-cm').textContent).toContain('B');
    expect(studioDocument.getSnapshot()).toMatchObject({
      source: 'B',
      revision: 1,
      lastTransaction: { origin: 'ai' },
    });
  });

  it('issue 渲染为 lint 标记（含 message）', () => {
    const studioDocument = new StudioDocument('\\draw (A)');
    render(
      <TikzCodePanel
        document={studioDocument}
        issues={[{
          severity: 'error',
          message: '未闭合',
          range: { start: 0, end: 5 },
        }]}
      />,
    );
    expect(document.querySelector('.cm-lintRange-error')).toBeTruthy();
  });
});
