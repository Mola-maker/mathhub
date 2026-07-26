# TikZ Studio 设计规格（v1）

- 日期：2026-07-26
- 状态：已批准（设计评审通过，直接进入实现）
- 项目：math_geohub（Next.js 16 App Router · React 19 · TS）
- 一句话：在 math_geohub 中新增与 GeoGebra 页面平行的 **TikZ Studio** —— LLM 生成构造语义 TikZ 子集 → 自研依赖引擎求值 → 交互 SVG 画布（拖拽联动/样式微调/代码双向同步）→ TikZJax 精确预览，实现高效竞赛几何作图。

---

## 1. 目标与定位

| 项 | 内容 |
|---|---|
| 产品定位 | 与 Math Studio（ggb）平行的第二个 studio：代码优先、LaTeX 原生、可交互微调的竞赛平面几何作图 |
| 入口 | 首页第二张 tile + 全屏 overlay（Pattern A，同 Math Studio）；另有 `/tikz` 直达路由 |
| 用户价值 | 自然语言出题 → LLM 写 TikZ → 立即可交互的图 → 拖拽/样式微调实时回写代码 → 导出可直接编译的 TikZ / SVG / PNG |
| 差异化 | ggb 页 = 黑盒引擎、无代码面；tikz 页 = 白盒代码、LaTeX 生态、竞赛构造语义 |

**v1 范围（MVP）= Phase 0 + Phase 1**（见 §11 分期）。

---

## 2. 已锁定的关键决策

| # | 决策 | 选项 | 理由 |
|---|---|---|---|
| D1 | 拖动语义 | **完整构造依赖（类 GeoGebra）** | 用户明确选择；竞赛图特征即深层派生链 |
| D2 | 渲染通道 | **自研交互 SVG 为主 + TikZJax 精确预览（懒加载）** | 拖拽联动要求 60fps 自研渲染；真 TeX 保真校验走 wasm |
| D3 | 真源 | **方案 A：TikZ 构造子集即唯一真源**（+ 借 lezer 语法做编辑器高亮） | 代码可编辑 + 双向同步是核心需求；JSON DSL 真源（方案 B）违背此需求 |
| D4 | 构造语义表达 | TikZ 原生 `calc`/`intersections`/`through`/`angles` 库语法 | 100% 合法可编译 TikZ；天然声明式构造语言；TikZJax 支持全部四个库 |
| D5 | LLM 出口 | **全部 provider 默认走中转站 `https://api.molamaker.cn`** | 用户要求；ggb 页即时生效，tikz 页继承 |
| D6 | 覆盖验收 | 竞赛语料回归测试，**v1 门槛 ≥90%** | 把"覆盖 90% 竞赛题"变成可验证指标 |

---

## 3. TikZ 构造子集规范（v1）

LLM 只输出此子集。**既是合法 TikZ（pdflatex + `\usetikzlibrary{calc,intersections,through,angles,quotes}` 可直接编译），又可解析成构造依赖图。**

### 3.1 文档结构

```latex
\begin{tikzpicture}[scale=1]   % 全局选项 v1 仅支持 scale
  ...语句序列...
\end{tikzpicture}
```

### 3.2 命名点（依赖图节点）

```latex
\coordinate (A) at (1.5, 2);                    % 自由点：字面量坐标，可拖拽
\coordinate (M) at ($(A)!0.5!(B)$);             % 派生点：calc 表达式，不可拖、联动
\path[name path=c1] (C) circle (1.5);           % 命名路径（构造用，可不可见）
\path[name intersections={of=c1 and l1}]
      (intersection-1) coordinate (P);          % 交点：派生点
```

### 3.3 calc 表达式求值表（求值器必须全部实现）

| 表达式 | 语义 |
|---|---|
| `(x,y)` | 字面量（单位 cm，数值可为小数/负数） |
| `(A)` | 点引用 |
| `($(A)+(B)$)` / `($(A)-(B)$)` / `($(A)+(1,2)$)` | 向量加减，可任意嵌套 |
| `($(A)!t!(B)$)` | 线性插值，t∈ℝ（0.5 中点；<0、>1 外插） |
| `($(A)!t!θ:(B)$)` | 将向量 A→B 绕 A 旋转 θ° 后取 t 倍（`($(M)!1!90:(A)$)` = 垂线方向） |
| `($(A)!(P)!(B)$)` | P 到直线 AB 的投影（垂足） |
| `let \p1=(coord), \n1={veclen(\x1,\y1)}, ... in ...` | **受限 let/in**：`\p` 绑定点、`\n` 绑定数（veclen + 四则），用于角平分线/内心等无原生原语的构造 |

经典反射：`($(P)!2!(H)$)` = P 关于垂足 H 的镜像（翻折）。

### 3.4 图形元素（依赖图汇点）

| 元素 | 形式 |
|---|---|
| 折线/多边形 | `\draw[样式] (A) -- (B) -- (C) -- cycle;` |
| 圆（半径字面量） | `\draw[样式] (O) circle (1.5);` |
| 圆（过点） | `\draw[样式] (O) circle [through=(A)];`（through 库；外接圆/九点圆的关键原语） |
| 构造路径 | `\path[...]`（不可见，配 name path） |
| 填充 | `\fill` / `\filldraw`，路径形式同 \draw |
| 标注 | `\node[锚点] at (coord) {$A$};`（v1 仅 `at` 形式；锚点 above/below/left/right 及组合） |
| 角标记 | `\pic[样式] {angle = B--A--C};` 与 `\pic[样式] {right angle = B--A--C};`（angles+quotes 库；顶点居中字母） |

### 3.5 样式子集

- 颜色：~20 个标准色名（red/blue/green/black/gray/orange/purple/brown/cyan/magenta/lime/olive/pink/teal/violet/yellow/white + 灰度 `black!30` 形式）
- 线宽：`ultra thin` … `ultra thick`，或 `line width=<pt>`
- 线型：`dashed` / `densely dashed` / `dotted` / `dash dot`
- 箭头：`->` `<-` `<->`，`>=stealth`
- 填充/透明：`fill=<颜色>`、`fill opacity=<0..1>`、`opacity=<0..1>`

### 3.6 v1 明确排除（解析到即标记 preview-only，走 TikZJax 兜底）

`\foreach`、plot/函数图像、贝塞尔控制点、`arc (...)` 高级形式、3D（tikz-3dplot）、反演/圆锥曲线/轨迹宏、`\clip`、scope 变换嵌套、自定义 `\newcommand`（安全 + 可解析性双重原因）。

### 3.7 竞赛构造配方（进 LLM 提示词，§6 `tikz-recipes.ts`）

外心 = 两边中垂线求交；内心 = 受限 let 边长加权式；垂心 = 两高线求交；切点 = 以 OP 为直径作圆求交；九点圆 = 三边中点的外接圆（through）；西姆松线 = 三垂足共线作图…… 与 ggb 的 `geogebra-context-builder.ts`（按需注入命令签名）完全对称：按题目关键词注入相关配方。

---

## 4. 架构总览

### 4.1 与 ggb 页面逐槽位对应

| ggb 页面（现有） | TikZ 页面（新） |
|---|---|
| ` ```geogebra ` fenced block | ` ```tikz ` fenced block |
| `parseGgbBlock` + `preflightFix` + 依赖重排 | 服务端轻校验（安全剥离+子集探测）→ 客户端解析器 + `static-check`（未知引用/环/子集外特性） |
| GGB applet 执行 | **构造依赖引擎**：依赖图 + calc 求值器 + 交点算法 |
| `renderWithRepair` Tier 0–2 | §7 修复回路（同构） |
| `snapshotCanvasState` | `scene-snapshot.ts`（求值坐标+图结构摘要，≤48 对象截断） |
| ConstructionStep 步骤面板 | 步骤面板 = 依赖图拓扑序逐步点亮 |
| Magic! → TikZ 导出 | TikZ 即原生：复制代码 / TikZJax SVG / PNG |
| GGB applet 渲染 | 自研交互 SVG（主）+ TikZJax 精确预览（懒加载，辅） |

### 4.2 双解析器分工（有意取舍）

- **编辑器高亮**：vendor `@tikz-editor/lezer-tikz` 语法（MIT；容错优先，永不失败）。npm 不可得则自研 CodeMirror `StreamLanguage` 兜底，不阻塞主架构。
- **语义分析**：自研递归下降解析器（严格、AST 形状自控、带 source range）。子集小，双解析器漂移风险有界。

### 4.3 服务端/客户端职责

解析器必须住在客户端（编辑器实时重解析要用）→ 服务端只做：抽取 fenced block、安全剥离（拒绝 `\input \include \write18 \def \newcommand` 等）、子集外特性探测标记，然后 SSE 发出 `{tikzCode}`。客户端解析 → 依赖图 → 求值 → 场景。TikZJax 预览只渲染服务端剥离后的安全代码，固定注入 preamble。

---

## 5. 数据流（三条通路，单一真源 = TikZ 源码）

```
通路① LLM 生成：chat → /api/tikz (SSE) → ```tikz block
      → 服务端轻校验 → 客户端解析 → 依赖图 → 求值 → 场景 → 渲染
通路② 画布微调：拖拽自由点 / 样式面板
      → AST source-range 局部补丁（只改数字/选项，保留原格式）
      → 增量重解析 → 受影响子图拓扑重算 → <16ms 重渲染
通路③ 代码编辑：CodeMirror（lezer-tikz 高亮）→ 300ms debounce
      → 全量重解析 → 成功: 换场景 / 失败: 保留上次好场景 + 编辑器内 lint 标记
```

**不变量**：
- 画布永远显示最近一次成功求值的场景（best-attempt，同 ggb）。
- 自由点可拖；派生点不可拖（视觉区分：实心/空心，同 ggb 语义）。v1 不做沿路径滑动。
- 依赖图环检测：环 → 错误面板列出环上点名 → 可触发 repair。
- 单位制：TikZ 坐标 cm、y 向上；SVG y 向下 —— y 翻转与缩放只在 viewport 模块一处处理。

---

## 6. 组件与文件布局（200–400 行小文件原则）

```
app/
  tikz/page.tsx                       — /tikz 直达路由（server 包装 client）
  api/tikz/route.ts                   — SSE：mode 'build' | 'repair'（envelope 预留 contextRefs）
  api/tikz/models/route.ts            — 复用 provider-models 模式
  api/tikz/providers/route.ts
components/
  tikz-studio.tsx                     — 主组件，镜像 math-studio 三栏：chat | canvas | code
  tikz/
    tikz-canvas.tsx                   — 交互 SVG：分层渲染 + 工具分发 + 拖拽
    tikz-code-panel.tsx               — CodeMirror：高亮 + 编辑 + lint 标记
    tikz-toolbar.tsx                  — 步骤 / ✨精确预览 / 导出 / 纯净模式 / 工具按钮(v1暂住)
    tikz-preview-modal.tsx            — TikZJax 预览 + 导出 SVG/PNG
    tikz-steps-panel.tsx              — 拓扑序逐步点亮（复用接缝①语义 ref）
    use-tikz-engine.ts                — 引擎 React 绑定（code → scene 状态机）
lib/
  tikz/subset/    lexer.ts · parser.ts · ast.ts（含 source range）· static-check.ts
  tikz/semantics/ dependency-graph.ts · calc-eval.ts · intersections.ts · scene.ts
  tikz/render/    svg-renderer.tsx · viewport.ts · style-resolver.ts · hit-test.ts · tools.ts
  tikz/patch/     source-patch.ts · style-patch.ts
  tikz/prompt/    tikz-system-prompt.ts · tikz-recipes.ts · tikz-context-builder.ts
  tikz/repair/    tikz-repair.ts · scene-snapshot.ts
  tikz/tikzjax/   preview-loader.ts（懒加载 + 版本 pin）
  llm/sse-stream.ts                   — 从 api/math/route.ts 抽取（makeSseStream + streamProvider）
```

对现有文件的唯一改动：`api/math/route.ts` 改为从 `lib/llm/sse-stream.ts` import（targeted extraction，非顺手重构）；`app/page.tsx` 增加第二张 tile。

---

## 7. 错误处理与修复回路

| 层级 | 机制 |
|---|---|
| Tier 0（免费） | 解析失败 → 保持上次好场景 + CodeMirror lint 标记，不打断编辑 |
| Tier 1（本地确定性） | 未知点名 Levenshtein snap；补全 `\end{tikzpicture}`；全角符号/中文括号规范化 |
| Tier 1.5（语义 lint） | 退化交点（平行/相离）定位到行；NaN 传播溯源；环依赖列出环上点名 |
| Tier 2（LLM repair） | `mode:'repair'` 带 `scene-snapshot`（求值坐标+图摘要），≤2 轮；保留错误最少的 best-attempt |
| 子集外语法 | 不阻断：标记 preview-only → TikZJax 兜底渲染 + 提示哪些行不可交互 |
| TikZJax 失败 | wasm/编译失败 → 预览按钮降级 + toast，不影响主画布 |
| 中转站约束 | 请求体上限 ~32MB；快照 ≤48 对象截断策略天然兼容 |

---

## 8. 可扩展性设计（为后期功能预留的接缝）

**原则**：v1 不实现这些功能，但接缝 v1 就建好；后期加功能 = 在注册点登记，不动架构。

### 8.1 五个接缝

| 接缝 | 机制 | v1 状态 | 赋能的后期功能 |
|---|---|---|---|
| ① 语义身份 | 每个 SVG 元素打 `data-tikz-ref`（图节点 id + kind） | 已用于步骤面板点亮、样式面板点选 | 局部点击问 AI、高亮笔、放大镜焦点、悬停信息卡 |
| ② 工具分发画布 | pointer 事件路由 `activeTool`；`toolRegistry`（id/icon/cursor/handler/overlay 钩子） | 仅注册 select/drag | 放大镜、高亮笔、AI 提问模式、测量、平移缩放 |
| ③ 分层渲染管线 | base 几何层 / decoration 层（临时样式+高亮）/ overlay 层（工具、透镜）；style-resolver 合并源码+临时样式；`RenderTheme` 参数化 | decoration 层为空；单一默认主题常量 | 高亮渲染、多主题（教材风/暗色/手绘风）、AI 讲解动态高亮 |
| ④ 纯渲染器 + viewport | `render(scene, theme, viewport) → SVG` 纯函数可重入；scene↔screen 变换单点收口（含逆变换） | 仅主画布一个调用点 | 放大镜（二次渲染进裁剪圆）、步骤缩略图、导出复用 |
| ⑤ 引擎溯源 API | 求值对象带 provenance（定义 AST 节点、父依赖、配方）→ `describe(refs)` 产出结构化事实（"M 是 AB 中点"） | 已用于 repair 快照、步骤面板 | 点击问 AI（refs → 子图+事实打包进 prompt）、AI 讲解、证明辅助 |

### 8.2 协议与状态形状一次定型（前向兼容）

- `/api/tikz` envelope v1 即含 `mode`（`'build'|'repair'`）+ 预留可选 `contextRefs` 字段位（v1 不使用，类型上存在）；后期 `'ask'|'explain'` 不改协议形状。
- 画布状态机 v1 定型：`{ code, scene, selection: SemanticRef[], activeTool, ephemeralStyles, viewport }`；后三项 v1 为默认/空值，形状不重构。

### 8.3 明确非目标（只留缝，不实现）

悬浮工具面板 UI（v1 工具按钮暂住 toolbar）、放大镜、ask 模式、高亮笔、多主题 —— 全部 Phase 3+ 候选，不进任何 v1 验收标准。

---

## 9. 统一 LLM 中转（api.molamaker.cn）

- `lib/provider/settings.ts`：`LLM_RELAY_BASE_URL = env('LLM_RELAY_BASE_URL') ?? 'https://api.molamaker.cn'`；**所有 provider 默认 baseUrl 指向它**；per-provider `*_BASE_URL` env 为逃生舱。
- 密钥：`LLM_RELAY_API_KEY` 共享默认；`ANTHROPIC_API_KEY` 等具体 key 优先（具体 > 通用）。
- 协议：provider 条目新增 `protocol` 字段；走中转站时 anthropic/deepseek/dashscope **统一 OpenAI 兼容**（`/v1/chat/completions` + Bearer）；仅 baseUrl 指回 `api.anthropic.com` 时用原生 `/v1/messages`；`streamProvider` 按 protocol 分发。
- Coze：协议特殊（`/v3/chat` + bot_id），默认保持直连 api.coze.cn；中转站若支持，设 `COZE_BASE_URL` 即切换。
- 模型目录零改动：`/api/*/models` + model-probe 打 baseUrl 的 `/v1/models`，自动显示中转站模型。
- CSP 无改动（浏览器只访问自家 `/api/*`，中转调用在服务端）。
- 落地：Phase 0 前置独立 commit（ggb 页即时生效）。

---

## 10. CSP / CDN 改动（最小集）

| 指令 | 现状 | 新增 |
|---|---|---|
| `script-src` | 已含 `wasm-unsafe-eval` ✅ | `https://cdn.jsdelivr.net` |
| `connect-src` | — | `https://cdn.jsdelivr.net`（wasm/core.dump 拉取） |
| `font-src` | — | `https://cdn.jsdelivr.net`（TikZJax 字体 CSS） |

- audit 白名单已含 jsdelivr ✅ 无需改；CodeMirror 走 npm bundle（运行时 lib）✅。
- **Plan B**：若 jsdelivr 无完整可用 TikZJax dist → 预览改走服务端 `/api/tikz/preview`（`node-tikzjax` 为 npm 运行时包，服务端跑 wasm，不违反 CDN 规则）。两条路均合规。

---

## 11. 测试策略（vitest；lib/tikz ≥80%）

- **单元**：parser 正/反语料；calc-eval 数值断言（中点/垂足/60° 旋转/let+veclen）；intersections 含相切相离退化；拓扑+环；**source-patch 格式保留**（只改数字、空白注释不动）。
- **集成 = 竞赛语料回归**：30–50 fixture（`lib/tikz/__fixtures__/competition/*.tikz` + 期望关键点坐标，容差 1e-6）：外心/内心/垂心/九点圆/西姆松线/根轴/切线/位似/四点共圆/中垂线/角平分线…… `parse→eval→坐标断言`。**覆盖率 ≥90% 为 v1 验收门槛**（Phase 0 起步 20 个，Phase 1 补齐 ≥30）。
- **组件**：renderer 冒烟（jsdom）；drag 状态机模拟 pointer events → 断言生成的 patch 文本。
- **E2E**：项目暂无 Playwright —— v1 用手工验证清单；Playwright 记为后续项。
- 提交前：`npm run audit:cdn` + `npm run build` 通过。

---

## 12. 分期计划

| Phase | 内容 | 验收 |
|---|---|---|
| **前置** | relay 中转 commit（§9）+ `lib/llm/sse-stream.ts` 抽取 | ggb 页走中转站正常对话 |
| **0 骨架** | 路由+tile+三栏布局；子集 lexer/parser/static-check；calc-eval+intersections；依赖图；静态 SVG 渲染；LLM build 管线；编辑器只读展示；语料 20 fixture | 自然语言出题 → 图正确显示；fixture 全过 |
| **1 交互（v1 完成）** | 拖拽+局部补丁+拓扑重算；样式面板；repair 全回路；步骤面板；代码面板可编辑（通路③）；语料 ≥30 且 **覆盖率 ≥90%** | 全通路双向同步；audit:cdn + build 过 |
| **2 保真** | TikZJax 预览+导出 SVG/PNG；子集外兜底；配方库扩充 | 预览与画布一致；子集外代码可预览 |
| **3 增强** | 标注编辑、arc、沿路径滑动、分享；悬浮工具面板/放大镜/ask/高亮（接缝启用） | — |

**v1 = Phase 0 + Phase 1。**

---

## 13. 开放问题（实现时验证项，不阻塞）

1. TikZJax 在 jsdelivr 上的可用 dist（候选 `@rod2ik/tikzjax` / drgrice1 分支构建）——Phase 2 验证；不可行则落 Plan B（§10）。
2. `@tikz-editor/lezer-tikz` npm 发布状态（本环境 registry 不可达）——实现时先查；不可得则 vendor 生成产物或自研 StreamLanguage。
3. 中转站对 Anthropic 原生 `/v1/messages` 的支持与否 —— 默认走 OpenAI 兼容即可，无需确认。
4. Coze 是否纳入中转站 —— 默认保持直连，见 §9。
