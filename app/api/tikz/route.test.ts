import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/client-ip', () => ({
  clientIp: vi.fn(async () => '127.0.0.1'),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRate: vi.fn(async () => ({ allowed: true, remaining: 19, resetMs: 60_000 })),
}));

vi.mock('@/lib/llm/sse-stream', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/llm/sse-stream')>();
  return {
    ...original,
    streamProvider: vi.fn(async (
      _provider,
      _messages,
      send: (token: string) => void,
    ) => {
      send('好的');
      return '```tikz\n\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}\n```';
    }),
  };
});

vi.mock('@/lib/provider/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/provider/settings')>();
  return {
    ...original,
    getEffectiveProvider: vi.fn(async () => ({
      apiKey: 'k',
      baseUrl: 'https://api.molamaker.cn',
      model: 'm',
      configured: true,
    })),
  };
});

import { checkRate } from '@/lib/rate-limit';
import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/tikz', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

describe('POST /api/tikz', () => {
  beforeEach(() => vi.clearAllMocks());

  it('build：SSE 含 model、token 与 tikzCode 帧，[DONE] 收尾', async () => {
    const response = await POST(request({
      mode: 'build',
      problem: '画三角形',
      history: [],
      provider: 'relay',
    }));
    const text = await response.text();
    expect(text).toContain('"model":"m"');
    expect(text).toContain('"token":"好的"');
    expect(text).toContain('"tikzCode"');
    expect(text).toContain('[DONE]');
  });

  it('repair：校验必需字段并可返回代码帧', async () => {
    expect((await POST(request({ mode: 'repair', provider: 'relay' }))).status).toBe(400);
    const response = await POST(request({
      mode: 'repair',
      provider: 'relay',
      tikzCode: '\\begin{tikzpicture}\\end{tikzpicture}',
      failures: ['未知引用'],
    }));
    expect(await response.text()).toContain('"tikzCode"');
  });

  it('非法 mode/provider → 400', async () => {
    expect((await POST(request({ mode: 'ask', provider: 'relay' }))).status).toBe(400);
    expect((await POST(request({ mode: 'build', problem: 'x', provider: 'evil' }))).status).toBe(400);
  });

  it('超过限流 → 429 并返回 Retry-After', async () => {
    vi.mocked(checkRate).mockResolvedValueOnce({ allowed: false, remaining: 0, resetMs: 5_000 });
    const response = await POST(request({ mode: 'build', problem: 'x', provider: 'relay' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('5');
  });
});
