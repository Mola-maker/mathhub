import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveProvider } from '@/lib/provider/settings';
import { resetProviderTransportHealth } from '@/lib/provider/transport-health';
import { makeSseStream, streamOpenAICompatible } from './sse-stream';

const relayConfig: EffectiveProvider = {
  apiKey: 'test-key',
  baseUrl: 'https://api.molamaker.cn',
  model: 'test-model',
  visionModel: '',
  configured: true,
};

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  resetProviderTransportHealth();
  vi.unstubAllGlobals();
});

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value, { stream: true }); }
  return out;
}

describe('makeSseStream', () => {
  it('token 帧 + 事件帧 + [DONE] 依次写出', async () => {
    const res = makeSseStream(async (send, sendEvent) => {
      send('你好');
      sendEvent({ tikzCode: '\\draw (0,0);' });
    });
    const text = await readAll(res);
    expect(text).toBe('data: {"token":"你好"}\n\ndata: {"tikzCode":"\\\\draw (0,0);"}\n\ndata: [DONE]\n\n');
  });

  it('gen 抛错时发出 {error} 帧后正常结束', async () => {
    const res = makeSseStream(async () => { throw new Error('boom'); });
    const text = await readAll(res);
    expect(text).toContain('"error":"boom"');
    expect(text).toContain('[DONE]');
  });

  it('rejects an oversized event without emitting a partial proposal', async () => {
    const res = makeSseStream(async (_send, sendEvent) => {
      sendEvent({ proposal: 'x'.repeat(70 * 1024) });
    });
    const text = await readAll(res);
    expect(text).toContain('SSE event exceeded');
    expect(text).not.toContain('"proposal"');
    expect(text).toContain('[DONE]');
  });

  it('aborts the generator when the response reader is canceled', async () => {
    let aborted = false;
    const res = makeSseStream(async (send, _sendEvent, signal) => {
      send('started');
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel('test disconnect');
    await vi.waitFor(() => expect(aborted).toBe(true));
  });
});

describe('streamOpenAICompatible', () => {
  it('retries one transient fetch failure before any provider bytes are received', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(chunkedResponse([
        'data: {"choices":[{"delta":{"content":"恢复成功"}}]}\n\n',
        'data: [DONE]\n\n',
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const tokens: string[] = [];
    await expect(streamOpenAICompatible(
      [{ role: 'user', content: '继续' }],
      (token) => tokens.push(token),
      relayConfig,
      'test-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz-agent',
    )).resolves.toBe('恢复成功');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokens).toEqual(['恢复成功']);
  });

  it('reports a bounded provider availability error after both connection attempts fail', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(streamOpenAICompatible(
      [{ role: 'user', content: '解释当前图形' }],
      vi.fn(),
      relayConfig,
      'test-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz-agent',
    )).rejects.toThrow('api.molamaker.cn 上游连接失败');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(streamOpenAICompatible(
      [{ role: 'user', content: '第二轮继续' }],
      vi.fn(),
      relayConfig,
      'test-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz-agent',
    )).rejects.toThrow('连续传输失败后已暂停重试');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests and reports provider prefix-cache usage', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => chunkedResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":3,"total_tokens":123,"prompt_cache_hit_tokens":96,"prompt_cache_miss_tokens":24}}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const onUsage = vi.fn();

    await streamOpenAICompatible(
      [{ role: 'user', content: 'draw' }],
      vi.fn(), relayConfig, 'test-model', 'relay',
      'api.molamaker.cn', 'stable system', 'tikz-agent',
      { onUsage },
    );

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      stream_options?: { include_usage?: boolean };
    };
    expect(request.stream_options).toEqual({ include_usage: true });
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 120,
      completionTokens: 3,
      totalTokens: 123,
      cacheReadTokens: 96,
      cacheMissTokens: 24,
    });
  });

  it('reports an empty upstream stream instead of silently succeeding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      ': keep-alive\n\n',
      'data: [DONE]\n\n',
    ])));
    await expect(streamOpenAICompatible(
      [{ role: 'user', content: 'draw' }],
      vi.fn(), relayConfig, 'test-model', 'relay',
      'api.molamaker.cn', 'system',
    )).rejects.toThrow('api.molamaker.cn: empty stream');
  });

  it('rejects an oversized upstream line before retaining the full response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      `data: ${'x'.repeat(70 * 1024)}`,
    ])));
    await expect(streamOpenAICompatible(
      [{ role: 'user', content: 'draw' }],
      vi.fn(), relayConfig, 'test-model', 'relay',
      'api.molamaker.cn', 'system',
    )).rejects.toThrow('oversized line');
  });

  it('honours an already aborted agent run signal', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if ((init?.signal as AbortSignal | undefined)?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      return chunkedResponse([]);
    }));
    await expect(streamOpenAICompatible(
      [{ role: 'user', content: 'draw' }],
      vi.fn(), relayConfig, 'test-model', 'relay',
      'api.molamaker.cn', 'system', 'tikz-agent',
      { signal: controller.signal },
    )).rejects.toThrow();
  });

  it('解析 CRLF，并保留末尾没有空行的最后一帧', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      'data: {"choices":[{"delta":{"content":"九点"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"圆"}}]}',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: '画一个九点圆' }],
      (token) => tokens.push(token),
      relayConfig,
      'test-model',
      'relay',
      'api.molamaker.cn',
      'system',
    );

    expect(text).toBe('九点圆');
    expect(tokens).toEqual(['九点', '圆']);
  });

  it('relay 的 reasoning-only 响应可恢复 GeoGebra 交付内容', async () => {
    const reasoning = '已完成构造。\\n```geogebra\\nA=(0,0)\\n```';
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n\n`,
      'data: [DONE]\n\n',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: '画图' }],
      (token) => tokens.push(token),
      relayConfig,
      'thinking-model',
      'relay',
      'api.molamaker.cn',
      'system',
    );

    expect(text).toContain('```geogebra');
    expect(tokens.join('')).toBe(text);
  });

  it('TikZ 路径可从 reasoning-only 响应恢复 tikzpicture', async () => {
    const reasoning = [
      '先计算三角形的九点圆。',
      '```tikz',
      '\\begin{tikzpicture}',
      '\\draw (0,0) circle (1);',
      '\\end{tikzpicture}',
      '```',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning_content: reasoning } }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: '画一个九点圆' }],
      (token) => tokens.push(token),
      relayConfig,
      'thinking-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz',
    );

    expect(text).toContain('```tikz');
    expect(text).toContain('\\begin{tikzpicture}');
    expect(tokens.join('')).toBe(text);
  });

  it('reasoning-only build 只恢复显式 fenced tikz-patch', async () => {
    const patch = {
      schemaVersion: 'ai-patch-proposal/v1',
      proposalId: 'proposal-1',
      idempotencyKey: 'proposal-1',
      basis: {
        documentId: 'document-1',
        epoch: 'epoch-1',
        revision: 0,
        sourceHash: 'hash',
        sourceId: 'document-1:tikz',
        hashAlgorithm: 'sha256-utf8',
      },
      focusBindingIds: ['binding:document:tikzpicture-body-end'],
      readBindingIds: ['binding:document:tikzpicture-body-end'],
      operations: [],
    };
    const reasoning = `内部推理\n\`\`\`tikz-patch\n${JSON.stringify(patch)}\n\`\`\``;
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning_content: reasoning } }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: '继续当前构造' }],
      (token) => tokens.push(token),
      relayConfig,
      'thinking-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz-patch',
    );

    expect(text).toContain('```tikz-patch');
    expect(text).toContain('"schemaVersion": "ai-patch-proposal/v1"');
    expect(text).not.toContain('```tikz\n');
    expect(tokens.join('')).toBe(text);
  });

  it('reasoning-only agent run never promotes an internal tool envelope', async () => {
    const toolCall = {
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'inspect-1',
      name: 'inspect-geometry',
      arguments: { refs: ['A'], depth: 1 },
    };
    const reasoning = `internal reasoning\n\`\`\`tikz-agent-tool\n${JSON.stringify(toolCall)}\n\`\`\``;
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning_content: reasoning } }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: 'Inspect A first.' }],
      (token) => tokens.push(token),
      relayConfig,
      'thinking-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz-agent',
    );

    expect(text).not.toContain('```tikz-agent-tool');
    expect(text).not.toContain('"callId":"inspect-1"');
    expect(text).toContain('内部推理不会被执行');
    expect(tokens).toEqual([]);
  });

  it('reasoning-only agent run never exposes ambiguous executable envelopes', async () => {
    const reasoning = [
      '```tikz-agent-tool',
      '{"schemaVersion":"tikz-agent-tool-call/v1","callId":"inspect-2","name":"inspect-geometry","arguments":{"refs":[]}}',
      '```',
      '```tikz-action',
      '\\draw (0,0)--(1,1);',
      '```',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n\n`,
      'data: [DONE]\n\n',
    ])));
    const text = await streamOpenAICompatible(
      [{ role: 'user', content: 'Inspect then draw.' }],
      () => undefined,
      relayConfig,
      'thinking-model',
      'relay',
      'api.molamaker.cn',
      'system',
      'tikz-agent',
    );
    expect(text).not.toContain('```tikz-agent-tool');
    expect(text).not.toContain('```tikz-action');
    expect(text).toContain('内部推理不会被执行');
  });

  it('兼容 relay 忽略 stream=true 后返回的单个 JSON message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      '{"choices":[{"message":{"content":"完整回复"},"finish_reason":"stop"}]}',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: '画图' }],
      (token) => tokens.push(token),
      relayConfig,
      'test-model',
      'relay',
      'api.molamaker.cn',
      'system',
    );

    expect(text).toBe('完整回复');
    expect(tokens).toEqual(['完整回复']);
  });

  it('忽略 relay 在 delta 之后重复发送的完整 message 快照', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse([
      'data: {"choices":[{"delta":{"content":"九点"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"圆"}}]}\n\n',
      'data: {"choices":[{"message":{"content":"九点圆"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])));
    const tokens: string[] = [];

    const text = await streamOpenAICompatible(
      [{ role: 'user', content: '画图' }],
      (token) => tokens.push(token),
      relayConfig,
      'test-model',
      'relay',
      'api.molamaker.cn',
      'system',
    );

    expect(text).toBe('九点圆');
    expect(tokens).toEqual(['九点', '圆']);
  });
});
