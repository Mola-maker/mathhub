import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assistantFallbackForTikzAgentTerminal,
  claimTikzAgentTurn,
  configuredProviderDefaultModel,
  explicitGeometryAiContextRefs,
  inferredGeometryAiContextRefs,
  isCommittedGeometryProjection,
  isVisualAuditAvailable,
  reduceTikzStudioAgentStep,
  reduceTikzStudioAgentWidget,
  reduceTikzStudioAssistantContent,
  TikzStudio,
  type TikzStudioMessage,
} from './tikz-studio';
import { TIKZ_PLUGIN_SET_DIGEST } from '@/lib/tikz/ir';
import { tikzAgentEvent } from '@/lib/tikz/agent/protocol';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubCatalogs() {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.includes('/api/tikz/providers')) {
      return Response.json({ available: ['relay'], providers: { relay: { configured: true } } });
    }
    if (path.includes('/api/tikz/models')) {
      return Response.json({
        models: [{ id: 'claude-sonnet-4-6' }],
        defaultModel: 'claude-sonnet-4-6',
        source: 'api',
      });
    }
    return new Response('data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch);
}

describe('TikzStudio', () => {
  it('accepts only a safe configured default model for immediate fallback', () => {
    expect(configuredProviderDefaultModel({
      providers: { relay: { configured: true, defaultModel: 'Minimax-M3' } },
    })).toBe('Minimax-M3');
    expect(configuredProviderDefaultModel({
      providers: { relay: { configured: true, defaultModel: 'bad model id' } },
    })).toBe('');
    expect(configuredProviderDefaultModel({
      providers: { relay: { configured: false, defaultModel: 'Minimax-M3' } },
    })).toBe('');
  });

  it('keeps chat usable while the live model catalog is still pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes('/api/tikz/providers')) {
        return Response.json({
          available: ['relay'],
          providers: {
            relay: {
              configured: true,
              defaultModel: 'Minimax-M3',
              visionConfigured: false,
            },
          },
        });
      }
      if (path.includes('/api/tikz/models')) {
        return await new Promise<Response>(() => undefined);
      }
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch);

    render(<TikzStudio startOpen />);

    expect(await screen.findByRole('option', {
      name: 'Minimax-M3 (配置默认)',
    })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('几何构造描述'), {
      target: { value: '解释当前图形' },
    });
    expect((screen.getByRole('button', { name: '发送 ↵' }) as HTMLButtonElement).disabled)
      .toBe(false);
    expect(screen.getByText('正在读取 api.molamaker.cn 模型目录…')).toBeTruthy();
  });

  it('projects terminal-only failures into readable chat instead of an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes('/api/tikz/providers')) {
        return Response.json({
          available: ['relay'],
          providers: { relay: { configured: true, visionConfigured: false } },
        });
      }
      if (path.includes('/api/tikz/models')) {
        return Response.json({
          models: [{ id: 'Minimax-M3' }],
          defaultModel: 'Minimax-M3',
          source: 'api',
        });
      }
      const failed = tikzAgentEvent('run-provider-failed', 0, {
        type: 'run.failed',
        title: 'AI 运行失败',
        detail: '上游模型服务暂时不可达',
        outcome: 'failed',
      });
      return new Response(
        `data: ${JSON.stringify({ agentEvent: failed })}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch);

    const { container } = render(<TikzStudio startOpen />);
    const composer = await screen.findByLabelText('几何构造描述');
    await screen.findByRole('option', { name: 'Minimax-M3' });
    fireEvent.change(composer, { target: { value: '解释当前图形' } });
    fireEvent.click(screen.getByRole('button', { name: '发送 ↵' }));

    expect(await screen.findByText('请求失败：上游模型服务暂时不可达')).toBeTruthy();
    expect(container.querySelector('.tz-msg--assistant .tz-answer__empty')).toBeNull();
  });

  it('does not present a terminal-only answer as successful model prose', () => {
    expect(assistantFallbackForTikzAgentTerminal(tikzAgentEvent('run-answer', 2, {
      type: 'run.completed',
      title: '已完成回答',
      outcome: 'answer',
    }))).toContain('没有返回可展示的最终答复');
    expect(assistantFallbackForTikzAgentTerminal(tikzAgentEvent('run-mutation', 3, {
      type: 'run.completed',
      title: '本轮操作完成',
      outcome: 'mutation',
    }))).toBe('画板与 TikZ 源码的修改已完成。');
  });

  it('admits only one foreground Agent turn until the owner releases it', () => {
    const admission = { current: null as string | null };
    expect(claimTikzAgentTurn(admission, 'turn-a')).toBe(true);
    expect(claimTikzAgentTurn(admission, 'turn-b')).toBe(false);
    expect(admission.current).toBe('turn-a');
    admission.current = null;
    expect(claimTikzAgentTurn(admission, 'turn-b')).toBe(true);
  });

  it('routes late events to their bound run instead of the newest assistant turn', () => {
    const initial: TikzStudioMessage[] = [
      { id: 'user:a', role: 'user', content: 'first' },
      { id: 'assistant:a', role: 'assistant', content: '' },
      { id: 'user:b', role: 'user', content: 'second' },
      { id: 'assistant:b', role: 'assistant', content: '' },
    ];
    const firstStarted = reduceTikzStudioAgentStep(
      initial,
      tikzAgentEvent('run-a', 0, { type: 'run.started', title: 'first started' }),
      'assistant:a',
    );
    const secondStarted = reduceTikzStudioAgentStep(
      firstStarted,
      tikzAgentEvent('run-b', 0, { type: 'run.started', title: 'second started' }),
      'assistant:b',
    );
    const afterLateFirstEvent = reduceTikzStudioAgentStep(
      secondStarted,
      tikzAgentEvent('run-a', 1, { type: 'context.read', title: 'late first event' }),
      'assistant:b',
    );

    expect(afterLateFirstEvent[1]?.run?.steps.map((step) => step.title))
      .toEqual(['first started', 'late first event']);
    expect(afterLateFirstEvent[3]?.run?.steps.map((step) => step.title))
      .toEqual(['second started']);
    expect(reduceTikzStudioAgentStep(
      afterLateFirstEvent,
      tikzAgentEvent('run-c', 0, { type: 'run.started', title: 'foreign run' }),
      'assistant:a',
    )).toBe(afterLateFirstEvent);
  });

  it('does not let stale tokens or VLM widgets fall through to a newer turn', () => {
    const messages: TikzStudioMessage[] = [
      { id: 'assistant:a', role: 'assistant', content: 'first' },
      { id: 'assistant:b', role: 'assistant', content: 'second' },
    ];
    const withLateToken = reduceTikzStudioAssistantContent(
      messages,
      'assistant:a',
      (content) => `${content} late`,
    );
    const withLateWidget = reduceTikzStudioAgentWidget(
      withLateToken,
      {
        kind: 'mutation',
        title: 'first audit',
        detail: 'belongs to the first turn',
        revision: 1,
      },
      'assistant:a',
    );

    expect(withLateWidget[0]?.content).toBe('first late');
    expect(withLateWidget[0]?.widgets?.[0]?.kind).toBe('mutation');
    expect(withLateWidget[1]).toEqual(messages[1]);
    expect(reduceTikzStudioAssistantContent(
      withLateWidget,
      'assistant:evicted',
      () => 'must be discarded',
    )).toBe(withLateWidget);
  });

  it('upserts one VLM card by work-item identity and rejects terminal regression', () => {
    const initial: TikzStudioMessage[] = [
      { id: 'assistant:a', role: 'assistant', content: 'committed' },
    ];
    const basis = {
      documentId: 'document-1',
      epoch: 'epoch-1',
      sourceId: 'document-1:tikz',
      revision: 3,
      sourceHash: 'source-hash',
      pluginSetDigest: 'plugin-set',
    };
    const pending = {
      kind: 'visual-audit' as const,
      title: 'VLM 视觉复核',
      status: 'pending' as const,
      summary: 'checking',
      observations: [],
      workItem: {
        schemaVersion: 'tikz-async-work-item/v1' as const,
        itemId: 'visual-audit:1',
        kind: 'visual-audit' as const,
        basis,
        status: 'running' as const,
        requestedAt: 1,
        updatedAt: 1,
        ownerMessageId: 'assistant:a',
      },
    };
    const withPending = reduceTikzStudioAgentWidget(initial, pending, 'assistant:a');
    const ready = {
      ...pending,
      status: 'passed' as const,
      summary: 'matched',
      workItem: {
        ...pending.workItem,
        status: 'ready' as const,
        updatedAt: 2,
        completedAt: 2,
      },
    };
    const withReady = reduceTikzStudioAgentWidget(withPending, ready, 'assistant:a');
    expect(withReady[0]?.widgets).toHaveLength(1);
    expect(withReady[0]?.widgets?.[0]).toMatchObject({
      status: 'passed',
      workItem: { status: 'ready' },
    });

    const lateRunning = reduceTikzStudioAgentWidget(
      withReady,
      { ...pending, workItem: { ...pending.workItem, updatedAt: 3 } },
      'assistant:a',
    );
    expect(lateRunning).toBe(withReady);
  });

  it('keeps the configured model usable when catalog refresh fails and can refresh again', async () => {
    let modelCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes('/api/tikz/providers')) {
        return Response.json({
          available: ['relay'],
          providers: { relay: { configured: true, visionConfigured: false } },
        });
      }
      if (path.includes('/api/tikz/models')) {
        modelCalls += 1;
        return modelCalls === 1
          ? Response.json({
            models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3 (配置默认)' }],
            defaultModel: 'MiniMax-M3',
            source: 'configured-fallback',
            listError: '暂时无法刷新完整模型目录；正在使用 .env.local 中明确配置的默认模型',
          })
          : Response.json({
            models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3' }],
            defaultModel: 'MiniMax-M3',
            source: 'api',
          });
      }
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch);

    render(<TikzStudio startOpen />);

    expect(await screen.findByRole('option', { name: 'MiniMax-M3 (配置默认)' })).toBeTruthy();
    expect(screen.getByText(/暂时无法刷新完整模型目录/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }));

    await waitFor(() => expect(modelCalls).toBe(2));
    expect(await screen.findByRole('option', { name: 'MiniMax-M3' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/暂时无法刷新完整模型目录/)).toBeNull();
    });
  });

  it('stops the active Agent turn and recovers its durable cancellation terminal', async () => {
    let buildSignal: AbortSignal | undefined;
    let replayCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = String(url);
      if (path.includes('/api/tikz/providers')) {
        return Response.json({
          available: ['relay'],
          providers: { relay: { configured: true, visionConfigured: false } },
        });
      }
      if (path.includes('/api/tikz/models')) {
        return Response.json({
          models: [{ id: 'claude-sonnet-4-6' }],
          defaultModel: 'claude-sonnet-4-6',
          source: 'api',
        });
      }
      if (path.includes('/api/tikz/runs/run-cancel')) {
        replayCalls += 1;
        const terminal = tikzAgentEvent('run-cancel', 1, {
          type: 'run.completed',
          title: '本轮已取消，画板未改变',
          outcome: 'unapplied-candidate',
        });
        return Response.json({
          schemaVersion: 'tikz-agent-run-replay/v1',
          runId: 'run-cancel',
          events: replayCalls === 1 ? [] : [terminal],
          proposal: null,
          verificationPending: false,
          terminal: replayCalls === 1 ? null : terminal,
        });
      }
      buildSignal = init?.signal ?? undefined;
      const started = tikzAgentEvent('run-cancel', 0, {
        type: 'run.started',
        title: '正在理解你的请求',
      });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({
              agentEvent: started,
              agentRunRecovery: {
                schemaVersion: 'tikz-agent-run-recovery/v1',
                runId: 'run-cancel',
                resumeToken: 'resume-token',
              },
            })}\n\n`,
          ));
          buildSignal?.addEventListener('abort', () => {
            controller.error(buildSignal?.reason ?? new DOMException('cancelled', 'AbortError'));
          }, { once: true });
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    }) as unknown as typeof fetch);

    render(<TikzStudio startOpen />);
    const composer = await screen.findByLabelText('几何构造描述');
    await screen.findByRole('option', { name: 'claude-sonnet-4-6' });
    fireEvent.change(composer, { target: { value: '解释九点圆' } });
    fireEvent.click(screen.getByRole('button', { name: '发送 ↵' }));

    fireEvent.click(await screen.findByRole('button', { name: '停止 ■' }));
    await waitFor(() => expect(buildSignal?.aborted).toBe(true));
    expect(await screen.findByText(/本轮已取消并恢复服务端终态/)).toBeTruthy();
    expect(replayCalls).toBe(2);
    expect(await screen.findByRole('button', { name: '发送 ↵' })).toBeTruthy();
  });

  it('only enables visual audits when the relay advertises a dedicated vision model', () => {
    expect(isVisualAuditAvailable({
      providers: { relay: { configured: true, visionConfigured: true } },
    })).toBe(true);
    expect(isVisualAuditAvailable({
      providers: { relay: { configured: true, visionConfigured: false } },
    })).toBe(false);
    expect(isVisualAuditAvailable({ available: ['relay'] })).toBe(false);
  });

  it('keeps the selected semantic circle in AI focus even when display refs only contain its center', () => {
    expect(explicitGeometryAiContextRefs(
      ['O'],
      'element:2:0',
      [],
    )).toEqual(['O', 'element:2:0']);
  });

  it('adds a uniquely named two-point edge when the user explicitly names its endpoints', () => {
    const entities = [
      { id: 'point:A', kind: 'point', name: 'A' },
      { id: 'point:C', kind: 'point', name: 'C' },
      {
        id: 'element:14:9',
        kind: 'polyline',
        parameters: { references: ['A', 'C'] },
      },
    ];
    expect(inferredGeometryAiContextRefs('把 A--C 改成紫色实线', entities))
      .toEqual(['A', 'C', 'element:14:9']);
    expect(inferredGeometryAiContextRefs('只解释 A 和 C，不修改线条', entities))
      .toEqual(['A', 'C']);
    expect(inferredGeometryAiContextRefs('Add a circle', entities))
      .toEqual([]);
  });

  it('resolves a nine-point-circle follow-up to the managed circle semantic entity', () => {
    const entities = [
      { id: 'point:A', kind: 'point', name: 'A' },
      {
        id: 'managed:npc:entity:nine-point-center',
        kind: 'point',
        name: 'N',
        tags: ['derived', 'nine-point-circle', 'center'],
        metadata: { constructionKind: 'nine-point-circle' },
      },
      {
        id: 'managed:npc:entity:nine-point-circle',
        kind: 'circle',
        tags: ['derived', 'nine-point-circle', 'through-nine-points'],
        metadata: { constructionKind: 'nine-point-circle' },
      },
    ];

    expect(inferredGeometryAiContextRefs(
      '\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272\u5e76\u52a0\u7c97',
      entities,
    )).toEqual(['managed:npc:entity:nine-point-circle']);
  });

  it('includes the declared center when labeling the unique nine-point circle', () => {
    const entities = [
      {
        id: 'managed:npc:entity:nine-point-center',
        kind: 'point',
        name: 'N',
        tags: ['derived', 'nine-point-circle', 'center'],
      },
      {
        id: 'managed:npc:entity:nine-point-circle',
        kind: 'circle',
        tags: ['derived', 'nine-point-circle', 'through-nine-points'],
      },
    ];

    expect(inferredGeometryAiContextRefs(
      '\u7ed9\u4e5d\u70b9\u5706\u589e\u52a0 label\uff0c\u5199\u4e0a\u4e5d\u70b9\u5706',
      entities,
    )).toEqual([
      'managed:npc:entity:nine-point-circle',
      'managed:npc:entity:nine-point-center',
    ]);
  });

  it('does not guess between multiple nine-point-circle constructions', () => {
    const entities = [
      {
        id: 'managed:npc-1:entity:circle',
        kind: 'circle',
        tags: ['nine-point-circle'],
      },
      {
        id: 'managed:npc-2:entity:circle',
        kind: 'circle',
        tags: ['nine-point-circle'],
      },
    ];

    expect(inferredGeometryAiContextRefs(
      '\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272',
      entities,
    )).toEqual([]);
  });

  it('waits for source, revision, and GeometryDoc to converge before post-commit verification', () => {
    const engine = {
      revision: 3,
      code: '\\coordinate (A) at (1,2);',
      geometryDoc: {
        basis: {
          revision: 3,
          pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
        },
      },
    } as Parameters<typeof isCommittedGeometryProjection>[0];
    expect(isCommittedGeometryProjection(
      engine,
      3,
      '\\coordinate (A) at (1,2);',
    )).toBe(true);
    expect(isCommittedGeometryProjection(engine, 2, engine.code)).toBe(false);
    expect(isCommittedGeometryProjection(engine, 3, '\\coordinate (A) at (9,9);'))
      .toBe(false);
  });

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

  it('keeps the transform capsule hidden for an ordinary canvas click and opens it for explicit select-all', async () => {
    stubCatalogs();
    render(<TikzStudio startOpen />);
    const canvas = await screen.findByRole('img', { name: 'TikZ 几何构造画布' });
    Object.defineProperties(canvas, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      },
    });

    fireEvent.pointerDown(canvas, {
      pointerId: 17,
      button: 0,
      clientX: 16,
      clientY: 16,
    });
    expect(canvas.getAttribute('data-interaction-phase')).not.toBe('idle');
    fireEvent.pointerUp(canvas, {
      pointerId: 17,
      button: 0,
      clientX: 16,
      clientY: 16,
    });
    expect(canvas.getAttribute('data-interaction-phase')).toBe('idle');
    expect(screen.queryByRole('region', { name: '选区变换' })).toBeNull();

    fireEvent.pointerDown(canvas, {
      pointerId: 18,
      button: 0,
      clientX: 24,
      clientY: 24,
    });
    expect(canvas.getAttribute('data-interaction-phase')).not.toBe('idle');
    const owningInteractionId = canvas.getAttribute('data-interaction-id');
    fireEvent.pointerDown(canvas, {
      pointerId: 19,
      button: 0,
      clientX: 40,
      clientY: 40,
    });
    expect(canvas.getAttribute('data-interaction-id')).toBe(owningInteractionId);
    fireEvent.pointerUp(canvas, {
      pointerId: 19,
      button: 0,
      clientX: 40,
      clientY: 40,
    });
    expect(canvas.getAttribute('data-interaction-phase')).not.toBe('idle');
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(canvas.getAttribute('data-interaction-phase')).toBe('idle');

    fireEvent.keyDown(canvas, {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
    });

    expect(await screen.findByRole('region', { name: '选区变换' })).toBeTruthy();
    expect(screen.getAllByText(/个驱动点/).length).toBeGreaterThan(0);
  });

  it('renders streamed math, handles a clarification click, and omits code artifacts from history', async () => {
    const postBodies: Record<string, unknown>[] = [];
    let turn = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/api/tikz/providers')) {
        return Response.json({ available: ['relay'], providers: { relay: { configured: true } } });
      }
      if (path.includes('/api/tikz/models')) {
        return Response.json({
          models: [{ id: 'claude-sonnet-4-6' }],
          defaultModel: 'claude-sonnet-4-6',
          source: 'api',
        });
      }
      postBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      turn += 1;
      const content = turn === 1
        ? '由 $N=\\frac{O+H}{2}$ 得到九点圆心。\n```tikz\n\\draw (N) circle (1);\n```\n请选择下一步？\n- 标注九点圆心\n- 继续证明'
        : '已记录你的选择。';
      const runId = `test-run-${turn}`;
      const frames = [
        { token: content },
        {
          agentEvent: {
            schemaVersion: 'tikz-agent-event/v1',
            runId,
            eventId: `${runId}:0`,
            sequence: 0,
            type: 'run.started',
            title: '正在理解你的请求',
          },
        },
        {
          agentEvent: {
            schemaVersion: 'tikz-agent-event/v1',
            runId,
            eventId: `${runId}:1`,
            sequence: 1,
            type: 'run.completed',
            title: '已完成回答',
            outcome: 'answer',
          },
        },
      ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
      return new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } });
    }) as unknown as typeof fetch);

    const { container } = render(<TikzStudio startOpen />);
    const composer = await screen.findByLabelText('几何构造描述');
    await screen.findByRole('option', { name: 'claude-sonnet-4-6' });
    fireEvent.change(composer, { target: { value: '解释九点圆心' } });
    fireEvent.click(screen.getByRole('button', { name: '发送 ↵' }));

    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy());
    const codeDetails = await screen.findByText('代码附件');
    expect(codeDetails.closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '标注九点圆心' }));
    expect((composer as HTMLTextAreaElement).value).toBe('标注九点圆心');

    fireEvent.click(screen.getByRole('button', { name: '发送 ↵' }));
    await waitFor(() => expect(postBodies).toHaveLength(2));
    const history = postBodies[1]?.history as { role: string; content: string }[];
    const assistant = history.findLast((message) => message.role === 'assistant');
    expect(assistant?.content).toContain('请选择下一步？');
    expect(assistant?.content).not.toContain('\\draw');
    expect(assistant?.content).not.toContain('```tikz');
  });
});
