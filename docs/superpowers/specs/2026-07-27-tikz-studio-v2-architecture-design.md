# TikZ Studio v2 架构设计

- 日期：2026-07-27
- 状态：**已废止**
- 替代规格：
  [TikZ Studio v3 architecture design](./2026-07-27-tikz-studio-v3-architecture-design.md)

v2 曾提出 Scene 真源、内容 hash 身份、per-frame TeX oracle 和拖拽后冻结派生坐标。
调研确认这些决策与自由编辑 TikZ、稳定对象身份、60fps 交互和约束保持相冲突。

v3 已将方向修正为：

- TikZ source/CodeMirror transaction 唯一真源；
- Lezer CST + revision-bound semantic projection；
- UUID + range mapping 的稳定身份；
- Worker 后的通用 `SolverPort`，反求上游驱动变量；
- 交互 SVG 与独立 ECS Tectonic/dvisvgm 编译服务；
- Redis reliable queue + lease + attempt fencing；
- OSS 内容寻址产物与 CDN 隐私分层。

本文件只作为历史入口，不得作为实施依据。
