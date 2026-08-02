# TikZ Studio 架构调研补充（2026-07-27）

> 状态：历史调研，已由 [TikZ Studio v3 架构调研](./2026-07-27-tikz-studio-v3-architecture-research.md) 和 [v3 架构设计](../specs/2026-07-27-tikz-studio-v3-architecture-design.md) 取代。本文中的浏览器 TikZJax 路线不得继续作为生产实施依据。

## 调研范围

在继续实现前，围绕 Next.js 16 Route Handlers、CodeMirror/Lezer、浏览器
Worker、TikZJax/Node-TikZJax、SVG 导出与 React 19 交互性能进行了检索。
Tavily 的深度研究端点首次不可用；随后使用 Tavily Advanced Search、上游
项目仓库、官方文档和 npm 元数据交叉核对。

## 决策

| 主题 | v1 决策 | 原因 |
|---|---|---|
| 语义引擎 | 保持纯 TypeScript、客户端执行 | 已完成的 lexer/parser/evaluator 是可测试的纯边界，几十个对象应先用性能门验证 |
| Web Worker | 不前置重构；超过性能预算后迁移 `analyze/evaluateScene` | Lezer 树不适合直接跨线程序列化；过早引入会增加代码、选区和撤销栈同步复杂度 |
| 编辑器 | `@tikz-editor/lezer-tikz@0.5.1` 优先，`StreamLanguage` 兜底；语义仍由自研 AST 决定 | Lezer 提供增量高亮，但该 TikZ grammar 发布较新，不能成为语义真源 |
| LLM API | 保持 Node runtime Route Handler + Web Streams/SSE | Next.js Route Handlers 原生使用 Web Request/Response 并支持流式响应；现有 provider 依赖 Node 环境 |
| 主渲染 | 保持自研交互 SVG | 拖拽、命中测试、步骤高亮需要低延迟和稳定语义身份 |
| 精确预览 | 继续懒加载 TikZJax；固定版本、优先 npm/自托管；只接收净化后的子集代码 | TikZJax 在浏览器内以 WASM 将 TikZ 转为 SVG；不应把浮动 CDN 或任意 TeX 输入作为生产边界 |
| 替代预览 | `node-tikzjax` 仅作部署 Plan B | 2026-02 有维护更新，但服务端 WASM 会增加函数体积、冷启动、超时和并发成本 |
| 新 TikZJax fork | 暂不采用 `@rod2ik/tikzjax@1.5.0` | 有 Worker 池/缓存且更新活跃，但包约 7 MB、GPL-3.0；需独立许可证和部署评估 |
| SVG/PNG | 仅从内部 Scene 生成 SVG；导出前移除事件、脚本、外链和 `foreignObject` | 避免把 LLM 或精确预览返回的未审计 SVG 直接注入/下载 |
| React 高频交互 | pointer move 使用临时视图状态和 `requestAnimationFrame` 合帧，pointer up 才回写代码 | 避免每个指针事件都触发完整解析、React 提交和历史记录 |

## v1 性能与安全门

- 30 个对象的 `parse -> staticCheck -> evaluateScene` p95 小于 16 ms。
- 拖拽过程中每帧最多一次视图更新；源代码只在提交点补丁。
- 精确预览依赖固定版本，并有 30 秒超时、一次重试和明确降级。
- 服务端拒绝 `\input`、`\include`、`\write18`、`\def`、`\newcommand` 等危险命令。
- SVG 导出只序列化内部白名单元素和属性；PNG 从该 SVG 的 Blob 进行光栅化。

## 参考

- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Lezer system guide](https://lezer.codemirror.net/docs/guide/)
- [CodeMirror language reference](https://codemirror.net/docs/ref/#language)
- [Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- [TikZJax](https://tikzjax.com/)
- [Node-TikZJax](https://github.com/prinsss/node-tikzjax)
- [`rod2ik/tikzjax`](https://github.com/rod2ik/tikzjax)
- [DOMPurify threat model](https://github.com/cure53/DOMPurify)
