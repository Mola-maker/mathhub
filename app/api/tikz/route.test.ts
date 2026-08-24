import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/tikz/agent/read-tools', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/tikz/agent/read-tools')>();
  return {
    ...original,
    executeTikzAgentReadTool: vi.fn(original.executeTikzAgentReadTool),
  };
});

import { checkRate } from '@/lib/rate-limit';
import {
  EMPTY_VISIBLE_MODEL_OUTPUT,
  streamProvider,
} from '@/lib/llm/sse-stream';
import { executeTikzAgentReadTool } from '@/lib/tikz/agent/read-tools';
import { buildSceneManifest } from '@/lib/tikz/semantics/scene-manifest';
import { analyze } from '@/lib/tikz/analyze';
import {
  buildGeometryAiContext,
  buildGeometrySourceMap,
  compileAiWriteProposal,
  createGeometryDoc,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
  type AiPatchBindingContext,
} from '@/lib/tikz/ir';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from '@/lib/tikz/authoring/construction-catalog';
import { compileConstructionPlan } from '@/lib/tikz/authoring/construction-ir';
import { applyTextPatches } from '@/lib/tikz/document/source-transaction';
import { POST, withAttestedAiProposalBasis } from './route';
import {
  getTikzAgentRunStore,
  resetMemoryTikzAgentRunStore,
  TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
} from '@/lib/tikz/agent/run-store';
import { createTikzAgentRunResumeToken } from '@/lib/tikz/agent/run-resume-token';

const request = (body: unknown) => new NextRequest('http://localhost/api/tikz', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

function projectRouteGeometry(
  source: string,
  revision: number,
  documentId: string,
  epoch: string,
) {
  const analysis = analyze(source, revision);
  const sceneManifest = buildSceneManifest({
    source,
    sourceRevision: revision,
    stmts: analysis.stmts,
    cst: analysis.cst,
    issues: analysis.issues,
  });
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    basis: {
      documentId,
      epoch,
      revision,
      sourceId: `${documentId}:tikz`,
      sourceHash: sceneManifest.sourceHash,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
    hashAlgorithm: sceneManifest.hashAlgorithm,
  });
  return {
    sceneManifest,
    geometryDoc: createGeometryDoc(truths, buildGeometrySourceMap(truths)),
  };
}

function managedNinePointRouteFixture() {
  const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => (
    candidate.id === 'nine-point-circle'
  ));
  if (!spec) throw new TypeError('Nine-point circle Catalog tool is unavailable');
  let ordinal = 0;
  const plan = createCatalogConstructionPlan(spec, {
    anchors: [
      { name: 'A', position: { x: 0, y: 0 }, existing: true },
      { name: 'B', position: { x: 6, y: 0 }, existing: true },
      { name: 'C', position: { x: 2, y: 4 }, existing: true },
    ],
    nextName: (prefix) => `${prefix}${++ordinal}`,
    nextConstructionId: () => 'route-nine-point-style-1',
  });
  const source = [
    '\\begin{tikzpicture}',
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (6,0);',
    '\\coordinate (C) at (2,4);',
    compileConstructionPlan(plan).lines.join('\n'),
    '\\end{tikzpicture}',
  ].join('\n');
  const documentId = 'route-style-document';
  const epoch = 'route-style-epoch';
  const projected = projectRouteGeometry(source, 0, documentId, epoch);
  const circle = projected.geometryDoc.semantic.ir.entities.find((entity) => (
    entity.kind === 'circle'
    && entity.metadata?.constructionId === plan.id
  )) ?? projected.geometryDoc.semantic.ir.entities.find((entity) => (
    entity.kind === 'circle'
  ));
  if (!circle) throw new TypeError('Managed nine-point circle was not projected');
  const labelAnchorNames = projected.geometryDoc.semantic.ir.entities
    .filter((entity) => (
      entity.kind === 'point'
      && entity.metadata?.constructionId === plan.id
      && typeof entity.name === 'string'
      && entity.name.length > 0
    ))
    .slice(0, 3)
    .map((entity) => entity.name!);
  if (labelAnchorNames.length !== 3) {
    throw new TypeError('Managed nine-point label anchors were not projected');
  }
  const semanticKernel = buildGeometryAiContext(projected.geometryDoc, {
    focusRefs: [circle.id],
    focusDepth: 3,
  });
  return {
    ...projected,
    source,
    documentId,
    epoch,
    circleId: circle.id,
    labelAnchorNames,
    contextRefs: [circle.id],
    semanticKernel,
  };
}

function proofAwareTriangleRouteFixture() {
  const source = [
    '\\begin{tikzpicture}',
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (4,0);',
    '\\coordinate (C) at (0,4);',
    '\\draw (A) -- (B) -- (C) -- cycle;',
    '\\end{tikzpicture}',
  ].join('\n');
  const documentId = 'route-proof-document';
  const epoch = 'route-proof-epoch';
  const projected = projectRouteGeometry(source, 0, documentId, epoch);
  const contextRefs = ['A', 'B', 'C'];
  const semanticKernel = buildGeometryAiContext(projected.geometryDoc, {
    focusRefs: contextRefs,
    focusDepth: 3,
  });
  return {
    ...projected,
    source,
    documentId,
    epoch,
    contextRefs,
    semanticKernel,
  };
}

describe('POST /api/tikz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryTikzAgentRunStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an oversized body before JSON parsing or provider dispatch', async () => {
    const response = await POST(new NextRequest('http://localhost/api/tikz', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'content-length': String(1024 * 1024 + 1),
      },
    }));
    expect(response.status).toBe(413);
    expect(vi.mocked(streamProvider)).not.toHaveBeenCalled();
  });

  it('allows an answer-only agent result without a write proposal', async () => {
    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      send,
    ) => {
      send('The nine-point circle passes through nine canonical points.');
      return 'The nine-point circle passes through nine canonical points.';
    });
    const response = await POST(request({
      mode: 'build',
      problem: 'Explain the nine-point circle',
      history: [],
      provider: 'relay',
    }));
    const text = await response.text();
    expect(text).not.toContain('Model output is missing an explicit');
    expect(text).toContain('"type":"run.completed"');
    const startedFrame = text.split(/\r?\n\r?\n/u)
      .find((frame) => frame.includes('"type":"run.started"'));
    expect(startedFrame).toContain('"agentRunRecovery"');
    expect(startedFrame).toContain('"resumeToken"');
    const runId = /"runId":"([^"]+)"/u.exec(text)?.[1];
    expect(runId).toBeTruthy();
    const runStore = await getTikzAgentRunStore();
    expect(runStore.ok).toBe(true);
    if (!runStore.ok || !runId) throw new Error('Agent RunStore unavailable');
    const replay = await runStore.store.read(runId);
    expect(replay.ok && replay.value?.events.map((event) => event.type)).toEqual([
      'run.started',
      'run.completed',
    ]);
  });

  it('persists client cancellation as a replayable unapplied terminal', async () => {
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      _send,
      _cfg,
      _model,
      _system,
      options,
    ) => {
      providerStarted();
      await new Promise<void>((_resolve, reject) => {
        const rejectAbort = () => reject(
          options.signal?.reason ?? new DOMException('cancelled', 'AbortError'),
        );
        if (options.signal?.aborted) rejectAbort();
        else options.signal?.addEventListener('abort', rejectAbort, { once: true });
      });
      return 'unreachable';
    });
    const controller = new AbortController();
    const response = await POST(new NextRequest('http://localhost/api/tikz', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'build',
        problem: 'Explain the nine-point circle',
        history: [],
        provider: 'relay',
      }),
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
    }));
    const responseText = response.text();
    await started;
    controller.abort(new DOMException('用户停止了本轮运行', 'AbortError'));
    const text = await responseText;
    const runId = /"runId":"([^"]+)"/u.exec(text)?.[1];
    expect(runId).toBeTruthy();
    if (!runId) throw new Error('Agent run id was not emitted before cancellation');

    const runStore = await getTikzAgentRunStore();
    expect(runStore.ok).toBe(true);
    if (!runStore.ok) throw new Error('Agent RunStore unavailable');
    const replay = await runStore.store.read(runId);
    expect(replay.ok && replay.value?.terminal).toMatchObject({
      type: 'run.completed',
      title: '本轮已取消，画板未改变',
      outcome: 'unapplied-candidate',
    });
    expect(replay.ok && replay.value?.events.some((event) => event.type === 'run.failed'))
      .toBe(false);
  });

  it('repairs a reasoning-only second-turn mutation without exposing the sentinel or failing the run', async () => {
    const fixture = managedNinePointRouteFixture();
    const oversizedHistory = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}: ${'九点圆推导与标签说明。'.repeat(900)}`,
    }));
    vi.mocked(streamProvider)
      .mockImplementationOnce(async () => EMPTY_VISIBLE_MODEL_OUTPUT)
      .mockImplementationOnce(async (_provider, messages, send) => {
        const historyChars = messages
          .filter((message) => (
            !message.content.includes('# Official PGF/TikZ capability catalogue')
            && !message.content.includes('trusted host protocol feedback')
            && message.content !== EMPTY_VISIBLE_MODEL_OUTPUT
          ))
          .reduce((total, message) => total + message.content.length, 0);
        expect(historyChars).toBeLessThanOrEqual(12_000);
        const currentTurn = messages.find((message) => (
          message.content.includes('# Official PGF/TikZ capability catalogue')
        ));
        expect(currentTurn?.content).not.toContain('% @mathgeo record {"recordType"');
        expect(currentTurn?.content.length).toBeLessThan(75_000);
        expect(messages.some((message) => (
          message.content.includes('missing-visible-agent-decision')
        ))).toBe(true);
        const clarification = '请确认：要标注九点圆构造中的全部命名点，还是只标注九个共圆点？';
        send(clarification);
        return clarification;
      });

    const response = await POST(request({
      mode: 'build',
      problem: '全部补上',
      history: oversizedHistory,
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(2);
    expect(text).toContain('检测到动作协议冲突，正在重新规划');
    expect(text).toContain('要标注九点圆构造中的全部命名点');
    expect(text).not.toContain(EMPTY_VISIBLE_MODEL_OUTPUT);
    expect(text).not.toContain('"type":"run.failed"');
    expect(text).toContain('"outcome":"answer"');
  });

  it('completes as safely unapplied when every bounded retry contains only hidden reasoning', async () => {
    const fixture = managedNinePointRouteFixture();
    vi.mocked(streamProvider).mockImplementation(async () => EMPTY_VISIBLE_MODEL_OUTPUT);

    const response = await POST(request({
      mode: 'build',
      problem: '把点 A 移动到 (1,1)',
      history: [],
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(3);
    expect(text).toContain('内部推理已隔离，画板未改变');
    expect(text).toContain('"type":"proposal.rejected"');
    expect(text).toContain('"type":"run.completed"');
    expect(text).toContain('"outcome":"unapplied-candidate"');
    expect(text).not.toContain('"type":"run.failed"');
    expect(text).not.toContain(EMPTY_VISIBLE_MODEL_OUTPUT);
  });

  it('never executes a legacy typed envelope returned by the model', async () => {
    const fixture = managedNinePointRouteFixture();
    const legacy = '```tikz-patch\n{"schemaVersion":"ai-patch-proposal/v1","operations":[]}\n```';
    vi.mocked(streamProvider).mockImplementation(async () => legacy);

    const response = await POST(request({
      mode: 'build',
      problem: '把点 A 向右移动 1 个单位',
      history: [],
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(3);
    expect(text).toContain('所有候选均已隔离，画板未改变');
    expect(text).toContain('"outcome":"unapplied-candidate"');
    expect(text).not.toContain('"aiPatchProposal"');
    expect(text).not.toContain('"sourceTransactionAttestation"');
  });

  it('checkpoints and verifies a typed style mutation with the development memory RunStore', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AGENT_RUN_REDIS_URL', '');
    vi.stubEnv('RATE_LIMIT_REDIS_URL', '');
    const fixture = managedNinePointRouteFixture();
    const problem = '把九点圆改成红色粗线';

    const proposalResponse = await POST(request({
      mode: 'build',
      problem,
      history: [],
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    expect(proposalResponse.status).toBe(200);
    const proposalText = await proposalResponse.text();
    expect(proposalText).toContain('"type":"proposal.ready"');
    expect(proposalText).toContain('"sourceTransactionAttestation"');
    expect(proposalText).not.toContain('无法建立可恢复的提案检查点');
    const runId = /"runId":"([^"]+)"/u.exec(proposalText)?.[1];
    expect(runId).toBeTruthy();
    if (!runId) throw new TypeError('Proposal run id was not emitted');

    const resolvedStore = await getTikzAgentRunStore();
    expect(resolvedStore.ok).toBe(true);
    if (!resolvedStore.ok) throw new Error(resolvedStore.message);
    const proposalRead = await resolvedStore.store.readProposal(runId);
    expect(proposalRead.ok).toBe(true);
    if (!proposalRead.ok || !proposalRead.value) {
      throw new TypeError('Typed style proposal was not checkpointed');
    }
    const checkpoint = proposalRead.value;
    expect(checkpoint.transactionAttestation.algorithm).toBe('sha256-utf8');
    expect(checkpoint.transactionAttestation.digest).toMatch(/^[0-9a-f]{64}$/u);

    const bindings: AiPatchBindingContext[] = fixture.semanticKernel.construction
      .sourceBindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.sourceId,
        range: binding.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.insertionPolicy,
        writeCapabilities: binding.writeCapabilities,
        ...(binding.managedConstructionId
          ? { managedConstructionId: binding.managedConstructionId }
          : {}),
      }));
    const compiled = compileAiWriteProposal(checkpoint.proposal, {
      basis: {
        ...fixture.geometryDoc.basis,
        sourceId: fixture.geometryDoc.basis.sourceId!,
        hashAlgorithm: fixture.sceneManifest.hashAlgorithm,
      },
      bindings,
      allowedBindingIds: fixture.semanticKernel.construction.authorizedBindingIds,
      source: fixture.source,
      geometryDoc: fixture.geometryDoc,
    }, { metadata: { agentRunId: runId } });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
    const patches = compiled.transaction.operations.flatMap((operation) => (
      operation.op === 'source-patch'
        ? operation.patches.map((patch) => ({
          from: patch.range.start,
          to: patch.range.end,
          insert: patch.insert,
        }))
        : []
    ));
    const candidateSource = applyTextPatches(fixture.source, patches);
    expect(candidateSource).toContain('red');
    expect(candidateSource).toContain('very thick');
    const candidate = projectRouteGeometry(
      candidateSource,
      1,
      fixture.documentId,
      fixture.epoch,
    );
    const candidateKernel = buildGeometryAiContext(candidate.geometryDoc, {
      focusRefs: fixture.contextRefs,
      focusDepth: 3,
    });

    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      send,
    ) => {
      send('已复核九点圆样式。');
      return '已复核九点圆样式。';
    });
    const verifyResponse = await POST(request({
      mode: 'verify-commit',
      problem,
      history: [],
      provider: 'relay',
      tikzCode: candidateSource,
      sourceRevision: 1,
      sourceHash: candidate.sceneManifest.sourceHash,
      sceneManifest: candidate.sceneManifest,
      semanticKernel: candidateKernel,
      contextRefs: fixture.contextRefs,
      commitObservation: {
        schemaVersion: 'tikz-agent-commit-observation/v1',
        runId,
        transactionId: checkpoint.transactionId,
        beforeRevision: 0,
        afterRevision: 1,
        beforeSourceHash: fixture.sceneManifest.sourceHash,
        afterSourceHash: candidate.sceneManifest.sourceHash,
        transactionAttestation: checkpoint.transactionAttestation,
        resumeToken: createTikzAgentRunResumeToken(runId),
      },
    }));
    expect(verifyResponse.status).toBe(200);
    const verifyText = await verifyResponse.text();
    expect(verifyText).toContain('"type":"commit.verified"');
    expect(verifyText).toContain('"type":"run.completed"');
    const replay = await resolvedStore.store.read(runId);
    expect(replay.ok && replay.value?.terminal?.type).toBe('run.completed');
  });

  it('accepts one model GeometryIntent for an atomic multi-label follow-up', async () => {
    const fixture = managedNinePointRouteFixture();
    const modelIntent = `\`\`\`tikz-geometry-intent
${JSON.stringify({
  schemaVersion: 'geometry-intent/v2',
  intentId: 'route-nine-point-multi-label',
  operation: {
    kind: 'present',
    targetRef: fixture.circleId,
    style: { color: 'blue', width: 'very thick' },
    labels: fixture.labelAnchorNames.map((anchorRef) => ({
      anchorRef,
      text: anchorRef,
    })),
  },
})}
\`\`\``;
    vi.mocked(streamProvider).mockImplementationOnce(async () => modelIntent);

    const response = await POST(request({
      mode: 'build',
      problem: `把九点圆改成蓝色粗线，并给 ${fixture.labelAnchorNames.join('、')} 添加标签`,
      history: [{ role: 'assistant', content: '九点圆已经构造完成。' }],
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(1);
    expect(text).toContain('"type":"proposal.ready"');
    expect(text).not.toContain('动作协议冲突');
    const runId = /"runId":"([^"]+)"/u.exec(text)?.[1];
    expect(runId).toBeTruthy();
    const resolvedStore = await getTikzAgentRunStore();
    if (!resolvedStore.ok || !runId) throw new Error('Agent RunStore unavailable');
    const checkpoint = await resolvedStore.store.readProposal(runId);
    expect(checkpoint.ok && checkpoint.value?.proposal).toMatchObject({
      schemaVersion: 'host-semantic-action-set/v1',
      styleIntent: {
        operation: {
          targetEntityId: fixture.circleId,
          style: { color: 'blue', width: 'very thick' },
        },
      },
      labelIntents: [
        { parameters: { text: fixture.labelAnchorNames[0] } },
        { parameters: { text: fixture.labelAnchorNames[1] } },
        { parameters: { text: fixture.labelAnchorNames[2] } },
      ],
    });
  });

  it('rejects Agent mutations when production has no shared RunStore', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AGENT_RUN_REDIS_URL', '');
    vi.stubEnv('RATE_LIMIT_REDIS_URL', '');

    const response = await POST(request({
      mode: 'build',
      problem: '修改九点圆样式',
      history: [],
      provider: 'relay',
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('shared Agent RunStore is not configured'),
    });
    expect(vi.mocked(streamProvider)).not.toHaveBeenCalled();
  });

  it('keeps the provider prefix byte-stable while binding each live Canvas snapshot separately', async () => {
    const cachedReply: typeof streamProvider = async (
      _provider,
      _messages,
      send,
      _cfg,
      _model,
      _system,
      options,
    ) => {
      options?.onUsage?.({
        promptTokens: 240,
        completionTokens: 8,
        totalTokens: 248,
        cacheReadTokens: 192,
        cacheMissTokens: 48,
      });
      send('已读取当前状态。');
      return '已读取当前状态。';
    };
    vi.mocked(streamProvider)
      .mockImplementationOnce(cachedReply)
      .mockImplementationOnce(cachedReply);

    const first = await POST(request({
      mode: 'build',
      problem: '解释三角形的高',
      history: [],
      provider: 'relay',
    }));
    const second = await POST(request({
      mode: 'build',
      problem: '解释九点圆',
      history: [],
      provider: 'relay',
    }));
    const firstText = await first.text();
    const secondText = await second.text();
    const calls = vi.mocked(streamProvider).mock.calls;

    expect(calls).toHaveLength(2);
    expect(calls[0]?.[5]).toBe(calls[1]?.[5]);
    expect(calls[0]?.[1].at(-1)?.content).not.toBe(calls[1]?.[1].at(-1)?.content);
    expect(firstText).toContain('"cacheReadTokens":192');
    expect(secondText).toContain('"cacheReadTokens":192');
    expect(firstText).toContain('"stablePrefixDigest"');
    expect(secondText).toContain('"runtimeContextDigest"');
  });

  it('emits a read-only geometry widget separately from conversational prose', async () => {
    const output = [
      '可以按三步理解这个构造。',
      '```tikz-agent-widget',
      JSON.stringify({
        kind: 'geometry-flow',
        title: '九点圆推导',
        steps: [
          { id: 'given', title: '已知', explanation: '给定三角形 ABC。', state: 'given' },
          { id: 'goal', title: '结论', explanation: '九点共圆。', state: 'goal' },
        ],
      }),
      '```',
    ].join('\n');
    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      send,
    ) => {
      send(output);
      return output;
    });
    const response = await POST(request({
      mode: 'build',
      problem: '解释九点圆',
      history: [],
      provider: 'relay',
    }));
    const text = await response.text();
    expect(text).toContain('"assistantWidget":{"kind":"geometry-flow"');
    expect(text).not.toContain('```tikz-agent-widget');
    expect(text).toContain('"outcome":"answer"');
  });

  it('builds a trusted function widget even when the model only returns prose', async () => {
    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      send,
    ) => {
      send('两条曲线在原点和 (2,4) 相交。');
      return '两条曲线在原点和 (2,4) 相交。';
    });
    const response = await POST(request({
      mode: 'build',
      problem: '解释 y=x^2 与 y=2x 的交点，用交互函数图 Widget 展示，不修改画板。',
      history: [],
      provider: 'relay',
    }));
    const text = await response.text();
    expect(text).toContain('"assistantWidget":{"kind":"function-plot"');
    expect(text).toContain('"title":"函数关系对照"');
    expect(text).not.toContain('proposal.ready');
    expect(text).toContain('"outcome":"answer"');
  });

  it('builds a trusted GeometryDoc proof flow when the model returns prose only', async () => {
    const tikzCode = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1.2,2.8);
\coordinate (M) at ($(A)!0.5!(B)$);
\coordinate (H) at ($(A)!(C)!(B)$);
\draw (A) -- (B) -- (C) -- cycle;
\draw (C) -- (M);
\draw (C) -- (H);
\pic [draw] {right angle = A--H--C};
\end{tikzpicture}`;
    const sourceRevision = 0;
    const analysis = analyze(tikzCode, sourceRevision);
    const sceneManifest = buildSceneManifest({
      source: tikzCode,
      sourceRevision,
      stmts: analysis.stmts,
      cst: analysis.cst,
      issues: analysis.issues,
    });
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: tikzCode,
      basis: {
        documentId: 'route-flow-document',
        epoch: 'route-flow-epoch',
        revision: sourceRevision,
        sourceId: 'route-flow-document:tikz',
        sourceHash: sceneManifest.sourceHash,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
      hashAlgorithm: sceneManifest.hashAlgorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    const contextRefs = ['M', 'H', 'C'];
    const semanticKernel = buildGeometryAiContext(geometryDoc, {
      focusRefs: contextRefs,
      focusDepth: 3,
    });
    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      send,
    ) => {
      send('我会按当前语义关系分四步展示。');
      return '我会按当前语义关系分四步展示。';
    });

    const response = await POST(request({
      mode: 'build',
      problem: '把中点 M 到中线 CM、垂足 H 到高 CH 的推导拆成四步动态几何流程图，只读，不修改画板。',
      history: [],
      provider: 'relay',
      tikzCode,
      sourceRevision,
      sourceHash: sceneManifest.sourceHash,
      sceneManifest,
      semanticKernel,
      contextRefs,
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"assistantWidget":{"kind":"geometry-flow"');
    expect(text).toContain('"basis":{"documentId":"route-flow-document"');
    expect(text).toContain('"epoch":"route-flow-epoch"');
    expect(text).toContain('"revision":0');
    expect(text).toContain(`"sourceHash":"${sceneManifest.sourceHash}"`);
    expect(text).toContain('"constructionToolId":"midpoint"');
    expect(text).toContain('"constructionToolId":"perpendicular-foot"');
    expect(text).not.toContain('"aiPatchProposal"');
    expect(text).not.toContain('AI 运行失败');
    expect(text).toContain('"outcome":"answer"');
  });

  it('requires a same-run proof observation before an olympiad auxiliary construction', async () => {
    const fixture = proofAwareTriangleRouteFixture();
    const action = [
      '```tikz-geometry-intent',
      JSON.stringify({
        schemaVersion: 'geometry-intent/v2',
        intentId: 'nine-point-without-proof-state',
        operation: {
          kind: 'construct',
          toolId: 'nine-point-circle',
          inputRefs: ['A', 'B', 'C'],
          requestedNames: {},
          parameters: {},
        },
      }),
      '```',
    ].join('\n');
    vi.mocked(streamProvider).mockImplementationOnce(async () => action);

    const response = await POST(request({
      mode: 'build',
      problem: '请画一个九点圆作为证明辅助线',
      history: [],
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('proof-solving construction requires one current build-proof-state observation');
    expect(text).toContain('"type":"proposal.rejected"');
    expect(text).toContain('"outcome":"unapplied-candidate"');
    expect(text).not.toContain('"type":"proposal.ready"');
  });

  it('lowers an olympiad auxiliary construction only from its current proof-state receipt', async () => {
    const fixture = proofAwareTriangleRouteFixture();
    const proofTool = [
      '```tikz-agent-tool',
      JSON.stringify({
        schemaVersion: 'tikz-agent-tool-call/v1',
        callId: 'proof-call-route-1',
        name: 'build-proof-state',
        arguments: {
          claims: [{
            claimId: 'goal-equal-distance',
            kind: 'equal-distance',
            pointRefs: ['A', 'B', 'C'],
          }],
        },
      }),
      '```',
    ].join('\n');
    const proofAwareAction = [
      '```tikz-geometry-intent',
      JSON.stringify({
        schemaVersion: 'geometry-intent/v2',
        intentId: 'nine-point-with-proof-state',
        operation: {
          kind: 'construct',
          toolId: 'nine-point-circle',
          inputRefs: ['A', 'B', 'C'],
          requestedNames: {},
          parameters: {},
          proofContext: {
            role: 'auxiliary-construction',
            observationCallId: 'proof-call-route-1',
            obligationIds: ['goal-equal-distance'],
          },
        },
      }),
      '```',
    ].join('\n');
    vi.mocked(streamProvider)
      .mockImplementationOnce(async () => proofTool)
      .mockImplementationOnce(async () => proofAwareAction);

    const response = await POST(request({
      mode: 'build',
      problem: '请画一个九点圆作为证明辅助线',
      history: [],
      provider: 'relay',
      tikzCode: fixture.source,
      sourceRevision: 0,
      sourceHash: fixture.sceneManifest.sourceHash,
      sceneManifest: fixture.sceneManifest,
      semanticKernel: fixture.semanticKernel,
      contextRefs: fixture.contextRefs,
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(2);
    expect(text).toContain('"type":"tool.started"');
    expect(text).toContain('"toolName":"build-proof-state"');
    expect(text).toContain('"type":"tool.completed"');
    expect(text).toContain('"type":"proposal.ready"');
    expect(text).toContain('"schemaVersion":"construction-intent/v1"');
    expect(text).not.toContain('proof-observation-required');
    expect(text).not.toContain('"type":"run.failed"');
  });

  it('streams trusted problem-search observations as a read-only source widget', async () => {
    const tikzCode = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1,3);
\draw (A) -- (B) -- (C) -- cycle;
\end{tikzpicture}`;
    const sourceRevision = 0;
    const analysis = analyze(tikzCode, sourceRevision);
    const sceneManifest = buildSceneManifest({
      source: tikzCode,
      sourceRevision,
      stmts: analysis.stmts,
      cst: analysis.cst,
      issues: analysis.issues,
    });
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: tikzCode,
      basis: {
        documentId: 'problem-widget-document',
        epoch: 'problem-widget-epoch',
        revision: sourceRevision,
        sourceId: 'problem-widget-document:tikz',
        sourceHash: sceneManifest.sourceHash,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
      hashAlgorithm: sceneManifest.hashAlgorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    const contextRefs = ['A', 'B', 'C'];
    const semanticKernel = buildGeometryAiContext(geometryDoc, {
      focusRefs: contextRefs,
      focusDepth: 2,
    });
    vi.mocked(streamProvider)
      .mockImplementationOnce(async () => [
        '```tikz-agent-tool',
        JSON.stringify({
          schemaVersion: 'tikz-agent-tool-call/v1',
          callId: 'problem-search-1',
          name: 'search-geometry-problems',
          arguments: { query: 'Simson line', limit: 4 },
        }),
        '```',
      ].join('\n'))
      .mockImplementationOnce(async (_provider, _messages, send) => {
        send('我找到了可继续分析的竞赛几何题。');
        return '我找到了可继续分析的竞赛几何题。';
      });
    vi.mocked(executeTikzAgentReadTool).mockResolvedValueOnce({
      schemaVersion: 'tikz-agent-tool-observation/v1',
      callId: 'problem-search-1',
      ok: true,
      payload: {
        records: [{
          id: 'olympiadbench:42',
          source: 'olympiadbench',
          title: 'Simson line problem',
          statementPreview: 'Point P lies on the circumcircle of triangle ABC.',
          topics: ['Geometry'],
          sourceUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
          datasetUrl: 'https://huggingface.co/datasets/Hothan/OlympiadBench',
          licenseId: 'Apache-2.0',
          contentHash: '0'.repeat(64),
          contentHashAlgorithm: 'sha256-utf8',
          contentHashScope: 'normalized-live-snapshot',
          admission: 'search-reference-only',
          rights: {
            sourceMaterialRights: 'review-required',
            redistribution: 'review-required',
            commercial: 'review-required',
            training: 'review-required',
          },
          hasImages: false,
        }],
        sourceStatus: [{
          id: 'olympiadbench',
          enabled: true,
          accessMode: 'live-search',
          sourceMaterialRights: 'review-required',
          detail: 'available',
        }],
      },
    });

    const response = await POST(request({
      mode: 'build',
      problem: '搜索 Simson line 竞赛几何题，用 Widget 展示候选，不修改画板。',
      history: [],
      provider: 'relay',
      tikzCode,
      sourceRevision,
      sourceHash: sceneManifest.sourceHash,
      sceneManifest,
      semanticKernel,
      contextRefs,
    }));
    const text = await response.text();
    expect(text).toContain('"assistantWidget":{"kind":"problem-search"');
    expect(text).toContain('"licenseId":"Apache-2.0"');
    expect(text).not.toContain('"aiPatchProposal"');
    expect(text).toContain('"outcome":"answer"');
  });

  it('treats model proposal basis as data and binds it to the current host snapshot', () => {
    const proposal = withAttestedAiProposalBasis({
      schemaVersion: 'ai-patch-proposal/v1',
      proposalId: 'style-current-edge',
      basis: {
        documentId: 'stale-document',
        epoch: 'stale-epoch',
        revision: 0,
        sourceId: 'stale-document:tikz',
        sourceHash: 'stale-hash',
      },
      operations: [],
    }, {
      documentId: 'current-document',
      epoch: 'current-epoch',
      revision: 7,
      sourceId: 'current-document:tikz',
      sourceHash: 'current-hash',
      hashAlgorithm: 'fnv1a64-utf8',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      kernelHash: 'current-kernel',
      projectionHash: 'current-projection',
      source: '\\begin{tikzpicture}\\end{tikzpicture}',
      userIntent: 'change the selected edge style',
      contextRefs: [],
      focusEntityIds: [],
      readBindingIds: [],
      bindings: [],
      geometryDoc: {} as never,
      agentContext: {} as never,
    }) as { basis: Record<string, unknown> };
    expect(proposal.basis).toMatchObject({
      documentId: 'current-document',
      epoch: 'current-epoch',
      revision: 7,
      sourceHash: 'current-hash',
      kernelHash: 'current-kernel',
      projectionHash: 'current-projection',
    });
    expect(proposal.basis).not.toMatchObject({ documentId: 'stale-document' });

    const transform = withAttestedAiProposalBasis({
      schemaVersion: 'ai-selection-transform-intent/v1',
      intentId: 'move-current-selection',
      idempotencyKey: 'move-current-selection',
      authorizationScopeFingerprint: 'host-scope',
      selectedEntityIds: ['segment:AB'],
      transform: { kind: 'translate', dx: 1, dy: 0 },
      basis: { documentId: 'stale-document', revision: 0 },
    }, {
      documentId: 'current-document',
      epoch: 'current-epoch',
      revision: 7,
      sourceId: 'current-document:tikz',
      sourceHash: 'current-hash',
      hashAlgorithm: 'fnv1a64-utf8',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      kernelHash: 'current-kernel',
      projectionHash: 'current-projection',
      source: '\\begin{tikzpicture}\\end{tikzpicture}',
      userIntent: 'move the selected segment',
      contextRefs: [],
      focusEntityIds: [],
      readBindingIds: [],
      bindings: [],
      geometryDoc: {} as never,
      agentContext: {} as never,
    }) as { basis: Record<string, unknown> };
    expect(transform.basis).toMatchObject({
      documentId: 'current-document',
      revision: 7,
      sourceHash: 'current-hash',
    });

    const deletion = withAttestedAiProposalBasis({
      schemaVersion: 'ai-semantic-delete-intent/v1',
      intentId: 'delete-current-selection',
      idempotencyKey: 'delete-current-selection',
      authorizationScopeFingerprint: 'host-scope',
      selectedEntityIds: ['segment:AB'],
      mode: 'block',
      basis: { documentId: 'stale-document', revision: 0 },
    }, {
      documentId: 'current-document',
      epoch: 'current-epoch',
      revision: 7,
      sourceId: 'current-document:tikz',
      sourceHash: 'current-hash',
      hashAlgorithm: 'fnv1a64-utf8',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      kernelHash: 'current-kernel',
      projectionHash: 'current-projection',
      source: '\\begin{tikzpicture}\\end{tikzpicture}',
      userIntent: 'delete the selected segment',
      contextRefs: [],
      focusEntityIds: [],
      readBindingIds: [],
      bindings: [],
      geometryDoc: {} as never,
      agentContext: {} as never,
    }) as { basis: Record<string, unknown> };
    expect(deletion.basis).toMatchObject({
      documentId: 'current-document',
      revision: 7,
      sourceHash: 'current-hash',
    });

    const constructionDag = withAttestedAiProposalBasis({
      schemaVersion: 'construction-dag-intent/v1',
      intentId: 'construct-current-dag',
      idempotencyKey: 'construct-current-dag',
      basis: {
        documentId: 'stale-document',
        revision: 0,
        constructionCatalogDigest: 'stale-catalog',
      },
      capability: {},
      steps: [],
    }, {
      documentId: 'current-document',
      epoch: 'current-epoch',
      revision: 7,
      sourceId: 'current-document:tikz',
      sourceHash: 'current-hash',
      hashAlgorithm: 'fnv1a64-utf8',
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      kernelHash: 'current-kernel',
      projectionHash: 'current-projection',
      source: '\\begin{tikzpicture}\\end{tikzpicture}',
      userIntent: 'construct a dependent geometry graph',
      contextRefs: [],
      focusEntityIds: [],
      readBindingIds: [],
      bindings: [],
      geometryDoc: {} as never,
      agentContext: {} as never,
    }) as { basis: Record<string, unknown> };
    expect(constructionDag.basis).toMatchObject({
      documentId: 'current-document',
      epoch: 'current-epoch',
      revision: 7,
      sourceHash: 'current-hash',
      kernelHash: 'current-kernel',
      projectionHash: 'current-projection',
      constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    });
    expect(constructionDag.basis).not.toMatchObject({
      constructionCatalogDigest: 'stale-catalog',
    });
  });

  it('build：无可写 GeometryDoc 时将 TikZ 示例保持为对话，不伪造写入', async () => {
    const response = await POST(request({
      mode: 'build',
      problem: '画三角形',
      history: [],
      provider: 'relay',
    }));
    const text = await response.text();
    expect(text).toContain('"model":"m"');
    expect(text).toContain('"token":"好的"');
    expect(text).not.toContain('"tikzCode"');
    expect(text).toContain('"outcome":"answer"');
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

  it('接受客户端 buildSceneManifest 产出的 manifest（同一算法族）', async () => {
    // The browser builds its manifest synchronously, so it hashes with the FNV
    // fallback. Verifying it against a hard-coded SHA-256 lane on the server made
    // every AI request fail 409 regardless of input.
    const tikzCode = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}\n';
    const sourceRevision = 1;
    const sceneManifest = buildSceneManifest({
      source: tikzCode,
      sourceRevision,
      stmts: analyze(tikzCode, sourceRevision).stmts,
    });

    const response = await POST(request({
      mode: 'build',
      problem: '继续',
      history: [],
      provider: 'relay',
      tikzCode,
      sourceRevision,
      sourceHash: sceneManifest.sourceHash,
      sceneManifest,
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('[DONE]');
  });

  it('manifest 哈希与源码不符时仍然 409', async () => {
    const tikzCode = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}\n';
    const sourceRevision = 1;
    const sceneManifest = buildSceneManifest({
      source: tikzCode,
      sourceRevision,
      stmts: analyze(tikzCode, sourceRevision).stmts,
    });

    const response = await POST(request({
      mode: 'build',
      problem: '继续',
      history: [],
      provider: 'relay',
      // Source drifted after the manifest was built; the guard must still fire.
      tikzCode: `${tikzCode}\\coordinate (B) at (1,1);\n`,
      sourceRevision,
      sourceHash: sceneManifest.sourceHash,
      sceneManifest,
    }));

    expect(response.status).toBe(409);
  });

  it('拒绝客户端自称的哈希算法与实际 manifest 不一致', async () => {
    const tikzCode = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}\n';
    const sourceRevision = 1;
    const sceneManifest = buildSceneManifest({
      source: tikzCode,
      sourceRevision,
      stmts: analyze(tikzCode, sourceRevision).stmts,
    });

    const response = await POST(request({
      mode: 'build',
      problem: '继续',
      history: [],
      provider: 'relay',
      tikzCode,
      sourceRevision,
      sourceHash: sceneManifest.sourceHash,
      // An FNV digest labelled as SHA-256 must not be honoured.
      sceneManifest: { ...sceneManifest, hashAlgorithm: 'sha256-utf8' },
    }));

    expect(response.status).toBe(409);
  });

  it('requires a revision-bound observation for post-commit verification', async () => {
    const response = await POST(request({
      mode: 'verify-commit',
      problem: '确认刚才的修改',
      provider: 'relay',
    }));
    expect(response.status).toBe(409);
  });

  it('verifies a committed revision as a read-only continuation of the same run', async () => {
    const tikzCode = '\\begin{tikzpicture}\n\\coordinate (A) at (1,2);\n\\end{tikzpicture}\n';
    const sourceRevision = 1;
    const analysis = analyze(tikzCode, sourceRevision);
    const sceneManifest = buildSceneManifest({
      source: tikzCode,
      sourceRevision,
      stmts: analysis.stmts,
      cst: analysis.cst,
      issues: analysis.issues,
    });
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: tikzCode,
      basis: {
        documentId: 'route-verify-document',
        epoch: 'route-verify-epoch',
        revision: sourceRevision,
        sourceId: 'route-verify-document:tikz',
        sourceHash: sceneManifest.sourceHash,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
      hashAlgorithm: sceneManifest.hashAlgorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    const semanticKernel = buildGeometryAiContext(geometryDoc, {
      focusRefs: ['A'],
      focusDepth: 2,
    });
    vi.mocked(streamProvider).mockImplementationOnce(async (
      _provider,
      _messages,
      send,
    ) => {
      send('已确认点 A 位于 (1,2)。');
      return '已确认点 A 位于 (1,2)。';
    });

    const transactionAttestation = {
      schemaVersion: 'ai-transaction-attestation/v1' as const,
      transactionId: 'transaction-verify-1',
      algorithm: 'fnv1a64-utf8' as const,
      digest: '0123456789abcdef',
    };
    const verifyRequestBody = {
      mode: 'verify-commit',
      problem: '把 A 移到 (1,2)',
      history: [],
      provider: 'relay',
      tikzCode,
      sourceRevision,
      sourceHash: sceneManifest.sourceHash,
      sceneManifest,
      semanticKernel,
      contextRefs: ['A'],
      commitObservation: {
        schemaVersion: 'tikz-agent-commit-observation/v1',
        runId: 'tikz-run-verify-1',
        transactionId: 'transaction-verify-1',
        beforeRevision: 0,
        afterRevision: 1,
        beforeSourceHash: 'previous-source-hash',
        afterSourceHash: sceneManifest.sourceHash,
        transactionAttestation,
        resumeToken: createTikzAgentRunResumeToken('tikz-run-verify-1'),
      },
    };
    const forged = await POST(request(verifyRequestBody));
    expect(forged.status).toBe(409);
    expect(vi.mocked(streamProvider)).not.toHaveBeenCalled();

    const runStore = await getTikzAgentRunStore();
    expect(runStore.ok).toBe(true);
    if (!runStore.ok) throw new Error(runStore.message);
    const sourceId = geometryDoc.basis.sourceId;
    if (!sourceId) throw new Error('Expected the GeometryDoc fixture to expose a source id');
    expect(await runStore.store.checkpointProposal({
      schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
      runId: 'tikz-run-verify-1',
      transactionId: 'transaction-verify-1',
      transactionAttestation,
      proposal: {
        schemaVersion: 'ai-patch-proposal/v1',
        proposalId: 'proposal-verify-1',
      },
      documentId: geometryDoc.basis.documentId,
      epoch: geometryDoc.basis.epoch,
      sourceId,
      beforeRevision: 0,
      beforeSourceHash: 'previous-source-hash',
      afterRevision: sourceRevision,
      afterSourceHash: sceneManifest.sourceHash,
      createdAt: Date.now(),
    })).toEqual({ ok: true, stored: true });

    const response = await POST(request(verifyRequestBody));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('已确认点 A 位于');
    expect(text).toContain('"type":"commit.verified"');
    expect(text).toContain('"type":"run.completed"');
    expect(text).not.toContain('"aiPatchProposal"');
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(1);

    const duplicate = await POST(request(verifyRequestBody));
    expect(duplicate.status).toBe(409);
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(1);

    const fallbackRunId = 'tikz-run-verify-reasoning-only';
    const fallbackAttestation = {
      ...transactionAttestation,
      transactionId: 'transaction-verify-reasoning-only',
      digest: 'fedcba9876543210',
    };
    expect(await runStore.store.checkpointProposal({
      schemaVersion: TIKZ_AGENT_PROPOSAL_CHECKPOINT_SCHEMA_VERSION,
      runId: fallbackRunId,
      transactionId: fallbackAttestation.transactionId,
      transactionAttestation: fallbackAttestation,
      proposal: {
        schemaVersion: 'ai-patch-proposal/v1',
        proposalId: 'proposal-verify-reasoning-only',
      },
      documentId: geometryDoc.basis.documentId,
      epoch: geometryDoc.basis.epoch,
      sourceId,
      beforeRevision: 0,
      beforeSourceHash: 'previous-source-hash',
      afterRevision: sourceRevision,
      afterSourceHash: sceneManifest.sourceHash,
      createdAt: Date.now(),
    })).toEqual({ ok: true, stored: true });
    vi.mocked(streamProvider).mockImplementation(async () => EMPTY_VISIBLE_MODEL_OUTPUT);

    const reasoningOnlyResponse = await POST(request({
      ...verifyRequestBody,
      commitObservation: {
        ...verifyRequestBody.commitObservation,
        runId: fallbackRunId,
        transactionId: fallbackAttestation.transactionId,
        transactionAttestation: fallbackAttestation,
        resumeToken: createTikzAgentRunResumeToken(fallbackRunId),
      },
    }));
    expect(reasoningOnlyResponse.status).toBe(200);
    const reasoningOnlyText = await reasoningOnlyResponse.text();
    expect(reasoningOnlyText).toContain('修改已提交');
    expect(reasoningOnlyText).toContain('模型本轮没有产生可展示的自然语言总结');
    expect(reasoningOnlyText).toContain('"type":"commit.verified"');
    expect(reasoningOnlyText).toContain('"type":"run.completed"');
    expect(reasoningOnlyText).not.toContain('"type":"proposal.rejected"');
    expect(reasoningOnlyText).not.toContain('"type":"run.failed"');
    expect(vi.mocked(streamProvider)).toHaveBeenCalledTimes(4);
  });
});
