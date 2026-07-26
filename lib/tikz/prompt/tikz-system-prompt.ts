import { buildTikzContextForProblem } from './tikz-context-builder';

export const TIKZ_SUBSET_RULES = `# TikZ 构造子集规则（必须严格遵守）
你输出的 TikZ 将被一个自研解析器实时解析为可交互构造图（不是交给 LaTeX 编译），因此只能使用以下子集：

## 结构
- 只输出一个 \`\`\`tikz 代码块，内含且仅含 \\begin{tikzpicture} ... \\end{tikzpicture}；块外可用一两句中文说明。
- 禁止使用：\\foreach、plot、\\clip、\\begin{scope}、arc(...)、\\newcommand/\\def、\\input/\\include、\\usepackage、\\documentclass、贝塞尔 .. controls ..、单位（坐标一律纯数字，单位视为 cm）。

## 命名点（三种）
1. 自由点：\\coordinate (A) at (1.5, 2); —— 纯数字字面量。
2. 派生点（calc 表达式，坐标随依赖自动联动）：
   - 插值 ($(A)!0.5!(B)$)：0.5 为中点；一般形式 ($(A)!t!(B)$) 可定比或外插
   - 旋转 ($(A)!t!角度:(B)$)：如 ($(A)!1!60:(B)$) 等边第三顶点、($(M)!1!90:(A)$) 垂线方向
   - 投影 ($(A)!(P)!(B)$)：P 到直线 AB 的垂足
   - 加减嵌套：($(A)+(B)-(C)$) 等
3. 交点：先 \\path[name path=c1] ... 命名路径，再 \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P); 绑定。
4. 受限 let：\\path let \\p1=(coord), \\n1={veclen(\\x1,\\y1)} in coordinate (N) at (coord); —— 仅 \\p/\\n/\\x/\\y 与 veclen+四则。

## 图形元素
- \\draw[样式] (A) -- (B) -- (C) -- cycle;（折线/多边形）
- \\draw[样式] (O) circle (r); 或 (O) circle [through=(A)];（过点圆，外接圆用此）
- \\path / \\fill / \\filldraw 同 \\draw 形式
- \\node[方位] at (P) {$A$};（方位 above/below/left/right 及组合；数学内容包在 $...$）
- \\pic[样式] {angle = B--A--C}; 与 \\pic[样式] {right angle = B--A--C};（顶点在中间字母）

## 样式子集
颜色名（red/blue/...）、thick/thin/line width=<n>pt、dashed/dotted/dash dot、->/<->/>=stealth、fill=颜色、fill opacity、opacity。

## 作图约定
- 点命名用有意义的单字母/双字母（A B C O H M I G P Q T …），与题面一致。
- 构造用辅助线（中垂线、直径圆等）用 \\path[name path=...] 不可见命名，或用 [dashed] 淡显。
- 求交用的路径要画足够长（用 !-1! / !2! 外插延长），否则交点可能不在路径段上。
- 坐标范围控制在 ±8 cm 内，图形居中在原点附近。
- 关键构造点尽量用派生表达式（而非手算坐标写死），这样用户拖动自由点时整图联动。`;

export function buildTikzSystemPrompt(
  problem: string,
  opts: { previousCode?: string },
): string {
  const recipes = buildTikzContextForProblem(problem);
  const parts = [
    '你是一位竞赛平面几何作图专家，用 TikZ 构造子集把题目画成可交互的图。',
    TIKZ_SUBSET_RULES,
  ];
  if (recipes) parts.push(`# 与本题相关的构造配方\n${recipes}`);
  if (opts.previousCode) {
    parts.push(`# 当前画布代码（在其基础上修改，保留仍正确的部分）\n${opts.previousCode}`);
  }
  parts.push(`# 题目\n${problem}`);
  return parts.join('\n\n');
}

export function buildTikzRepairPrompt(
  code: string,
  failures: string[],
  sceneSnapshot: string,
): string {
  return [
    '你是 TikZ 构造子集修复器。下面的代码在我们的子集引擎中报错，请输出修复后的完整代码。',
    TIKZ_SUBSET_RULES,
    `# 当前代码\n${code}`,
    `# 错误列表\n${failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n')}`,
    sceneSnapshot ? `# 引擎求值快照（部分对象可能缺失）\n${sceneSnapshot}` : '',
    '要求：只输出一个 ```tikz 代码块（完整可解析），不要做文字解释。保持原构造意图，最小改动修复错误。',
  ].filter(Boolean).join('\n\n');
}
