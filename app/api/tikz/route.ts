import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { makeSseStream, streamProvider, type Message } from '@/lib/llm/sse-stream';
import { isSafeModelId } from '@/lib/provider/provider-models';
import { CLIENT_PROVIDER, getEffectiveProvider, type ProviderName } from '@/lib/provider/settings';
import { checkRate } from '@/lib/rate-limit';
import { buildTikzRepairPrompt, buildTikzSystemPrompt } from '@/lib/tikz/prompt/tikz-system-prompt';
import { detectPreviewOnly, extractTikzBlock, sanitizeTikz } from '@/lib/tikz/server/extract-tikz';
import { extractAiPatchProposal } from '@/lib/tikz/server/extract-ai-patch';
import { hashSourceAsync } from '@/lib/tikz/semantics/scene-manifest';
import { parseManagedConstructionBlocks } from '@/lib/tikz/semantics/managed-construction';
import { applyTextPatches } from '@/lib/tikz/document/source-transaction';
import { hashSource } from '@/lib/tikz/document/source-hash';
import { analyze } from '@/lib/tikz/analyze';
import {
  buildGeometryAiContext,
  compileAiWriteProposal,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
  type AiPatchBindingContext,
  type AiPatchProposalBasis,
} from '@/lib/tikz/ir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TikzRequest {
  mode?: 'build' | 'repair';
  problem?: string;
  history?: Array<{ role?: string; content?: string }>;
  provider?: string;
  model?: string;
  tikzCode?: string;
  failures?: string[];
  sceneSnapshot?: string;
  sceneManifest?: unknown;
  semanticKernel?: unknown;
  sourceRevision?: number;
  sourceHash?: string;
  contextRefs?: string[];
}

const MAX_PROBLEM_LENGTH = 12_000;
const MAX_CODE_LENGTH = 128_000;
const MAX_FAILURES = 24;
const MAX_MANIFEST_LENGTH = 96_000;
const MAX_SEMANTIC_KERNEL_LENGTH = 128_000;

function jsonError(error: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

function normalizedHistory(history: TikzRequest['history']): Message[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-8)
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content!.slice(0, MAX_PROBLEM_LENGTH),
    }));
}

function emitCode(full: string, sendEvent: (event: Record<string, unknown>) => void): void {
  const raw = extractTikzBlock(full);
  if (!raw) {
    sendEvent({ error: '模型输出中未找到 ```tikz 代码块，请重试或换个说法' });
    return;
  }
  const { code, stripped } = sanitizeTikz(raw);
  sendEvent({
    tikzCode: code,
    previewOnly: detectPreviewOnly(code),
    stripped,
  });
}

interface SourceProposalBasis extends AiPatchProposalBasis {
  source: string;
  contextRefs: readonly string[];
  focusEntityIds: readonly string[];
  readBindingIds: readonly string[];
  bindings: readonly AiPatchBindingContext[];
}

function emitRevisionBoundSourceProposal(
  full: string,
  sendEvent: (event: Record<string, unknown>) => void,
  basis: SourceProposalBasis,
): boolean {
  const extracted = extractAiPatchProposal(full);
  if (!extracted.proposal) {
    sendEvent({ error: extracted.error ?? '模型没有返回可验证的 AI patch proposal' });
    return false;
  }
  const compiled = compileAiWriteProposal(extracted.proposal, {
    basis,
    bindings: basis.bindings,
    allowedBindingIds: basis.readBindingIds,
    source: basis.source,
  }, {
    pluginSetDigest: basis.pluginSetDigest,
    metadata: {
      contextRefs: basis.contextRefs,
      focusEntityIds: basis.focusEntityIds,
      requestedReadBindingIds: basis.readBindingIds,
    },
  });
  if (!compiled.ok) {
    sendEvent({
      error: 'AI patch proposal 未通过源码 binding 与前置条件校验',
      proposalErrors: compiled.errors,
    });
    return false;
  }
  const patches = compiled.transaction.operations.flatMap((operation) => (
    operation.op === 'source-patch'
      ? operation.patches.map((patch) => ({
        from: patch.range.start,
        to: patch.range.end,
        insert: patch.insert,
      }))
      : []
  ));
  let code: string;
  try {
    code = applyTextPatches(basis.source, patches);
  } catch (error) {
    sendEvent({
      error: error instanceof Error ? error.message : 'AI patch proposal 的源码范围无效',
    });
    return false;
  }
  const unsafe = sanitizeTikz(code).stripped;
  if (unsafe.length > 0) {
    sendEvent({
      error: `AI patch proposal 包含禁止命令：${unsafe.join('、')}`,
    });
    return false;
  }
  const candidate = analyze(code, basis.revision + 1);
  if (candidate.issues.some((issue) => issue.severity === 'error')) {
    sendEvent({
      error: 'AI patch proposal 未通过 TikZ 语法/语义投影校验',
      proposalIssues: candidate.issues
        .filter((issue) => issue.severity === 'error')
        .slice(0, 16),
    });
    return false;
  }
  const candidateTruth = projectTikzAnalysisToGeometryTruth({
    analysis: candidate,
    source: code,
    basis: {
      documentId: basis.documentId,
      epoch: basis.epoch,
      revision: basis.revision + 1,
      sourceHash: hashSource(code),
      sourceId: basis.sourceId,
      pluginSetDigest: basis.pluginSetDigest,
    },
    hashAlgorithm: basis.hashAlgorithm,
  });
  const semanticErrors = candidateTruth.semantic.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error');
  if (semanticErrors.length > 0) {
    sendEvent({
      error: 'AI patch proposal failed the complete Geometry Truth projection gate.',
      proposalIssues: semanticErrors.slice(0, 16),
    });
    return false;
  }
  sendEvent({
    aiPatchProposal: compiled.proposal,
    sourceTransaction: compiled.transaction,
    tikzCode: code,
    previewOnly: detectPreviewOnly(code),
    stripped: [],
  });
  return true;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: TikzRequest;
  try {
    body = (await req.json()) as TikzRequest;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  if (body.mode !== 'build' && body.mode !== 'repair') {
    return jsonError('mode 必须是 build 或 repair', 400);
  }

  const provider = (body.provider ?? CLIENT_PROVIDER) as ProviderName;
  if (provider !== CLIENT_PROVIDER) return jsonError('未知 provider', 400);

  const ip = await clientIp();
  const rate = await checkRate(`math-tikz:${ip}`, 20, 60_000);
  if (rate.unavailable) {
    return jsonError('限流服务暂时不可用，请稍后重试', 503, {
      'Retry-After': '1',
      'Cache-Control': 'no-store',
    });
  }
  if (!rate.allowed) {
    return jsonError('请求太频繁，请稍后再试', 429, {
      'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1_000))),
    });
  }

  const cfg = await getEffectiveProvider(provider);
  if (!cfg.configured) return jsonError(`provider ${provider} 未配置密钥`, 400);
  const model = body.model?.trim() || cfg.model;
  if (!isSafeModelId(model)) {
    return jsonError('请先从 api.molamaker.cn 返回的模型列表中选择有效模型', 400);
  }

  if (body.mode === 'repair') {
    if (typeof body.tikzCode !== 'string' || !Array.isArray(body.failures)) {
      return jsonError('repair 缺少 tikzCode/failures', 400);
    }
    if (!body.tikzCode.trim() || body.tikzCode.length > MAX_CODE_LENGTH) {
      return jsonError('tikzCode 为空或过长', 400);
    }
    const failures = body.failures
      .filter((failure): failure is string => typeof failure === 'string')
      .slice(0, MAX_FAILURES)
      .map((failure) => failure.slice(0, 2_000));
    if (failures.length === 0) return jsonError('repair 缺少有效 failures', 400);

    const system = buildTikzRepairPrompt(
      body.tikzCode,
      failures,
      typeof body.sceneSnapshot === 'string' ? body.sceneSnapshot.slice(0, MAX_CODE_LENGTH) : '',
    );
    const messages: Message[] = [{ role: 'user', content: '请修复上面的代码。' }];
    return makeSseStream(async (send, sendEvent) => {
      sendEvent({ model });
      const full = await streamProvider(
        provider,
        messages,
        send,
        cfg,
        model,
        system,
        { reasoningTarget: 'tikz' },
      );
      emitCode(full, sendEvent);
    });
  }

  const problem = body.problem?.trim();
  if (!problem) return jsonError('缺少 problem', 400);
  if (problem.length > MAX_PROBLEM_LENGTH) return jsonError('problem 过长', 400);
  if (body.tikzCode && body.tikzCode.length > MAX_CODE_LENGTH) {
    return jsonError('tikzCode 过长', 400);
  }

  let sceneManifest = '';
  let verifiedHashAlgorithm: string | undefined;
  if (body.sceneManifest !== undefined) {
    if (
      !body.sceneManifest
      || typeof body.sceneManifest !== 'object'
      || Array.isArray(body.sceneManifest)
    ) {
      return jsonError('sceneManifest 必须是对象', 400);
    }
    try {
      sceneManifest = JSON.stringify(body.sceneManifest);
    } catch {
      return jsonError('sceneManifest 无法序列化', 400);
    }
    if (sceneManifest.length > MAX_MANIFEST_LENGTH) {
      return jsonError('sceneManifest 过长', 400);
    }
    const manifest = body.sceneManifest as {
      schemaVersion?: unknown;
      sourceHash?: unknown;
      hashAlgorithm?: unknown;
      sourceRevision?: unknown;
    };
    if (manifest.schemaVersion !== 1) {
      return jsonError('sceneManifest 版本不受支持', 400);
    }
    if (typeof body.tikzCode !== 'string') {
      return jsonError('sceneManifest 缺少对应 tikzCode', 400);
    }
    const expectedDigest = await hashSourceAsync(body.tikzCode);
    const expectedHash = expectedDigest.hash;
    if (
      manifest.sourceHash !== expectedHash
      || manifest.hashAlgorithm !== expectedDigest.algorithm
      || body.sourceHash !== expectedHash
    ) {
      return jsonError('sceneManifest 与当前源码不匹配', 409);
    }
    verifiedHashAlgorithm = expectedDigest.algorithm;
    if (
      !Number.isInteger(body.sourceRevision)
      || manifest.sourceRevision !== body.sourceRevision
    ) {
      return jsonError('sceneManifest revision 不匹配', 409);
    }
  }

  let semanticKernel = '';
  const contextRefs = Array.isArray(body.contextRefs)
    ? [...new Set(body.contextRefs
      .filter((reference): reference is string => typeof reference === 'string')
      .map((reference) => reference.trim())
      .filter(Boolean))]
      .slice(0, 64)
    : [];
  if (
    body.contextRefs !== undefined
    && (
      !Array.isArray(body.contextRefs)
      || body.contextRefs.some((reference) => (
        typeof reference !== 'string'
        || reference.length > 256
      ))
    )
  ) {
    return jsonError('contextRefs must be a bounded string array', 400);
  }

  let proposalIdentity: {
    documentId: string;
    epoch: string;
    sourceId: string;
    hashAlgorithm: string;
    pluginSetDigest: string;
    contextRefs: readonly string[];
    focusEntityIds: readonly string[];
    readBindingIds: readonly string[];
    bindings: readonly AiPatchBindingContext[];
  } | null = null;
  if (body.semanticKernel !== undefined) {
    if (
      !body.semanticKernel
      || typeof body.semanticKernel !== 'object'
      || Array.isArray(body.semanticKernel)
    ) {
      return jsonError('semanticKernel must be an object', 400);
    }
    try {
      semanticKernel = JSON.stringify(body.semanticKernel);
    } catch {
      return jsonError('semanticKernel is not serializable', 400);
    }
    if (semanticKernel.length > MAX_SEMANTIC_KERNEL_LENGTH) {
      return jsonError('semanticKernel is too large', 400);
    }
    const kernel = body.semanticKernel as {
      schemaVersion?: unknown;
      basis?: {
        revision?: unknown;
        sourceHash?: unknown;
        documentId?: unknown;
        epoch?: unknown;
        sourceId?: unknown;
        hashAlgorithm?: unknown;
        pluginSetDigest?: unknown;
      };
      focus?: {
        requestedRefs?: unknown;
        closureEntityIds?: unknown;
      };
      construction?: {
        authorizedBindingIds?: unknown;
        sourceBindings?: unknown;
      };
    };
    if (kernel.schemaVersion !== 'geometry-ai-context/v1') {
      return jsonError('unsupported semanticKernel version', 400);
    }
    if (
      !kernel.basis
      || kernel.basis.revision !== body.sourceRevision
      || kernel.basis.sourceHash !== body.sourceHash
      || typeof kernel.basis.documentId !== 'string'
      || kernel.basis.documentId.length === 0
      || typeof kernel.basis.epoch !== 'string'
      || kernel.basis.epoch.length === 0
      || typeof kernel.basis.sourceId !== 'string'
      || kernel.basis.sourceId !== `${kernel.basis.documentId}:tikz`
      || typeof kernel.basis.hashAlgorithm !== 'string'
      || kernel.basis.hashAlgorithm !== verifiedHashAlgorithm
        || kernel.basis.pluginSetDigest !== TIKZ_PLUGIN_SET_DIGEST
    ) {
      return jsonError('semanticKernel does not match the source snapshot', 409);
    }
    const requestedRefs = Array.isArray(kernel.focus?.requestedRefs)
      ? kernel.focus.requestedRefs.filter(
        (reference): reference is string => typeof reference === 'string',
      )
      : null;
    const closureEntityIds = Array.isArray(kernel.focus?.closureEntityIds)
      ? kernel.focus.closureEntityIds.filter(
        (entityId): entityId is string => typeof entityId === 'string',
      )
      : null;
    if (
      !requestedRefs
      || !closureEntityIds
      || requestedRefs.length !== contextRefs.length
      || requestedRefs.some((reference, index) => reference !== contextRefs[index])
    ) {
      return jsonError('semanticKernel focus does not match contextRefs', 409);
    }
    const source = body.tikzCode ?? '';
    const sourceRevision = body.sourceRevision as number;
    const serverContext = buildGeometryAiContext(
      projectTikzAnalysisToGeometryTruth({
        analysis: analyze(source, sourceRevision),
        source,
        basis: {
          documentId: kernel.basis.documentId,
          epoch: kernel.basis.epoch,
          revision: sourceRevision,
          sourceHash: body.sourceHash as string,
          sourceId: kernel.basis.sourceId,
          pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
        },
        hashAlgorithm: verifiedHashAlgorithm as string,
      }),
      {
        maxEntities: 220,
        maxConstraints: 160,
        maxRelations: 280,
        maxBindings: 220,
        maxOpaqueNodes: 96,
        focusRefs: contextRefs,
        focusDepth: 3,
      },
    );
    if (
      closureEntityIds.length !== serverContext.focus.closureEntityIds.length
      || closureEntityIds.some(
        (entityId, index) => entityId !== serverContext.focus.closureEntityIds[index],
      )
    ) {
      return jsonError('semanticKernel focus closure is not server-attested', 409);
    }
    semanticKernel = JSON.stringify(serverContext);
    const sourceBindings: readonly unknown[] = serverContext.construction.sourceBindings;
    const bindings = sourceBindings.flatMap((value): AiPatchBindingContext[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const binding = value as {
        id?: unknown;
        sourceId?: unknown;
        range?: { start?: unknown; end?: unknown };
        writable?: unknown;
        opaque?: unknown;
        insertionPolicy?: unknown;
        sliceHash?: unknown;
        writeCapabilities?: unknown;
        managedConstructionId?: unknown;
        managedPlanKind?: unknown;
        managedContentFingerprint?: unknown;
      };
      if (
        typeof binding.id !== 'string'
        || binding.id.length === 0
        || binding.sourceId !== kernel.basis!.sourceId
        || !Number.isInteger(binding.range?.start)
        || !Number.isInteger(binding.range?.end)
        || (binding.range?.start as number) < 0
        || (binding.range?.end as number) < (binding.range?.start as number)
        || (binding.range?.end as number) > (body.tikzCode?.length ?? 0)
        || typeof binding.writable !== 'boolean'
        || binding.opaque !== false
        || !(
          binding.insertionPolicy === 'none'
          || binding.insertionPolicy === 'tikzpicture-body'
          || binding.insertionPolicy === 'full-document'
        )
        || (
          binding.sliceHash !== undefined
          && typeof binding.sliceHash !== 'string'
        )
        || !Array.isArray(binding.writeCapabilities)
        || binding.writeCapabilities.some((capability) => (
          capability !== 'create-managed-construction'
          && capability !== 'replace-managed-construction'
        ))
        || (
          binding.managedConstructionId !== undefined
          && typeof binding.managedConstructionId !== 'string'
        )
        || (
          binding.managedPlanKind !== undefined
          && typeof binding.managedPlanKind !== 'string'
        )
        || (
          binding.managedContentFingerprint !== undefined
          && typeof binding.managedContentFingerprint !== 'string'
        )
      ) return [];
      return [{
        bindingId: binding.id,
        sourceId: binding.sourceId as string,
        range: {
          start: binding.range!.start as number,
          end: binding.range!.end as number,
        },
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.insertionPolicy,
        writeCapabilities: binding.writeCapabilities as AiPatchBindingContext['writeCapabilities'],
        ...(typeof binding.managedConstructionId === 'string'
          ? { managedConstructionId: binding.managedConstructionId }
          : {}),
        ...(typeof binding.managedPlanKind === 'string'
          ? { managedPlanKind: binding.managedPlanKind }
          : {}),
        ...(typeof binding.managedContentFingerprint === 'string'
          ? { managedContentFingerprint: binding.managedContentFingerprint }
          : {}),
        ...(typeof binding.sliceHash === 'string'
          ? { sliceHash: binding.sliceHash }
          : {}),
      }];
    });
    if (
      bindings.length !== sourceBindings.length
      || new Set(bindings.map((binding) => binding.bindingId)).size !== bindings.length
    ) {
      return jsonError('semanticKernel contains invalid or duplicate source bindings', 400);
    }
    const managedBlocks = parseManagedConstructionBlocks(body.tikzCode ?? '');
    const invalidWriteCapability = bindings.some((binding) => {
      const capabilities = binding.writeCapabilities ?? [];
      if (capabilities.includes('create-managed-construction')) {
        if (
          binding.bindingId !== 'binding:document:tikzpicture-body-end'
          || !binding.writable
        ) return true;
      }
      if (!capabilities.includes('replace-managed-construction')) return false;
      if (
        binding.writable
        || !binding.managedConstructionId
        || !binding.managedPlanKind
        || !binding.managedContentFingerprint
      ) return true;
      const matches = managedBlocks.filter((block) => (
        block.id === binding.managedConstructionId
        && block.range.start === binding.range.start
        && block.range.end === binding.range.end
      ));
      const match = matches[0];
      return matches.length !== 1
        || !match
        || match.planKind !== binding.managedPlanKind
        || match.contentFingerprint !== binding.managedContentFingerprint
        || match.metadataStatus !== 'valid'
        || match.integrityStatus !== 'valid';
    });
    if (invalidWriteCapability) {
      return jsonError('semanticKernel contains an unattested semantic write capability', 409);
    }
    const focusEntityIdSet = new Set(closureEntityIds);
    const readBindingIds = sourceBindings.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const binding = value as { id?: unknown; entityIds?: unknown };
      if (typeof binding.id !== 'string' || !Array.isArray(binding.entityIds)) return [];
      return (
        binding.id === 'binding:document:tikzpicture-body-end'
        || binding.entityIds.some((entityId) => (
          typeof entityId === 'string' && focusEntityIdSet.has(entityId)
        ))
      )
        ? [binding.id]
        : [];
    });
    const declaredAuthorizedBindingIds = Array.isArray(
      kernel.construction?.authorizedBindingIds,
    )
      ? kernel.construction.authorizedBindingIds
      : [];
    if (
      declaredAuthorizedBindingIds.length !== readBindingIds.length
      || declaredAuthorizedBindingIds.some(
        (bindingId, index) => bindingId !== readBindingIds[index],
      )
    ) {
      return jsonError(
        'semanticKernel authorized binding scope does not match focus closure',
        409,
      );
    }
    const sourceIsEmpty = (body.tikzCode ?? '').trim().length === 0;
    const invalidInsertionPolicy = bindings.some((binding) => {
      if (binding.bindingId !== 'binding:document:tikzpicture-body-end') {
        return binding.insertionPolicy !== 'none';
      }
      return binding.insertionPolicy !== (
        sourceIsEmpty ? 'full-document' : 'tikzpicture-body'
      );
    });
    if (invalidInsertionPolicy) {
      return jsonError(
        'semanticKernel insertion policy does not match the source document',
        409,
      );
    }
    proposalIdentity = {
      documentId: kernel.basis.documentId,
      epoch: kernel.basis.epoch,
      sourceId: kernel.basis.sourceId,
      hashAlgorithm: kernel.basis.hashAlgorithm,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      contextRefs,
      focusEntityIds: closureEntityIds,
      readBindingIds,
      bindings,
    };
  }

  const system = buildTikzSystemPrompt(problem, {
    previousCode: typeof body.tikzCode === 'string' ? body.tikzCode : undefined,
    sceneManifest: sceneManifest || undefined,
    semanticContext: semanticKernel || undefined,
  });
  const messages: Message[] = [
    ...normalizedHistory(body.history),
    { role: 'user', content: problem },
  ];
  return makeSseStream(async (send, sendEvent) => {
    sendEvent({ model });
    const full = await streamProvider(
      provider,
      messages,
      send,
      cfg,
      model,
      system,
      { reasoningTarget: proposalIdentity ? 'tikz-patch' : 'tikz' },
    );
    if (
      proposalIdentity
      && typeof body.tikzCode === 'string'
      && Number.isInteger(body.sourceRevision)
      && typeof body.sourceHash === 'string'
    ) {
      emitRevisionBoundSourceProposal(full, sendEvent, {
        source: body.tikzCode,
        revision: body.sourceRevision!,
        sourceHash: body.sourceHash,
        documentId: proposalIdentity.documentId,
        epoch: proposalIdentity.epoch,
        sourceId: proposalIdentity.sourceId,
        hashAlgorithm: proposalIdentity.hashAlgorithm,
        pluginSetDigest: proposalIdentity.pluginSetDigest,
        contextRefs: proposalIdentity.contextRefs,
        focusEntityIds: proposalIdentity.focusEntityIds,
        readBindingIds: proposalIdentity.readBindingIds,
        bindings: proposalIdentity.bindings,
      });
    }
    if (!proposalIdentity) emitCode(full, sendEvent);
  });
}
