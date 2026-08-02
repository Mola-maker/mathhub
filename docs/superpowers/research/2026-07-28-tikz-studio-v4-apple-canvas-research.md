# TikZ Studio v4 Apple Canvas 交互与竞赛几何调研

- 日期：2026-07-28
- 状态：Phase 0 调研完成，等待产品方确认后进入 Figma Foundations
- 面向用户：几何竞赛教师、教研员与高阶学习者
- 上位架构：[TikZ Studio v3 architecture design](../specs/2026-07-27-tikz-studio-v3-architecture-design.md)
- 本轮设计稿：[TikZ Studio v4 Apple Canvas design](../specs/2026-07-28-tikz-studio-v4-apple-canvas-design.md)
- Figma 文件：[Math GeoHub · TikZ Studio v4 Apple Canvas](https://www.figma.com/design/GHMWBcldK3Ck6BdeT8tmmp)

## 1. 调研问题

本轮不是为现有工具条增加更多按钮，而是回答五个架构问题：

1. 怎样让竞赛教师能快速使用反演、根轴、完全四边形等高级构造，同时不把界面变成工具墙；
2. 怎样实现 GeoGebra 式“选取输入—指针跟随预览—确认构造”，并保持低延迟；
3. 怎样让画板编辑、属性编辑、AI 生成与 TikZ 源码形成可见、可追踪的同一条事务链；
4. 怎样采用 Apple 官方画板产品的层次、材质与动效原则，而不是只复制半透明外观；
5. 怎样扩展交互层而不破坏 v3 已锁定的“TikZ 源码唯一真源、双渲染通道、ECS 隔离编译”。

## 2. 官方产品与设计系统结论

### 2.1 Apple：材质表达层级，不替代内容

Apple 的 [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
说明了材质用于建立界面层级。Liquid Glass 应集中在导航、控制和临时操作层，内容层保持清晰稳定。
因此本项目采用：

- 几何画布是内容层，不使用玻璃蒙层；
- 浮动工具条、轻量检查器、命令面板可使用克制的 thin/regular material；
- 玻璃材质不覆盖高密度源码、不承担主要正文背景；
- 阴影、模糊和高光服务于层级，不能作为装饰堆叠。

Apple 的 [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars?changes=la)
强调按任务分组、避免拥挤、让最重要的操作保持突出。因此高级几何命令不应全部常驻：

- 顶部只保留高频基础工具和类别入口；
- 变换、竞赛构造进入可搜索的命令面板；
- 最近使用与教师自定义工具可以被固定；
- 工具选择状态使用系统化 hover、selected、pressed 反馈。

### 2.2 Freeform：连接预览是交互反馈，不是动画表演

Apple Freeform 的 [添加图表](https://support.apple.com/guide/freeform/add-a-diagram-frfm1e6c3d3e/mac)
在拖动连接控制点时立即显示连线预览和可连接位置；其
[形状与线条编辑](https://support.apple.com/en-gb/guide/freeform/frfm8479c716/mac)
将填充、描边、文字、线端和连接形式集中在对象检查器中。

对 TikZ Studio 的启示：

- 构造工具在收集输入时必须显示当前输入槽和合法目标；
- 预览几何直接跟随 pointer，不使用滞后的弹簧补间；
- 磁吸光环、确认反馈和完成后的描边可以使用短弹簧或 stroke reveal；
- 属性面板按 Geometry / Style / Relations 分区，而不是把所有字段平铺；
- 临时连接点和命中区域可以比最终视觉图元更大，但不污染输出。

### 2.3 GeoGebra：工具是“有类型的输入—输出构造”

GeoGebra 官方 [Graphics Tools](https://geogebra.github.io/docs/manual/en/tools/Graphics_Tools/)
与 [Move Tool](https://geogebra.github.io/docs/manual/en/tools/Move/)
体现了稳定的工具交互模式：选择工具、按顺序提供对象、预览或完成构造、继续编辑对象。
四边形相关能力并不是一个无类型的 polygon：

- [Polygon](https://geogebra.github.io/docs/manual/en/tools/Polygon/)；
- [Rigid Polygon](https://geogebra.github.io/docs/manual/en/tools/Rigid_Polygon/)；
- [Vector Polygon](https://geogebra.github.io/docs/manual/en/tools/Vector_Polygon/)。

反演可参考 [Reflect about Circle](https://geogebra.github.io/docs/manual/en/tools/Reflect_about_Circle/)
和对应的 [Reflect command](https://geogebra.github.io/docs/manual/en/commands/Reflect/)。
GeoGebra 的 [Custom Tools](https://geogebra.github.io/docs/manual/en/tools/Custom_Tools/)
与 [Tool Creation Dialog](https://geogebra.github.io/docs/manual/en/Tool_Creation_Dialog/)
还证明了教师场景需要把一组已验证构造封装成可复用工具，而不是每次从零执行。

因此现有 `ToolDefinition` 的命令式 click handler 不足以承载 v4。工具必须声明：

- 输入槽类型与顺序；
- 输出对象类型；
- 可选输入与默认值；
- hover/指针预览；
- 求解约束和分支；
- 编译到 TikZ 的 canonical source；
- 适用条件、快捷键和帮助内容。

## 3. 动效技术选型

### 3.1 三层动效所有权

| 层 | 技术 | 用途 |
|---|---|---|
| 直接操纵 | Pointer Events + `requestAnimationFrame` | 连线 ghost、拖拽、套索、吸附候选；必须一帧内跟手 |
| 微交互 | CSS transitions/keyframes | hover、press、focus ring、按钮选中、淡入淡出 |
| 编排反馈 | Anime.js | 构造提交描边、对象出现、属性面板切换、源码 pulse、批量 AI 生成序列 |

项目已经依赖 Anime.js。其官方文档提供
[SVG](https://animejs.com/documentation/svg/)、
[engine](https://animejs.com/documentation/engine/) 与
[React 集成](https://animejs.com/documentation/getting-started/using-with-react/)。
它足以覆盖 v4 的 SVG path、timeline、spring 和 scoped cleanup。

本轮不同时引入 GSAP 与 Motion：

- GSAP 的 [MotionPathPlugin](https://gsap.com/docs/v3/Plugins/MotionPathPlugin/) 和
  [Flip](https://gsap.com/docs/v3/Plugins/Flip/) 更适合复杂路径编排与跨布局 FLIP；
- Motion 的 [React animation](https://motion.dev/docs/react-animation) 和
  [layout animations](https://motion.dev/docs/react-layout-animations)
  更适合组件级手势与自动布局；
- 当前需求没有必须由它们解决、而 Anime.js 无法解决的阻塞点；
- 三套运行时并存会增加 bundle、生命周期、reduced-motion 和动画所有权成本。

若后续出现“跨面板共享元素转场”或“复杂几何教学路径演示”这一类明确需求，再以基准测试和最小 PoC 决定是否增加单一新库。

### 3.2 动效不是求解器

动画状态不得成为几何状态。每次构造先通过文档事务提交，再由事务结果触发动画。
pointer preview 只读 interaction state，不能写入 TikZ source；pointer-up 才产生一次原子 source transaction。

### 3.3 Reduced Motion

Apple 的 [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
和 [Reduced motion evaluation criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)
要求减少会造成不适的位移、缩放、景深和弹跳。

`prefers-reduced-motion: reduce` 下：

- 指针预览仍直接跟手；
- 取消 path draw、跨区移动、blur interpolation 和 overshoot；
- 选中、提交、面板切换改用即时状态或短 opacity fade；
- 源码高亮保留颜色与边框，不依赖扫光或位移动画。

## 4. 源码联动调研

CodeMirror 官方 [Decorations example](https://codemirror.net/examples/decoration/)
建议用 `StateEffect` 与 `StateField` 管理可映射的标记；
[Document changes](https://codemirror.net/examples/change/)
说明所有程序性修改也应作为 transaction，并能通过 change mapping 跟踪位置。

现有 `StudioTransactionRecord` 已有 origin、patch、revision、committedAt，是正确基础；v4 只需扩展 UI envelope：

```ts
interface StudioUiTransaction {
  transactionId: string
  origin: TransactionOrigin
  beforeRevision: number
  afterRevision: number
  changedRangesAfter: readonly SourceRange[]
  affectedEntityIds: readonly string[]
  motionHint: 'insert' | 'update' | 'delete' | 'batch'
}
```

实现结论：

- Canvas / AI / Style / Repair 都走现有单一写入链；
- transaction 提交后计算 `changedRangesAfter`；
- CodeMirror 用 `StateEffect` 添加 decoration；
- decoration 通过后续 changes 自动映射；
- 约 1.2 秒后按 `transactionId` 清理，不能用旧 timeout 清掉新 pulse；
- 画布 hover 与源码 range hover 使用同一个 `SourceIndex` 双向联动；
- 高亮是 UI 投影，不写入 source、不进入 undo history。

## 5. 竞赛几何能力分层

### 5.1 Foundation：先补齐通用构造语法

- 交点；
- 平行线、垂线、中垂线、角平分线；
- 三点圆、外接圆、切线；
- 点/线反射；
- 旋转；
- 位似；
- 中点、垂足等已有工具统一迁移到声明式 schema。

这些工具构成后续高级构造的输入语言，必须先稳定。

### 5.2 Olympiad：高阶原语

- 反演：点关于圆反演、直线/圆的反演对象；
- 根轴与根心；
- 极线与极点；
- 调和共轭与交比；
- 等角共轭；
- 可查询的祖先、后代与约束关系。

### 5.3 Quadrilateral：四边形不是单个按钮

- 自由四边形；
- 圆内接四边形、外切四边形；
- 平行四边形、梯形、风筝、菱形、矩形、正方形；
- 刚性四边形；
- 完全四边形。

每个命令都要输出显式约束和可追踪对象，而不是只画出看似正确的四条线。

### 5.4 Competition recipes：教师可复用构造

- 九点圆系统；
- 欧拉线；
- Simson 线；
- Miquel 点；
- Apollonius 圆；
- 旁心与接触三角形。

Recipe 不是新的第二种文档格式。它展开为带稳定 ID 的 canonical TikZ primitives，
并保留一个可被语义层识别的注释指令块。

## 6. Breaking points

### BP-1：Construct once, edit everywhere

教师通过高级命令构造的结果，必须能在画板选中、在检查器编辑、在关系视图追踪，并在源码中看到对应的标准 TikZ。任何一个入口都不能生成不可编辑黑盒。

### BP-2：Proof-aware object graph

画板不仅显示对象，还能回答“这个点依赖谁”“移动它会改变什么”“这个结论来自哪些约束”。Relations 面板提供 ancestors / descendants / constraints，支持画板与源码联动高亮。

### BP-3：Olympiad command deck

用分组工具条、命令搜索、快捷键、最近使用和自定义教师工具承载高级能力；不把四十个按钮平铺在顶部。

### BP-4：Source choreography

画板、AI、样式、修复引起的每一次源码变化都有短暂、精准、可映射的语法高亮。对象 hover 与源码 range 双向联动，用户始终知道“改了什么”。

### BP-5：Dual truth without compromise

v4 只升级交互投影与 authoring grammar。v3 的源码唯一真源、revision-bound semantic projection、交互 SVG 与隔离精确编译双通道保持不变。

## 7. v4-1 建议范围

第一版不追求一次实现全部竞赛命令。建议交付：

1. 声明式工具 schema 与统一 interaction state machine；
2. GeoGebra 式输入槽、ghost preview、磁吸候选和取消/回退；
3. Foundation 全套；
4. 反演点、根轴、圆内接四边形、完全四边形；
5. Recipe/Custom Tool 的数据结构与一个可运行模板；
6. Geometry / Style / Relations 检查器；
7. CodeMirror transaction pulse 和画板/源码双向 hover；
8. Apple 风格 foundations、toolbar、command deck、selection 与 motion tokens；
9. reduced-motion 与键盘路径。

反演直线/圆、极点极线、调和共轭、等角共轭和完整竞赛 recipe 库进入后续增量。

## 8. Phase 0 Figma 发现

已创建空白设计文件，但尚未写入节点、变量或组件。

- 文件内当前只有空白 `Page 1`；
- 可用字体包含 SF Pro、SF Pro Rounded、Inter、Roboto Mono；
- 已连接 Apple macOS 26/27、iOS/iPadOS 26/27 官方设计资源；
- macOS 27 库可检索到 toolbar、button group、segmented control、materials、Liquid Glass 与 scroll edge effects；
- Material 3 仅作为组件行为参考，不采用其视觉语言；
- 代码仓库当前没有 Code Connect 映射，Phase 0 不建立伪映射。

建议：

- 复用 Apple macOS 27 的系统材质与工具条语义作为参考；
- 几何专用组件在当前文件本地构建；
- 先建 tokens/styles，再依次建原子组件、组合组件和完整画板；
- 未经产品方确认，不进入 Figma 写入阶段。

## 9. 风险与验证边界

| 风险 | 控制方式 |
|---|---|
| 高阶构造退化为不可编辑宏 | 指令块展开为 canonical primitives；所有输出有稳定 entity ID |
| 工具数增长造成认知负担 | 类别、搜索、最近使用、自定义固定；顶部只保留高频项 |
| pointer preview 延迟 | Pointer Events + rAF 直接更新，不经 React 文档状态或动画补间 |
| 手改源代码破坏高阶约束 | 识别指令块；发生不兼容改动时显式 detach/invalid，不静默重写 |
| 动画库冲突 | v4 只保留 CSS + Anime.js；动画由事务结果驱动 |
| 玻璃材质影响可读性 | 只用于控制层；画布与源码保持实底和足够对比度 |
| 竞赛构造分支不稳定 | solver branch token、退化检测、预览 invalid 状态和原子提交 |
| Figma 与代码漂移 | tokens 命名与 CSS scope 对齐；组件完成后再评估 Code Connect |

本调研只确定产品与技术方向，不代表浏览器、求解器、精确编译或竞赛数学正确性已验收。
