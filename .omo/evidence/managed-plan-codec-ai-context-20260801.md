# Managed plan codec -> AI context static evidence

日期：2026-08-02  
实现范围：`lib/tikz/ir/ai-context.ts`；未修改 prompt、codec、adapter、Broker 或 UI。

## 接入结果

- AI context 直接调用 `decodeManagedConstructionPlan()`，并从对应 revision-bound `SourceDocument.text` 重新解析 `parseManagedConstructionBlocks()`；没有从 summary 或 semantic records 猜 plan。
- 只处理 `syntaxNodeType === 'mathgeo-managed-construction'` 的 block binding；record binding 不重复携带 plan。
- codec 查找要求 construction ID 与 binding 的 exact half-open range 同时匹配，且只能命中一个当前 block；否则输出 `stale-block` typed issue。
- `replace-managed-construction` capability 只有在以下条件同时成立时出现：
  - binding 位于当前 focus entity closure；
  - write policy 是 `managed-recompile-only`；
  - metadata/integrity 都是 `valid`；
  - construction ID、plan kind、content fingerprint 存在；
  - schema-v2 codec canonical decode 成功，并已证明完整 block byte-for-byte 可重编译。
- focus 内 canonical binding 携带 `managedPlan.status='canonical'` 和完整 `previousPlan`。该 plan 是 codec 已通过 `validateConstructionPlan()` 且能直接重新交给 trusted writer 的完整 `ConstructionPlan`，不是删字段后的猜测性摘要。
- focus 内 decode 失败时携带 `managedPlan.status='unavailable'`，最多四条 `{code,path,message}`；message 限制为 240 字符。没有 previous plan，也没有 replace capability。
- 非 focus binding 不运行 codec，不携带 previous plan 或 issues，避免上下文膨胀。
- managed summary 的 raw `semanticRecords` 在 focus/非 focus 都不再发给 AI。canonical 成功时以 previous plan 取代；失败时不允许模型从 records 自行拼装 plan。
- 原始 `sourceBindings[].writable` 仍逐字取自 construction binding，没有改为 true。managed raw source lane 仍为只读；本次只暴露 typed replace capability。

## 静态核对

执行了：

```text
git diff --check
git diff --no-index --check -- NUL lib/tikz/ir/ai-context.ts
rg -n "writeCapabilities|decodedManagedPlan|previousPlan|semanticRecords|writable:" lib/tikz/ir/ai-context.ts
```

结果：没有 whitespace error；`git diff --check` 仅报告工作树已有的 LF/CRLF 转换 warnings。未运行 test、build、lint、typecheck、TeX、Docker 或 browser。

## 关键静态位置

- codec/parser import 与 context contract：`lib/tikz/ir/ai-context.ts:12-17,91-112`
- typed issue 压缩：`lib/tikz/ir/ai-context.ts:279-297`
- current source + exact block 查找 + canonical decode：`lib/tikz/ir/ai-context.ts:309-378`
- focus gate、capability gate、previous plan attachment、raw writable 保留：`lib/tikz/ir/ai-context.ts:396-465`
- semantic records fail-closed removal：`lib/tikz/ir/ai-context.ts:472-486`
