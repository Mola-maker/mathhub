# Math GeoHub Workspace Dashboard 信息架构调研

- 日期：2026-07-29
- 状态：已采用
- 调研渠道：Tavily、Exa、官方 OpenAI / GitHub 文档与 GitHub Changelog
- 适用范围：Math GeoHub 主页面与 TikZ Studio 的职责拆分

## 1. 结论

热力图、语法能力覆盖、活动记录、工作区健康和跨画板入口不属于直接操纵画布，
统一放到主页面。TikZ Studio 只保留完成构造所需的 AI 输入、工具、Canvas、
CodeMirror、对象检查器和 Exact Preview。

这不是把 Studio 的面板简单搬到首页，而是建立两个明确的产品层：

```text
Workspace Dashboard
  ├─ continue work
  ├─ source-bound health and activity
  ├─ capability coverage
  └─ open Studio at semantic object

TikZ Studio
  ├─ AI / command input
  ├─ direct manipulation
  ├─ source editing
  ├─ object inspector
  └─ exact rendering
```

## 2. 官方参考

### 2.1 GitHub Home Dashboard

GitHub 2025-10-28 的 Home Dashboard 更新把首页定义为“看到、理解并处理最重要工作”
的单一入口。默认首页使用短、可定制的 agent tasks、pull requests 和 issues 模块，
Feed 被移到独立页面。这个拆分说明首页应该是可行动的工作摘要，而不是把所有编辑器
细节塞入一个工作表面。

- [GitHub Home dashboard update](https://github.blog/changelog/2025-10-28-home-dashboard-update-in-public-preview/)
- [GitHub Personal dashboard reference](https://docs.github.com/en/account-and-profile/reference/personal-dashboard)

映射到 Math GeoHub：

| GitHub | Math GeoHub |
|---|---|
| prompt / agent task entry | 描述或继续 TikZ 构造 |
| recent pull requests / issues | 最近画板与当前 session |
| actionable status | source / semantic revision、issues、projection state |
| filterable modules | dependency / risk / activity heatmap |
| jump to work item | 用 refs + statement index 打开 Studio |

### 2.2 OpenAI Codex Projects / Cloud

Codex 以项目目录作为共享 workspace，并把 chats/tasks 作为可恢复的工作单元；Codex
cloud 将任务列表、状态和代码审查放在项目级入口，具体修改仍在任务或代码表面完成。

- [OpenAI Codex Projects and chats](https://developers.openai.com/codex/projects)
- [OpenAI Codex cloud](https://developers.openai.com/codex/cloud)

映射到 Math GeoHub：主页面展示 workspace 状态并负责恢复入口，Studio 是一次具体
几何构造的工作表面。

### 2.3 GitHub 开源需求作为补充信号

OpenAI Codex 仓库的 dashboard 需求强调跨项目摘要、最近工作、未完成事项和下一步。
它是社区 issue，不作为产品事实或架构真值，只用来验证“主页面应解决恢复上下文”
这一用户需求。

- [openai/codex issue #23561](https://github.com/openai/codex/issues/23561)

## 3. 架构决定

### 3.1 主页面不能成为第二真源

Dashboard 不接收 TikZ source 后再独立 `analyze()`。Studio 发布只读、
revision-bound 的 `TikzWorkspaceSnapshot`：

```ts
interface TikzWorkspaceSnapshot {
  revision: number
  semanticRevision: number | null
  projectionState: 'current' | 'stale' | 'unavailable'
  pointCount: number
  elementCount: number
  sourceIssueCount: number
  issueCount: number
  heatmap: SceneHeatmap
}
```

其中 `heatmap`、对象计数和 `issueCount` 必须来自同一个 `semanticRevision`。
当前源码失效时，主页面明确显示 `revision !== semanticRevision`，只读展示最近有效
语义投影，不能用当前未完成源码重新计算可点击对象。

### 3.2 Activity 必须是实体级信号

`lastEditOrigin` 只说明事务来自 AI、Canvas、Style 或 Repair，不能证明所有对象都活跃。
Activity 根据 Geometry invalidation 的 `changedEntityIds`、当前 selection 和 hover
计算；不再把一个全局 recent flag 归一化成所有单元 100%。

### 3.3 Dashboard 到 Studio 只传稳定定位

热力图点击通过：

```ts
{ selectionRefs, stmtIndex }
```

打开 Studio。它复用 Canvas 现有选择协议，不创建 Dashboard 专用对象 ID，也不直接
写 source。若投影为 stale，Studio 仍可展示该 revision 的只读对象，但所有写回继续
受 projection gate 阻止。

### 3.4 Dashboard 与 Studio 必须路由隔离

Dashboard 不挂载 `MathStudio`、`TikzStudio` 或任何画板引擎。入口只使用轻量路由卡：

- `/`：workspace dashboard；
- `/tikz`：TikZ 专注画板；
- `/math`：GeoGebra 专注画板。

`studio-events.ts` 只传递 revision-bound 的只读 telemetry。最近快照与最多五条会话
活动可写入 `sessionStorage`，用于跨路由返回首页后恢复摘要；它们不包含 TikZ source，
不会成为第二真源，也不能进入 Canvas 写回路径。未来接入账号、多文档或多人协作时，
应把相同 schema 放入 workspace service，并增加 documentId、epoch、授权和 durable
event log。

Dashboard 到 TikZ Studio 的定位使用 URL：

```text
/tikz?selection=A,B&stmtIndex=12
```

Studio 只把这些参数解释为初始 selection，不允许把 URL 当作 mutation 指令。

## 4. UI 决定

- 顶部：workspace command entry 和 relay 状态；
- 左侧：稳定导航与 Studios；
- 中央：短、可行动模块，优先“继续工作”和“场景健康”；
- 右侧：当前 workspace、官方能力覆盖、session activity；
- Studio 内不再显示 heatmap；
- Dashboard 的 Studio 卡片只做路由导航，不触发 provider/model API 或初始化 Canvas；
- 移动端主页面按模块纵向排列；Studio 保持所有 Canvas、AI、Source、Inspector 表面
  可滚动访问，不能隐藏 Inspector。

Figma 设计基线：

- [Math GeoHub v4 — Apple Geometry Canvas](https://www.figma.com/design/yBE4rCUrpAsQZYWseUlrvq)
- 页面 `01 · Product Shell`
- 画框 `Math GeoHub · Dashboard Shell`、`Math GeoHub · TikZ Studio Focus`

## 5. 部署边界

主页面与 Studio 都部署在 ECS Web 服务，静态 CSS/JS 通过 OSS/CDN 加速。Dashboard
快照属于用户态运行数据，不进入公共 CDN 缓存。Exact artifact 仍遵循 public/private
OSS namespace 和 immutable attestation 规则。

## 6. 验收

1. Dashboard 热力图与对象计数绑定同一个 `semanticRevision`；
2. 输入无效源码后，Dashboard 不生成另一个“看似可用”的当前 scene；
3. activity 只高亮 selection、hover 或最后事务实际影响的实体；
4. 热力图点击打开 Studio 并选择同一 refs / statement；
5. Studio 内没有 workspace heatmap 或能力分析重复面板；
6. 手机尺寸可访问 Canvas、AI、Source 和 Inspector；
7. Dashboard 不持久化、覆盖或重写 TikZ source；
8. 访问 `/` 时不挂载 `.tz-studio`、Canvas SVG，也不请求 provider/model 目录；
9. 直接访问 `/tikz`、`/math` 时只初始化对应一个 Studio。
