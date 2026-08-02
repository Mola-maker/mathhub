# TikZ Studio 旧双渲染方案

- 日期：2026-07-27
- 状态：**历史文档，已由
  [TikZ Studio v3 architecture design](./2026-07-27-tikz-studio-v3-architecture-design.md)
  取代**

旧方案正确识别了“交互 SVG + 精确 TikZ”需要分离，但把精确路径放在进程内
TeX/WASM 单实例队列，缺少 ECS 隔离、Redis 可靠任务、租约 fencing、OSS/CDN
隐私策略，也没有建立完整的 source-first transaction 内核。

不得按旧方案继续实现。保留本文件仅用于解释历史决策：

- 交互子集仍由自研语义层渲染；
- subset 外源码仍必须进入精确编译；
- 精确结果使用隔离 `<img>`，不把不可信 SVG 注入 DOM；
- 真正生产实现以 v3 独立 compiler API/Worker 为准。
