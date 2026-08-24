import { hashSource } from '../document/source-hash';
import {
  AI_PATCH_PROPOSAL_SCHEMA_VERSION,
  type AiPatchBindingContext,
  type AiPatchProposal,
  type AiPatchProposalBasis,
} from '../ir/ai-patch-proposal';
import { sanitizeTikz } from './extract-tikz';
import { classifyTikzExecutableEnvelopes } from '../agent/executable-envelope';

export interface AiSourceCandidateBasis extends AiPatchProposalBasis {
  source: string;
  bindings: readonly AiPatchBindingContext[];
  readBindingIds: readonly string[];
  userIntent?: string;
}

export type LowerAiSourceCandidateResult =
  | { status: 'none' }
  | { status: 'rejected'; message: string }
  | { status: 'proposal'; proposal: AiPatchProposal };

function containsTikzpictureEnvironment(source: string): boolean {
  return /\\(?:begin|end)\s*\{tikzpicture\}/u.test(source);
}

function bodyInsertion(source: string, offset: number, body: string): string {
  const trimmed = body.trim();
  const prefix = offset > 0 && source[offset - 1] !== '\n' ? '\n' : '';
  const suffix = source[offset] && source[offset] !== '\n' ? '\n' : '';
  return `${prefix}${trimmed}${trimmed.endsWith('\n') ? '' : '\n'}${suffix}`;
}

export function isExplicitReadOnlyGeometryIntent(
  userIntent: string | undefined,
): boolean {
  if (!userIntent) return false;
  // Target-scoped safeguards such as "不要修改其他对象" belong to a write
  // request and must not accidentally downgrade the entire turn to read-only.
  // A no-write override is therefore accepted only when it names the whole
  // document/surface, is an explicit explanation request, or ends as a bare
  // prohibition.
  return /(?:只读|不(?:要)?修改(?:画板|图形|源码|代码)|不(?:要)?修改(?=$|[\s，。！？,.!?；;])|保持(?:画板|图形|源码|代码)不变|不要写入|不写入|仅解释|只解释|read[ -]?only|do\s+not\s+(?:modify|change|edit|write)(?:\s+the)?\s+(?:canvas|drawing|source|code|document)|do\s+not\s+(?:modify|change|edit|write)(?=$|\s*[.!?])|without\s+(?:modifying|changing|editing|writing)\s+(?:anything|(?:the\s+)?(?:canvas|drawing|source|code|document)))/iu
    .test(userIntent);
}

export function isExplicitCreateGeometryIntent(userIntent: string | undefined): boolean {
  if (!userIntent) return false;
  if (isExplicitReadOnlyGeometryIntent(userIntent)) return false;
  const create = /(?:\u8ffd\u52a0|\u65b0\u589e|\u6dfb\u52a0|\u65b0\u5efa|\u521b\u5efa|\u753b\u4e00|\u753b\u51fa|\u4f5c\u4e00|\u505a\u51fa|\u7ed8\u5236|\u91cd\u753b|\u6784\u9020\u4e00|\b(?:add|append|create|insert|draw|redraw)\b)/iu;
  if (!create.test(userIntent)) return false;
  const directRequest = /(?:\u8bf7|\u5e2e\u6211|\u7ed9\u6211|\u66ff\u6211).{0,12}(?:\u753b|\u4f5c|\u6784\u9020|\u521b\u5efa|\u65b0\u589e|\u6dfb\u52a0)/iu;
  if (directRequest.test(userIntent)) return true;
  const question = /(?:\u5982\u4f55|\u600e\u4e48|\u600e\u6837|\u4e3a\u4ec0\u4e48|\u4e3a\u4f55|\u4ec0\u4e48\u662f|\u89e3\u91ca|\u8bf4\u660e|\u4ecb\u7ecd|\u6559\u7a0b|\u8bed\u6cd5|\bhow\s+(?:do|can|to)\b|\bwhy\b|\bexplain\b|[?\uff1f])/iu;
  return !question.test(userIntent);
}

/**
 * Conservative host-side mutation gate. Model output is never evidence that
 * the user authorized a write: questions/explanations stay answer-only even
 * if a reasoning model happens to emit a syntactically valid proposal.
 */
export function isExplicitGeometryMutationIntent(
  userIntent: string | undefined,
): boolean {
  if (!userIntent) return false;
  // A user-authored, explicit no-write instruction is stronger than generic
  // words such as "draw", "flow diagram", or "show" that may occur inside a
  // request for a read-only explanatory widget.
  if (isExplicitReadOnlyGeometryIntent(userIntent)) return false;
  const question = /(?:\u5982\u4f55|\u600e\u4e48|\u600e\u6837|\u4e3a\u4ec0\u4e48|\u4e3a\u4f55|\u4ec0\u4e48\u662f|\u89e3\u91ca|\u8bf4\u660e|\u4ecb\u7ecd|\u6559\u7a0b|\u8bed\u6cd5|\bhow\s+(?:do|can|to)\b|\bwhy\b|\bexplain\b|[?\uff1f])/iu;
  if (question.test(userIntent)) return false;
  if (isExplicitCreateGeometryIntent(userIntent)) return true;
  return /(?:\u4fee\u6539|\u66f4\u6539|\u66ff\u6362|\u8c03\u6574|\u6539\u4e3a|\u6539\u6210|\u53d8\u6210|\u8bbe\u4e3a|\u6d82\u6210|\u67d3\u6210|\u79fb\u52a8|\u79fb\u5230|\u62d6\u52a8|\u65cb\u8f6c|\u7f29\u653e|\u53cd\u5c04|\u955c\u50cf|\u5220\u9664|\u79fb\u9664|\u6e05\u7a7a|\u91cd\u753b|\u9690\u85cf|\u663e\u793a|\u52a0\u7c97|\u53d8\u8272|\u6539\u8272|\u52a0\u4e0a|\u8865\u4e0a|\u8865\u5168|\u589e\u52a0|\u6dfb\u52a0|\u65b0\u589e|\u6807\u6ce8|\u6807\u7b7e|\u91cd\u547d\u540d|\b(?:modify|change|update|replace|move|rotate|scale|reflect|delete|remove|clear|redraw|hide|show|style|label|annotate|rename|add|apply)\b)/iu.test(userIntent);
}

/**
 * Lower a provider's plain TikZ deliverable into the same revision-bound write
 * proposal used by the Broker. The provider never chooses identity, ranges,
 * hashes, or write authority in this compatibility lane.
 */
export function lowerAiSourceCandidate(
  modelOutput: string,
  basis: AiSourceCandidateBasis,
): LowerAiSourceCandidateResult {
  const executable = classifyTikzExecutableEnvelopes(modelOutput);
  const actionBodies = executable.envelopes
    .filter((item) => item.kind === 'plain-action')
    .map((item) => item.body)
    .filter(Boolean);
  if (executable.malformed) {
    return { status: 'rejected', message: 'TikZ action batch 包含未闭合的可执行动作块。' };
  }
  if (executable.plainActionCount > 0 && actionBodies.length === 0) {
    return { status: 'rejected', message: 'TikZ action batch 不能只包含空动作块。' };
  }
  if (actionBodies.length === 0) return { status: 'none' };
  if (
    executable.toolCount > 0
    || executable.typedActionCount > 0
  ) {
    return { status: 'rejected', message: '普通 TikZ 动作不能与工具调用、typed 修改或未闭合动作块混合。' };
  }
  if (actionBodies.length !== executable.plainActionCount) {
    return { status: 'rejected', message: 'TikZ action batch 不能包含空动作块。' };
  }
  if (actionBodies.length > 16) {
    return { status: 'rejected', message: '单轮 TikZ action batch 最多包含 16 个动作块。' };
  }
  if (basis.source.length === 0 && actionBodies.length > 1) {
    return { status: 'rejected', message: '空白画板只接受一个完整 tikzpicture 动作块。' };
  }
  const extracted = actionBodies.join('\n');
  if (extracted.length > 96_000) {
    return { status: 'rejected', message: '单轮 TikZ action batch 超过 96000 字符的安全上限。' };
  }

  const sanitized = sanitizeTikz(extracted);
  if (sanitized.stripped.length > 0) {
    return {
      status: 'rejected',
      message: `候选代码包含禁止命令：${sanitized.stripped.join('、')}`,
    };
  }

  const insertionBinding = basis.bindings.find((binding) => (
    binding.bindingId === 'binding:document:tikzpicture-body-end'
  ));
  let candidate: string;
  let binding: AiPatchBindingContext;
  let patch: { from: number; to: number; insert: string };
  if (basis.source.length === 0) {
    if (!containsTikzpictureEnvironment(sanitized.code)) {
      return {
        status: 'rejected',
        message: '空白画板需要完整的 tikzpicture 环境。',
      };
    }
    if (
      !insertionBinding
      || insertionBinding.insertionPolicy !== 'full-document'
      || !insertionBinding.writable
      || insertionBinding.opaque
      || !basis.readBindingIds.includes(insertionBinding.bindingId)
    ) {
      return {
        status: 'rejected',
        message: 'The current empty document has no verified full-document insertion capability.',
      };
    }
    candidate = sanitized.code;
    binding = insertionBinding;
    patch = { from: 0, to: 0, insert: candidate };
  } else if (!containsTikzpictureEnvironment(sanitized.code)) {
    if (!isExplicitCreateGeometryIntent(basis.userIntent)) {
      return {
        status: 'rejected',
        message: '非空画板只有明确的新增构造请求可以使用末尾插入；修改既有对象必须针对其授权 binding 提交 typed patch。',
      };
    }
    if (
      !insertionBinding
      || insertionBinding.insertionPolicy !== 'tikzpicture-body'
      || !insertionBinding.writable
      || insertionBinding.opaque
      || !basis.readBindingIds.includes(insertionBinding.bindingId)
    ) {
      return {
        status: 'rejected',
        message: '当前文档没有可验证的 TikZ 画板插入点。',
      };
    }
    const insert = bodyInsertion(
      basis.source,
      insertionBinding.range.start,
      sanitized.code,
    );
    candidate = `${basis.source.slice(0, insertionBinding.range.start)}${insert}${basis.source.slice(insertionBinding.range.end)}`;
    binding = insertionBinding;
    // An explicit tikz-action means "append these statements". Build the
    // operation directly from the attested zero-width insertion capability.
    // Whole-document diffs can collapse matching suffixes into unrelated
    // semantic bindings, especially for multi-statement actions.
    patch = {
      from: insertionBinding.range.start,
      to: insertionBinding.range.end,
      insert,
    };
  } else {
    return {
      status: 'rejected',
      message: 'A non-empty canvas accepts TikZ body statements only; full-document replacement is not authorized.',
    };
  }

  const kind = patch.from === patch.to
    ? 'insert' as const
    : patch.insert.length === 0
      ? 'delete' as const
      : 'replace' as const;
  const identity = `ai-lowered-${hashSource(`${basis.sourceHash}\n${candidate}`)}`;
  return {
    status: 'proposal',
    proposal: {
      schemaVersion: AI_PATCH_PROPOSAL_SCHEMA_VERSION,
      proposalId: identity,
      idempotencyKey: identity,
      basis: {
        documentId: basis.documentId,
        epoch: basis.epoch,
        revision: basis.revision,
        sourceHash: basis.sourceHash,
        sourceId: basis.sourceId,
        hashAlgorithm: basis.hashAlgorithm,
        ...(basis.kernelHash ? { kernelHash: basis.kernelHash } : {}),
        ...(basis.projectionHash ? { projectionHash: basis.projectionHash } : {}),
        ...(basis.pluginSetDigest ? { pluginSetDigest: basis.pluginSetDigest } : {}),
      },
      focusBindingIds: [binding.bindingId],
      readBindingIds: [binding.bindingId],
      operations: [{
        operationId: `${identity}:source`,
        kind,
        bindingId: binding.bindingId,
        sourceId: binding.sourceId,
        range: { start: patch.from, end: patch.to },
        insert: patch.insert,
        expectedText: basis.source.slice(patch.from, patch.to),
        preconditions: {
          sourceId: binding.sourceId,
          range: { start: patch.from, end: patch.to },
          writable: true,
          opaque: false,
        },
      }],
      rationale: 'Server-lowered from an untrusted plain TikZ candidate.',
      metadata: {
        loweredBy: 'tikz-agent-runtime/v1',
        providerSuppliedAuthority: false,
        actionBlockCount: actionBodies.length,
        atomicBatch: actionBodies.length > 1,
      },
    },
  };
}
