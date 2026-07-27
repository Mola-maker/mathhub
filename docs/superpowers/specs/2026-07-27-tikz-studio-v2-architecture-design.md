# TikZ Studio v2 架构设计

- 日期：2026-07-27
- 状态：**已批准**（设计评审通过，待实现）
- 项目：math_geohub（Next.js 16 App Router · React 19 · TS）
- 关系：承接 [`2026-07-26-tikz-studio-design.md`](./2026-07-26-tikz-studio-design.md)（v1 = 双渲染 + 静态依赖引擎）和 [`2026-07-27-tikz-dual-renderer.md`](./2026-07-27-tikz-dual-renderer.md)（WASM 保真通道），做**内核重建**。
- 一句话：把 TikZ Studio 的真源从"TikZ 源码字符串"提升到"immutable Scene 值类型"，引入三管线并发 + per-frame oracle + roundtrip 安全校验，使画板能在 60fps 下做出 GeoGebra 式的高自由度交互，同时对几何正确性做严格护栏。

---

## §0 为何做 v2

v1 在 Task 22 已完成（30 fixture / 140 测试绿 / 90.11% 覆盖率 / build clean），但用户场景未通：

| # | 症状 | 根因 |
|---|---|---|
| A | 自研 SVG 不总能正确描绘（与真实 TeX 渲染有偏差） | 渲染/求值正确性没有 oracle 持续护栏；只用 fixture 通过=绿作为正确判据 |
| B | 不是所有点/线都能拖 | 只有字面量 free 坐标点（`freePointRanges`）可拖；派生点/线/多边形未接入工具系统 |
| C | 拖点后右侧代码不实时变更 | `applyPatch = setCode`（v1 没有真正的 patch 通道）；CodeMirror 300ms 防抖与场景重建叠加 |

加上未来需求（多选/锁定/隐藏、拖约束、点击看身份、打破依赖），v1 的"TikZ 字符串即真源"模型无法承载这些交互。

---

## §1 范围

### v2-in（必交付）

- 真源反转：**Scene = immutable value-type**，TikZ 退为可双向同步的视图
- 三管线并发：Display（SVG+WASM oracle）/ Edit（CM 改）/ Drag（transient+patch）
- Per-frame oracle（WASM Worker）+ perceptual diff 落，正式 SVG 渲染与 TeX 之间有护栏
- Roundtrip 安全：`encode ∘ decode = id` 的 fixture 矩阵回归
- 50ms 防抖（编辑）/ RAF 节流（显示）/ immer-style produce（拖拽事务）
- 几何不变量回归：30+ fixture，坐标容差 1e-6
- GeoGebra 式交互：多选 / 锁定 / 隐藏 / 组 / 拖约束 / 点击看身份
- 打破依赖（v2 范围）：派生点改坐标（不重写表达式）

### v2-out（非目标，留缝不留实现）

- 重写 parser/lexer；subset 定义不变（v1 的 calc + intersections + through + angles + quotes 全保留）
- TikZJax 包升级、share/同步、注释、arc 高级形式、3D、`\foreach`/plot/函数图像、沿路径滑动、轨迹动画
- LLM 中转站改动（v1 §9 已交付，本设计不重做）

---

## §2 已锁定决策（决策登记）

| # | 决策 | 选项 | 理由 |
|---|---|---|---|
| **D1** | 真源归属 | **Scene（immutable value）** | 拖拽自由、约束/锁可表达；TikZ 仅作视图 |
| **D2** | 渲染策略 | **SVG = 交互/WASM = 真相 oracle**（per-frame） | 几何正确性靠 oracle 持续护栏 |
| **D3** | TikZ 语义约束 | **TikZ 必须保持 subset 内合法 + roundtrip 安全** | LLM/CM 入口与 Encoder 出口共用同一契约 |
| **D4** | 子集 | **沿用 v1 §3 子集**（calc/intersections/through/angles/quotes） | 不重写解析器；所有 fixture 直接平移 |
| **D5** | 编辑防抖 | **50ms**（v1 的 300ms 提速 6×） | 用户感知"改一句图就变" |
| **D6** | 拖拽事务 | **transient Scene（immer-style produce）** | 释放时由 encoder 走 patch；Esc 回滚不留痕迹 |
| **D7** | 锁定/隐藏/组 | **Scene.sidecar 一等公民**；WASM 端通过 `\setvisibility` 注释旁路 | 与 Scene 同步，跨管线一致 |
| **D8** | Oracle 频率 | **每帧（key=Scene.hash，200ms 合并 / Worker 单例）** | 立即发现自研渲染偏差 |
| **D9** | 失败语义 | 解析失败 / Encoder 拒绝 / Roundtrip 不等 / Oracle 分歧 / Worker 超时 五类分级 | 详见 §5.4 |
| **D10** | 评测判据 | **fixture 坐标容差 1e-6**；不依赖像素哈希 | 像素哈希在跨渲染管线数学上不可达 |
| **D11** | 迁移策略 | **Strangler Fig**，`lib/tikz2/` 与 `lib/tikz/` 并存，旧代码 cutover 后归档（不删） | 渐进切换，降低风险 |
| **D12** | 覆盖门槛 | `lib/tikz2` ≥ 80%（同 v1 §11） | 沿用项目测试规则 |

---

## §3 Scene 数据模型（对应段 A）

不可变值类型树。`applyEvent` 是唯一入口；事件进 `SceneLog`（时间序），用于撤销/重做/调试/replay。

```ts
type Scene = {
  picture:    { scale: number; viewport: Viewport }
  points:     Map<PointId, Point>
  namedPaths: Map<NameId, NamedPath>     // 命名圆/直线/路径（构造用）
  elements:   Map<ElementId, DrawElement> // draw/fill/pic/node
  issues:     Issue[]
  sidecar:    Sidecar                    // 不进源码语义
  version:    number                     // 每次 applyEvent +1
  hash:       string                     // sha256 of canonical JSON
}

type Point = {
  id:           PointId
  name:         string | null
  role:         'free' | 'derived' | 'expr-locked'  // 'expr-locked' 见 §6/C2
  def:          Expr                      // 字面量或 calc 表达式
  coords:       Vec2                      // 当前求值坐标
  provenance:   { stmtIndex: number; deps: PointId[] }
  stableId:     string                    // 重解析后稳定
}

type Sidecar = {
  selection: Set<StableId>                // 多选
  locks:     Map<StableId, LockReason>    // 'user' | 'topological' | 'frozen'
  hides:     Set<StableId>                // hide
  groups:    Map<GroupId, Set<StableId>>  // 拖一组
  tool:      ToolId
  ephemeral: EphemeralStyle               // 临时样式（拖拽态）
}
```

不可变性约束（项目规则 §coding-style.md 强制）：`Scene.update(event)` 返回新 Scene；旧 Scene 保留作撤销。

`expr-locked` 角色：派生点被用户改坐标后角色升级；不再走依赖链重算（打破依赖 — v2 仅坐标级，表达式级留 v3）。

---

## §4 三管线 + Scene 真源（对应段 B）

三条管线共享 Scene，但触发条件、约束、产物不同：

### §4.1 Display 管线（显示真源 / 真理护栏）

```
Scene.update() / hash 变
  ├─► SVG 重新渲染（RAF 节流，≤16ms / 200 节点目标）
  └─► WASM Worker 入队（key=Scene.hash，200ms 合并）
        ├─ output: PNG（offscreen canvas + pixelmatch 库）
        └─ 与 SVG 端同位置元素的栅格做 perceptual diff
              ├─ diff < 0.5%：忽略
              └─ diff ≥ 0.5%：reconcile 接管 → display 切 WASM 输出 + toast
```

### §4.2 Edit 管线（CM → Scene）

```
CodeMirror docChanged
  → 50ms 防抖
  → diff CM：找出 changed statements（按 statement 级范围比对）
  → 只重解析 affected statements + 与它们依赖的语句
  → Scene.applyEvent('edit', delta) [保留未改节点的 stableId]
  → Display 管线触发
```

CM 改出子集外：保留当前 Scene 显示（best-attempt），CM 内 lint 标记 + 提示"此行不可交互，预览看 WASM"。

### §4.3 Drag 管线（pointer → patch → code）

```
pointer down
  → tool.onPointerDown
  → 进入 transient mode：所有变动在 transientScene 上
  → transientScene = produce(scene, draft => applyTool(...))
pointer move (RAF 节流)
  → SVG 显示 transientScene
  → WASM oracle 跑 transientScene.hash（每帧，per D8）
pointer up
  → encoder.run(scene, transientScene) → AST delta
     ├─ 成功：CM dispatch patch → 触发 Edit 管线，Scene 重建
     └─ 失败：toast 提示，丢弃 transientScene，恢复 scene
escape
  → 丢弃 transientScene，无副作用
```

### §4.4 模块布局

```
lib/tikz2/
  scene/
    scene.ts          Scene 类型 + applyEvent + SceneLog
    produce.ts        immer-style Scene 拷贝（draft）帮手
    stableId.ts       stableId 生成（基于 statement 内容 hash）
    hash.ts           canonical JSON → sha256
    expr.ts           calc 表达式 AST + 评估器
    eval.ts           Scene 求值入口：拓扑传播 + 交点
    intersections.ts  圆-圆 / 圆-线 / 线-线 求交
  pipeline/
    display.ts        Scene → SVG（RAF）+ WASM 调度
    edit.ts           CM diff → AST delta → applyEvent
    drag.ts           pointer → transient → encoder dispatch
  render/
    svg.tsx           纯函数 (Scene, viewport, theme) → JSX
    hit-test.ts       element ↔ StableId
    tools.ts          工具注册：select / marquee / drag / lock / hide / group / constraint
    overlay.tsx       选区手柄 / 约束线 / 锁徽
  patch/
    gpu.ts            statement ↔ stableId ↔ source-range 索引
    encoder.ts        Scene delta → TikZ patch（subset-合法 + 格式保留）
    decoder.ts        CM edit → AST delta
  oracle/
    worker.ts         WASM 单例 Worker（沿用 v1 dual-renderer 封装）
    perceptual.ts     pixelmatch 包装
    reconcile.ts      分歧时接管策略
  code/
    codemirror-bridge.tsx   CM ↔ AST ↔ patch
    selection.ts            多选 / 组 / 锁 / 隐藏 持久态
  subset/                 ← 从 v1 复用，不重写
```

---

## §5 确定正确性策略（对应段 C）

### §5.1 三层防线

1. **几何坐标验证**（fixture 回归）：30+ 竞赛 fixture + 期望 `PointMap<id, Vec2>`（容差 1e-6）；测试 `parse → eval → scene-equality`。
2. **Roundtrip 测试**（TikZ ↔ Scene）：`Scene₀ → encoder → TikZ → parser → Scene₁`，断言 `scene-equality(Scene₀, Scene₁)`。所有 60 fixture 必过。
3. **Per-frame oracle**（运行时）：每帧用 WASM Worker 比较；分歧时 reconcile 落。

### §5.2 Roundtrip 不变量（必须保证）

- Encoder 输出必须**仅用 subset 内语法**（不输出 `\draw (O) circle [through=(A)]` 这种 v1 spec 笔误）
- Encoder 输出**保留用户原格式**：注释、空格、styling 不动；只改必要 statement 的数值
- 重解析回 Scene 后**几何上等价**（点坐标容差 1e-6，路径参数相同）
- 用户在 CM 中改超出 subset：lint 提示，Scene 不动；Oracle 切回保真层

### §5.3 Patch 测试

拖动场景脚本化：
- 选 free point A
- 模拟 pointer down @ 坐标 C₁；pointer move @ C₂；pointer up
- 断言：encoder 产生 patch；CM 接受后 Scene 与人工写入的"坐标 C₂ 的 A"几何等价

### §5.4 错误分级

| 错误 | 检测点 | 处理 | UI 反馈 |
|---|---|---|---|
| 解析失败（CM 改出子集外） | Edit 管线 | Scene 保留；标记语句为 preview-only | CM lint + toast "预览看 WASM" |
| Encoder 拒绝（拖拽结果超出子集） | Drag 管线 release | 丢弃 transientScene，回滚 | toast "无法编码，请缩小拖动范围" |
| Roundtrip 不等 | 测试侧 | CI 红；fix encoder | —— |
| Oracle 分歧 ≥ 0.5% | Display 管线 reconcile | display 切 WASM 输出 | 显示"WASM 真值"徽标 |
| Worker 超时 > 2s | Display 管线 | 保留上次 WASM 图 | 调试日志 |

### §5.5 性能预算

| 场景 | 目标 | 测量手段 |
|---|---|---|
| 拖一个 free 点（200 节点场景） | ≤ 16ms / 帧 | PerformanceObserver + chrome-devtools trace |
| Edit 解析 | ≤ 50ms / 句 | 自测 timer |
| WASM oracle | ≤ 200ms 内合并 / ≤ 2s 完成 | Worker 心跳日志 |
| Display SVG | ≤ 16ms / 200 节点；≤ 33ms / 800 节点 | 入帧前 timer |

---

## §6 迁移路径（对应段 D）

**Strangler Fig**：`lib/tikz2/` 与 `lib/tikz/` 并存；分阶段切换；cutover 后 `lib/tikz/` 归档到 `.archive/`，不删。

| 阶段 | 内容 | 验收门槛 |
|---|---|---|
| **A0 基础设施** | 建 `lib/tikz2/scene/{scene,produce,stableId,hash,expr,eval,intersections}`；30 fixture 平移到 `__fixtures_v2__`；eval 与 v1 坐标一致 | 30 fixture 全坐标与 v1 相等（1e-6） |
| **A1 三管线骨架** | Display + Edit 管线接好；WASM 沿用 v1 dual-renderer 路径；SVG 用 v1 的 `TikzSceneSvg` 过渡 | CM 改一句 → Scene 一致；解析错保留 Scene |
| **B1 真源反转** | 加 `encoder.ts` + roundtrip 测试；v1 组件改为 Scene-as-input | 30 fixture roundtrip 全过；`encode ∘ decode = id` 测试矩阵 60 全过 |
| **B2 Drag 管线** | transient Scene + produce；release patch 完整回路；50ms 防抖 | 拖点 → release → CM 同步；ping-pong |
| **B3 多选 / 锁 / 隐藏 / 组** | Sidecar 实施；工具注册 select / marquee / lock / hide / group；hit-test 升级 | 多选拖；锁不动；隐藏同步 WASM |
| **B4 拖约束 + 身份** | circle/line/point 投影；click-identity | 选中 M 见"M 是 AB 中点"；拖 A 时 M 跟随 |
| **C1 Per-frame oracle** | Worker 真源 + perceptual diff + reconcile 落 | 故意注入偏移 → 切 WASM 真值 |
| **C2 expr-locked** | 派生点改坐标升级角色；不再走依赖链 | 选派生点改坐标；求值不重算依赖 |
| **D0 切换 + 清理** | `/tikz` 路由接 lib/tikz2；`lib/tikz/` → `.archive/` | 60 fixture 全过；ggb 页不动 |

---

## §7 测试策略

### §7.1 单元（vitest）
- `scene/produce.ts`：applyEvent、produce 的不可变性、stableId 保留
- `eval.ts`：calc 子集全表（v1 已有，v2 加 roundtrip 校验）
- `intersections.ts`：圆-圆 / 圆-线 / 线-线，相切相离
- `encoder.ts`：所有 fixture 必须 encode 一致
- `patch/gpu.ts`：source-range 写回格式保留
- `render/svg.tsx`：纯函数冒烟（jsdom）

### §7.2 集成（fixture 回归）
- 60+ fixture（30 v1 + 30 增）`parse → eval → scene-equality`
- roundtrip 矩阵：`Scene → encoder → TikZ → parser → Scene ≡ Scene`

### §7.3 组件
- Display 管线：RAF 节流正确（不重入）
- Drag 管线：pointer 事件序列 → transient 收尾 → patch 异步
- CM bridge：双向同步无回环

### §7.4 E2E
- 项目暂无 Playwright，v2 维持手工验证清单；Playwright 记后续项
- 6 个手测脚本：drag-patch-sync / 多选拖 / 锁元素 / 隐藏 / 周游约束 / 切换 oracle

### §7.5 验收门槛
- `npm test` 全绿
- `lib/tikz2` 覆盖率 ≥ 80%（v1 同等门槛）
- `npm run lint` 全绿
- `npm run audit:cdn` 全绿（无 public/）
- `npm run build` 全绿

---

## §8 显式非目标（v3+ 候选，**只留缝，不实现**）

- 重写解析器 / 词法
- TikZJax 包升级、share / 同步 / 注释
- arc / midpoints on segments 任意切分
- 沿路径滑动
- 轨迹动画（点扫描 sweep）
- 多主题（教材风/暗色/手绘风）
- 悬浮工具栏 UI、AI 提问模式、高亮笔
- Coze 中转站集成（v1 §9 默认保持直连）
- 撤销/重做的可视化时间轴面板（v2 仅实现 SceneLog，不做 UI）

---

## §9 待实现时验证项（不阻塞 spec）

1. pixelmatch 在 offscreen canvas + Worker 链路下延迟（perceptual diff 阈值 0.5% 是否合理）
2. immer-style produce 在 Map<string, T> 上的开销（必要时退回到 manual freeze + spread）
3. WASM Worker 在每帧 key=Scene.hash 下的命中率（多数连续拖动会复用 hash 吗？）
4. CM diff 在 50ms 内是否能完成（要测一次 statement 重解析时间）
