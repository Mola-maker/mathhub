import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TikzStudio } from './tikz-studio';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubCatalogs() {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.includes('/api/tikz/providers')) {
      return Response.json({ available: ['anthropic'], providers: { anthropic: { configured: true } } });
    }
    if (path.includes('/api/tikz/models')) {
      return Response.json({
        models: [{ id: 'claude-sonnet-4-6', probe: { ok: true } }],
        defaultModel: 'claude-sonnet-4-6',
        source: 'fallback',
      });
    }
    return new Response('data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch);
}

describe('TikzStudio', () => {
  it('首页渲染第二张 tile，点击打开 studio（含画布与代码面板）', async () => {
    stubCatalogs();
    render(<TikzStudio />);
    expect(screen.getByText('TikZ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开 TikZ Studio' }));
    expect(await screen.findByTestId('tikz-canvas')).toBeTruthy();
    expect(screen.getByTestId('tikz-code-panel')).toBeTruthy();
    expect(screen.getByText(/构造有效/)).toBeTruthy();
  });

  it('键盘可打开并用 Escape 关闭', async () => {
    stubCatalogs();
    render(<TikzStudio />);
    const tile = screen.getByRole('button', { name: '打开 TikZ Studio' });
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'TikZ Studio' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'TikZ Studio' })).toBeNull();
  });
});
