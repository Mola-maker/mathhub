# ManagedPresentationIR / managed construction schema-v3 最小落地设计

日期：2026-08-01  
审查性质：只读架构审查；本报告是唯一写入物。  
验证边界：未运行 test、build、lint、typecheck、TeX、Docker 或浏览器。

## 结论

当前 schema-v2 已经有可用的语义记录、闭包校验和 body/metadata 联合 fingerprint，但它没有持久化「这个 plan 如何由 writer 分解成源码槽位」和「每个槽位中哪些字节是表现层」。因此：

- `managedStyleRecompilePatches()` 能在 body 内定向改 options 并重封 fingerprint，但受管 body 从此不再等于 `compileConstructionPlan(previousPlan)` 的标准输出；
- `managedConstructionPlanRecompilePatches()` 只能对完全 canonical 的 v2 block 重编译，对已调整样式/注释/未知源码的 block 正确地 fail closed；
- 直接把 `StyleDraft` 放进 `ConstructionPlan` 会污染源中立的 Geometry Plan，而且丢失未知 TikZ options 及其原始格式；
- 直接在 metadata 里复制整段 raw body 会建立第二份 source truth，不符合项目规则。

最小可落地的 schema-v3 应当采用：

1. **ConstructionPlan 仍然只表示语义**，不收纳 raw TikZ options 或源码；
2. v3 metadata 增加一条可验证的 **plan-core record** 和一条 **presentation manifest record**；
3. writer 不再只返回无标识的 `string[]`，而是先生成带稳定 ID 的 **writer slots**；
4. body 中以 TeX 注释形式写入 slot begin/end marker，原始 options、注释、空白和未知源码仍只存在 TikZ source 中；
5. `ManagedPresentationIR` 是从当前 revision 源码派生的无损投影，重编译时按 slot ID 合并，而不是第二份可独立保存的文档；
6. 未能证明可无损合并的 slot/block 必须降级为 read-only，绝不「尽量保留」后盲目重编译。

这个方案可以在不破坏 source-as-truth 的前提下，打通 AI / Canvas / Inspector 对已有 managed construction 的语义修改，并保留样式、注释和不能解释的 TikZ 源码。

## 1. 当前实现的精确断点

### 1.1 schema-v2 把语义 metadata 和 TikZ body 绑在一起，但没有 presentation 语义

- `lib/tikz/semantics/managed-construction.ts:9-16` 只声明 schema 1/2 和元数据大小限制。
- `ManagedConstructionSemanticRecord` 只有 input/entity/constraint/relation/output（`lib/tikz/semantics/managed-construction.ts:18-28`），没有 plan descriptor、writer slot 或 presentation record。
- `ManagedConstructionBlock` 只暴露 header、record prefix 和整个 `tikzBodyRange`（`lib/tikz/semantics/managed-construction.ts:68-87`），不知道 body 内哪条语句属于哪个 entity/constraint/output。
- `recordsOf()` 要求 record 是 header 之后的连续前缀，并原子地拒绝部分解码（`lib/tikz/semantics/managed-construction.ts:905-1142`），这个事务语义应当保留。
- fingerprint 把 header identity、metadata text 和 TikZ body 联合计算（`lib/tikz/semantics/managed-construction.ts:1169-1200`）；parser 在 mismatch 时标记 detached（`lib/tikz/semantics/managed-construction.ts:1253-1296`）。

### 1.2 ConstructionPlan writer 没有稳定 source slot

- `ConstructionPlanBase` 的 persisted-looking 字段是 inputs/entities/constraints/relations/outputs，另有 UI 结果 `status/selection`（`lib/tikz/authoring/construction-ir.ts:341-352`）。
- `writerBody()` 仅返回 `readonly string[]`（`lib/tikz/authoring/construction-ir.ts:1754-1988`）。例如 circumcircle 的五条 helper/body 行、complete quadrilateral 的多条 line 都没有持久 slot ID。
- `directive()` 将 records 与无标识 body 直接拼接（`lib/tikz/authoring/construction-ir.ts:1718-1751`）。
- `compileConstructionPlan()` 在运行时把 plan 展开为 records + body，但不持久 plan kind 特有字段的可逆 descriptor（`lib/tikz/authoring/construction-ir.ts:2056-2108`）。仅凭 records 无法稳健恢复所有 plan-level 字段、circle reference 快照和 writer 分支。
- `compileSourceCircleAdoption()` 故意原样保存一条 raw circle source（`lib/tikz/authoring/construction-ir.ts:2111-2201`），它不是普通 primitive writer 的 canonical body，必须与普通 plan codec 分开。

### 1.3 当前 style lane 无损修改当次 options，但会阻断下一次 semantic recompile

- `buildOptionsRaw()` 会针对已知 option group 做局部替换，未知 option、分隔符、换行和格式保持原样（`lib/tikz/patch/style-options.ts:60-168,301-350`）。这个 token-preserving helper 应当被 v3 复用。
- `StyleDraft` 只是 Inspector 可编辑子集（`lib/tikz/patch/style-options.ts:12-50`）；`styleDraftFromRaw()` 不会表示所有未知 options（`lib/tikz/patch/style-options.ts:352-396`），所以不能把 `StyleDraft` 序列化成「完整样式」。
- `managedStyleRecompilePatches()` 把定向 body patch 应用到原 body，重算 fingerprint，然后返回一个整 block replacement（`lib/tikz/authoring/managed-construction-recompile.ts:146-228`）。
- `managedConstructionPlanRecompilePatches()` 通过「当前 block 必须字节等于 previous plan 的 canonical compilation」保护样式（`lib/tikz/authoring/managed-construction-recompile.ts:114-123`）。这个拒绝是正确的过渡态，不能为了可写而删除。

### 1.4 AI/Canvas 已有 typed recompile 入口，但 previous plan/presentation 还不是 source-derived

- `construction-plan-proposal/v1` 对 replace 要求 AI 提供 `previousPlan` 和 `plan`（`lib/tikz/ir/ai-construction-plan-proposal.ts:25-43`）。当前 canonical equality guard 可以防止伪造 previous plan，但 styled v2 永远无法通过。
- managed bindings 保持 `writable:false` + `managed-recompile-only`（`lib/tikz/ir/tikz-adapter.ts:1558-1646`）是正确的 raw-source 边界，不应改成 `writable:true`。
- AI context 另行暴露 `replace-managed-construction` capability（`lib/tikz/ir/ai-context.ts:283-335`）已经建立正确的权限分层；v3 只需要把「可无损恢复 plan + presentation」加入 capability attestation。

## 2. schema-v3 的最小持久数据模型

### 2.1 不要直接把当前常量从 2 改成 3

`validSemanticRecordShape()`、`schemaV2SemanticRecordIssue()` 和 semantic closure 现在多处以 `schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_VERSION` 判断 typed 语义。如果只把常量改为 3，v2 的 point-reflection/rotation/radical-axis 等记录会立即变成 invalid。

应先改为：

```ts
export const MANAGED_CONSTRUCTION_SCHEMA_V1 = 1 as const;
export const MANAGED_CONSTRUCTION_SCHEMA_V2 = 2 as const;
export const MANAGED_CONSTRUCTION_SCHEMA_V3 = 3 as const;
export const LATEST_MANAGED_CONSTRUCTION_SCHEMA_VERSION =
  MANAGED_CONSTRUCTION_SCHEMA_V3;

export function isTypedSemanticSchema(version: number | null):
  version is 2 | 3 {
  return version === MANAGED_CONSTRUCTION_SCHEMA_V2
    || version === MANAGED_CONSTRUCTION_SCHEMA_V3;
}
```

v2 的 parser/fingerprint 规则保持原样；v3 是新的可写 capability，不得倒过来重新解释历史 v2 字节。

### 2.2 新增 plan-core record，不要序列化整份 ConstructionPlan

`inputs/entities/constraints/relations/outputs` 已经是 schema metadata 中的 typed records，不应再复制一遍。`status` 和 `selection` 是一次交互的 UI 结果，也不应持久化。最小 plan record 只保存每种 plan kind 无法从 semantic records 唯一恢复的定义字段：

```ts
export interface ManagedPlanCoreRecord {
  readonly recordType: 'plan';
  readonly id: 'plan';
  readonly format: 'construction-plan-core/v1';
  readonly planKind: ConstructionPlanKind;
  readonly definition: ManagedPlanDefinition; // discriminated by planKind
}
```

`ManagedPlanDefinition` 为 `ConstructionPlan` 的 per-kind 字段（如 `a/b/result`、`circle1/circle2`、`lineAB/...`），排除：

- `id/kind` 之外的 base record arrays；
- `status/selection`；
- `sourceWriterHint`（任何 opaque source hint 永远不得通过 v3 managed semantic write lane 恢复）。

新增 `lib/tikz/authoring/construction-plan-codec.ts`：

```ts
export function encodeManagedPlanCore(plan: ConstructionPlan):
  ManagedPlanCoreRecord;

export function hydrateManagedConstructionPlan(
  block: ManagedConstructionBlock,
): ConstructionPlan;
```

hydrator 只能消费已经通过闭包校验的 records + plan core，并在返回前再次调用 `validateConstructionPlan()`。它不从 TikZ body 猜几何语义。

### 2.3 presentation manifest 只持久 writer topology，不复制 raw source

```ts
export interface ManagedPresentationManifestRecord {
  readonly recordType: 'presentation';
  readonly id: 'presentation';
  readonly format: 'managed-presentation/v1';
  readonly writerId: 'mathgeo/tikz-construction-writer';
  readonly writerRevision: number;
  readonly planKind: ConstructionPlanKind;
  readonly slotOrder: readonly string[];
  readonly referenceSurfaceFingerprint: string;
}
```

`slotOrder` 的数量很小（现有 plan 只有若干 helper/definition/render 语句），不会接近单 record 16 KiB 限制。manifest 不存 raw options、comments 或 body；这些字节仍只存在 source 中。

### 2.4 body 使用成对 slot marker 建立无损 source map

每个 compiler-owned source slot 写成：

```tex
% @mathgeo slot-begin {"id":"entity:axis:render","kind":"tikz-statement","owners":["entity:axis"],"semantic-fingerprint":"0123456789abcdef"}
\draw[very thick,custom/.style={x,y}] ($(A)!-3!(B)$) -- ($(A)!4!(B)$);
% @mathgeo slot-end {"id":"entity:axis:render"}
```

规则：

- marker 使用 TeX line comment，不影响 exact compile；
- slot ID 必须来自 plan/record 身份和 writer role，不得包含可修改坐标、颜色、整条 source text 或纯数组下标；
- 例如 `constraint:<id>:definition`、`entity:<id>:render`、`helper:circumcenter:m1`；helper 名称也要是 plan-kind 内显式稳定 role，不能依赖当前行号；
- `semantic-fingerprint` 对 slot 的源中立 typed 定义做 canonical JSON hash，排除 options、空白、注释和 writer 排版；
- marker 必须严格成对、不嵌套、ID 唯一，且顺序与 manifest 相同；否则 presentation status 为 invalid/read-only；
- `% @mathgeo slot-*` 是保留命名空间；用户注释如果伪造这个前缀，只会使本 block 降级为只读，不会被执行或丢失。

### 2.5 运行时 ManagedPresentationIR 是 source-derived projection

新增 `lib/tikz/authoring/managed-presentation-ir.ts`：

```ts
export interface ManagedPresentationIR {
  readonly format: 'managed-presentation/v1';
  readonly writerId: string;
  readonly writerRevision: number;
  readonly planKind: ConstructionPlanKind;
  readonly referenceSurfaceFingerprint: string;
  readonly slots: readonly ManagedPresentationSlot[];
  readonly attachments: readonly ManagedOpaqueAttachment[];
  readonly status: 'valid' | 'invalid' | 'unsupported';
  readonly issues: readonly ManagedPresentationIssue[];
}

export interface ManagedPresentationSlot {
  readonly id: string;
  readonly kind: 'tikz-statement' | 'tikz-fragment';
  readonly owners: readonly string[];
  readonly semanticFingerprint: string;
  readonly markerRange: SourceRange;
  readonly contentRange: SourceRange;
  readonly source: string; // current revision projection only; not duplicated in metadata
  readonly mode: 'structured' | 'opaque';
  readonly optionSites: readonly {
    readonly id: string;
    readonly present: boolean;
    readonly raw: string;
    readonly range: SourceRange;
  }[];
}

export interface ManagedOpaqueAttachment {
  readonly anchor:
    | { readonly beforeSlotId: string }
    | { readonly afterSlotId: string }
    | { readonly at: 'body-start' | 'body-end' };
  readonly source: string;
  readonly range: SourceRange;
  readonly sourceFingerprint: string;
  readonly referenceSurfaceFingerprint: string;
}
```

`attachments` 是 slot 边界之间的原字节，包括空白、普通注释和不属于 compiler-owned slot 的未知 TikZ。它们不被 Canvas/AI 猜测语义，只被按稳定边界原样携带。

## 3. writer 与无损合并算法

### 3.1 先把 writerBody 重构成 artifact，再开启 schema-v3

`lib/tikz/authoring/construction-ir.ts` 新增：

```ts
export interface ConstructionWriterSlot {
  readonly id: string;
  readonly kind: 'tikz-statement' | 'tikz-fragment';
  readonly owners: readonly string[];
  readonly semanticFingerprint: string;
  readonly canonicalSource: string;
  readonly optionSites: readonly {
    readonly id: string;
    readonly insertionPolicy: 'command-options';
  }[];
}

export interface ConstructionWriterArtifact {
  readonly writerId: 'mathgeo/tikz-construction-writer';
  readonly writerRevision: number;
  readonly planKind: ConstructionPlanKind;
  readonly referenceSurface: readonly string[];
  readonly slots: readonly ConstructionWriterSlot[];
}

export function compileConstructionWriterArtifact(
  plan: ConstructionPlan,
): ConstructionWriterArtifact;
```

`writerBody()` 的每个 switch 分支必须显式列出 slot ID、owner 和 semantic fingerprint input。第一步重构时仍用 artifact 的 `canonicalSource` 生成当前 v2 `string[]`，以保证 v2 输出字节不变；这样可将「writer 标识化」和「schema 迁移」拆成两步。

### 3.2 presentation merge 只有三种合法行为

新增：

```ts
export function mergeManagedPresentation(
  previous: ManagedPresentationIR,
  next: ConstructionWriterArtifact,
): ManagedPresentationMergeResult;
```

对每个同 ID slot：

1. **structured slot**：从 previous slot 提取每个已声明 option site 的原始 `raw`，注入 next canonical slot；未知 options 和其格式因为复用 raw 而完整保留。
2. **opaque slot + semantic fingerprint 未变**：原样复用 previous slot 全部字节。
3. **opaque slot + semantic fingerprint 变化**：拒绝 `opaque-slot-semantic-change`；禁止用新 canonical slot 覆盖未知用户源码。

对 attachments：

- slotOrder 未变时按 anchor 原样重放；
- slot 新增/删除/重排时，任何非空 attachment 无法唯一定位就拒绝；
- 存在未知 TikZ attachment 时，如果 `referenceSurfaceFingerprint` 改变（实体名/slot-owned 可引用名集合改变），拒绝 `opaque-attachment-reference-surface-changed`；不能悄悄留下断开的 `(OldName)` 引用。

structured/opaque 的判断不能依赖全局 v1 subset parser 对「所有 TikZ」成功。它应由每个 writer slot 自己的严格 source mapper 确认：除已声明 option site 和 trivia 外，其他 semantic token 与 canonical template 必须一致。任何无法证明的差异都标为 opaque，而不是丢弃。

### 3.3 v3 compiler API

```ts
export interface ConstructionWriterOptions {
  readonly schemaVersion?: 2 | 3;
  readonly presentation?: ManagedPresentationIR;
  readonly allowUnsafeOpaque?: boolean;
}
```

- 新建 managed construction 在 rollout 完成后默认 schema 3；
- schema 3 必须同时写 semantic records、plan-core record、presentation manifest、slot markers 和合并后 body；
- `allowUnsafeOpaque` 与 v3 semantic replacement 互斥；带 `sourceWriterHint` 的 plan 不获得 `replace-managed-construction`；
- compiler 输出必须立即用 `parseManagedConstructionBlocks()` 自校验：恰好一个 block、same ID/kind、metadata/integrity/presentation 全部 valid。

## 4. fingerprint 与预条件

### 4.1 不要用 v1 fingerprint domain 诠释 v3

当前 `managedConstructionContentFingerprint()` 的 domain 是硬编码 `mathgeo-managed-content/v1`，输入不包含 schema version（`lib/tikz/semantics/managed-construction.ts:1183-1199`）。v3 应新增：

```ts
managedConstructionContentFingerprintV2({
  schemaVersion: 3,
  writerId,
  writerRevision,
  id, kind, planKind, inputs, outputs,
  metadataText,
  tikzBodyText,
});
```

新 domain 为 `mathgeo-managed-content/v2`。header 增加 `fingerprint-domain=2`，`fingerprint-alg=fnv1a64-utf8` 仍只表示 hash 算法。parser 对 schema 1/2 仍按现有 v1 domain 验证，不得重算成 v2 domain。

### 4.2 v3 replace 不再信任调用者提供 previousPlan

`managedConstructionPlanRecompilePatches()` 的 v3 路径应当：

1. 以 construction ID + expected exact range 找到唯一 block；
2. 校验 document revision/source hash、exact expected block text 或 slice hash、content fingerprint、schema/presentation status；
3. 从当前 block records 恢复 previous plan，从当前 body markers 派生 presentation IR；
4. 验证 next plan 同 ID/同 plan kind 且通过 construction closure/evaluator preflight；
5. 合并 presentation，编译一个 v3 replacement；
6. 自校验 replacement，再生成一个 whole-block source transaction。

`AiConstructionPlanOperation.replace-managed-construction` 在 v3 中可删除不可信任的 `previousPlan`，只携带 next typed plan + block preconditions。v2 过渡路径可暂时保留 `previousPlan` 作为 canonical migration proof，但不能将其当作 styled v2 的真实 previous plan。

## 5. v2 迁移与拒绝策略

迁移必须是一次用户/AI/Canvas 已授权修改中的原子 source transaction，不能在 parse/open 文档时悄悄改写源码。

| 当前 block | v3 策略 | 原因 |
|---|---|---|
| v2 + metadata valid + integrity valid + exact canonical body | 可自动升级；以通过 exact equality 的 previous plan 或唯一 codec 结果生成 plan-core，初始 presentation 为 canonical slots | 无任何表现差异，可证明无损 |
| v2 + valid fingerprint + 仅 options/trivia/comments 偏离 canonical | 只在 per-kind v2 migrator 对所有 writer slot 完成唯一对齐、提取 raw options 和 attachments 后升级 | 必须证明每个差异都是 presentation，不能猜 |
| v2 + valid fingerprint + 有未知独立语句 | 可作 anchored opaque attachment 携带，但只有 slot order/reference surface 稳定的修改可通过 | 保留源码但不伪造其语义 |
| v2 + 某 compiler slot 内有不可分类差异 | 将该 slot 标记 opaque；slot 语义不变时可升级，语义变化时拒绝 | 全字节复用才能无损 |
| v2 `source-adopted` circle | 可升级为独立 `source-adopted/v1` codec + 单 opaque slot；在通用 codec 完成前只允许 style mutation | 它的 body 本来就是外部 raw source，不是 primitive canonical writer |
| v2 styled/diverged 但没有唯一可恢复 plan | 拒绝 `v2-plan-unrecoverable` | v2 records 不足以恢复全部 plan-level 字段 |
| v1 / schema absent | 保持 read-only；只能通过显式 adoption/repair 新建 v3 block | 缺少 typed closure/integrity 证据 |
| unsupported schema / detached / invalid metadata / invalid presentation / duplicate construction ID | 一律 read-only，不迁移、不重封 | 无法建立可信 CAS 与语义基线 |

重要：「当前 fingerprint valid」只证明 metadata/body 自上次重封后一致，不证明 body 仍是 canonical writer 输出。因此 styled v2 不能只因 integrity valid 就自动升级。

## 6. Inspector / Canvas / AI 的统一 IO 路径

### Inspector style

最终公开入口应从「调用者提供 body `TextPatch`」收口为 typed mutation：

```ts
{ op: 'set-presentation-property',
  slotId: 'entity:axis:render',
  optionSiteId: 'main',
  property: 'line-width',
  expected: 'thick',
  next: 'very thick' }
```

v3 compiler 内部仍可使用 `styleDraftFromRaw()` + `buildOptionsRaw()` 生成最小 options patch，但 UI 不再能传 raw source range 或任意 option string。低层 source commit 可以保持 body patch + header fingerprint patch 两个不重叠最小 patch，由同一 Broker/CodeMirror transaction 原子提交；无需为纯 style change 整块替换，这也更利于 selection/range identity 稳定。

### Canvas semantic edit

Canvas 发出 typed plan mutation 或完整 next `ConstructionPlan`，不发 body patch。recompiler 从当前 source 恢复 plan + presentation，修改 plan，用同一 writer artifact + merge 路径整块重编译。

### AI semantic edit

AI 与 Canvas 使用同一 plan mutation/recompiler，不拥有专用 TikZ writer。AI context 对当前 focus block 只暴露：

- compact hydrated plan；
- editable semantic/presentation capabilities；
- presentation status/opaque diagnostics，不默认暴露大段 raw attachment；
- exact block range/content fingerprint/source basis；
- `replace-managed-construction` 只在 schema 3 + plan hydratable + presentation valid + unique ID 时授权。

raw `ai-patch-proposal/v1` 仍永久不能写 managed body；typed write capability 与 `writable:false` 不冲突。

## 7. 精确文件/函数改动表

### 新文件

1. `lib/tikz/authoring/construction-plan-codec.ts`
   - `ManagedPlanCoreRecord`
   - `encodeManagedPlanCore()`
   - `hydrateManagedConstructionPlan()`
   - per-kind exhaustive codec registry
2. `lib/tikz/authoring/managed-presentation-ir.ts`
   - `ManagedPresentationIR`
   - slot/attachment/parser issue types
   - `parseManagedPresentation()`
   - `mergeManagedPresentation()`
   - `applyTypedPresentationMutation()`
3. 可选拆分 `lib/tikz/authoring/construction-writer-artifact.ts`
   - 若 `construction-ir.ts` 体积继续增长，将 slot artifact 和 TikZ writer 从 IR types 中分离。

### 现有文件

1. `lib/tikz/semantics/managed-construction.ts`
   - 拆分 schema 1/2/3 常量，以 `isTypedSemanticSchema()` 取代精确等于 latest version 的判断；
   - `ManagedConstructionSemanticRecord` 不应继续混合所有 record；改名为 `ManagedSemanticRecord`，另定义 `ManagedMetadataRecord = semantic | plan | presentation`；
   - `RECORD_TYPES` 注册 `plan/presentation`，但 semantic closure 只遍历 semantic records；
   - parser 增加 plan/presentation status、slot marker ranges/issues；任何新 record 失败仍原子地不暴露部分 plan；
   - 增加 v3 fingerprint domain，保留 v1/v2 fingerprint 原规则。
2. `lib/tikz/authoring/construction-ir.ts`
   - `writerBody()` 重构为 `compileConstructionWriterArtifact()`；
   - `directive()` 升级为 schema-aware serializer；
   - `compileConstructionPlan()` 接收 typed presentation，不接受 caller-authored raw body；
   - 新建 v3 默认在所有 per-kind artifact 完成之后再打开。
3. `lib/tikz/authoring/managed-construction-recompile.ts`
   - v3 路径从 source block 恢复 previous plan/presentation；
   - `expectedCanonicalPlan` 只保留为 v2 canonical migration proof，v3 删除；
   - 增加精确错误码：`presentation-invalid`、`opaque-slot-semantic-change`、`opaque-attachment-reference-surface-changed`、`v2-plan-unrecoverable`、`writer-revision-unsupported`；
   - 将现有 raw `managedStyleRecompilePatches()` 降为 module-private/transition helper，公开 typed presentation mutation。
4. `lib/tikz/patch/style-options.ts`
   - 保留 token-preserving `buildOptionsRaw()`；
   - 不将 `StyleDraft` 当作完整 presentation serialization；
   - 必要时导出「可编辑 option group」的 typed key，供 mutation registry 白名单使用。
5. `lib/tikz/ir/tikz-adapter.ts`
   - managed summary 区分 semantic records 与 metadata records，不再将 plan/presentation record cast 为语义 entity/constraint、也不建立虚假 record binding；
   - block metadata 增加 `planStatus/presentationStatus/writerRevision/opaqueSlotCount/opaqueAttachmentCount`；
   - `writePolicy` 仅在 unique + valid + hydratable + mergeable 时为 `managed-recompile-only`，其他给出精确 read-only policy。
6. `lib/tikz/ir/ai-context.ts`
   - `replace-managed-construction` capability 增加 v3 presentation gate；
   - 只对 focus block 发送 compact plan/capabilities，不发送大型 raw attachments。
7. `lib/tikz/ir/ai-construction-plan-proposal.ts`
   - v3 replace 删除 `previousPlan`，由 trusted source codec 恢复；
   - 提案仍携带 construction ID、range、content fingerprint、plan kind 和 document basis；
   - presentation-only 修改最终应使用枚举 mutation，不接受 raw option string。
8. `components/tikz/use-tikz-engine.ts`
   - `applyInspectorSourcePatch(..., 'semantic')` 的拒绝保持，增加 `commitManagedConstructionMutation()`；
   - managed style 从 raw body patch 过渡到 typed presentation mutation；
   - 所有交仍通过 Broker -> StudioDocument -> CodeMirror transaction。
9. `components/tikz/tikz-style-panel.tsx`
   - 使用 slot/entity binding 生成 typed style mutation，不把 statement range 当作 managed write authority；
   - 对 opaque/unsupported presentation 显示可理解的只读原因。

## 8. 兼容性与实施风险

1. **schema 常量精确等于风险（高）**  
   现有多个 v2-only typed constraint 以 latest constant 判断。必须先引入 typed-schema predicate，否则升级常量会破坏全部 v2 block。
2. **slot ID 不稳定风险（高）**  
   用行号、数组下标、坐标或原文生成 slot ID 会在每次 writer 修改后丢失 presentation。slot ID 必须是 per-kind 显式 ABI。
3. **writer 升级 ABI 风险（高）**  
   `writerRevision` 不能只是展示字段。如果 slot topology/options site 改变，必须提供 old->new presentation migrator，否则只读。
4. **v3 指纹与v2冲突风险（中高）**  
   当前 fingerprint input 未包含 schema。v3 需要新 domain，但不能重新解释历史 header。
5. **metadata 大小风险（中）**  
   不要在 plan/presentation record 内复制整段 body 或整份 plan arrays。plan-core + manifest 保持小尺寸，raw source 仍在 body。
6. **未知源码引用变质风险（高）**  
   只是原样携带 unknown statement 不代表它仍正确。实体名/reference surface 变化时必须拒绝，直到能对 opaque attachment 声明 typed dependencies。
7. **source-adopted 伪装成 primitive 风险（高）**  
   adoption body 不是 canonical primitive writer 输出。必须独立 codec/locked opaque slot，否则第一次 semantic recompile 就会消除用户原始圆语句。
8. **record union 扩展风险（中）**  
   adapter 多处遍历 `block.records`。plan/presentation 记录不应得到 Geometry entity/constraint binding；建议 block 上直接分开 `semanticRecords/planCore/presentationManifest`。
9. **整块 style patch 的 identity/range 风险（中）**  
   当前 style helper 返回 whole-block replacement。v3 应优先同一事务的 body + fingerprint 最小双 patch，但 semantic plan 变化仍必须整 block replacement。
10. **过早声称全 TikZ 可交互风险（高）**  
    v3 的目标是「对 compiler-owned 可编辑子集无损可逆，对未知 TikZ 保真并 fail closed」。它不把所有 TikZ 伪造成 Geometry Plan。

## 9. 最快且安全的实施顺序

1. **兼容基础**：拆分 schema constants/predicates，保证 v1/v2 parser 语义不变；先不写 v3。
2. **writer artifact**：把 `writerBody()` 重构成显式 slot artifact，但继续生成与当前 v2 相同的字节。
3. **plan-core codec**：完成所有现有 safe `ConstructionPlanKind` 的 encode/hydrate 和穷尽校验；source-adopted 单独处理。
4. **presentation parser**：实现 manifest/slot markers、structured/opaque 分类、attachment anchoring 和 diagnostics。
5. **v3 create compiler**：新建 block 写 schema 3，每个输出立即 self-parse/self-validate；这时先不开放 replace capability。
6. **presentation merge + v3 semantic replace**：完成 source-derived previous plan/presentation，合并并整块重编译；先只开放 schema 3 canonical/structured block。
7. **typed style mutation**：Inspector 从 raw patch 迁到 slot/property mutation，未知 options 仍由 raw option site 保留。
8. **AI/Canvas 共用 lane**：AI replace 删除 v3 `previousPlan`，Canvas/Inspector/AI 全部调同一 hydrator/merge/compiler/Broker。
9. **v2 canonical migrator**：先开放能精确证明 canonical 的 block。
10. **v2 presentation migrator**：逐 plan kind 实现 slot 对齐；未覆盖 kind 保持 read-only，不做通用字符串 diff 猜测。
11. **writer revision migrator**：只有在 v3 稳定后才允许改变 slot ABI。
12. **owner-run gates**：单元/属性测试覆盖原字节保留、未知 option、注释/CRLF、opaque slot/attachment 拒绝、v1/v2 兼容、AI/Canvas 同一交易；再做浏览器与 exact compiler 验证。

## 10. 完成定义

schema-v3 只有在以下条件全部成立时才算完成：

1. 任何 v1/v2 source 打开后字节不变，历史 fingerprint 按原 domain 校验。
2. 新 v3 block 可从 source 唯一恢复 validated ConstructionPlan 和 ManagedPresentationIR。
3. 在 Inspector 中添加自定义颜色/未知 TikZ option 后，再用 Canvas 修改同一 construction 的语义输入，样式和 option 原字节仍保留。
4. slot 间用户注释、空白和未知 TikZ statement 在合法重编译后原样存在。
5. 对未知 inline semantic 变更、slot ABI 不兼容、opaque reference surface 变化等情况，交易明确拒绝且 source 不变。
6. AI、Canvas 和 Inspector 对 managed semantic edit 最终都调用同一 plan hydrator、mutation validator、writer artifact、presentation merge 和 transaction broker。
7. raw source patch 永远不获得 managed body 写权；CodeMirror source 仍是唯一持久化真相。

本设计的 breaking point 不是「把 style 字段加进 records」，而是将 writer 从无身份的 `string[]` 升级为稳定 slot ABI。只有建立这层，系统才能在语义重编译时知道哪些 source bytes 必须替换、哪些必须原样保留，从而真正实现 Code / Canvas / AI 的可逆 IO。
