import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveProvider } from '@/lib/provider/settings';
import { makeSseStream, streamOpenAICompatible } from './sse-stream';

const relayConfig: EffectiveProvider = {
  apiKey: 'test-key',
  baseUrl: 'https://api.molamaker.cn',
  model: 'test-model',
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
});

describe('streamOpenAICompatible', () => {
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
