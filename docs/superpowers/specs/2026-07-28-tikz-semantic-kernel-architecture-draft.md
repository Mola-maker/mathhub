# Math GeoHub TikZ Semantic Kernel 架构草案

日期：2026-07-28  
状态：Draft / architecture gate  
目标版本：v4.x foundation  
部署目标：ECS 应用服务 + 对象存储/CDN 精确产物；本地开发不依赖 Docker

## 1. 结论

Math GeoHub 不再把 TikZ parser 当作产品内核。新的内核是语言无关的
`Geometry Semantic Kernel`，TikZ 是一个保真、可逆、可执行的前后端适配器。

系统同时维护三种真值，三者不能互相冒充：

1. **Semantic Truth**：点、线、圆、约束、依赖、构造步骤和数学关系。
2. **Construction Truth**：用户实际编写的 TikZ/TeX 源码、宏、注释、格式和源码范围。
3. **Rendering Truth**：指定 PGF/TikZ 版本、TeX 引擎、字体和驱动编译出的 SVG/PDF。

“集成全部官方语法”的工程定义是：

- 任意合法 PGF/TikZ 3.1.11a 源码能够保真打开、编辑、保存和送入精确编译；
- 官方语法和库进入版本化能力目录，可搜索、补全、诊断并向 AI 描述；
- 已有语义插件的语法能够投影为可编辑 Geometry IR；
- 暂未语义化的语法成为有范围、有能力标签、有依赖影响的 opaque 节点；
- opaque 节点不会被删除、重排或伪解释，也不会无条件锁死整张画板；
- 只有精确 TeX 执行结果可以声称“与 TikZ 官方渲染一致”。

不承诺把宏展开、任意 TeX 控制流、驱动 special 和全部 library 都伪装成可拖拽
Canvas 对象。它们属于执行语义，不是有限静态语法。

## 2. 调研依据

### 2.1 PGF/TikZ 官方基线

- 固定版本：PGF/TikZ `3.1.11a`
- 固定仓库提交：
  [`839974a3f895bfb86f5a8bc155f0886c918f1bff`](https://github.com/pgf-tikz/pgf/tree/839974a3f895bfb86f5a8bc155f0886c918f1bff)
- 官方手册：
  [PGF/TikZ Manual 3.1.11a](https://mirrors.ctan.org/graphics/pgf/base/doc/generic/pgf/pgfmanual.pdf)
- CTAN 包：
  [pgf](https://ctan.org/pkg/pgf)

手册共有 1323 页，明确区分 TikZ frontend、Graph Drawing、Libraries、
Data Visualization、Utilities、Mathematical/Object-Oriented Engines、PGF Basic
Layer 和 System Layer。官方手册还明确说明 TikZ 下方存在 Basic Layer 与
System Layer；System Layer 负责抽象驱动差异。因此 Canvas parser 不能被当作
TeX/PGF 执行器。

### 2.2 增量语言架构

Tree-sitter 的官方 API 要求编辑旧树后把旧树传入 parser，以复用未变化区域；
同时提供 changed ranges 计算结构变化范围：

- [incremental parse contract](https://github.com/tree-sitter/tree-sitter/blob/4deef2d5ef0d2dc738289f50622211a24ff7d9a0/lib/include/tree_sitter/api.h#L281-L290)
- [changed ranges](https://github.com/tree-sitter/tree-sitter/blob/4deef2d5ef0d2dc738289f50622211a24ff7d9a0/lib/include/tree_sitter/api.h#L459-L484)

采用其算法思想，但保留现有 Lezer 运行时：

- 每次编辑携带精确 source edit；
- 复用旧 CST；
- changed ranges 只触发局部语义失效；
- 结构 changed range 不是 semantic diff，必须由插件重新投影后才能形成语义事务。

Typst 的 source store 会在原 identity 上 reset source，以保留增量工作：
[Typst source cache](https://github.com/typst/typst/blob/bc8de171e7a3f0dabc211ac36f76568ad804d53a/crates/typst-kit/src/files.rs#L101-L110)。
Math GeoHub 借鉴稳定文档 identity 和依赖失效，不照搬其单进程 World 模型。

### 2.3 几何约束求解

SolveSpace 使用 substitution、Jacobian、SparseQR/COLAMD、modified Newton、
least-squares 和 rank/DoF 诊断：

- [solver pipeline](https://github.com/solvespace/solvespace/blob/790bf74c727f72986c157fab4bbdb9e660447971/src/system.cpp#L238-L340)
- [technology overview](https://solvespace.github.io/solvespace-web/tech.html)

Math GeoHub 采用算法思想，不直接链接 SolveSpace GPLv3 实现：

- 先做符号替换 fast path；
- 只求解被修改对象所在的 constraint connected component；
- 使用初始位置稳定多解分支；
- 非线性求解设置迭代、时间和位移上限；
- 返回 `under-constrained`、`redundant`、`inconsistent`、`did-not-converge`
  等 typed diagnostics；
- point-on-path 使用显式参数 `t` 和 domain，而不是只存一个偶然坐标。

FreeCAD Sketcher 的经验用于性能规则：优先 Horizontal/Vertical 等低成本约束，
谨慎使用通用 Length、Tangency、Point-on-object、Symmetric 组合。
其 undo/redo 修复也明确暴露了一个关键边界：Geometry、Constraints 与 ViewProvider
若不在同一 transaction 完成同步，恢复期间就会出现索引/状态不一致。Math GeoHub
因此要求“新输入点 + 主构造 + 选择目标”作为一个 revision-bound source transaction
提交，Rendering Truth 只能在语义事务完成后刷新：
[FreeCAD Geometry state synchronisation](https://github.com/FreeCAD/FreeCAD/commit/36fdbc460a1bba7d35341cd6854cea0f878775c6)、
[FreeCAD internal transaction support](https://github.com/FreeCAD/FreeCAD/commit/3941b69170399a7e79f71abf6d654cd27b68dac8)、
[ViewProvider deferred undo/redo update](https://github.com/FreeCAD/FreeCAD/commit/7ae2fc7b051c86639a508b317a96f0ba69f9d235)。

### 2.4 多入口事务

当前单用户版本采用：

- LSP `WorkspaceEdit` 的 versioned document 和 all-or-nothing bundle 思路；
- [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) 的 operation + `test`
  precondition 思路；
- 语义操作日志 + 编译后的 source patches；
- `baseRevision + baseHash + preconditions + idempotencyKey`；
- 冲突返回 `409 REVISION_CONFLICT`，禁止静默覆盖。

Yjs 的事务和 state vector 证明 CRDT 可作为未来协作层：
[Yjs internals](https://github.com/yjs/yjs/blob/9c1994547d7bc86245a21e1a4c8319f056d05ecf/INTERNALS.md#L134-L163)。
v4 不引入 CRDT；只预留 adapter，不让 Yjs binary update 进入公开 API。

### 2.5 工具状态

本轮调用 GitHub 连接器核对了 PGF/TikZ、Tree-sitter、FreeCAD、JSXGraph、Yjs、
Automerge 等公开仓库。Tavily 在重新授权后完成了一轮 architecture/algorithm
Research；随后 Search 端点继续完成四组交叉检索（request
`5eb4e7ac-37d7-48b0-8547-3cb108e1d4bc`、
`3452accb-1d44-42e2-9d39-472f8def3928`、
`420debe7-a4ae-4fcf-b3e7-1e5804c8a1cd`、
`65eb6d6e-e15e-4627-925f-2f67068c1363`）。本轮再次调用 Research 时账户返回
`432 usage limit`；`tikz.dev` Map 端点仍因 429 被限流。这两个限流不影响 Search、
官方文档和 SHA 固定源码的证据链。

2026-07-29 再次确认 Tavily 可用后，Research Pro 仍因套餐额度返回 432，但 Advanced
Search 成功完成四组定向复核（request `c814a960-59a9-42a3-914f-03a5ea27e75a`、
`47b0fd5e-edf1-470b-a8d1-23887aaec3c4`、
`aa984a15-02c7-4522-8afb-2c939ec9888d`、
`d2fd2064-e1ef-4b0a-8aa0-7339857af4b7`）。新增证据包括：

- [Lezer error recovery](https://marijnhaverbeke.nl/blog/lezer.html) 使用跳过 token、
  虚构 token、提前结束内部 production 和带 badness 的 GLR 分支恢复；这支持
  “容错 CST 始终更新，但恢复节点不自动获得语义写权限”的 Parse Gate。
- [LSP 3.17 WorkspaceEdit](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification)
  优先使用 versioned `TextDocumentEdit`，并明确多个 edit 基于同一旧状态、应从后向前
  应用；这支持当前 non-overlapping patch bundle 与 expected revision。
- [PatchOptic](https://arxiv.org/html/2607.05483) 将 projected read view、authorized
  write region 和 patch-source region 合成一个可验证合同；Math GeoHub 对应为
  AI manifest projection、read/write set、source precondition 与 Broker commit。
- GeoGebra 的动态构造资料再次验证自由对象、路径约束对象和由算法完全决定的对象必须
  保持不同自由度；删除父构造时应通过反向依赖处理子图，不能只删除可见 SVG。

Tavily 结果支持四条已有决策：

- source / semantic IR / interactive Canvas / exact compiler 分离；
- 宏和动态 TeX 作为 opaque execution boundary；
- dependency component 局部失效与稀疏 Jacobian/DoF；
- source map + versioned patch 形成可逆编辑链。

Search 还补强了三个实现约束：

- [VS Code Custom Editor](https://code.visualstudio.com/api/extension-guides/custom-editors)
  明确建议工作区编辑采用满足目标的最小改动并保留用户格式；这与本项目的
  `source range + expectedText + minimal TextPatch` 一致。
- [Geometric constraint solving review](https://arxiv.org/pdf/2202.13795)
- [GeoGebra three-point circle algorithm (pinned)](https://github.com/geogebra/geogebra/blob/c594e2ecf62b7f32d3cc48ae5d4f22b453a76012/source/shared/common/src/main/java/org/geogebra/common/kernel/algos/AlgoCircleThreePoints.java)
- [GeoGebra tangent-through-point algorithm (pinned)](https://github.com/geogebra/geogebra/blob/c594e2ecf62b7f32d3cc48ae5d4f22b453a76012/source/shared/common/src/main/java/org/geogebra/common/kernel/algos/AlgoTangentPointND.java)
- [JSXGraph circle dependency and polynomial model (pinned)](https://github.com/jsxgraph/jsxgraph/blob/4b97351634951e3e36277f35270dc37edb26bbae/src/base/circle.js)
  和 DOF-based 求解研究都把图分解/规划与数值执行分成不同阶段；因此内核必须先按
  dependency component、rank/DoF 做规划，再把局部方程送进有界数值求解器。
- 双向变换研究中的 partial-state lens 进一步说明多视图共享源并不天然存在 total
  round-trip law；opaque TeX、宏展开和 driver 输出必须显式保留 partial/unsupported
  结果，不能用“尽量改一下字符串”冒充双向语义。

以下 Tavily 建议被显式拒绝：

1. **不切换 Tree-sitter**：现有 Lezer 已满足浏览器增量容错 CST；切换只增加双 parser
   和 WASM/native 维护成本。采用 Tree-sitter 的 edit/range 算法思想即可。
2. **不让每条 truth lane 各自持有 CRDT**：这会产生多个可写真源。只有 source
   transaction coordinator 有提交权，IR/Canvas/exact 都是 revision-bound projection。
3. **v4 不引入 Yjs/Automerge**：单用户多异步 actor 用 revision/hash/read-write-set
   已足够。明确需要多人/离线后，CRDT 只放在 source document adapter。
4. **不 fork/链接 SolveSpace**：GPLv3 对商业闭源集成有风险。只依据公开算法重新实现
   substitution、rank/DoF、稀疏 Jacobian、bounded Newton 和 least-squares。
5. **不声称通用 lens 是 total**：opaque 宏展开内部没有可靠反向 source mapping；
   无安全 writer 的操作必须返回 read-only/unsupported，而不是制造 TextEdit。

Tavily 的二手链接只用来发现方向；最终架构证据仍以官方手册、规范和 SHA 固定源码为准。

### 2.6 2026-07-29 Tavily + GitHub 架构复核

本轮在 Tavily Search 恢复后，重新检索了 incremental CST、lossless tree、
CodeMirror transaction、optimistic concurrency、source map、几何约束和双向编辑；
GitHub 侧对成熟实现固定到了具体提交。复核结果没有推翻三真值架构，但增加了六个必须
实现的边界。

1. **Parse Gate**。Tree-sitter 的 `InputEdit + changed_ranges` 合同说明增量语法树和
   语义增量是两件事：
   [Rust API，固定提交](https://github.com/tree-sitter/tree-sitter/blob/4deef2d5ef0d2dc738289f50622211a24ff7d9a0/lib/binding_rust/lib.rs#L1483-L1520)。
   2026 ECOOP 的
   [Stable Lossless Syntax Tree](https://drops.dagstuhl.de/storage/00lipics/lipics-vol372-ecoop2026/LIPIcs.ECOOP.2026.5/LIPIcs.ECOOP.2026.5.pdf)
   也采用“先更新容错 CST，存在 ERROR/MISSING 时延后 lossless/semantic diff”的 gate。
   因此源码编辑始终可以进入 Construction Truth，但包含结构错误时不得生成新的
   Semantic IR、AI 权威上下文或可写 Canvas projection。
2. **继续使用 Lezer，吸收 Tree-sitter 算法合同**。Overleaf 的 LaTeX 编辑器采用
   Lezer grammar + custom tokenizer + CodeMirror 6：
   [固定提交](https://github.com/overleaf/overleaf/blob/28ad3b03b71cb4311decdcb55c36b33ec10d72db/services/web/frontend/js/features/source-editor/lezer-latex/README.md#L1-L23)。
   这验证了现有运行时方向。Overleaf 为 AGPL-3.0，只借鉴分层，不复制实现；v4 不为
   “换 parser”引入第二套 WASM grammar。
3. **Broker 采用 LSP `TextDocumentEdit` 语义**。LSP 3.18 要求 document edit 绑定
   version，并且 edits 不重叠：
   [固定提交](https://github.com/microsoft/language-server-protocol/blob/b7f5132c95261c0898ae5124e7a91707abc48fcd/_specifications/lsp/3.18/metaModel/metaModel.json#L3507-L3575)。
   Math GeoHub 在此基础上增加 exact-byte source hash、read/write set、expectedText、
   actor、transactionId 和 idempotencyKey。
4. **幂等键必须绑定请求内容**。Broker 不能只记录“见过这个 key”。必须保存
   `requestHash + committedResult`：同 key + 同 payload 返回原结果；同 key + 不同
   payload 以 `IDEMPOTENCY_KEY_REUSED` 拒绝，避免 AI 重试误吞另一笔修改。
5. **依赖算法图驱动局部重算**。GeoGebra 的 Construction 按已登记算法更新派生对象：
   [固定提交](https://github.com/geogebra/geogebra/blob/5ed1d5f49126e3e56a88228e78670ed6bfaa4994/source/shared/common/src/main/java/org/geogebra/common/kernel/Construction.java#L1042-L1053)。
   只采用 `inputs -> algorithm -> outputs`、反向依赖和 affected-subgraph queue；
   GeoGebra 为 GPL-3.0-or-later，不复制或链接其实现。
6. **SourceMap 升级为多级映射**。映射链必须是
   `UTF-8/UTF-16 source -> CST node -> Geometry entity/constraint -> interactive SVG
   primitive -> exact artifact diagnostic`。单独的 `entityId` 无法支持源码高亮、
   Canvas 点击回跳、AI grounding 和精确编译错误定位。

约束求解复核还要求把 constraint graph 设计为 entity/constraint 二部图，并显式输出
DoF deficit、redundant、over-constrained、unsatisfied 和 discrete-solution 分支；
参考 [CAD 2024 graph-constructive review](http://www.cad-conference.net/files/CAD24/CAD24_288-294.pdf)
与 [2025 parametric CAD design intent](https://arxiv.org/html/2504.13178v1)。
AI 只能提议 typed constraint operation，求解和可提交性由 Kernel 决定。

本轮继续拒绝在 v4 核心引入完整 CRDT、TeX 宏执行器、3D solver 或 PGF runtime。
Yjs/Automerge 只保留 source-document collaboration adapter；当前单用户多异步 actor
使用 OCC Broker。

### 2.7 Tavily 恢复后的算法补充

2026-07-29 再次使用 Tavily Advanced Search 交叉检索了约束求解、双向编辑、TikZ
执行边界与浏览器 CAD 内核（request `9ee0f3e1-0a03-41c9-ab0b-a09ed432a699`、
`de0c745f-1463-406f-848a-bb016a3082c5`、
`d72f8653-d626-4de0-b23e-ea9f99ec31f0`、
`5c2fabb3-1d67-4440-91d0-6eddd82fbe06`）。Research Mini 本轮发生连接传输错误，
因此架构决策只采用可复核的 Search 结果和原始来源。

- [FreeCAD PlaneGCS 的浏览器 WASM 包装，固定提交](https://github.com/Salusoft89/planegcs/blob/ee9b156da9827a91a56a888a53520f63d5cffaa6/README.md)
  证明 DogLeg、Levenberg-Marquardt、BFGS、SQP 等数值求解器可作为浏览器 adapter，
  但其 FreeCAD/GPL 来源意味着 v4 只保留可替换接口，不直接嵌入商业产品核心。
- [JSketcher，固定提交](https://github.com/xibyte/jsketcher/blob/c1905c4f9df9711206866c8b39e982f52d598d88/README.md)
  将 2D constraint solver、选择/交互、
  feature history 和稳定拓扑身份分层；Math GeoHub 对应采用
  `Construction Plan -> dependency graph -> local solve -> source transaction`，
  不让 Canvas renderer 持有第二份可写模型。
- [SketchGraphs，固定提交](https://github.com/PrincetonLIPS/SketchGraphs/blob/1f27f5f9459926d38318007c71b72697083b2f3c/README.md)
  把 primitive 作为节点、
  几何关系作为约束边，支持 Geometry IR 使用 entity/constraint 二部图，而不是把
  `parallel`、`lies-on` 等关系压回样式字符串。
- [partial-state lenses](https://arxiv.org/pdf/2601.04573) 再次说明 `put` 必须同时持有
  原 source 和更新后的 view；因此 Canvas/AI 操作必须携带 base revision、read set、
  write set 和 source precondition，不能只把新的 Geometry IR 序列化后覆盖文档。
- [PGF/TikZ Parser Module](https://tikz.dev/module-parser) 与
  [官方 PGF/TikZ 手册](https://mirrors.ctan.org/graphics/pgf/base/doc/generic/pgf/pgfmanual.pdf)
  明确 TikZ 运行期依赖 TeX token/category code、宏展开、`pgfkeys` 和数学引擎。
  因而“全语法支持”的正确实现仍是全量保真 + 固定 profile 精确执行 + 能力分级语义化，
  不是在浏览器 AST 中重写一个 PGF runtime。

这轮补充将 v4 的 solver breaking point 固定为：先实现 changed-range 到受影响
dependency component 的确定性映射，并输出 DoF/冗余/冲突诊断；只有局部求解接口和
诊断协议稳定后，才评估自研 TypeScript solver 或隔离 WASM worker。

### 2.8 Exa + Tavily 开源实现复核

2026-07-29 Exa MCP 已成功接入并可直接检索；Tavily Advanced Search 同时完成
源码保真 TikZ 编辑器和 Apple motion 的交叉复核（request
`dd4a1751-a5d8-4f4d-9c06-cddffdce1b52`、
`4c30bfa0-7910-44c6-bb55-f52a3e3d7ac1`）。新增结论如下：

1. [DominikPeters/tikz-editor](https://github.com/DominikPeters/tikz-editor)
   采用 MIT 许可证，公开目标包括解析已有 TikZ、对象拖动后即时更新源码，以及在修改
   坐标时保留用户原有空白和换行；同时明确 `let` 等高级构造尚未全部支持。它证明
   “精确 source location + 最小值域修改”是可行的，也证明任何浏览器 parser 都必须
   公开能力边界。Math GeoHub 只复用其许可证允许的算法思想，不把其语法子集当作
   官方 TikZ 执行真值。
2. [KittyCAD/ezpz](https://github.com/KittyCAD/ezpz) 是 MIT 许可的 Rust 几何约束
   求解器，拆分为 core、CLI 与 WASM 样例；它是比 GPL/LGPL 求解器更适合开源产品
   后续评估的候选。v4 仍先固定本项目的 entity/constraint 二部图、局部 component
   输入、DoF/冲突诊断和 transaction result 协议，再通过 adapter 比较 ezpz 与自研
   求解器，避免让第三方求解器的数据模型反向绑架 Geometry IR。
3. [JSketcher](https://github.com/xibyte/jsketcher) 再次验证 parametric sketch、
   constraint solver、selection/interaction、feature history 和稳定对象身份需要
   分层；其“symbolic dimension 变化后重新求解”与本项目“修改 driving variable，
   不冻结 derived point”完全一致。
4. Apple 官方
   [Motion HIG](https://developer.apple.com/design/human-interface-guidelines/motion)
   与
   [Reduced Motion criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)
   要求动画解释关系与反馈、可中断，并为 Reduce Motion 提供等价路径。画板的
   pointer preview、drag 和 snap 因此保持零补间；只有 commit、selection、source
   pulse 和 panel layout 使用动画。
5. [Motion for React accessibility](https://motion.dev/docs/react-accessibility)
   提供全局 `reducedMotion="user"` 与局部 `useReducedMotion`，并在降级时保留
   opacity/color、关闭 transform/layout motion。v4 前端统一选择 Motion 作为 React、
   SVG 和 layout choreography 层；不同时装入 Anime.js、GSAP 与 Motion。GSAP 只在
   将来出现需要时间轴 scrub 的独立教学演示时重新评估。

这轮复核把开源复用规则固定为：许可证允许、接口先行、实现可替换、能力必须可诊断。
外部 parser、solver 或 renderer 都只能是 adapter，不能成为第二真源，也不能绕过
`revision + sourceHash + read/write set + Transaction Broker`。

## 3. 目标数据流

```text
                          Human / AI / Canvas / Import
                                      |
                             Versioned IO Envelope
                                      |
                        Semantic Transaction Coordinator
                                      |
               +----------------------+----------------------+
               |                      |                      |
        Construction Truth       Semantic Truth        Rendering Truth
          Lossless TikZ CST      Geometry Kernel       Exact TeX Result
               |                      |                      |
      TikZ Compatibility       Constraint Graph       Compiler Worker
          Adapter + Writer      + Event/Op Log        + Artifact Cache
               |                      |                      |
          CodeMirror View          Canvas View          SVG/PDF + CDN
```

任何入口都只能提交 transaction，不能直接改另一个视图：

- CodeMirror 输入 source edit；
- Canvas 输入 semantic operation；
- AI 输入 semantic operation bundle 或受限 source patch；
- exact compiler 输入 immutable source snapshot；
- importer 输入 source snapshot 或 Geometry IR snapshot。

Coordinator 成功提交后，统一生成新 revision/hash，再通知各 projection。

规范文档身份必须是：

```ts
interface DocumentIdentity {
  docId: string;
  epoch: string;
  revision: number;
  sourceHash: string; // SHA-256 over exact UTF-8 bytes
}
```

`revision` 只表达同一 epoch 内的顺序，`sourceHash` 只表达内容身份，两者不能替代。
内存中从 0 递增的 revision 不能跨页面刷新或跨设备充当全局版本。

## 4. 分层模型

### 4.1 Layer A — Lossless TikZ Compatibility Layer

职责：

- 保留所有 token、trivia、注释、空白、宏和未知语法；
- 提供 error recovery；
- 维护 UTF-8 byte、UTF-16 code unit、line/column 三种位置映射；
- 为每个节点生成稳定 syntax identity；
- 标记 scope/document/local 影响；
- 识别 official syntax family，但不假装执行 TeX。

核心节点：

```ts
interface LosslessSyntaxNode {
  id: string;
  kind: string;
  command?: string;
  range: { start: number; end: number };
  byteRange: { start: number; end: number };
  children: string[];
  trivia: string[];
  familyId?: string;
  recognition: 'static' | 'tex-expansion' | 'driver';
  impact: 'local' | 'scope' | 'document' | 'external';
  fidelity: 'lossless';
}
```

源码仍是 Construction Truth；CST 只通过 range 引用源码，不复制和重新格式化它。

### 4.2 Layer B — Official Syntax Capability Registry

每个官方语法 family、library 或 subsystem 都有版本化记录：

```ts
interface TikzSyntaxCapability {
  id: string;
  pgfVersion: '3.1.11a';
  officialRef: string;
  layer:
    | 'tikz'
    | 'graph-drawing'
    | 'library'
    | 'data-visualization'
    | 'utility'
    | 'math-engine'
    | 'pgf-basic'
    | 'pgf-system'
    | 'tex-runtime';
  recognition: 'static' | 'tex-expansion' | 'driver';
  preserve: true;
  syntax: 'classified' | 'opaque';
  semantic: 'none' | 'partial' | 'complete';
  interactive: 'none' | 'inspect' | 'edit';
  exact: 'compiler' | 'driver-dependent' | 'blocked-by-policy';
  pluginId?: string;
  securityRisk: 'none' | 'resource' | 'file-io' | 'shell' | 'network' | 'driver';
}
```

能力等级必须在 UI、AI manifest 和 diagnostics 使用同一份 Registry，避免 UI 说
“支持”、AI 说“可编辑”、renderer 实际却忽略。

### 4.3 Layer C — Geometry Semantic Kernel

内核不包含 `\draw`、`\node` 之类语言命令。核心实体是：

- Point、Line、Segment、Ray、Circle、Arc、Conic、Polygon、Text；
- Constraint、Relation、Construction、Transform；
- Style 和 Presentation；
- OpaqueConstructionBinding；
- Proof/Explanation metadata。

核心标识：

- `entityId`：数学实体稳定身份；
- `constructionId`：构造步骤稳定身份；
- `syntaxNodeId/sourceRange`：源码绑定；
- `renderId`：特定 renderer projection 的身份；
- 这些 ID 不允许通过数组下标隐式推导。

### 4.4 Layer D — Semantic Plugin System

插件声明输入、输出、能力和降级策略：

```ts
interface SemanticPlugin {
  id: string;
  version: string;
  syntaxFamilies: string[];
  project(input: SyntaxProjectionInput): ProjectionResult;
  plan(operation: SemanticOperation, snapshot: KernelSnapshot): OperationPlan;
  write(plan: OperationPlan, source: SourceSnapshot): SourcePatch[];
  render?(entity: GeometryEntity, context: RenderContext): RenderPrimitive[];
  explain?(entity: GeometryEntity): AiGrounding;
}
```

插件不能直接修改源码或 Scene。它只能返回带 precondition 的计划，由 Coordinator
原子提交。插件失败必须返回 typed diagnostic；禁止部分写入。

插件集也参与投影身份：

```text
projectionHash = SHA256(
  sourceHash
  + cstGrammarDigest
  + semanticPluginSetDigest
  + kernelSchemaVersion
)
```

同一源码在插件升级后可能产生不同语义投影，不能错误复用旧 Scene。

### 4.5 Layer E — Interactive Projection

Canvas renderer 只读取 Kernel snapshot：

- recognized/editable entity：完整 hit-test、drag、style、delete；
- recognized/inspect entity：可选中、可解释，不允许不安全写回；
- opaque local node：显示 exact overlay/bounds 时仍允许其他对象交互；
- scope/document opaque：仅冻结受影响 dependency component，不锁死无关画板；
- exact image 作为可切换的 visual truth overlay，不取代交互 renderer。

### 4.6 Layer F — Exact Execution

精确编译输入是 immutable snapshot：

```text
SHA256(
  source
  + pgf-version
  + engine-version
  + driver-version
  + font-bundle
  + compiler-image-digest
  + security-profile-digest
  + compile-options
)
```

生产链路：

```text
Next API -> queue -> isolated ECS worker -> object storage -> CDN
```

要求：

- network disabled；
- shell escape disabled；
- file allowlist；
- CPU / memory / wall-time / output-size limit；
- Tectonic 为默认可重复引擎，LuaLaTeX 为兼容 fallback；
- dvisvgm/driver 版本进入 artifact key；
- 结果不可变，失败也有 typed diagnostic 和可追踪 job id。

Exact lane 不允许在提交与编译之间静默 canonicalize/sanitize 源码。迁移或规范化必须
成为显式、可撤销 transaction；编译器只做拒绝式安全验证，并返回
`executedSourceHash`。否则产物不是用户已提交源码的 Rendering Truth。

## 5. 原子事务协议

```ts
interface SemanticTransaction {
  schemaVersion: 1;
  operationId: string;
  idempotencyKey: string;
  actor: 'human-code' | 'human-canvas' | 'ai' | 'repair' | 'importer';
  base: {
    revision: number;
    sourceHash: string;
    kernelHash: string;
  };
  readSet: ResourceRef[];
  writeSet: ResourceRef[];
  preconditions: Precondition[];
  operations: SemanticOperation[];
  compiledSourcePatches?: SourcePatch[];
  postconditions?: Postcondition[];
}
```

提交算法：

1. 校验 schema、size、actor 和允许的 operation kind。
2. 检查 `operationId/idempotencyKey`；重复请求返回原结果。
3. 对比 revision/sourceHash/kernelHash。
4. 校验 read-set、write-set、实体存在、插件版本、source range、旧文本 hash、
   opaque barrier、依赖和数学 preconditions。
5. 生成 semantic plan。
6. 由 writer 生成不重叠 source patches。
7. 在临时 snapshot 上解析 CST、重投影受影响 dependency component。
8. 校验 postconditions。
9. 原子提交 source、kernel snapshot、operation log 和新 hash。
10. 广播 changed source ranges、changed entity ids 和 render invalidation。

冲突不做 last-write-wins：

```ts
interface TransactionConflict {
  code:
    | 'REVISION_CONFLICT'
    | 'SOURCE_HASH_CONFLICT'
    | 'KERNEL_HASH_CONFLICT'
    | 'MISSING_ENTITY'
    | 'SOURCE_RANGE_MOVED'
    | 'PLUGIN_VERSION_CHANGED'
    | 'CONSTRAINT_UNSATISFIABLE';
  currentRevision: number;
  currentHashes: { source: string; kernel: string };
  retryable: boolean;
  affectedIds: string[];
}
```

AI 在 conflict 后必须基于最新 manifest 重新规划，不能覆盖用户新编辑。

幂等记录不是布尔集合：

```ts
interface IdempotencyRecord {
  key: string;
  requestHash: string; // SHA-256 over canonical transaction envelope
  result: CommittedTransactionResult;
}
```

同一 key 的请求只有在 `requestHash` 相同才是安全 replay。不同 payload 复用 key
属于协议错误，不能返回前一笔成功，也不能执行后一笔修改。

事务状态机：

```text
proposed -> previewed -> validated -> committed
                               \-> conflicted
                               \-> rejected
```

只有 `committed` 会进入 document history。AI 流式 token、拖动中的临时坐标和 exact
编译结果都不能直接改变 source。

## 6. 增量算法

### 6.1 Source edit

```text
TextPatch
 -> validate range/version/hash
 -> update old Lezer tree
 -> parse incrementally
 -> structural changed ranges
 -> map to syntax node ids
 -> invalidate owning semantic plugins
 -> traverse affected dependency components
 -> re-project
 -> semantic diff
 -> render invalidation
```

必须新增 byte/UTF-16 position index。JS string offset 不能直接当 UTF-8 byte offset。
每次 commit 还要保存 range mapping、syntax identity remap 和 entity remap checkpoint，
不能只保留短期内存 transaction。

### 6.2 Parse Gate

```text
source transaction committed
 -> tolerant CST updated
 -> ERROR/MISSING?
      yes: preserve source + diagnostics + last-valid projection(read-only/stale)
      no:  semantic plugin projection -> dependency invalidation -> writable Canvas
```

Gate 只阻止新的语义写回，不回滚用户正在输入的源码。存在结构错误时：

- CodeMirror 继续可编辑并显示范围诊断；
- Canvas 显示最后一个有效 projection 和“基于旧 revision”标记；
- Canvas/AI/solver transaction 被拒绝为 `SEMANTIC_PROJECTION_STALE`；
- exact compiler 不自动排队，除非用户显式请求编译该无效 snapshot；
- 修复为合法 CST 后再一次性重建受影响语义子图。

### 6.3 Canvas drag

```text
pointer move
 -> semantic Move/SetParameter operation
 -> affected constraint component
 -> substitution fast path
 -> Jacobian + rank/DoF
 -> bounded Newton / least-squares
 -> stable solution closest to prior state
 -> source writer patches only bound parameters
 -> atomic commit
```

拖动期间允许 ephemeral preview；pointer up 才形成持久 transaction。预览不能进入
undo history、AI manifest 或 exact compiler queue。

### 6.4 Delete

1. 从稳定 entity/construct ID 找 owner construction。
2. reverse dependency traversal 得到 descendants。
3. 提供 `block`、`cascade`、`detach-and-preserve` 三种计划。
4. command block 是事务最小删除单元；不遗留空 `@mathgeo` 标记。
5. 生成 source patches 后在临时 snapshot 中重放依赖图。

受管复合构造的细粒度删除不能退化成删除一条 TikZ body 语句。只有当对应
Construction IR plugin 能同时重写 entity/constraint/relation/output records、body、
header inputs/outputs 与 content fingerprint 时，才允许删除内部子图；否则 UI 和
  Transaction Broker 必须明确执行整块原子删除。默认 `block` 模式不得误删块外下游；
  若存在外部 descendants，必须拒绝并要求用户通过独立的二次确认操作选择 `cascade`。
  `detach` 在 typed structural recompiler 完成前不可用于受管块。

高级构造还必须满足 writer/render 完备性：writer 写出的每条可见几何语句都必须有
typed entity record、唯一 record binding、RenderPrimitive 和 hit-test 身份。关系图必须
表达派生对象对实际几何实体的依赖，例如完全四边形的交点依赖两条对边，而不能只用
“交点依赖四个原始点”替代构造语义。

### 6.5 Point on path

```ts
interface PointOnPathConstraint {
  pointId: string;
  pathId: string;
  parameter: number;
  domain: 'line' | 'segment' | 'ray' | 'circle' | 'arc';
  bounds?: [number, number];
}
```

拖动只改变 parameter。Detach 把当前求值坐标写成自由点。删除 path 时使用统一
dependency policy。

## 7. AI comprehension 协议

AI 不再只接收裸源码。输入 envelope 包含：

- docId/epoch/revision/sourceHash/projectionHash/kernelHash；
- parser/plugin/compiler profile digests；
- entity/constraint/relation graph；
- construction order；
- named paths/intersection bindings；
- source bindings；
- opaque nodes 和它们的影响范围；
- capability summary；
- typed diagnostics；
- prompt budget truncation declaration和 coverage 百分比。

AI 输出优先是 semantic operation bundle。只有无法语义化的官方语法才允许受限
source patch，并必须声明：

- target source range；
- expected old text/hash；
- official syntax family；
- exact compiler requirement；
- affected opaque/scope barrier；
- postconditions。

模型输出的整段 TikZ 只能作为“proposal”，客户端必须转换为最小 patch、验证 base
revision/hash、重新 analyze 后才能提交。

## 8. Breaking points

以下条件任一未完成，就不能宣称三方“完全互通”：

1. CodeMirror 仍可绕过 transaction coordinator 直接写状态。
2. Canvas tool 仍直接拼接整段源码且没有 semantic operation。
3. AI 返回整段代码即可覆盖用户新 revision。
4. source range 只有 JS offset，没有 byte/UTF-16 映射。
5. opaque scope 会锁死整张画板，而不是局部 capability barrier。
6. style/option 未识别时静默忽略，不产生 capability diagnostic。
7. exact compile 产物没有 engine/PGF/driver/font version cache key。
8. point-on-path 只保存坐标、不保存约束参数。
9. 删除不经过 reverse dependency plan。
10. solver 不报告 DoF、冗余、矛盾和不收敛。
11. Registry 没有 official version/ref，无法证明“官方语法基线”。
12. AI manifest 缺少 opaque/capability/source binding，AI 会把未知区域当空白。
13. 协议仍用 FNV-1a 等非密码 hash 作为服务端完整性依据。
14. exact lane 在编译前静默改写源码，却不返回 executed source hash。
15. dependency graph 缺少 `defines/reads/styles/scope/constraint/unknown-effect` 边类型。
16. transaction 没有 read-set/write-set，无法判断不相交修改能否安全 rebase。
17. CST 存在 ERROR/MISSING 时仍生成新的可写 Semantic IR 或 AI manifest。
18. idempotencyKey 不绑定请求 hash，同 key 不同 payload 被误判为成功重试。
19. source/CST/entity/render/artifact 之间没有可组合的多级 SourceMap。

## 9. 迁移顺序

### Phase 0 — 冻结边界

- 冻结 `StudioDocument` 为唯一 source commit 入口。
- 记录所有现有绕过入口。
- 保持当前 Scene/Canvas 可用，不大爆炸式重写。

### Phase 1 — Compatibility foundation

- 建立 PGF/TikZ 3.1.11a capability registry。
- CST 增加 stable syntax identity、position index、scope tree 和 opaque impact。
- UI 增加官方语法浏览、能力标签、官方链接和插入模板。
- 协议 hash 统一升级为 exact-byte SHA-256；FNV 仅保留为本地性能 hint。

### Phase 2 — Kernel v1

- 把现有 Scene 映射为 Geometry IR adapter。
- 增加 entity/constraint/relation/source binding。
- 先迁移 point、segment、line、circle、point-on-circle、intersection。

### Phase 3 — Transaction coordinator

- CodeMirror、Canvas、AI、repair 全部走同一 envelope。
- 增加 docId/epoch、hash、read/write set、precondition、idempotency/conflict。
- 幂等缓存保存 request hash 与原提交结果，拒绝 key/payload 不一致。
- CodeMirror runtime filter 拦截缺少 Broker metadata 的 programmatic write。
- 生成 semantic diff + source patches + render invalidation。

### Phase 4 — Plugin migration

- core paths / coordinate systems；
- scopes / transforms / styles；
- nodes / shapes / anchors；
- calc / intersections / angles / through；
- Bézier / arc / plot；
- matrix / trees / graphs；
- decorations / patterns / shadings / fadings；
- data visualization / graph drawing；
- PGF Basic/System 保真与 exact-only classification。

### Phase 5 — Solver

- connected-component invalidation；
- substitution；
- rank/DoF；
- bounded nonlinear solver；
- typed diagnostics；
- worker isolation。

### Phase 6 — Exact truth and production

- local non-Docker compiler process；
- ECS compiler workers；
- object storage/CDN immutable artifacts；
- versioned cache key；
- exact overlay/source-map diagnostics。

## 10. 验收矩阵

| 入口 | 必须输入 | 必须输出 | 冲突行为 |
|---|---|---|---|
| CodeMirror | versioned TextPatch | CST diff + semantic diff | 拒绝过期 range |
| Canvas | semantic operation | solver result + source patches | 选择重算或回滚 |
| AI | manifest + base hashes | semantic bundle/source proposal | 409 后重规划 |
| Compiler | immutable source snapshot | SVG/PDF + diagnostics | 不改变文档 |
| Importer | source/IR envelope | new transaction | schema/version gate |

最低回归场景：

1. 源码含 `\foreach`、宏、scope、未知 library 时原文无字节丢失。
2. 在 opaque 局部块之外仍可创建、拖动和删除对象。
3. 圆上点拖动后只改变 parameter，仍保持 lies-on constraint。
4. AI 续画使用已有 named paths；引用不存在对象时事务被拒绝。
5. AI 生成期间用户移动点，旧 AI 结果不得覆盖新 revision。
6. 空文档由 Canvas 创建点后生成最小有效 tikzpicture。
7. 级联删除不留下失效引用或空 command marker。
8. exact result 与 interactive projection 不同时时，UI 明确标注能力差异。
9. 每个官方 family 可在 Registry 查询 preserve/syntax/semantic/interactive/exact 状态。
10. exact compiler 不可用时，交互画板仍可编辑可理解子集。
11. exact artifact 返回 source/profile/image/artifact hashes，旧 revision 只能作为历史预览。
12. Unicode 文档中 byte、UTF-16 和 line/column range 映射往返一致。
13. versioned managed block 的 header、连续 metadata prefix 或 TikZ body 任一变化都会
    使 content fingerprint 进入 detached/invalid，且不得回退为猜测语义。
14. Scene projection 与 managed records 的唯一强匹配实体合并为同一 canonical entity；
    `on-circle` 与 `depends-on` 不得产生重复 constraint/relation。
15. Canvas、Style 和 AI 不得局部改写 managed block；修改必须经过 Construction IR
    recompiler 整块替换，删除必须以 command block 为原子单元。

## 11. 当前决策

- **采用**：Geometry Semantic Kernel、lossless CST、capability registry、
  semantic plugin、version/hash transaction、operation log、exact truth lane。
- **采用但延后**：稀疏非线性 solver、CRDT adapter、多文件 WorkspaceEdit。
- **不采用**：把所有 TikZ 命令直接硬编码进单一 AST；用 exact SVG 替代交互场景；
  AI 整段覆盖；未知 style 静默降级；当前阶段直接引入 Yjs/Automerge。

本草案通过架构 gate 后，实施应从 Phase 1 与 Phase 2 的兼容层/Kernel 骨架开始，
再把现有 Scene、AI manifest 和 Canvas tools 逐步迁移，避免一次性推翻已工作的画板。

## 12. 2026-07-29 实施对齐

当前工作树已经完成：

- PGF/TikZ 3.1.11a 能力目录、140 条能力记录、74 个官方 library；
- Geometry IR/Plugin/IO/AI context 基础；
- revision/hash/read-write-set/source precondition 的 Transaction Broker；
- 幂等键绑定规范化 request fingerprint；同 key 不同 payload 明确冲突，内存索引
  与 256 条事务窗口同步淘汰；
- CodeMirror、Canvas、AI programmatic writer 的统一提交路径；
- AI 缺少可验证 transaction 时禁止整段源码 fallback 覆盖；
- AI 返回的未验证/无效整段源码不再借 `repair` 身份绕过 Broker；
- 事务冲突、拖动过期和构造过期的用户可见诊断；
- Parse Gate：无效当前源码保留，Canvas 显示 last-valid revision 的只读投影，
  Canvas/AI/style 写回全部被同一 gate 拒绝；
- 空字符串定义为合法空 Construction Truth，可从 0 点/0 图元重新开始画图；
- 官方语法库插入通过真实 CodeMirror transaction；
- 集中式命令/快捷键注册，modifier-only keydown 不再作为运行时异常；
- 统一 TikZ calc coordinate serializer；平行线已不再生成嵌套 `$...$` 或缺失括号；
- typed Construction IR、结构校验器和单一 TikZ writer；画板工具不再把高级构造意图
  直接等同于字符串模板；
- `point-on-circle`、`parallel-line`、`perpendicular-line`、`inversion-point`、
  `cyclic-quadrilateral`、`complete-quadrilateral` 已迁移为
  entity/constraint/relation/output plan，再由 writer 生成受管源码块；
- 原先绕过 Construction IR 的“中点”和“垂足”也已迁移为 typed plan，
  分别写入 `midpoint` 与 `perpendicular-foot` constraint，并通过同一 writer、
  fingerprint、Broker、Geometry IR 与 AI context 闭环；
- 画板 12 类基础图元统一经过一个穷尽式 primitive plan factory；生产提交与创建预览
  都消费同一份 `ConstructionPlan`。`authoringLines()` 已退出生产运行时，仅保留为旧测试
  兼容导出；创建 preview 不再生成或重解析临时 TikZ；
- 空白处创建图元时，每个新 anchor 先编译为 typed point plan，主图元再编译为 typed
  primitive/custom plan，所有 managed blocks 合并进同一个 revision-bound source patch；
  删除该 source-block 会原子移除 owned points 与主图元；
- 构造 ID 与点名分离并从当前文档 managed IDs 分配；同一 A/B 可创建多条独立样式的
  segment/vector/line/ray，而不会复用同一构造身份；
- 非点图元的 relation/output 使用 typed entity record ID，而不是把展示名称重新塞回
  TikZ point-ref 命名空间，避免用户点名与构造实体名碰撞；
- free-point metadata 的坐标在 writer 中使用与 TikZ body 相同的 source-number
  canonicalization，避免 AI semantic definition 与 Scene 执行坐标出现隐藏精度分叉；
- rectangle-by-opposite-corners 已从工具层预生成四 anchor 收束为 plan 自己接收两个
  对角输入并生成另外两个派生角点；
- 受管源码协议当前 writer 使用 `schema=2 + plan-kind + typed input/entity/constraint/relation/output`
  记录；records 必须是 header 后的连续前缀，畸形、错位、重复或超限 metadata 按事务
  整体失效，不能暴露部分语义；
- reader 继续兼容旧 `schema=1` 的既有 closed vocabulary；三点圆、切线、中垂线和
  角平分线等新增 constraint kinds 只允许出现在 schema v2。不能只提升 adapter version
  而静默改变持久化源码协议；
- 每个新受管块写入 `fingerprint-alg=fnv1a64-utf8` 与
  `content-fingerprint`，绑定 header identity、metadata 文本与 TikZ body。该同步指纹
  用于检测意外漂移而非密码学证明；旧块标为 unchecked/absent，失配块标为 detached；
- detached、invalid、unsupported block 只保留 lossless Construction Truth、诊断和
  exact TeX 通道，不再走 header heuristic；只有真正无 schema 的旧块允许兼容性 fallback；
- 受管源码块会重新投影为 Geometry IR entity/constraint/relation 与精确 UTF-16 source
  binding，AI context 直接输出定义、输入/输出 role、完整性状态和只读 source ranges；
- managed typed records 与 Scene projection 使用“块内唯一强语义键”对齐：匹配成功时
  合并为同一 canonical entity，无法唯一匹配时保留 `semanticOnly` 实体并显式标记；
  typed `on-circle` 与 `depends-on` 会抑制同义 Scene constraint/relation；
- managed entity 的 semantic kind/dimension 对 canonical entity 具有权威性；Scene 的
  `polyline` 只记录 TikZ subset 执行结果。segment/vector/line/ray 的数学身份不再由
  箭头样式或有限端点猜测；
- line/ray 的 TikZ calc 坐标会重复 A/B 引用，adapter 同时保留 exact syntax key 与
  两点 normalized projection key；归一化仅在“块内唯一 + 恰好两个唯一引用”时参与匹配。
  匹配后 managed record 的两点引用会覆盖 canonical entity 的重复 Scene references，
  因而 Semantic Truth 和 Rendering Truth 都只携带权威 `[from,to]`；
- interactive Rendering Truth 已从 reconciled GeometryEntity 读取 kind：line 标记
  `extent=infinite`，ray 标记 `extent=positive-infinite`，segment/vector 保留 finite
  identity；free/derived point 也会成为具有 source binding 的 interactive primitive。
  拓扑维度按几何身份记录：点与标签为 0，路径、圆边界、多边形边界及角标为 1，
  rectangle semantic region 为 2；
- committed Canvas 已切换为消费 revision-bound interactive RenderPrimitive；强类型
  decoder 在进入 React SVG 前验证有限坐标、图元基数、半径、样式和别名，单个不支持或
  非法 primitive 只产生局部 decode issue，不会使整张画板失效；
- Canvas 接受 RenderingTruth 前必须完整匹配 `rendererId + documentId + epoch +
  revision + sourceHash + kernel/projection/plugin digest + sourceId`，不能只比较可能在
  新 epoch 重复的 revision number；
- line/ray 使用共享的 parametric slab clipping 裁剪到当前 SVG frame，分别采用
  `t∈(-∞,+∞)` 与 `t∈[0,+∞)`；该纯函数同时作为后续 hit-test 的唯一裁剪边界，禁止
  渲染与选择各自实现一套近似算法；
- auto-fit 从 RenderPrimitive 的语义定义点计算；line/ray 优先通过权威 reference
  找回 named point handle，禁止把 TikZ 扩展端点或 viewport 裁剪端点反馈进 fit，
  从而避免无限图元导致 viewport 循环漂移；
- committed selection/hover 的 element hit-test 已改读同一组 decoded RenderPrimitive，
  并与 SVG renderer 共用 line/ray slab clipping；point drag 暂时继续由 Scene handle
  命中负责。返回值携带 source stable ID、semantic entity、render primitive、
  source-binding/range 与 statement identity，typed SelectionTarget 分字段保存；
  semantic-only 图元没有 source stable ID 时降级为 statement target，禁止把 canonical
  entity ID 冒充 Scene 删除身份；
- SelectionTarget 进入 Inspector 前必须经过独立的 revision-bound Selection
  Resolution：在同一 revision 内同时解析 semantic entity、RenderPrimitive、
  source binding/range 和可选 legacy Statement，并要求 Statement range 与
  RenderPrimitive source range 精确匹配。Inspector 标题、几何详情、关系图和源码跳转
  消费这一份 resolution；关系面板优先读 Geometry IR dependency/constraint graph，
  Scene 仅作为尚未语义化的 point fallback。任何 range/revision 不一致都必须禁止属性
  写回，不能显示上一选择或按旧 stmtIndex 猜测目标；
- ToolContext 的拖拽求解暂时继续使用 Scene 数值缓存；创建 preview 已独立为 source-neutral
  `Preview IR`。第一阶段从同一 plan 精确投影 point/segment/vector/line/ray/polyline/
  polygon/rectangle/circle/label/angle/right-angle；尚未接数值求解器的派生 plan 返回
  `unsupported-plan-kind` 并退回 generic ghost，不能生成临时 TikZ 或借用 committed truth
  冒充预览结果；
- Transaction Broker 禁止 Canvas、Style、AI 对 managed header/metadata/body 做局部
  raw patch；合法修改必须由 recompiler 整块替换，整块删除仍保持原子性；
- Inspector 写回必须先由 Selection Resolution 计算显式 capability：
  `direct` 只允许当前 source revision/hash/range 已证明可写的普通语句；
  `managed-recompile` 只允许 recompiler 已声明支持的属性类别；其余一律
  `read-only`，不得把“按钮可点”冒充可逆语义编辑；
- managed style recompiler 每次整块替换时必须重新计算 content fingerprint，并由
  Transaction Broker 校验整块 replacement；坐标、标签文本等同时存在于 typed record
  与 TikZ body 的语义字段，在 typed record + body 双写 recompiler 完成前必须拒绝修改，
  不能只改可见 TikZ body 造成双真相；
- managed 整块替换会产生新的 source statement / RenderPrimitive 身份。Selection
  Resolution 不得用可绑定多个对象的 block-level binding 猜测目标。每个 typed semantic
  record 必须拥有稳定且唯一的 `binding:managed:<construction>:record:<type>:<id>`；
  恢复时只接受绑定到单个 entity 的 identity binding，并在候选不唯一时进入 read-only。
  恢复后再用当前 revision 的 semantic entity、RenderPrimitive、source stable ID、range
  和 binding 归一化 SelectionTarget；连续第二次属性修改不得继续携带旧 revision 身份；
- Scene identity registry 的 semantic key 必须排除颜色、线宽、虚线、标签 anchor/text 等
  可编辑表现属性以及整段 source spelling；这些属性变化不能重铸 entity/RenderPrimitive
  identity。事务 range mapping 只作为语义键无法匹配时的保守 fallback；
- managed construction ID 必须满足 document-level uniqueness。重复 ID 的所有块继续按
  原源码渲染，但不得投影成可写受管语义；其 block binding 以 source range 隔离、写策略
  降级为 `ambiguous-managed-id-read-only`，recompiler 必须在执行前再次验证唯一性；
  Geometry diagnostics 和 AI construction summary 同时暴露 duplicate-ID 状态；
- entity、constraint、relation、output 每条 typed record 都产生独立 record binding；
  output binding 必须继续传播到其目标 entity/RenderPrimitive，不能只存在于
  Construction Truth 而在 Canvas/Inspector 入口丢失；
- angle/right-angle 的 renderer、hit-test 与 hover 必须消费同一份 screen-space mark
  geometry。角标与顶点 handle 重叠时，只有点击位置到角标路径更近才由角标获胜，保证
  点拖拽优先级与角标可选中性同时成立；
- `complete-quadrilateral` writer 绘制的四条延长线与两交点连线均已升级为 typed entity；
  每个图元拥有独立 record binding。X1/X2 分别依赖对应的两条对边，派生连线再依赖
  X1/X2，Canvas、Inspector、AI dependency graph 不再只看见两个交点；
- `circumcircle` 已从“只输出圆心、无约束”升级为显式三输入点算法：typed circle entity、
  `circle-through-three-points` constraint、center/circle 双输出与完整依赖边同步进入 managed
  metadata、Geometry IR、AI context 和 Rendering Truth；
- `tangent-at-point` 已移除指向不存在 `radius-<center>-<touch>` 实体的伪 perpendicular
  constraint 和近似半径输入。工具直接命中一个实际 circle entity，并在点击参数处生成
  typed touch point；`on-circle(touch,circle)` 与
  `tangent-at-point(line,touch,circle,center)` 同时进入 schema v2。writer 先用所选圆自己的
  center/through/angle 参数化生成切点，再作半径垂线；touch、direction point 与 tangent
  line 均登记为 output；
- 圆类构造命中统一消费当前 revision 的 decoded RenderPrimitive circle geometry。普通/AI
  TikZ 圆只有在 parser 能证明 `named center + named through` 或
  `named center + positive literal radius` 时，才携带 typed `circleDefinition` 进入
  Scene → Geometry IR → Rendering Truth；复杂 calc 圆不得从无序 `refs` 猜测 center/through。
  point-on-circle 与 tangent 共用这一 typed 圆实体输入通道；
- Runtime Scene/RenderPrimitive UUID 不能写入持久化 TikZ。受管图元跨构造引用只允许
  `managed:<construction-id>:<entity-record-id>`；adapter 在投影前预索引所有有效 managed
  entity records，并把该稳定引用解析到当前 revision 的 canonical entity。这样页面重载、
  AI context 重建与 ECS/CDN 滚动发布不会因 `tz_<uuid>` 重铸而断开圆/切线关系；
- 普通/AI 生成圆的 `source:circle:center:<name>:through:<name>` 与
  `source:circle:center:<name>:radius:<number>` 只属于**当前 revision 的定义选择器**，不是可持久化
  身份。第一次被其他构造引用时，Transaction Broker 必须把原始圆语句原样包入独立 schema-v2
  managed block，生成 `managed:source-circle[-N]:circle`，并让本次依赖构造只引用该 managed ID。
  收编与依赖构造必须合并为一次 CodeMirror 事务；任一 source range、metadata 或 fingerprint
  校验失败则整次不写。同一 revision 存在重复定义时仍 fail closed；后续出现相同 raw 定义时
  必须分配新的 managed ID，禁止跨 revision takeover。ID allocator 不仅保留现存 block ID，
  还必须保留源码中任何仍被 `managed:<id>:` 引用的孤儿 ID；直接删除上游块不能使身份重新可用。
  raw circle source range 若与任一 valid/detached/invalid managed block 重叠，则禁止再次收编，
  必须先修复或显式重编译原块，禁止嵌套 `@mathgeo begin/end`；
- Canvas 创建统一通过 `canvas-construction-batch-proposal/v1`：owned input point plans、最终
  construction plan 与 raw-circle adoption intents 使用起始文档 UTF-16 坐标组成一个原子
  multi-patch transaction。GeometryDoc 的 `binding:document:tikzpicture-body-end` 必须显式暴露
  `create-managed-construction-batch` capability 及 revision/plugin-bound fingerprint；Broker 从当前
  source 重建 GeometryDoc，校验 compact canonical plan、writer safety 与 writer artifact 后重新调用
  trusted writer，要求 canonical patches/proof 完全相等。可逆类型还必须从生成块反解回同一 compact
  plan；当前记录无法无猜测恢复圆参数的 point-on-circle、tangent-at-point、radical-axis 必须通过严格
  catalog semantic footprint 后再由 trusted writer 重放；其中每个 managed circle ID 必须从当前 valid
  managed record 或同批 adoption capability 重新解析定义，并与 GeometryDoc 的圆心、过点、半径及
  evaluated snapshot 一致。任何无 batch proof 的 Canvas managed-block
  新建一律拒绝，不能退回 generic source patch；style 只是提交展示来源，不能改变 Canvas 授权身份；
- 所有 ConstructionPlan 类型统一服从 `construction-plan-footprint/v1`。该 ABI 对当前 19 类构造
  （含可变参数的 polyline/polygon primitive）精确规定有序 inputs、entities、constraints、relations
  与 outputs。Catalog 的预览/提交、Canvas proposal、AI proposal 与 Broker canonical replay 必须
  调用同一个 validator；任何额外记录、重复角色、未消费依赖或数组重排都 fail closed。Canvas
  外部 input ref 还必须解析到当前 GeometryDoc、同批更早的 owned point 或同批 adoption capability；
  仅通过一般 ConstructionPlan grammar 但不符合具体工具足迹的计划不得进入 writer；
- AI 新建构造已经收敛为 closed、create-only 的 `construction-intent/v1`，不再要求模型合成完整
  record arrays。intent 携带完整 document/epoch/revision/source/kernel/projection/plugin/catalog basis、
  revision-bound insertion capability fingerprint、toolId、有序 binding IDs、声明式命名请求与显式参数；
  可信 Catalog compiler 在当前 GeometryDoc 上分配 ID、构建 canonical ConstructionPlan、验证 footprint
  并产出 writer artifact，Broker 在最终提交点重新投影当前 source、重解 binding、重编 intent、比较
  canonical plan 并重生 patch。完整 ConstructionPlan 只保留为内部 proof/replay ABI，以及现阶段对
  已有 canonical managed block 的受控 replacement compatibility lane；AI 直接用 plan 新建必须拒绝。
  Broker 的 authorized binding IDs、create capability fingerprint 与 scope fingerprint 必须由宿主作为
  独立 commit evidence 传入，不能从 intent 或 transaction metadata 反推，否则 scope 校验只是同义反复。
  raw source circle adoption 已进入 intent/v1：模型只提交授权 binding，Catalog/Broker 从当前
  GeometryDoc、source range、verbatim fingerprint 与 typed definition 原子生成 adoption + dependent plan；
  计算型、歧义、退化、opaque 或 stale 圆仍显式 fail closed，不能猜测 circle snapshot；
- `radical-axis` 的输入已从四个近似点升级为两个 typed circle references。writer 使用
  `t=(d^2+r1^2-r2^2)/(2d^2)` 生成等幂点，再以圆心连线的垂线方向生成完整直线；center-through
  与 positive literal radius 两种圆定义共享该语义。schema-v2 同时登记 line entity、
  radical-axis constraint、两圆依赖与 point/direction/line outputs。相交、相切、相离圆走同一
  算法；同心或近同心圆在写事务前拒绝，不能产生奇异公式或半完成 managed block。判断使用
  当前 Geometry Truth 的 evaluated center/radius 快照而非圆心名字，因此异名同坐标也不能
  绕过除零保护；
- `reflect-point`、`reflect-line`、`rotate-90`、`homothety-2` 不再只登记宽泛
  `depends-on`。schema-v2 分别写入 `point-reflection`、`line-reflection`、`rotation`、
  `homothety` constraints；axis endpoints、projection foot、source/result、angleDegrees=90 与
  scale=2 都有独立字段并由 adapter 投影为明确 roles/parameters，AI 与后续 solver 不必从 calc
  公式反推变换意图；
- `perpendicular-bisector` 同时记录 midpoint 与 perpendicular-bisector predicate，并把
  输出线登记为 typed output；`angle-bisector` 记录 line + armA/vertex/armB 的等角语义，
  不再让 AI 从画线公式猜测构造意图；
- Construction Plan runtime validator、managed schema shape validator、TikZ adapter 1.17.0、
  `construction-plan-footprint/v1` 与
  structural constraint diagnostics 已同时登记上述新 predicate。新增语义种类不得只改
  catalog 或 writer，否则必须视为 schema/AI/canvas 闭环失败；
- 交点不再定义为匿名坐标或数组下标。`line-intersection` 已携带两条 typed line entity；
  `line-circle-other-intersection` 已携带 line、circle、已知排除点与明确的 infinite-line
  domain。圆内接四边形的第四点使用 `exclude-known-point(A)` 保持拖动时的分支身份，完全
  四边形的两个对边交点分别绑定各自两条直线。候选解排序不再成为持久语义；
- 圆内接四边形提交前按 writer 同一公式求第二交点，除切线外还拒绝第四点与 B/C 重合；
  完全四边形在写入前拒绝平行对边。上述失败都保持源码不变，不生成半个 managed block；
- ConstructionPlan runtime gate 已穷尽验证 entity/relation/output/constraint record，并对 input
  ref、entity id/name 建立声明闭包；entity dependency、constraint、relation、output、selection
  与 plan-level writer refs 在序列化前必须闭包可解。未作为 input 声明的 `managed:*` 不得成为
  隐式跨块依赖；circle center/through 仅作为已声明 circle input 的源码 witness 保留兼容；
- structural diagnostics 已为 point/line reflection、rotation、homothety、radical-axis、
  line-intersection 与 line-circle-other-intersection 登记保守的 scalar-equation DoF 权重；这些
  权重只用于 planning，不能冒充数值 residual/rank 证明；
- [JSXGraph OtherIntersection](https://jsxgraph.org/docs/symbols/OtherIntersection.html) 与
  [GeoGebra Intersect](https://geogebra.github.io/docs/manual/en/commands/Intersect/) 证明动态交点
  需要显式 branch/seed 选择；[PGF base-points](https://github.tikz.dev/base-points) 同时警告
  平行线求交可能算术溢出且交点顺序依赖算法。因此切线导致“另一交点”消失、无交点、平行、
  重合、退化方向都必须产生 typed diagnostic，并保留 last-valid Geometry Truth；
- Delete/Backspace 与 Inspector 使用同一 managed-block policy：受管选择只执行 `block`，
  不能通过快捷键绕开“外部下游”拒绝和二次 cascade 确认；
- engine/service 边界的缺省删除模式也是 `block`；任何 `cascade` 必须由调用方显式传入，
  防止未来新增入口在未实现确认 UI 时意外继承破坏性默认值；
- 受管复合构造内部图元的删除当前执行整个 command block 的原子删除；Inspector 默认
  使用 `block` 并明确显示“删除整个受管构造”，块外存在 descendants 时拒绝。用户只有
  通过独立的“删除构造及外部下游”二次确认才能进入 `cascade`。只有接入能闭包重写
  records/body/header/fingerprint 的 typed structural recompiler 后，才可开放单个内部
  图元删除或 detach；
- Scene 名称引用已统一解析为当前 revision 的稳定实体 ID；缺失引用显式标为
  `unresolved:*`，不再伪造指向不存在 `point:A` 实体的 graph edge；
- `geometry-source-map/v1` 组合 source binding → semantic
  entity/constraint/relation → render primitive；interactive SVG 暴露 binding ID 与
  UTF-16 source start/end，可从画布对象精确回到 CodeMirror range；
- AI context 支持 `focusRefs` 和依赖闭包优先级，先保留当前选择相关实体、约束、关系
  与 source binding，再应用 token/数量预算；API 校验 `contextRefs` 与 kernel focus
  为同一 revision 快照。

### 12.1 预览事务不是第二条编译链

旧的 `previewAuthoring -> authoringLines -> previewCode -> analyze -> legacy Scene` 与正式
`ConstructionPlan -> compileConstructionPlan -> Broker` 曾是两条不同语义路径。2026-08-01 已移除
这条 raw creation-preview 编译链：创建 preview 使用不可变、source-neutral 的
`ConstructionPreview/Preview IR`，通过与 commit 相同的 plan factory 取得稳定 plan ID 与 typed
geometry；draft store 不写源码、history、AI memory、持久化或网络。Escape 只回退/丢弃 draft，
完成操作才把 ConstructionPlan 交给 writer 并形成一次 Broker 提交。

当前 Phase 1 已覆盖全部 primitive 定义与对角矩形；line/ray 在 preview 中明确携带
`finite-extent-fallback` 诊断。需要数值约束求解的 midpoint、foot、bisector、tangent、transform、
radical-axis、cyclic 与 complete-quadrilateral 暂时返回 typed `unsupported-plan-kind`，保留通用
anchor/candidate ghost。下一阶段必须让它们消费独立 Constraint Solver 的 evaluated draft，禁止
复制 TikZ writer 公式形成第三套几何实现。

[tldraw shapes](https://tldraw.dev/sdk-features/shapes)、
[Editor transactions](https://tldraw.dev/sdk-features/editor) 与
[history rollback](https://tldraw.dev/sdk-features/history) 提供了 immutable record、稳定 ID、批量
事务和 bail-to-mark 的官方先例；[Excalidraw v0.18.0](https://github.com/excalidraw/excalidraw/releases/tag/v0.18.0)
则把不进入历史的 preview update 与最终 undoable commit 明确区分。Canvas 不得通过 raw TikZ
字符串临时创建另一份 Rendering Truth。

### 12.2 增量约束求解边界（2026-08-01 调研对齐）

下一阶段不把 renderer 或 TikZ writer 继续扩成隐式 solver。数值求解必须成为 Geometry
Semantic Kernel 的独立派生层：TikZ/CST 与 managed records 保持不可变输入，constraint graph
建立 directional adjacency index，只把 drag/AI patch 影响到的 connected component 送入 worker。

依据：

- [SolveSpace solver technology](https://solvespace.github.io/solvespace-web/tech.html)
  使用方程残差、Jacobian/Newton 与欠约束处理；本项目据此把 `residual + rank + convergence`
  作为 solver truth，而不是把“能画出 SVG”当作约束成立；
- [JSXGraph Board update lifecycle](https://jsxgraph.org/beta/docs/symbols/JXG.Board.html)
  暴露 prepare/update 与重入保护；本项目 drag 事务采用
  `begin -> optimistic variable -> affected solve -> diagnostics -> commit/rollback`，禁止递归更新环；
- [tldraw bindings](https://tldraw.dev/sdk-features/bindings) 使用 directional bindings、增量索引、
  isolation hooks 与 operation-complete 生命周期；本项目 relation/constraint records 同样维护
  from/to 索引，删除时先 isolate/bake 或显式 cascade，整次操作结束后再批量发布诊断。

统一退化诊断码至少包括 `DEGENERATE`、`INCONSISTENT`、`UNDERCONSTRAINED` 与
`NON_CONVERGENT`。平行/垂直使用 cross/dot residual，交点和根轴在进入除法前检查零长度、
平行、同心与秩亏。求解失败保留 last-valid Geometry Truth 并回滚本次拖动，不得把 NaN/Infinity
写进 managed records、TikZ source 或 Rendering Truth。

2026-07-29 本机 Edge 浏览器证据：

1. 官方语法库插入示例后，源码、行号、opaque capability diagnostic 同步更新，
   UI 显示“已通过源码事务插入”。
2. 平行线工具选择 `C` 与参考线 `AB` 后生成：

   ```tex
   \coordinate (Q1) at ($(C)+(B)-(A)$);
   \draw ($(C)!-3!(Q1)$) -- ($(C)!4!(Q1)$);
   ```

3. 基础 line/segment 工具选择已有 A/B 后均写入 `plan-kind=primitive`、
   schema、fingerprint、typed entity/relation/output，页面保持“构造有效”。
4. 在空白处创建线段产生连续的 `point-P1`、`point-P2`、`segment-P1-P2`
   三个 managed blocks；通过画板“删除对象及下游”后三块同时消失，
   已有 `segment-A-B` 与 `line-A-B` 保留。
5. 矩形选择 A/C 后 header 仅有 `inputs=A,C`，plan 自己生成 R1/R2 并绘制闭合矩形；
   浏览器 console 未出现 error/warn。

   画板由 `5 点 · 9 图元` 更新为 `6 点 · 10 图元`，状态仍为“构造有效”。
3. `Ctrl+Z` 通过 CodeMirror 历史原子撤销并恢复原图；浏览器无新增 error/warning。
4. 在源码末尾制造未完成结构后，当前源码和诊断保留，Canvas 仍显示 revision 0 的
   `5 点 · 9 图元`，并出现只读标记；点工具没有写入，AI 续画被 gate 明确拒绝。
5. 撤销语法错误后，last-valid 标记和 AI gate 提示消失，当前 projection 自动恢复。
6. 清空源码后画板显示 `0 点 · 0 图元` 且“构造有效”；在空白处使用点工具会原子生成：

   ```tex
   \begin{tikzpicture}
   \coordinate (P1) at (...);
   \end{tikzpicture}
   ```

   两次撤销恢复原始 `5 点 · 9 图元`；以上浏览器场景均为 0 error / 0 warning。
7. typed Construction IR 接线后重新执行平行线，仍生成同一最小合法 calc 语法，
   画板更新为 `6 点 · 10 图元`，说明 plan → writer → Broker → CodeMirror →
   semantic projection 闭环成立。
8. 先以 `A` 为圆心、`C` 为圆上一点创建圆，再使用“圆上点”点击圆周，生成：

   ```tex
   % @mathgeo begin schema=1 fingerprint-alg=fnv1a64-utf8 content-fingerprint=<16hex> id=point-on-circle-P1 kind=point-on-circle plan-kind=point-on-circle inputs=<circle-stable-id>,C outputs=P1
   % @mathgeo record {"recordType":"input","id":"circle","role":"circle","ref":"<circle-stable-id>"}
   % @mathgeo record {"recordType":"constraint","id":"constraint-P1","kind":"on-circle","point":"P1","circle":"<circle-stable-id>"}
   \coordinate (P1) at ($(A)!1!0.001:(C)$);
   % @mathgeo end
   ```

   画板识别为 `6 点 · 10 图元`，状态保持“构造有效”，浏览器控制台 0 error /
   0 warning；该块会在下一次投影时恢复圆约束、依赖关系和源码范围。
9. 浏览器 DOM 抽查 interactive primitive，确认同时存在稳定 `data-tikz-id`、
   `data-tikz-source-binding`、`data-tikz-source-start="186"` 和
   `data-tikz-source-end="226"`；热更新后控制台仍为 0 error / 0 warning。

同日继续完成：

1. changed UTF-16 range 已映射到 binding/entity/constraint/relation/render primitive，
   并计算 dependency ancestor、descendant 和组合闭包；遇到 opaque barrier、basis mismatch、
   plugin-set change 或 closure limit 时保守回退 full reproject；
2. AI proposal 升级为 `ai-patch-proposal/v1`：按 source binding 验证多操作 patch、
   compare-and-swap guard、source range 和 opaque/writable 权限，再编译为单个
   revisioned Geometry Transaction；不存在整文覆盖分支；
3. API 只接受与当前 document basis、kernel focus 和 source binding scope 一致的 proposal；
   无可验证 proposal 时 fail closed；
4. constraint diagnostics 已建立 typed DoF、redundant 和 over-constrained 诊断入口；
5. exact execution 建立 `sourceDigest → cacheKeyDigest → artifactDigest` 三段证明，
   compiler image、profile、visibility、bytes 和完成时间进入
   `tikz-artifact-attestation/v1`；
6. Worker 实际重新观察 source hash；Web 重新计算 source/cache/job 与 artifact bytes，
   不以内联 SVG 代替受证明产物；
7. ECS production 以同一 immutable `repo@sha256:...` 绑定 API/Worker，Redis 按 image digest
   命名空间隔离；
8. OSS public/private artifact namespace 分离，写入使用
   `x-oss-forbid-overwrite: true`；冲突时复核对象 bytes、metadata 和 ACL；CDN 只服务
   public immutable artifact；
9. AI patch 与 exact attestation 已分别通过最终静态代码审查，结论均为 CLEAR/APPROVE；
   按产品方边界未执行测试、build、lint、typecheck、Docker、compiler、Redis 或 OSS。

仍未完成：

1. 持续扩展 official capability registry 的 semantic/interactive coverage，不能把
   “官方语法可保真/可精确编译”误报成“每条语法都可直接操纵”；
2. 本地浏览器复核 Workspace Dashboard、v4 Motion、Style Inspector 与 exact attestation UI；
3. 产品方执行已登记的单元、编译器、容器、OSS/CDN 和生产验收；
4. Figma variables/components/screens 等待账号获得 Edit 席位后同步。
