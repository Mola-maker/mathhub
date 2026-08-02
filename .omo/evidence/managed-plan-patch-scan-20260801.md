# Managed construction typed plan patch 架构扫描

日期：2026-08-01  
范围：只读扫描现有仓库；本文件只提出最小闭环，不修改实现，不运行 test/build/lint/typecheck。

## 结论

当前仓库已经具备 managed construction 的三块重要基础，但还没有“修改已有受管构造”的语义闭环：

1. `ConstructionPlan -> compileConstructionPlan() -> schema-v2 managed block` 已存在，且编译器不接受默认的任意 source body（`lib/tikz/authoring/construction-ir.ts:2056-2108`）。
2. managed block parser 会原子校验 record 形状、引用闭包和 `content-fingerprint`，并把 detached/invalid block 降为只读（`lib/tikz/semantics/managed-construction.ts:1114-1142,1169-1209,1211-1323`）。
3. `TikzTransactionBroker` 已用 document epoch、revision、whole-source hash、read/write set、slice CAS 和 CodeMirror-backed `StudioDocument` 提交源码事务（`lib/tikz/transactions/broker.ts:280-378,380-539`; `lib/tikz/document/studio-document.ts:188-229`）。

缺口是反向路径：仓库没有 `ManagedConstructionBlock -> ConstructionPlan` decoder，也没有 typed managed mutation proposal。managed bindings 被正确标成 `writable:false + managed-recompile-only`（`lib/tikz/ir/tikz-adapter.ts:1554-1641`），所以它们不会进入 AI 的 `authorizedBindingIds`（`lib/tikz/ir/ai-context.ts:307-320`）。当前唯一受管更新入口 `managedStyleRecompilePatches()` 接收调用者提供的 `TextPatch`，只重算 body 与 header fingerprint（`lib/tikz/authoring/managed-construction-recompile.ts:14-116`）；Inspector 对 semantic property 明确拒绝（`components/tikz/use-tikz-engine.ts:523-593`）。

因此最小正确闭环不是把 managed binding 改成 `writable:true`，而是增加一条独立、受限的 **typed plan patch lane**。普通 `ai-patch-proposal/v1` 继续永远不能 raw-patch managed block。

## 当前真实链路与断点

### Code -> IR/Canvas/AI

```text
CodeMirror source
  -> parseManagedConstructionBlocks
  -> validated records + block ranges + content fingerprint
  -> tikz-adapter managedConstructionSemantics
  -> Geometry IR / Render truth / source bindings
  -> buildGeometryAiContext summaries
```

- adapter 已把 managed records 叠加到实体、约束、关系，并建立 block/record binding（`lib/tikz/ir/tikz-adapter.ts:660-810,1554-1641`）。
- AI context 目前只提供 managed summary：input/output、record IDs、状态和 write policy，不提供可逆的 typed plan、操作能力或 block precondition（`lib/tikz/ir/tikz-adapter.ts:1348-1414`; `lib/tikz/ir/ai-context.ts:144-152,246-337`）。
- `sourceReference()` 当前没有计算 `sliceHash`，所以 AI context 的可选 `sliceHash` 通常为空（`lib/tikz/ir/tikz-adapter.ts:63-72`; `lib/tikz/ir/ai-context.ts:286-305`）。

### AI -> Code

```text
AI ai-patch-proposal/v1
  -> binding/range/expectedText validation
  -> source-patch GeometryTransactionRequest
  -> server candidate analyze
  -> client revalidation
  -> Broker
  -> StudioDocument / CodeMirror transaction
```

- 这条 lane 对普通 writable binding 是合理的（`lib/tikz/ir/ai-patch-proposal.ts:13-20,387-621,643-741`）。
- managed binding 是只读，因此无法修改已有 managed plan；这是安全边界，不应解除。
- 当前 prompt 也只允许 `insert|replace|delete` 源码操作，并要求 `writable=true`（`lib/tikz/prompt/tikz-system-prompt.ts:43-105`）。
- API 与客户端分别调用 `compileAiPatchProposal()`，再各自预分析候选源码（`app/api/tikz/route.ts:82-154`; `components/tikz-studio.tsx:545-629`）。typed managed proposal 应复用这一“双重验证”结构，而不是让客户端信任服务端下发的 raw block。

### Canvas/Inspector -> Code

- 普通图元使用 direct source patch。
- managed style 通过 `managedStyleRecompilePatches()` 整块替换并更新 fingerprint。
- managed semantic property 被拒绝为 `managed-property-requires-semantic-recompile`（`components/tikz/use-tikz-engine.ts:552-569`）。
- selection resolution 已能区分 `direct | managed-recompile | read-only`，并校验当前 revision/hash/source identity（`lib/tikz/authoring/selection-resolution.ts:254-328`）；它可以直接成为 typed lane 的入口能力判断。

## 最小目标架构

```text
AI managed proposal       Canvas/Inspector semantic intent
          \                         /
           -> ManagedPlanPatchProposal (typed, no source text)
                           |
              validateManagedPlanPatchProposal
                           |
             ManagedConstructionCodecRegistry
          block records -> decode -> ConstructionPlan
                           |
                  apply whitelisted ops
                           |
          assertConstructionPlan + evaluate/preflight
                           |
     compileConstructionPlan(plan, presentation overlay)
                           |
        exactly one valid same-id managed block replacement
                           |
       GeometryTransactionRequest (exact whole-block range)
                           |
       TikzTransactionBroker -> StudioDocument -> CodeMirror
                           |
          parse/project new revision -> Canvas + AI context
```

Code 仍是唯一持久化事实源。Plan、IR、Canvas 和 AI context 都是 `revision + sourceHash` 绑定的投影；typed proposal 是输入协议，不是第二份可独立保存的文档。

## 必需的准确类型

建议新增 `lib/tikz/authoring/managed-construction-codec.ts`：

```ts
export interface ManagedPresentationIR {
  readonly styles: readonly {
    readonly id: string;
    readonly targetEntityId: string;
    readonly properties: Readonly<{
      strokeColor?: string;
      fillColor?: string;
      lineWidthPt?: number;
      dash?: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
      arrow?: 'none' | 'forward' | 'both';
      opacity?: number;
      fillOpacity?: number;
      labelAnchor?: 'above' | 'below' | 'left' | 'right'
        | 'above-left' | 'above-right' | 'below-left' | 'below-right';
    }>;
  }[];
}

export interface DecodedManagedConstruction<P extends ConstructionPlan = ConstructionPlan> {
  readonly block: ManagedConstructionBlock;
  readonly plan: P;
  readonly presentation: ManagedPresentationIR;
  readonly planFingerprint: string;
  readonly editableOperations: readonly ManagedPlanMutation['op'][];
}

export interface ManagedConstructionCodec<P extends ConstructionPlan> {
  readonly planKind: P['kind'];
  decode(block: ManagedConstructionBlock, source: string): DecodedManagedConstruction<P>;
  capabilities(value: DecodedManagedConstruction<P>): readonly ManagedPlanMutation['op'][];
  apply(
    value: DecodedManagedConstruction<P>,
    operations: readonly ManagedPlanMutation[],
    lookup: ManagedReferenceLookup,
  ): { readonly plan: P; readonly presentation: ManagedPresentationIR };
}
```

Codec 必须按 `ConstructionPlanKind` 注册。top-level 的 `a/b/center/result/...` 由 input/output role、entity 和 constraint records 恢复，不能从 TikZ body 猜；每次 `apply()` 后重新生成 entities/constraints/relations/outputs，禁止直接改某一条 record 导致镜像字段分裂。

建议新增 `lib/tikz/ir/managed-plan-patch.ts`：

```ts
export const MANAGED_PLAN_PATCH_SCHEMA_VERSION = 'managed-plan-patch/v1' as const;

export interface ManagedPlanPatchBasis {
  readonly documentId: string;
  readonly documentEpoch: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly hashAlgorithm: string;
  readonly kernelHash?: string;
  readonly pluginSetDigest?: string;
}

export interface ManagedBlockPrecondition {
  readonly bindingId: string;
  readonly constructionId: string;
  readonly blockRange: SourceRange;
  readonly blockSliceHash: string;
  readonly sliceHashAlgorithm: 'fnv1a64-utf8';
  readonly contentFingerprint: string;
  readonly planFingerprint: string;
  readonly schemaVersion: 2 | 3;
  readonly metadataStatus: 'valid';
  readonly integrityStatus: 'valid';
}

export type ManagedPlanMutation =
  | {
      readonly op: 'set-input-ref';
      readonly inputId: string;
      readonly expectedRef: string;
      readonly nextRef: string;
    }
  | {
      readonly op: 'set-free-point-position';
      readonly entityId: string;
      readonly expected: readonly [number, number];
      readonly next: readonly [number, number];
    }
  | {
      readonly op: 'set-construction-scalar';
      readonly parameter: 'circle-angle-degrees' | 'literal-circle-radius';
      readonly expected: number;
      readonly next: number;
    }
  | {
      readonly op: 'set-label-text';
      readonly entityId: string;
      readonly expected: string;
      readonly next: string;
    }
  | {
      readonly op: 'set-style-property';
      readonly entityId: string;
      readonly property: keyof ManagedPresentationIR['styles'][number]['properties'];
      readonly expected: JsonValue;
      readonly next: JsonValue;
    }
  | {
      readonly op: 'delete-construction';
      readonly cascade: 'reject';
    };

export interface ManagedPlanPatchOperation {
  readonly operationId: string;
  readonly precondition: ManagedBlockPrecondition;
  readonly mutations: readonly ManagedPlanMutation[];
}

export interface ManagedPlanPatchProposal {
  readonly schemaVersion: typeof MANAGED_PLAN_PATCH_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly idempotencyKey: string;
  readonly basis: ManagedPlanPatchBasis;
  readonly operations: readonly ManagedPlanPatchOperation[];
}
```

函数边界必须固定为：

```ts
decodeManagedConstructionPlan(block, source, registry): DecodedManagedConstruction;
validateManagedPlanPatchProposal(value, context): ValidationResult;
applyManagedPlanMutations(decoded, mutations, lookup): DecodedManagedConstruction;
compileManagedConstructionReplacement(source, decoded, next): TextPatch;
compileManagedPlanPatchTransaction(proposal, context): GeometryTransactionRequest;
```

`compileManagedConstructionReplacement()` 只返回 `{from:block.range.start,to:block.range.end,insert:compiledBlock}`。它必须重新调用 `compileConstructionPlan()`，再对 `insert` 调用 `parseManagedConstructionBlocks()`，要求：恰好一个 block、range 覆盖全部 insert、ID/planKind 不变、schema 支持、metadata/integrity 均 valid。然后把候选全文交给现有 `analyze()` 预检。

## precondition：revision / CAS / hash / fingerprint

这里必须澄清术语：仓库当前**没有 CRC**。现有同步 `hashSource()` 是 FNV-1a 64-bit 的 staleness identity，不是密码学证明；异步环境可用 SHA-256（`lib/tikz/document/source-hash.ts:40-69`）。不要新增 CRC32 作为并发保护，它比现有 hash 更弱。这里需要的是 compare-and-swap（CAS）和多层 fingerprint：

| 层 | 必须校验 | 目的 |
|---|---|---|
| document identity | `documentId + documentEpoch + sourceId` | 拒绝跨文档/换代历史 |
| source revision | `sourceRevision === snapshot.revision` | 最快的乐观并发门 |
| whole source | `sourceHash` 与当前 exact source 一致 | 拒绝同 revision 的错误基线 |
| semantic/runtime | `kernelHash + pluginSetDigest`（存在时必比） | 拒绝旧语义投影/旧 codec 集 |
| exact block CAS | `blockRange + blockSliceHash` | 保护 CRLF、注释、空白在内的原字节片段 |
| managed attachment | header `contentFingerprint === expected` 且 `actualContentFingerprint === expected` | 确认 records 与 body 仍绑定 |
| semantic projection | canonical `planFingerprint` | 确认 AI/Canvas 读到的 plan 未改变 |
| field CAS | 每个 mutation 的 `expected*` | 拒绝同一 plan 上的字段级竞态 |
| idempotency | broker `requestFingerprint` | 同 key 同内容可重放，不同内容拒绝 |

当前 `GeometryPrecondition` 和 `SourceTextPatch` 已声明 `sliceHash/expectedSliceHash`（`lib/tikz/ir/transactions.ts:45-78`; `lib/tikz/ir/model.ts:80-87`），但 Broker 实际只校验 `text/expectedText`，没有校验 slice hash（`lib/tikz/transactions/broker.ts:396-420,450-462`）。在 managed lane 使用 `blockSliceHash` 前必须补齐 Broker 的 hash 分支，并在 `sourceReference()` 中产生 slice hash。算法字段不能隐式复用 whole-source 的 SHA-256；v1 明确固定 block slice 为 `fnv1a64-utf8`，以后再版本化升级。

## 可接受操作白名单

v1 只开放以下语义意图；每个 codec 还要进一步缩小 capability：

1. `set-input-ref`：按稳定 `inputId` 修改构造输入，并要求 `expectedRef`。codec 同步更新 plan 顶层字段，重新生成所有依赖 records。`nextRef` 必须由当前 revision 的 `ManagedReferenceLookup` 解析，且实体 kind 满足该 role。
2. `set-free-point-position`：只允许 `primitive(point)` 且 entity 有 literal position；所有 derived point 拒绝，不能冻结约束。
3. `set-construction-scalar`：仅枚举过的 scalar；数值必须 finite，并满足参数域（radius > 0，角度按 codec 约束）。不能接收任意 JSON Pointer。
4. `set-label-text`：只允许 managed primitive label；限制长度、单行、括号平衡并复用 TeX 禁止命令校验。在安全 inline-text serializer 完成前，这项 capability 应返回 unavailable。
5. `set-style-property`：只允许上面类型中列出的样式键和值域。调用者不能传 `raw` option string 或 source range。CST/source patch 只能作为 compiler 内部实现细节。
6. `delete-construction`：只整块删除，v1 仅 `cascade:'reject'`；如果 dependency graph 有下游引用则拒绝。后续再引入显式 dependents 事务。

明确禁止：

- `replace-body`、`insert-source`、`replace-record-json`、任意 JSON Pointer、任意 `sourceWriterHint`；
- 修改 construction ID、output name、entity ID、plan kind（会破坏跨 block/raw TikZ 引用）；
- 直接移动 derived point、直接改 constraint result、把 calc/intersection 写死为坐标；
- 混入 `@mathgeo begin/end/record`、宏、preamble 或任意调用者提供的 TikZ lines；
- 对 legacy、unsupported、detached、invalid、duplicate-ID、opaque-writer 或 codec-unknown block 写入。

## presentation/style 是语义重编译前的阻断项

当前 records 没有持久化 style，`ConstructionPlanBase` 也没有 presentation；而 `managedStyleRecompilePatches()` 可以修改 TikZ body 并重新封印 fingerprint。若简单 decode plan 后调用 `compileConstructionPlan()`，会把用户已修改的 managed style 丢掉。

最小安全迁移方案：

1. 引入独立 `ManagedPresentationIR`，不要把视觉样式混进 Geometry Plan。
2. schema-v3 增加 typed presentation/style record；新 compiler 同时写 plan records 与 presentation records。
3. v2 block 首次 semantic edit 时，只在 codec 能从已识别的 compiler-owned CST slot 无歧义恢复全部 style 时升级到 v3；否则保持 read-only，并提示先执行显式 repair/migration。
4. 现有 `managedStyleRecompilePatches(source,id,bodyPatch)` 不再作为 UI/AI/Canvas 公共入口。改成 `set-style-property`，内部可以生成 CST patch，但最终仍整块重算 records/body/fingerprint。
5. `source-adopted` circle 不是普通 `primitive` writer 产物，应有独立 codec；未实现前只允许安全 style mutation，不能伪装成通用 primitive plan。

## AI context 与授权必须分成两类

不要把 managed binding 的 `writable` 改成 true，也不要把它塞入现有 `authorizedBindingIds`。建议扩展：

```ts
construction: {
  authorizedBindingIds: string[];              // 现有 raw source patch 权限
  authorizedManagedBindingIds: string[];       // 新 typed plan patch 权限
  sourceBindings: ...;
  managedEditBindings: readonly {
    bindingId: string;
    constructionId: string;
    planKind: ConstructionPlanKind;
    plan: JsonObject;                           // canonical compact plan view
    presentation: JsonObject;
    editableOperations: ManagedPlanMutation['op'][];
    precondition: ManagedBlockPrecondition;
  }[];
}
```

`authorizedManagedBindingIds` 只包含：当前 basis、唯一 ID、schema 2/3、metadata valid、integrity valid、codec known、presentation 可逆、位于 focus closure 的 block。managed block 继续 `writable:false`，因为它对 raw source lane 确实不可写。

AI output 增加独立的 ````tikz-managed-patch` JSON block。选择已有 managed construction 时 prompt 只能返回 `managed-plan-patch/v1`；新增普通构造或修改非 managed source 时仍用 `ai-patch-proposal/v1`。一次 proposal 内可包含多个不重叠 managed block，compiler 生成多个 whole-block patches，由 Broker 原子提交。v1 不混合 raw source operation 与 managed operation，避免授权边界模糊。

## 三端 IO 对齐

### Code 作为输入

1. 用户直接编辑源码仍进入 CodeMirror transaction。
2. parser 校验 managed block；若手改 metadata/body 导致 fingerprint mismatch，立即变为 detached/read-only，不猜语义。
3. valid block 经 codec 恢复 plan + presentation，投影给 Canvas 与 AI。
4. 所有官方但不可交互的 TikZ 继续由 lossless CST/opaque lane 原文保存并走 exact compiler；不能为了“全语法”伪造成可编辑 plan。

### Canvas 作为输入

1. hit/selection 得到 managed binding + entity ID。
2. tool/inspector 生成 typed mutation，例如 `set-input-ref` 或 `set-style-property`，不生成 body range patch。
3. `engine.commitManagedPlanPatch()` 在当前 snapshot 上重新 decode/validate/compile；不能使用 pointer-down 时缓存的旧 plan。
4. Broker 原子提交 exact whole-block patch，CodeMirror 高亮该 changed range。
5. 新 revision 重投影，Canvas 只渲染新 IR；失败时保留旧 source/IR。

### AI 作为输入

1. AI 读取 compact canonical plan、关系闭包、typed capabilities 和 precondition。
2. AI 只返回意图操作和 expected values，不返回 TikZ body。
3. API 在 trusted source 上 compile + candidate analyze；客户端收到 proposal 后基于原 base revision 再次 compile。
4. `commitManagedPlanPatch()` 走与 Canvas 完全相同的函数；AI 没有特殊 writer。

### 三者作为输出/中间态

- Source/Code：唯一持久化输出。
- Plan/Geometry IR：revision-bound semantic output，可作为 AI/Canvas 的输入，但不可脱离 basis 保存回源。
- Canvas：Render IR 输出，并产生 typed intent 输入。
- AI：读取相同 Plan/IR，产生同一种 typed intent。
- Exact TeX：只消费提交后的 source，验证视觉真值，不进入 pointer/transaction 热路径。

## 准确改动点与调用点

1. `lib/tikz/authoring/managed-construction-codec.ts`（新）：per-kind decoder/registry、presentation decoder、capability。
2. `lib/tikz/ir/managed-plan-patch.ts`（新）：proposal types、untrusted validator、transaction compiler。
3. `lib/tikz/authoring/managed-construction-recompile.ts`：把 public `TextPatch` API 收口为 typed mutation compiler；保留低层 body patch helper 为 module-private。
4. `lib/tikz/semantics/managed-construction.ts`：schema-v3 presentation record、canonical plan/presentation fingerprint；v1/v2 继续只读兼容。
5. `lib/tikz/authoring/construction-ir.ts`：writer options 接收 typed presentation，不接收 raw lines；opaque hint 仍需双重 opt-in 且不得进入 managed edit capability。
6. `lib/tikz/ir/tikz-adapter.ts`：`sourceReference()` 生成 exact slice hash；binding metadata 暴露 managed block precondition；summary 添加 codec capability，但 binding 保持 `writable:false`。
7. `lib/tikz/ir/ai-context.ts`：增加 `authorizedManagedBindingIds/managedEditBindings`，与 raw authorization 分离。
8. `lib/tikz/transactions/broker.ts`：真正校验 `sliceHash/expectedSliceHash`；managed typed compiler 生成的 whole-block patch使用 exact block read/write set。不要放宽 `managedPatchConflict()` 的 raw partial-body 禁令（当前 `lib/tikz/transactions/broker.ts:180-227`）。
9. `lib/tikz/server/extract-ai-managed-patch.ts`（新）、`lib/tikz/prompt/tikz-system-prompt.ts`、`app/api/tikz/route.ts`：增加 managed proposal 提取、trusted compile、candidate analyze；保留现有 raw proposal path。
10. `components/tikz/use-tikz-engine.ts`：增加 `commitManagedPlanPatch()`；semantic inspector 不再调用 `applyInspectorSourcePatch(TextPatch, 'semantic')`。
11. `components/tikz-studio.tsx`：像现有 raw proposal 一样客户端重验 typed proposal，再调用 engine；不直接提交服务端提供的 raw source transaction。
12. `components/tikz/tikz-style-panel.tsx` 与 Canvas tools：发 typed mutation；source range 只用于选择/高亮，不作为 managed semantic write payload。

## Broker/编译器必须保持的原子性

- 同一 construction ID 必须唯一。
- 每个 operation 的 block range 必须和 trusted projection 完全一致。
- 多个 replacement range 不重叠；一次请求只有一个 CodeMirror transaction。
- recompiler 只能替换完整旧 block，不能替换 `tikzBodyRange`。
- replacement 必须是同 ID、单 block、valid metadata + valid integrity；删除必须是空 insert 且通过 dependency gate。
- transaction readSet/writeSet 精确声明完整旧 block range；patch 自带 exact block CAS。
- request fingerprint 必须包含 typed proposal、basis、preconditions 和 compiled operation identity；同幂等键不同操作拒绝。
- candidate parse/project 失败时不提交；提交后若新 revision projection 不可用，标记 transaction diagnostic，不能在 UI 层另存一份“成功” scene。

## 推荐的最快实施顺序

1. 先补 `sliceHash` 生成与 Broker 校验，避免新协议建立在未实现的 precondition 字段上。
2. 实现 codec registry + `decodeManagedConstructionPlan()`，先覆盖当前所有 safe compiler-produced plan kinds；未知/迁移失败 fail closed。
3. 实现 `set-input-ref` 与 `set-free-point-position` 两个 semantic op，打通 Canvas/Code；它们能验证最核心的 plan-record-writer 闭环。
4. 加 `ManagedPresentationIR`/schema-v3，再迁移 style lane；在此之前禁止 semantic recompile 丢 style。
5. 接 AI context + `managed-plan-patch/v1`，复用服务端/客户端双重 compile 与 candidate analyze。
6. 最后开放 label/scalar/delete，并按 codec capability 做细粒度白名单。

这条路线使 AI comprehension、Code、Canvas 共用同一份 decoded Plan、同一 mutation schema、同一 compiler 和同一 Broker；同时保持“官方 TikZ 全语法保真/精确编译”与“可逆交互语义子集”两层分离，不会为了宣称全语法支持而破坏源码保真。
