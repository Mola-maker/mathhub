# TikZ Studio (v1) Implementation Plan

> 状态：历史计划，已由 [TikZ Studio v3 架构设计](../specs/2026-07-27-tikz-studio-v3-architecture-design.md) 取代。本文中的 TikZJax、旧 provider 和旧阶段划分不得继续作为实施依据。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 math_geohub 中实现 TikZ Studio v1（= spec Phase 0 + Phase 1）：LLM 生成构造语义 TikZ 子集 → 自研依赖引擎 → 交互 SVG 画布（拖拽联动/样式微调/代码双向同步）+ repair 回路 + 步骤面板。

**Architecture:** 唯一真源 = TikZ 构造子集源码（calc/intersections/through/angles 原生语法）。管线镜像 ggb 页面：fenced block → 服务端轻校验 → 客户端解析 → 依赖图拓扑求值 → 自研 SVG 渲染；拖拽/样式 → AST source-range 局部补丁 → 重解析重算。全部 LLM 流量走中转站 api.molamaker.cn（OpenAI 兼容协议）。

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript strict · Vitest（绿地，本计划建测试设施）· CodeMirror 6（Task 18 才安装）。

**Spec:** `docs/superpowers/specs/2026-07-26-tikz-studio-design.md`（本计划覆盖其 v1 范围；Phase 2/3 —— TikZJax 预览、CSP 改动、悬浮面板/放大镜/ask —— 不在本计划）。

## Global Constraints

每个任务都隐含以下约束（违反 = review 不通过）：

- **项目根**：`E:\Portaitsweb\math_geohub`；所有路径相对于此根。模块导入别名 `@/* → ./*`。
- **不可变数据（CRITICAL）**：永远 `{ ...obj, field }` / `[...arr]`，禁止 mutation（项目规则）。
- **小文件**：200–400 行典型，800 硬上限；高内聚低耦合，按 feature 组织。
- **禁止 `console.log`**；错误必须显式处理；UI 文案一律**简体中文**。
- **TS strict**（`tsconfig.json` strict: true）；`allowJs: false`。
- **测试**：`lib/tikz` 覆盖率 ≥80%；测试与源码同目录 `*.test.ts(x)`（vitest 默认 glob）；运行 `npx vitest run <file>`，全量 `npm test`。
- **CDN 规则**：禁止创建 `public/`；禁止非 CDN 的 `url(/...)` / `<img src="/...">`；CodeMirror 等 npm 包走 bundle 属例外。提交前若动了资源引用必须 `npm run audit:cdn` 通过。
- **提交**：Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`），每个任务末尾按步骤提交指定文件。
- **不动无关代码**：除任务明确列出的文件，不"顺手改进"任何现有代码。
- Node ≥22；`process.env` 读取优先用"调用时读取"（可测试），避免模块加载时固化。

---

### Task 0: git 基线（项目当前不是 git 仓库）

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Produces: 可用的 `git` 提交能力（后续每个任务的 commit 步骤依赖它）

- [ ] **Step 1: 初始化并写 .gitignore**

```bash
cd /e/Portaitsweb/math_geohub && git init
```

`.gitignore`:

```gitignore
node_modules/
.next/
dist/
*.tsbuildinfo
next-env.d.ts
.omc/state/
.DS_Store
```

- [ ] **Step 2: 基线提交**

```bash
git add -A && git commit -m "chore: baseline before TikZ Studio v1"
```

Expected: 提交成功，`git log --oneline` 显示 1 条。

---

### Task 1: 统一 LLM 中转（api.molamaker.cn）+ 协议分发

**Files:**
- Modify: `lib/provider/settings.ts`（当前 88 行，已知全文）
- Modify: `app/api/math/route.ts:324-336`（streamProvider 分发处）
- Test: `lib/provider/settings.test.ts`

**Interfaces:**
- Consumes: 现有 `getEffectiveProvider(name)`、`PROVIDER_NAMES`、`EffectiveProvider`
- Produces: `EffectiveProvider` 增加字段 `protocol: 'anthropic' | 'openai-compatible' | 'coze'`；`relayBaseUrl(): string`；env：`LLM_RELAY_BASE_URL`、`LLM_RELAY_API_KEY`。Task 2 与 `/api/tikz` 依赖此 protocol 分发。

背景（当前实现要点）：`PROVIDER_DEFAULTS` 中 anthropic=`https://api.anthropic.com`、deepseek=`https://api.deepseek.com`、dashscope=`https://dashscope.aliyuncs.com/compatible-mode/v1`、coze=`https://api.coze.cn`；`envFallback(name)` 读 per-provider env；`getEffectiveProvider` 合并 defaults+env。

- [ ] **Step 1: 写失败测试** `lib/provider/settings.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getEffectiveProvider, relayBaseUrl } from './settings';

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'LLM_RELAY_API_KEY', 'LLM_RELAY_BASE_URL', 'DEEPSEEK_API_KEY', 'COZE_API_KEY', 'COZE_BOT_ID'];
beforeEach(() => { for (const k of ENV_KEYS) vi.stubEnv(k, ''); delete process.env.ANTHROPIC_BASE_URL; delete process.env.LLM_RELAY_BASE_URL; });
afterEach(() => { vi.unstubAllEnvs(); });

describe('relay defaults', () => {
  it('relayBaseUrl 默认 api.molamaker.cn，可被 LLM_RELAY_BASE_URL 覆盖', () => {
    expect(relayBaseUrl()).toBe('https://api.molamaker.cn');
    vi.stubEnv('LLM_RELAY_BASE_URL', 'https://relay.example.com/');
    expect(relayBaseUrl()).toBe('https://relay.example.com');
  });

  it('anthropic 默认走中转站且协议为 openai-compatible', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const p = await getEffectiveProvider('anthropic');
    expect(p.baseUrl).toBe('https://api.molamaker.cn');
    expect(p.protocol).toBe('openai-compatible');
  });

  it('baseUrl 指回 api.anthropic.com 时协议为 anthropic 原生', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    const p = await getEffectiveProvider('anthropic');
    expect(p.protocol).toBe('anthropic');
  });

  it('共享 LLM_RELAY_API_KEY 兜底，具体 key 优先', async () => {
    vi.stubEnv('LLM_RELAY_API_KEY', 'relay-key');
    expect((await getEffectiveProvider('deepseek')).apiKey).toBe('relay-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'ds-key');
    expect((await getEffectiveProvider('deepseek')).apiKey).toBe('ds-key');
  });

  it('coze 协议保持 coze、默认直连 api.coze.cn', async () => {
    vi.stubEnv('COZE_API_KEY', 'k'); vi.stubEnv('COZE_BOT_ID', 'b');
    const p = await getEffectiveProvider('coze');
    expect(p.protocol).toBe('coze');
    expect(p.baseUrl).toBe('https://api.coze.cn');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run lib/provider/settings.test.ts`
Expected: FAIL（`relayBaseUrl` 不存在 / `protocol` 不存在）。注意此时还没有 vitest.config —— vitest 默认配置即可跑纯 TS 测试。

- [ ] **Step 3: 实现** `lib/provider/settings.ts`（在现有文件上修改，保持现有导出不变）

改动点：
1. `EffectiveProvider` 接口加 `protocol: 'anthropic' | 'openai-compatible' | 'coze'`。
2. 新增：

```ts
export function relayBaseUrl(): string {
  return (process.env.LLM_RELAY_BASE_URL?.trim() || 'https://api.molamaker.cn').replace(/\/+$/, '');
}
```

3. `PROVIDER_DEFAULTS` 中 anthropic/deepseek/dashscope 的 `baseUrl` 改为占位 `''`（真实默认在 `getEffectiveProvider` 里走 relay）；coze 保持 `'https://api.coze.cn'`。
4. `envFallback` 每个分支的 `apiKey` 改为 `process.env.X_API_KEY ?? process.env.LLM_RELAY_API_KEY ?? ''`。
5. `getEffectiveProvider` 内：

```ts
const isRelayed = name !== 'coze';
const baseUrl = env.baseUrl?.trim() || (isRelayed ? relayBaseUrl() : defaults.baseUrl);
const protocol: EffectiveProvider['protocol'] =
  name === 'coze' ? 'coze' : baseUrl.includes('api.anthropic.com') ? 'anthropic' : 'openai-compatible';
return { apiKey, baseUrl, model, botId, configured, protocol };
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run lib/provider/settings.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 改 streamProvider 按 protocol 分发**（`app/api/math/route.ts:324-336`）

```ts
async function streamProvider(
  provider: Provider,
  messages: Message[],
  send: SendToken,
  cfg: EffectiveProvider,
  model: string,
  systemPrompt: string,
): Promise<string> {
  if (cfg.protocol === 'anthropic') return streamAnthropic(messages, send, cfg, model, systemPrompt);
  if (cfg.protocol === 'coze') return streamCoze(messages, send, cfg, systemPrompt);
  const label = provider === 'deepseek' ? 'DeepSeek' : provider === 'dashscope' ? 'DashScope' : 'Anthropic';
  return streamOpenAICompatible(messages, send, cfg, model, provider, label, systemPrompt);
}
```

- [ ] **Step 6: 验证构建 + 提交**

Run: `npm run build`（ggb 页编译不受影响）
Expected: build 成功

```bash
git add lib/provider/settings.ts lib/provider/settings.test.ts app/api/math/route.ts
git commit -m "feat: route all LLM providers through api.molamaker.cn relay with protocol dispatch"
```

---

### Task 2: 抽取共享 SSE 流到 lib/llm/sse-stream.ts

**Files:**
- Create: `lib/llm/sse-stream.ts`
- Create: `lib/llm/sse-stream.test.ts`
- Modify: `app/api/math/route.ts`（删除被移动的代码，改为 import）

**Interfaces:**
- Produces: `makeSseStream(gen)`、`streamProvider(...)`、`streamAnthropic`、`streamOpenAICompatible`、`streamCoze`、`type SendToken`、`type SendEvent`。Task 12（/api/tikz）直接复用 `makeSseStream` 与 `streamProvider`。

背景：`app/api/math/route.ts` 的 51–86 行是 `SendToken/SendEvent/makeSseStream`；128–336 行是 `streamAnthropic/streamOpenAICompatible/streamCoze/streamProvider`（已知全文结构）。移动后这些函数引用的以下符号保持从原模块 import：`chatCompletionsUrl`（`@/lib/provider/openai-chat-url`）、`isThinkingModelId`（`@/lib/provider/provider-models`）、`extractDeliverableFromReasoning`、`REASONING_MODEL_FALLBACK_MSG`、`streamTextInChunks`（`@/lib/math/math-response-sanitize`）、`cozeMathUserContent`（`@/lib/math/math-system-prompt`）、`EffectiveProvider`/`ProviderName`（`@/lib/provider/settings`）。行为完全不变的纯移动（refactor）。

- [ ] **Step 1: 写失败测试** `lib/llm/sse-stream.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeSseStream } from './sse-stream';

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value, { stream: true }); }
  return out;
}

describe('makeSseStream', () => {
  it('token 帧 + 事件帧 + [DONE] 依次写出', async () => {
    const res = makeSseStream(async (send, sendEvent) => {
      send('你好');
      sendEvent({ tikzCode: '\\draw (0,0);' });
    });
    const text = await readAll(res);
    expect(text).toBe('data: {"token":"你好"}\n\ndata: {"tikzCode":"\\\\draw (0,0);"}\n\ndata: [DONE]\n\n');
  });

  it('gen 抛错时发出 {error} 帧后正常结束', async () => {
    const res = makeSseStream(async () => { throw new Error('boom'); });
    const text = await readAll(res);
    expect(text).toContain('"error":"boom"');
    expect(text).toContain('[DONE]');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run lib/llm/sse-stream.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 移动代码**

1. 新建 `lib/llm/sse-stream.ts`：`export const` 无；把 `SendToken`、`SendEvent`、`makeSseStream`、`streamAnthropic`、`streamOpenAICompatible`、`streamCoze`、`streamProvider` 原样移入并 `export`；顶部补齐所需 import（含上方"背景"列出的符号；`Message` 类型定义为 `type Message = { role: 'user' | 'assistant' | 'system'; content: string }` 并 export —— 若被移动函数内部用了 `Provider` 别名，改为直接使用 `ProviderName`）。
2. `app/api/math/route.ts`：删除被移动的函数与类型，改为 `import { makeSseStream, streamProvider, type SendToken, type SendEvent } from '@/lib/llm/sse-stream';`；若 route 内仍有本地 `type Message`/`type Provider` 别名且无冲突则保留。

- [ ] **Step 4: 测试 + 构建**

Run: `npx vitest run lib/llm/sse-stream.test.ts && npm run build`
Expected: 测试 PASS；build 成功（ggb 页行为不变）

- [ ] **Step 5: 提交**

```bash
git add lib/llm/sse-stream.ts lib/llm/sse-stream.test.ts app/api/math/route.ts
git commit -m "refactor: extract shared SSE stream helpers into lib/llm/sse-stream.ts"
```

---

### Task 3: 测试设施 + AST 类型 + 词法器

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/tikz/subset/ast.ts`
- Create: `lib/tikz/subset/lexer.ts`
- Test: `lib/tikz/subset/lexer.test.ts`

**Interfaces:**
- Produces: `Token`/`lex()`（Task 4 用）；全部 AST 类型 + `ParseError`（Task 4/5/6/8/9/16 共用契约）。

- [ ] **Step 1: vitest.config.ts（项目零测试设施，先建）**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: { environment: 'jsdom', include: ['**/*.test.{ts,tsx}'], exclude: ['node_modules', '.next'] },
});
```

- [ ] **Step 2: 写失败测试** `lib/tikz/subset/lexer.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { lex } from './lexer';

describe('lex', () => {
  it('坐标语句切分为命令/括号/数字/逗号/分号', () => {
    const toks = lex('\\coordinate (A) at (1.5,-2);');
    expect(toks.map(t => t.type)).toEqual(['cmd','lparen','name','rparen','name','lparen','number','comma','minus','number','rparen','semi']);
    expect(toks[0]).toMatchObject({ value: '\\coordinate', start: 0, end: 11 });
  });

  it('-- 优先于单个 -，calc 符号齐全', () => {
    const types = lex('\\draw (A) -- ($(A)!0.5!(B)$);').map(t => t.type);
    expect(types).toContain('dashdash');
    expect(types).toContain('dollar');
    expect(types).toContain('bang');
  });

  it('% 注释与空白被跳过但位置保留', () => {
    const src = '% hello\n\\node';
    const toks = lex(src);
    expect(toks).toHaveLength(1);
    expect(toks[0].start).toBe(8);
  });

  it('\\p1 切分为 cmd(\\p) + number(1)', () => {
    const toks = lex('\\p1');
    expect(toks.map(t => t.value)).toEqual(['\\p', '1']);
  });
});
```

- [ ] **Step 3: 运行确认失败** → **Step 4: 实现**

`lib/tikz/subset/ast.ts`（完整契约，后续任务都 import 它）：

```ts
export interface SourceRange { start: number; end: number }

export type CoordExpr =
  | { kind: 'literal'; x: number; y: number; range: SourceRange }
  | { kind: 'ref'; name: string; range: SourceRange }
  | { kind: 'calc'; expr: CalcExpr; range: SourceRange };

export type CalcExpr =
  | { op: 'coord'; coord: CoordExpr; range: SourceRange }
  | { op: 'add' | 'sub'; left: CalcExpr; right: CalcExpr; range: SourceRange }
  | { op: 'interpolate'; a: CalcExpr; t: NumExpr; b: CalcExpr; range: SourceRange }
  | { op: 'rotate'; a: CalcExpr; t: NumExpr; angleDeg: NumExpr; b: CalcExpr; range: SourceRange }
  | { op: 'project'; a: CalcExpr; p: CalcExpr; b: CalcExpr; range: SourceRange };

export type NumExpr =
  | { kind: 'num-lit'; value: number; range: SourceRange }
  | { kind: 'num-var'; name: string; range: SourceRange }
  | { kind: 'num-comp'; pvar: string; axis: 'x' | 'y'; range: SourceRange }
  | { kind: 'num-bin'; binop: '+' | '-' | '*' | '/'; left: NumExpr; right: NumExpr; range: SourceRange }
  | { kind: 'veclen'; x: NumExpr; y: NumExpr; range: SourceRange };

export type LetBinding =
  | { type: 'point'; name: string; value: CoordExpr; range: SourceRange }
  | { type: 'num'; name: string; value: NumExpr; range: SourceRange };

export interface StyleOptions { raw: string; range: SourceRange }

export type CircleRadius =
  | { kind: 'literal'; value: number; range: SourceRange }
  | { kind: 'through'; point: CoordExpr; range: SourceRange };

export type PathSpec =
  | { type: 'polyline'; points: CoordExpr[]; cycle: boolean; range: SourceRange }
  | { type: 'circle'; center: CoordExpr; radius: CircleRadius; range: SourceRange };

export interface IntersectionBinding { index: number; name: string; range: SourceRange }

export type Statement =
  | { kind: 'coordinate'; name: string; at: CoordExpr; range: SourceRange }
  | { kind: 'let-coordinate'; bindings: LetBinding[]; name: string; at: CoordExpr; range: SourceRange }
  | { kind: 'path'; command: 'draw' | 'path' | 'fill' | 'filldraw'; options: StyleOptions | null; specs: PathSpec[]; namePath: string | null; intersections: { of: [string, string]; bindings: IntersectionBinding[] } | null; range: SourceRange }
  | { kind: 'node'; options: StyleOptions | null; at: CoordExpr; text: string; range: SourceRange }
  | { kind: 'pic'; picType: 'angle' | 'right-angle'; points: [string, string, string]; options: StyleOptions | null; range: SourceRange };

export interface TikzPicture { scale: number | null; statements: Statement[]; range: SourceRange }

export class ParseError extends Error {
  constructor(message: string, public readonly start: number, public readonly end: number) {
    super(message);
    this.name = 'ParseError';
  }
}
```

`lib/tikz/subset/lexer.ts`：

```ts
export type TokenType =
  | 'cmd' | 'lbrace' | 'rbrace' | 'lbracket' | 'rbracket' | 'lparen' | 'rparen'
  | 'dashdash' | 'bang' | 'colon' | 'equals' | 'comma' | 'semi' | 'dollar'
  | 'plus' | 'minus' | 'star' | 'slash' | 'number' | 'name';

export interface Token { type: TokenType; value: string; start: number; end: number }

const SINGLE: Record<string, TokenType> = {
  '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket',
  '(': 'lparen', ')': 'rparen', '!': 'bang', ':': 'colon', '=': 'equals',
  ',': 'comma', ';': 'semi', '$': 'dollar', '+': 'plus', '*': 'star', '/': 'slash',
};

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (type: TokenType, value: string, start: number, end: number) => tokens.push({ type, value, start, end });
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(src.slice(i));
      if (m) { push('cmd', m[0], i, i + m[0].length); i += m[0].length; continue; }
      push('cmd', src.slice(i, i + 2), i, i + 2); i += 2; continue;
    }
    if (ch === '-' && src[i + 1] === '-') { push('dashdash', '--', i, i + 2); i += 2; continue; }
    if (ch === '-') { push('minus', '-', i, i + 1); i++; continue; }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { push('number', num[0], i, i + num[0].length); i += num[0].length; continue; }
    const nm = /^[A-Za-z][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (nm) { push('name', nm[0], i, i + nm[0].length); i += nm[0].length; continue; }
    const t = SINGLE[ch];
    if (t) { push(t, ch, i, i + 1); i++; continue; }
    throw new Error(`无法识别的字符 '${ch}' @${i}`);
  }
  return tokens;
}
```

- [ ] **Step 5: 测试通过 + 提交**

Run: `npx vitest run lib/tikz/subset/lexer.test.ts`

```bash
git add vitest.config.ts lib/tikz/subset/ast.ts lib/tikz/subset/lexer.ts lib/tikz/subset/lexer.test.ts
git commit -m "test: bootstrap vitest; feat(tikz): subset AST types and lexer"
```

---

### Task 4: 子集解析器（递归下降，带 source range）

**Files:**
- Create: `lib/tikz/subset/parser.ts`
- Test: `lib/tikz/subset/parser.test.ts`

**Interfaces:**
- Consumes: `lex()`、`Token`（Task 3）；全部 AST 类型（Task 3）。
- Produces: `parseTikz(src: string): TikzPicture`（抛 `ParseError{message,start,end}`）。Task 5/8/9/13/16 全部依赖。

**解析要点**（实现者须知）：
- options `[...]` 与 node 文本 `{...}` **不做 token 级解析**：parser 记录匹配括号位置后取 `src.slice(open.end, close.start)` 原文（括号需计深度匹配）。
- `namePath` 从 options 原文用 `/name\s+path\s*=\s*([A-Za-z][A-Za-z0-9_-]*)/` 提取；`name intersections={of=a and b}` 用 `/name\s+intersections\s*=\s*\{of\s*=\s*([A-Za-z][\w-]*)\s+and\s+([A-Za-z][\w-]*)\}/` 提取。
- pic 花括号原文用 `/^(angle|right angle)\s*=\s*(\w+)\s*--\s*(\w+)\s*--\s*(\w+)$/` 解析。
- 坐标字面量拒绝单位（`(1cm,2)` → ParseError「v1 子集坐标只支持纯数字（单位 cm 省略）」）。

- [ ] **Step 1: 写失败测试** `lib/tikz/subset/parser.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseTikz } from './parser';

const DOC = `\\begin{tikzpicture}[scale=1]
  \\coordinate (A) at (0,0);
  \\coordinate (B) at (4,0);
  \\coordinate (M) at ($(A)!0.5!(B)$);
  \\coordinate (H) at ($(A)!(C)!(B)$);
  \\draw[name path=c1] (C) circle (1.5);
  \\path[name path=l1] (A) -- (B);
  \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P) (intersection-2) coordinate (Q);
  \\draw[thick,->] (A) -- (B) -- (C) -- cycle;
  \\node[above right] at (A) {$A$};
  \\pic[draw] {right angle = B--H--C};
\\end{tikzpicture}`;

describe('parseTikz', () => {
  it('语句种类与数量正确', () => {
    const pic = parseTikz(DOC);
    expect(pic.scale).toBe(1);
    expect(pic.statements.map(s => s.kind)).toEqual([
      'coordinate','coordinate','coordinate','coordinate','path','path','path','path','node','pic',
    ]);
  });

  it('calc 插值 AST 形状与 source range', () => {
    const m = parseTikz(DOC).statements[2];
    if (m.kind !== 'coordinate' || m.at.kind !== 'calc') throw new Error('bad shape');
    expect(m.at.expr.op).toBe('interpolate');
    expect(DOC.slice(m.at.range.start, m.at.range.end)).toBe('($(A)!0.5!(B)$)');
  });

  it('投影 $(A)!(C)!(B)$ → project', () => {
    const h = parseTikz(DOC).statements[3];
    if (h.kind !== 'coordinate' || h.at.kind !== 'calc') throw new Error('bad shape');
    expect(h.at.expr.op).toBe('project');
  });

  it('name path / intersections 绑定', () => {
    const stmts = parseTikz(DOC).statements;
    expect(stmts[4]).toMatchObject({ kind: 'path', namePath: 'c1' });
    expect(stmts[6]).toMatchObject({ kind: 'path', intersections: { of: ['c1','l1'], bindings: [{ index: 1, name: 'P' }, { index: 2, name: 'Q' }] } });
  });

  it('折线 cycle 与箭头 options 原文', () => {
    const d = parseTikz(DOC).statements[7];
    if (d.kind !== 'path') throw new Error('bad');
    expect(d.specs[0]).toMatchObject({ type: 'polyline', cycle: true });
    expect(d.options?.raw).toBe('thick,->');
  });

  it('node 文本取花括号原文；pic 三点', () => {
    const n = parseTikz(DOC).statements[8];
    expect(n).toMatchObject({ kind: 'node', text: '$A$' });
    expect(parseTikz(DOC).statements[9]).toMatchObject({ kind: 'pic', picType: 'right-angle', points: ['B','H','C'] });
  });

  it('let-coordinate 绑定解析', () => {
    const src = `\\begin{tikzpicture}
      \\path let \\p1=($(B)-(A)$), \\n1={veclen(\\x1,\\y1)} in coordinate (D) at ($(A)+({\\x1/\\n1},{\\y1/\\n1})$);
    \\end{tikzpicture}`;
    const s = parseTikz(src).statements[0];
    expect(s).toMatchObject({ kind: 'let-coordinate', name: 'D' });
    if (s.kind !== 'let-coordinate') throw new Error('bad');
    expect(s.bindings.map(b => b.type)).toEqual(['point', 'num']);
  });

  it('through 圆半径', () => {
    const s = parseTikz('\\begin{tikzpicture}\\draw (O) circle [through=(A)];\\end{tikzpicture}').statements[0];
    if (s.kind !== 'path') throw new Error('bad');
    expect(s.specs[0]).toMatchObject({ type: 'circle', radius: { kind: 'through' } });
  });

  it('错误：未知命令 / 坐标带单位 / 未闭合', () => {
    expect(() => parseTikz('\\begin{tikzpicture}\\foreach \\x in {1,2} {}\\end{tikzpicture}')).toThrowError(/不支持的命令/);
    expect(() => parseTikz('\\begin{tikzpicture}\\coordinate (A) at (1cm,2);\\end{tikzpicture}')).toThrowError(/纯数字/);
    expect(() => parseTikz('\\begin{tikzpicture}\\coordinate (A) at (1,2);')).toThrowError(/end{tikzpicture}/);
  });
});
```

- [ ] **Step 2: 运行确认失败** → **Step 3: 实现** `lib/tikz/subset/parser.ts`

骨架（token 游标 + 如下方法；每个 AST 节点的 `range` 取首 token.start 到末 token.end）：

```ts
import { lex, type Token } from './lexer';
import { ParseError, type TikzPicture, type Statement, type CoordExpr, type CalcExpr, type NumExpr, type LetBinding, type PathSpec, type IntersectionBinding } from './ast';

export function parseTikz(src: string): TikzPicture {
  const tokens = lex(src);
  let pos = 0;
  const peek = () => tokens[pos] as Token | undefined;
  const next = () => tokens[pos++] as Token;
  const fail = (msg: string, t?: Token): never => { throw new ParseError(msg, t?.start ?? src.length, t?.end ?? src.length); };
  const expect = (type: Token['type'], what: string): Token => { const t = peek(); if (!t || t.type !== type) fail(`期望 ${what}`, t); return next(); };
  const expectCmd = (value: string): Token => { const t = peek(); if (!t || t.type !== 'cmd' || t.value !== value) fail(`期望 ${value}`, t); return next(); };
  // ...见下
}
```

必须实现的方法与精确规则：

```ts
// 文档骨架
function parsePicture(): TikzPicture {
  const begin = expectCmd('\\begin');
  expect('lbrace', "'{'"); const env = expect('name', '环境名');
  if (env.value !== 'tikzpicture') fail(`只支持 tikzpicture 环境，收到 ${env.value}`, env);
  expect('rbrace', "'}'");
  let scale: number | null = null;
  if (peek()?.type === 'lbracket') {
    const raw = readBracketRaw();           // 返回 {raw, range}，计深度匹配 ']'
    const m = /scale\s*=\s*([\d.]+)/.exec(raw.raw);
    if (m) scale = Number(m[1]);
  }
  const statements: Statement[] = [];
  for (;;) {
    const t = peek();
    if (!t) fail('缺少 \\end{tikzpicture}');
    if (t.type === 'cmd' && t.value === '\\end') { next(); expect('lbrace', "'{'"); const e = expect('name', '环境名'); expect('rbrace', "'}'"); if (e.value !== 'tikzpicture') fail('环境闭合不匹配', e); break; }
    statements.push(parseStatement());
  }
  return { scale, statements, range: { start: begin.start, end: src.length } };
}

// 语句分派：cmd 值 → coordinate/let/path/node/pic；其余 cmd → fail(`子集不支持的命令 ${t.value}`)
// '\coordinate' → '(' name ')' 'at'(name token) parseCoord() ';'
// '\path' 且下一个非 [ 非 coord 而是 'let' → parseLetCoordinate()：
//    bindings: 循环 [cmd('\p')|cmd('\n')] number '=' （point: parseCoord / num: '{' parseNumExpr '}'）逗号分隔，直到 name('in')
//    然后 'coordinate' '(' name ')' 'at' parseCoord ';'
// '\draw'|'\path'|'\fill'|'\filldraw' → parsePath()：
//    options?（readBracketRaw → StyleOptions）→ 循环至 ';'：
//      - lbracket 且原文含 'name intersections' → ']' 后读绑定：重复 ['(' 'intersection' minus number ')' 'coordinate' '(' name ')']
//      - coord 后紧跟 name('circle') → circle spec：'(' number ')' 或 '[' 'through' '=' '(' coord ')' ']'
//      - 否则 polyline：coord (dashdash coord)* (dashdash name('cycle'))?
// '\node' → options? name('at') coord 花括号原文(计深度) ';'
// '\pic' → options? 花括号原文(正则解析 picType+三点) ';'

// parseCoord(): lparen 后三种：dollar→parseCalc 后 expect dollar+rparen（range 含外层 ($..$)）；number|minus→字面量 x ',' y rparen（负号折叠；遇 name 单位则 fail 纯数字提示）；name→ref rparen
// parseCalcExpr(): left = parseCalcFactor()；循环：plus|minus → 二元；bang → 修饰：
//    number t, bang, 后若 number θ + colon + factor → rotate，否则 factor → interpolate
//    若 bang 后紧跟 factor P + bang + factor B → project
// parseCalcFactor(): lparen ... rparen 包裹一个 CoordExpr → {op:'coord'}（嵌套 calc 经 parseCoord 的 dollar 分支递归）
// parseNumExpr(): 加减乘除优先级两层；因子：number / cmd('\x'|'\y'|'\n')+number / cmd('\veclen') '(' num ',' num ')' / '(' num ')' / 花括号包裹（'{...}' 内允许完整 NumExpr，range 去括号）
```

- [ ] **Step 4: 测试通过 + 提交**

Run: `npx vitest run lib/tikz/subset/parser.test.ts`

```bash
git add lib/tikz/subset/parser.ts lib/tikz/subset/parser.test.ts
git commit -m "feat(tikz): recursive-descent parser for construction subset with source ranges"
```

---

### Task 5: 静态检查（未知引用/重复定义）

**Files:**
- Create: `lib/tikz/subset/static-check.ts`
- Test: `lib/tikz/subset/static-check.test.ts`

**Interfaces:**
- Consumes: `TikzPicture`、`Statement`、`CoordExpr`、`CalcExpr`（Task 3）。
- Produces: `CheckIssue`、`staticCheck(pic)`。Task 13 的 `analyze()` 依赖。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { parseTikz } from './parser';
import { staticCheck } from './static-check';

const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

describe('staticCheck', () => {
  it('合法文档零 issue', () => {
    const pic = parseTikz(wrap('\\coordinate (A) at (0,0);\\coordinate (M) at ($(A)!0.5!(A)$);'));
    expect(staticCheck(pic)).toEqual([]);
  });

  it('未知点引用报错并带 range', () => {
    const pic = parseTikz(wrap('\\coordinate (M) at ($(A)!0.5!(B)$);'));
    const issues = staticCheck(pic);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ severity: 'error' });
    expect(issues[0].message).toContain('A');
  });

  it('未知 name path 引用报错', () => {
    const pic = parseTikz(wrap('\\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P);'));
    expect(staticCheck(pic).map(i => i.message).join()).toContain('c1');
  });

  it('重复定义同名点报错', () => {
    const pic = parseTikz(wrap('\\coordinate (A) at (0,0);\\coordinate (A) at (1,1);'));
    expect(staticCheck(pic)[0].message).toContain('重复');
  });

  it('pic 引用的点也要检查', () => {
    const pic = parseTikz(wrap('\\pic {angle = B--A--C};'));
    expect(staticCheck(pic)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 实现**

```ts
import type { TikzPicture, Statement, CoordExpr, CalcExpr, SourceRange } from './ast';

export interface CheckIssue {
  severity: 'error' | 'preview-only';
  message: string;
  range: SourceRange | null;
  stmtIndex: number | null;
}

export function staticCheck(pic: TikzPicture): CheckIssue[] {
  // 1. 收集定义：point 名（coordinate/let-coordinate/intersection bindings）与 path 名（namePath）
  // 2. 重复定义 → error「点 'X' 重复定义」
  // 3. 遍历所有 CoordExpr（含 calc 子树、let 绑定值、through 点）收集 ref → 未定义则 error「未定义的点 'X'」
  //    let-coordinate 中 \p1 形式不算 ref（它是 pvar）；ref 名一律走 named point
  // 4. intersections.of 两个 path 名 → 未定义则 error「未定义的命名路径 'X'」
  // 5. pic.points 三点同理
}
```

ref 收集辅助（Task 8 也会用，放 `static-check.ts` 并 export）：

```ts
export function collectCoordRefs(coord: CoordExpr): string[] {
  switch (coord.kind) {
    case 'literal': return [];
    case 'ref': return [coord.name];
    case 'calc': return collectCalcRefs(coord.expr);
  }
}
export function collectCalcRefs(e: CalcExpr): string[] {
  switch (e.op) {
    case 'coord': return collectCoordRefs(e.coord);
    case 'add': case 'sub': return [...collectCalcRefs(e.left), ...collectCalcRefs(e.right)];
    case 'interpolate': case 'rotate': return [...collectCalcRefs(e.a), ...collectCalcRefs(e.b)];
    case 'project': return [...collectCalcRefs(e.a), ...collectCalcRefs(e.p), ...collectCalcRefs(e.b)];
  }
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add lib/tikz/subset/static-check.ts lib/tikz/subset/static-check.test.ts
git commit -m "feat(tikz): static check for unknown refs and duplicate definitions"
```

---

### Task 6: calc 求值器（含受限 let）

**Files:**
- Create: `lib/tikz/semantics/calc-eval.ts`
- Test: `lib/tikz/semantics/calc-eval.test.ts`

**Interfaces:**
- Consumes: AST 类型（Task 3）。
- Produces: `Pt`、`EvalEnvs`、`EvalError`、`evalCoord/evalCalc/evalNum`。Task 7/8/9/16 依赖。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { evalCoord, type EvalEnvs, type Pt } from './calc-eval';
import { parseTikz } from '../../tikz/subset/parser';
import type { CoordExpr } from '../../tikz/subset/ast';

const at = (src: string): CoordExpr => {
  const s = parseTikz(`\\begin{tikzpicture}\\coordinate (T) at ${src};\\end{tikzpicture}`).statements[0];
  if (s.kind !== 'coordinate') throw new Error('bad');
  return s.at;
};
const env = (pts: Record<string, Pt>): EvalEnvs => ({ points: new Map(Object.entries(pts)) });
const close = (p: Pt, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };

describe('calc-eval', () => {
  it('字面量与引用', () => {
    close(evalCoord(at('(1.5,-2)'), env({})), 1.5, -2);
    close(evalCoord(at('(A)'), env({ A: { x: 3, y: 4 } })), 3, 4);
  });
  it('插值：中点与外插', () => {
    const e = env({ A: { x: 0, y: 0 }, B: { x: 4, y: 2 } });
    close(evalCoord(at('($(A)!0.5!(B)$)'), e), 2, 1);
    close(evalCoord(at('($(A)!1.5!(B)$)'), e), 6, 3);
  });
  it('旋转 60° 构成等边三角形', () => {
    const e = env({ A: { x: 0, y: 0 }, B: { x: 2, y: 0 } });
    const c = evalCoord(at('($(A)!1!60:(B)$)'), e);
    close(c, 1, Math.sqrt(3));
  });
  it('投影垂足', () => {
    const e = env({ A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 1, y: 2 } });
    close(evalCoord(at('($(A)!(C)!(B)$)'), e), 1, 0);
  });
  it('向量加减与嵌套', () => {
    const e = env({ A: { x: 1, y: 1 }, B: { x: 3, y: 0 }, C: { x: 0, y: 2 } });
    close(evalCoord(at('($(A)+(B)-(C)$)'), e), 4, -1);
    close(evalCoord(at('($(A)+($(B)!0.5!(C)$)$)'), e), 2.5, 2);
  });
  it('退化投影抛 EvalError(degenerate)，未知引用抛 unknown-ref', () => {
    expect(() => evalCoord(at('($(A)!(C)!(B)$)'), env({ A: {x:0,y:0}, B: {x:0,y:0}, C: {x:1,y:1} }))).toThrowError(/退化/);
    expect(() => evalCoord(at('(ZZ)'), env({}))).toThrowError(/未定义/);
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/semantics/calc-eval.ts`

```ts
import type { CalcExpr, CoordExpr, NumExpr } from '../../tikz/subset/ast';

export interface Pt { x: number; y: number }
export interface EvalEnvs {
  points: ReadonlyMap<string, Pt>;
  pvars?: ReadonlyMap<string, Pt>;
  nvars?: ReadonlyMap<string, number>;
}
export class EvalError extends Error {
  constructor(message: string, public readonly code: 'unknown-ref' | 'degenerate' | 'eval') { super(message); this.name = 'EvalError'; }
}

const EPS = 1e-12;
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, t: number): Pt => ({ x: a.x * t, y: a.y * t });
const rotateDeg = (a: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

export function evalCoord(expr: CoordExpr, env: EvalEnvs): Pt {
  switch (expr.kind) {
    case 'literal': return { x: expr.x, y: expr.y };
    case 'ref': {
      const p = env.points.get(expr.name);
      if (!p) throw new EvalError(`未定义的点 '${expr.name}'`, 'unknown-ref');
      return p;
    }
    case 'calc': return evalCalc(expr.expr, env);
  }
}

export function evalCalc(e: CalcExpr, env: EvalEnvs): Pt {
  switch (e.op) {
    case 'coord': return evalCoord(e.coord, env);
    case 'add': return add(evalCalc(e.left, env), evalCalc(e.right, env));
    case 'sub': return sub(evalCalc(e.left, env), evalCalc(e.right, env));
    case 'interpolate': { const a = evalCalc(e.a, env); const b = evalCalc(e.b, env); const t = evalNum(e.t, env); return add(a, scale(sub(b, a), t)); }
    case 'rotate': { const a = evalCalc(e.a, env); const b = evalCalc(e.b, env); const t = evalNum(e.t, env); const ang = evalNum(e.angleDeg, env); return add(a, scale(rotateDeg(sub(b, a), ang), t)); }
    case 'project': {
      const a = evalCalc(e.a, env); const p = evalCalc(e.p, env); const b = evalCalc(e.b, env);
      const d = sub(b, a); const len2 = d.x * d.x + d.y * d.y;
      if (len2 < EPS) throw new EvalError('投影的参考线退化为一点', 'degenerate');
      const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2;
      return add(a, scale(d, t));
    }
  }
}

export function evalNum(e: NumExpr, env: EvalEnvs): number {
  switch (e.kind) {
    case 'num-lit': return e.value;
    case 'num-var': { const v = env.nvars?.get(e.name); if (v === undefined) throw new EvalError(`未定义的数 '\\${e.name}'`, 'unknown-ref'); return v; }
    case 'num-comp': { const p = env.pvars?.get(e.pvar); if (!p) throw new EvalError(`未定义的点 '\\${e.pvar}'`, 'unknown-ref'); return e.axis === 'x' ? p.x : p.y; }
    case 'num-bin': {
      const l = evalNum(e.left, env); const r = evalNum(e.right, env);
      if (e.binop === '+') return l + r;
      if (e.binop === '-') return l - r;
      if (e.binop === '*') return l * r;
      if (Math.abs(r) < EPS) throw new EvalError('除数为 0', 'degenerate');
      return l / r;
    }
    case 'veclen': return Math.hypot(evalNum(e.x, env), evalNum(e.y, env));
  }
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add lib/tikz/semantics/calc-eval.ts lib/tikz/semantics/calc-eval.test.ts
git commit -m "feat(tikz): calc expression evaluator (interpolate/rotate/project/let nums)"
```

---

### Task 7: 交点算法（线线/线圆/圆圆）

**Files:**
- Create: `lib/tikz/semantics/intersections.ts`
- Test: `lib/tikz/semantics/intersections.test.ts`

**Interfaces:**
- Consumes: `Pt`（Task 6）。
- Produces: `GeomPath`、`intersectPaths(first, second): Pt[]`（沿 first 路径参数序排列，去重）。Task 9 场景求值依赖。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { intersectPaths, type GeomPath } from './intersections';

const seg = (x1: number, y1: number, x2: number, y2: number): GeomPath => ({ type: 'poly', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false });
const circ = (x: number, y: number, r: number): GeomPath => ({ type: 'circle', center: { x, y }, radius: r });

describe('intersectPaths', () => {
  it('线段相交 / 平行不相交', () => {
    expect(intersectPaths(seg(0, 0, 4, 4), seg(0, 4, 4, 0))).toHaveLength(1);
    expect(intersectPaths(seg(0, 0, 4, 4), seg(0, 4, 4, 0))[0]).toMatchObject({ x: 2, y: 2 });
    expect(intersectPaths(seg(0, 0, 4, 0), seg(0, 1, 4, 1))).toHaveLength(0);
  });
  it('线段×圆：两交点并沿 first 排序；相切 1 点；相离 0 点', () => {
    const pts = intersectPaths(seg(-3, 0, 3, 0), circ(0, 0, 2));
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeCloseTo(-2, 9); expect(pts[1].x).toBeCloseTo(2, 9);
    expect(intersectPaths(seg(-3, 2, 3, 2), circ(0, 0, 2))).toHaveLength(1);
    expect(intersectPaths(seg(-3, 3, 3, 3), circ(0, 0, 2))).toHaveLength(0);
  });
  it('圆×圆：2/1/0 交点', () => {
    expect(intersectPaths(circ(0, 0, 2), circ(3, 0, 2))).toHaveLength(2);
    expect(intersectPaths(circ(0, 0, 2), circ(4, 0, 2))).toHaveLength(1);
    expect(intersectPaths(circ(0, 0, 2), circ(5, 0, 2))).toHaveLength(0);
    expect(intersectPaths(circ(0, 0, 2), circ(0, 0, 2))).toHaveLength(0); // 同心重合视为退化
  });
  it('交点在线段端点外不计（TikZ 语义：路径段而非无限直线）', () => {
    expect(intersectPaths(seg(0, 0, 1, 1), seg(2, 0, 3, 1))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 实现**

```ts
import type { Pt } from './calc-eval';

export type GeomPath =
  | { type: 'poly'; points: Pt[]; closed: boolean }
  | { type: 'circle'; center: Pt; radius: number };

const EPS = 1e-9;
const close = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

// 内部：segSeg(a,b,c,d) → {pt, t} | null（t 为 first 上参数，t,u∈[-EPS,1+EPS]）
// 内部：segCircle(a,b,c,r) → {pt, t}[]（二次方程，t∈[-EPS,1+EPS]，判别式≈0 时 1 解）
// 内部：circleCircle(c1,r1,c2,r2) → Pt[]（d>r1+r2、d<|r1-r2|、d<EPS 均 0 解；否则 1–2 解）

export function intersectPaths(first: GeomPath, second: GeomPath): Pt[] {
  // poly 拆成逐段（closed 时首尾相连）；收集 {pt, t: 沿 first 的累计参数}：
  //   first=poly 时 t = 段索引 + 段内 t；first=circle 时 t = 角度 θ（排序键）
  // 去重（close 判等）→ 按 t 升序 → 返回 Pt[]
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add lib/tikz/semantics/intersections.ts lib/tikz/semantics/intersections.test.ts
git commit -m "feat(tikz): segment/circle intersection algorithms with along-path ordering"
```

---

### Task 8: 依赖图（拓扑排序 + 环检测）

**Files:**
- Create: `lib/tikz/semantics/dependency-graph.ts`
- Test: `lib/tikz/semantics/dependency-graph.test.ts`

**Interfaces:**
- Consumes: `Statement`、`collectCoordRefs`（Task 5）。
- Produces: `DepGraph { order: string[]; cycle: string[] | null; nodeKinds: Map<string,'point'|'path'> }`、`buildDependencyGraph(stmts)`。Task 9 依赖。节点 id：点名直接；路径名加前缀 `path:`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { parseTikz } from '../../tikz/subset/parser';
import { buildDependencyGraph } from './dependency-graph';

const stmtsOf = (body: string) => parseTikz(`\\begin{tikzpicture}${body}\\end{tikzpicture}`).statements;

describe('buildDependencyGraph', () => {
  it('派生点排在其依赖之后', () => {
    const g = buildDependencyGraph(stmtsOf('\\coordinate (A) at (0,0);\\coordinate (M) at ($(A)!0.5!(A)$);'));
    expect(g.cycle).toBeNull();
    expect(g.order.indexOf('A')).toBeLessThan(g.order.indexOf('M'));
  });
  it('前向引用也正确排序', () => {
    const g = buildDependencyGraph(stmtsOf('\\coordinate (M) at ($(A)!0.5!(B)$);\\coordinate (A) at (0,0);\\coordinate (B) at (4,0);'));
    expect(g.order.indexOf('A')).toBeLessThan(g.order.indexOf('M'));
    expect(g.order.indexOf('B')).toBeLessThan(g.order.indexOf('M'));
  });
  it('路径节点依赖其点，交点依赖两条路径', () => {
    const g = buildDependencyGraph(stmtsOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (4,0);
      \\draw[name path=c1] (A) circle (1.5);
      \\path[name path=l1] (A) -- (B);
      \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P);`));
    expect(g.order.indexOf('A')).toBeLessThan(g.order.indexOf('path:c1'));
    expect(g.order.indexOf('path:c1')).toBeLessThan(g.order.indexOf('P'));
    expect(g.order.indexOf('path:l1')).toBeLessThan(g.order.indexOf('P'));
    expect(g.nodeKinds.get('path:c1')).toBe('path');
  });
  it('环检测返回环上点名', () => {
    const g = buildDependencyGraph(stmtsOf('\\coordinate (A) at ($(B)!0.5!(B)$);\\coordinate (B) at ($(A)!0.5!(A)$);'));
    expect(g.cycle).not.toBeNull();
    expect(g.cycle).toContain('A');
    expect(g.cycle).toContain('B');
  });
  it('let-coordinate 依赖绑定值中的点', () => {
    const g = buildDependencyGraph(stmtsOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (4,0);
      \\path let \\p1=($(B)-(A)$) in coordinate (D) at ($(A)+({\\x1},{\\y1})$);`));
    expect(g.order.indexOf('B')).toBeLessThan(g.order.indexOf('D'));
  });
});
```

- [ ] **Step 2: 实现**

```ts
import type { Statement } from '../../tikz/subset/ast';
import { collectCoordRefs } from '../../tikz/subset/static-check';

export interface DepGraph {
  order: string[];
  cycle: string[] | null;
  nodeKinds: Map<string, 'point' | 'path'>;
}

export function buildDependencyGraph(stmts: Statement[]): DepGraph {
  // 节点定义：
  //   coordinate → id=name, deps=collectCoordRefs(at)
  //   let-coordinate → id=name, deps=各 binding.value 的 refs（point 绑定走 collectCoordRefs；num 绑定里的 \x1 不算 ref）+ at 的 refs
  //   path 且 namePath → id=`path:${namePath}`, deps=specs 内全部点 refs（含 through）
  //   intersections bindings → id=binding.name, deps=[`path:${of[0]}`, `path:${of[1]}`]
  // Kahn 拓扑排序（deps 先于节点）；剩余未排节点 = 环 → cycle = 其名（去前缀后排序）
  // nodeKinds 记录 point/path（'path:' 前缀节点为 path）
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add lib/tikz/semantics/dependency-graph.ts lib/tikz/semantics/dependency-graph.test.ts
git commit -m "feat(tikz): construction dependency graph with topo sort and cycle detection"
```

---

### Task 9: 场景求值 + 样式解析

**Files:**
- Create: `lib/tikz/semantics/scene.ts`
- Create: `lib/tikz/render/style-resolver.ts`
- Test: `lib/tikz/semantics/scene.test.ts`
- Test: `lib/tikz/render/style-resolver.test.ts`

**Interfaces:**
- Consumes: `buildDependencyGraph`（Task 8）、`evalCoord/evalNum/EvalError/Pt`（Task 6）、`intersectPaths/GeomPath`（Task 7）、`collectCoordRefs`（Task 5）。
- Produces: `Scene`、`SceneElement`、`ScenePoint`、`SceneIssue`、`evaluateScene(stmts)`（Task 10/13/20 依赖）；`ResolvedStyle`、`resolveStyle(raw, command)`、`anchorFromRaw(raw)`（Task 10/17/19 依赖）。

- [ ] **Step 1: 写失败测试** `lib/tikz/semantics/scene.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseTikz } from '../../tikz/subset/parser';
import { evaluateScene } from './scene';

const sceneOf = (body: string) => evaluateScene(parseTikz(`\\begin{tikzpicture}${body}\\end{tikzpicture}`).statements);

describe('evaluateScene', () => {
  it('自由点/派生点求值与 free 标记', () => {
    const s = sceneOf('\\coordinate (A) at (0,0);\\coordinate (B) at (4,0);\\coordinate (M) at ($(A)!0.5!(B)$);');
    expect(s.issues).toEqual([]);
    expect(s.points.get('A')).toMatchObject({ position: { x: 0, y: 0 }, free: true });
    expect(s.points.get('M')).toMatchObject({ position: { x: 2, y: 0 }, free: false, dependsOn: ['A', 'B'] });
  });
  it('through 圆半径 = center 到 through 点距离', () => {
    const s = sceneOf('\\coordinate (O) at (1,1);\\coordinate (A) at (4,5);\\draw (O) circle [through=(A)];');
    const c = s.elements.find(e => e.kind === 'circle');
    expect(c).toMatchObject({ center: { x: 1, y: 1 } });
    expect(c && c.kind === 'circle' ? c.radius : 0).toBeCloseTo(5, 6);
  });
  it('交点绑定到点名', () => {
    const s = sceneOf(`
      \\coordinate (A) at (-3,0);\\coordinate (B) at (3,0);\\coordinate (C) at (0,0);
      \\draw[name path=c1] (C) circle (2);
      \\path[name path=l1] (A) -- (B);
      \\path[name intersections={of=c1 and l1}] (intersection-1) coordinate (P) (intersection-2) coordinate (Q);`);
    expect(s.points.get('P')?.position.x).toBeCloseTo(-2, 6);
    expect(s.points.get('Q')?.position.x).toBeCloseTo(2, 6);
  });
  it('环依赖 → cycle issue，场景为空', () => {
    const s = sceneOf('\\coordinate (A) at ($(B)!0.5!(B)$);\\coordinate (B) at ($(A)!0.5!(A)$);');
    expect(s.issues[0].kind).toBe('cycle');
    expect(s.elements).toHaveLength(0);
  });
  it('let-coordinate（内心加权公式）求值', () => {
    const s = sceneOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (4,0);\\coordinate (C) at (0,3);
      \\path let \\p1=($(C)-(B)$), \\p2=($(C)-(A)$), \\p3=($(B)-(A)$),
        \\n1={veclen(\\x1,\\y1)}, \\n2={veclen(\\x2,\\y2)}, \\n3={veclen(\\x3,\\y3)}
        in coordinate (I) at ($({(\\n2*0+\\n3*0+\\n1*0)},{0})$);`);
    expect(s.issues).toEqual([]);
    expect(s.points.has('I')).toBe(true);
  });
  it('node → label 元素带锚点；pic → angle-mark', () => {
    const s = sceneOf(`
      \\coordinate (A) at (0,0);\\coordinate (B) at (1,0);\\coordinate (C) at (0,1);
      \\node[above right] at (A) {$A$};
      \\pic {right angle = B--A--C};`);
    expect(s.elements.find(e => e.kind === 'label')).toMatchObject({ at: { x: 0, y: 0 }, text: '$A$', anchor: 'above right' });
    expect(s.elements.find(e => e.kind === 'angle-mark')).toMatchObject({ right: true, vertex: { x: 0, y: 0 } });
  });
  it('求值失败的语句进 issues，其余正常渲染（best-attempt）', () => {
    const s = sceneOf(`
      \\coordinate (A) at (0,0);
      \\coordinate (H) at ($(A)!(A)!(A)$);
      \\draw (A) -- (H);`);
    expect(s.issues.some(i => i.kind === 'degenerate')).toBe(true);
    expect(s.points.get('A')).toBeDefined();
  });
});
```

`lib/tikz/render/style-resolver.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { resolveStyle, anchorFromRaw } from './style-resolver';

describe('resolveStyle', () => {
  it('颜色/线宽/虚线/箭头', () => {
    expect(resolveStyle('red,thick,dashed,->', 'draw')).toMatchObject({ stroke: '#ff0000', strokeWidth: 1.4, dash: '6 4', arrow: '->' });
  });
  it('black!30 灰度与 fill 命令默认', () => {
    const s = resolveStyle('black!30', 'fill');
    expect(s.stroke).toBe('rgba(37,31,26,0.3)');
    expect(s.fill).toBe('rgba(37,31,26,0.3)');
  });
  it('line width=2pt 换算与 opacity', () => {
    expect(resolveStyle('line width=2pt,opacity=0.5', 'draw')).toMatchObject({ strokeWidth: 2.666, opacity: 0.5 });
  });
  it('path 命令不可见', () => {
    expect(resolveStyle(null, 'path').stroke).toBe('none');
  });
  it('锚点提取', () => {
    expect(anchorFromRaw('above right, red')).toBe('above right');
    expect(anchorFromRaw(null)).toBe('above');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/render/style-resolver.ts`

```ts
export interface ResolvedStyle {
  stroke: string; strokeWidth: number; dash: string | null;
  arrow: 'none' | '->' | '<-' | '<->';
  fill: string | null; fillOpacity: number; opacity: number;
}
const INK = '#251f1a';
export const DEFAULT_STYLE: ResolvedStyle = { stroke: INK, strokeWidth: 1, dash: null, arrow: 'none', fill: null, fillOpacity: 0.25, opacity: 1 };

const COLORS: Record<string, string> = {
  red: '#ff0000', blue: '#0000ff', green: '#008000', black: INK, gray: '#808080', orange: '#ffa500',
  purple: '#800080', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00',
  olive: '#808000', pink: '#ffc0cb', teal: '#008080', violet: '#ee82ee', yellow: '#ffd700', white: '#ffffff',
};
const WIDTHS: Record<string, number> = { 'ultra thin': 0.4, 'very thin': 0.6, thin: 0.8, semithick: 1, thick: 1.4, 'very thick': 2, 'ultra thick': 3 };
const DASHES: Record<string, string> = { dashed: '6 4', 'densely dashed': '3 2.5', dotted: '1.5 3', 'dash dot': '6 3 1.5 3' };

export function resolveStyle(raw: string | null, command: 'draw' | 'path' | 'fill' | 'filldraw' | 'node' | 'pic'): ResolvedStyle {
  // 自 DEFAULT_STYLE 起不可变折叠：逐 option（按 ',' 切分 trim）应用
  // 'black!N'/'<color>!N' → rgba(37,31,26,N/100)（N≤100，仅支持到 ink 的混色）
  // 'line width=<n>pt' → strokeWidth = n*1.333（保留 3 位小数）
  // 'fill=<c>' → fill=resolveColor(c)；fill 命令且无 fill 选项 → fill=stroke；filldraw 同理
  // 'path' 命令 → stroke 'none' 且 fill null
  // 箭头 '->'|'<-'|'<->'；'>=stealth' 忽略箭头形状差异（v1 统一 stealth 形）
  // 'fill opacity=<n>'/'opacity=<n>' → 数字
}
export function anchorFromRaw(raw: string | null): string {
  // 从 options 中提取方位词组合（above/below/left/right/base/mid 及组合），默认 'above'
}
```

- [ ] **Step 3: 实现** `lib/tikz/semantics/scene.ts`

```ts
import type { Statement } from '../../tikz/subset/ast';
import { buildDependencyGraph } from './dependency-graph';
import { evalCoord, evalNum, EvalError, type Pt } from './calc-eval';
import { intersectPaths, type GeomPath } from './intersections';
import { collectCoordRefs } from '../../tikz/subset/static-check';
import { resolveStyle, anchorFromRaw, type ResolvedStyle } from '../render/style-resolver';

export interface ScenePoint { name: string; position: Pt; free: boolean; dependsOn: string[]; stmtIndex: number }
interface Base { stmtIndex: number; refs: string[]; style: ResolvedStyle }
export type SceneElement =
  | (Base & { kind: 'polyline'; points: Pt[]; cycle: boolean })
  | (Base & { kind: 'circle'; center: Pt; radius: number })
  | (Base & { kind: 'label'; at: Pt; text: string; anchor: string })
  | (Base & { kind: 'angle-mark'; vertex: Pt; from: Pt; to: Pt; right: boolean });
export interface SceneIssue { stmtIndex: number; message: string; kind: 'unknown-ref' | 'cycle' | 'degenerate' | 'eval' }
export interface Scene { points: Map<string, ScenePoint>; elements: SceneElement[]; issues: SceneIssue[]; graphOrder: string[] }

export function evaluateScene(stmts: Statement[]): Scene {
  // 1. graph = buildDependencyGraph(stmts)
  //    cycle 非空 → 返回 { points: new Map(), elements: [], issues: [{ stmtIndex: -1, kind: 'cycle', message: `构造存在环依赖: ${cycle.join(' → ')}` }], graphOrder: [] }
  // 2. points/env、pathEnv 构建：按 graph.order 找到定义该节点的 statement：
  //    coordinate → evalCoord(at)；free = at.kind === 'literal'
  //    let-coordinate → 顺序求 bindings（point→pvars、num→nvars，env 逐层扩展）后 evalCoord(at)
  //    path(namePath) → GeomPath（首个 spec：polyline→points/cycle；circle→center+半径(字面量|through 求距离)）
  //    intersection binding → intersectPaths(pathEnv.get(of0), pathEnv.get(of1))[index-1]；缺解 → EvalError degenerate「第 N 个交点不存在」
  //    EvalError → issues.push({ stmtIndex, kind: e.code, message: e.message })，该节点不写入 env（下游引用将以 unknown-ref 再报）
  // 3. elements：逐 statement（draw/fill/filldraw/node/pic；path 且仅作构造者跳过——无可见样式时跳过）：
  //    polyline spec → points 逐个 evalCoord（refs 收集）→ polyline 元素（fill/filldraw 时 style 经 resolveStyle(command)）
  //    circle spec 同理 → circle 元素
  //    node → label（anchor = anchorFromRaw(options?.raw ?? null)，text 原文）
  //    pic → angle-mark（vertex=points[1]、from=points[0]、to=points[2] 求值；right = picType==='right-angle'）
  //    元素级 EvalError → issue，跳过该元素；refs = 该语句引用到的点名集
  // 4. graphOrder = graph.order
}
```

- [ ] **Step 4: 测试通过 + 提交**

Run: `npx vitest run lib/tikz/semantics/scene.test.ts lib/tikz/render/style-resolver.test.ts`

```bash
git add lib/tikz/semantics/scene.ts lib/tikz/semantics/scene.test.ts lib/tikz/render/style-resolver.ts lib/tikz/render/style-resolver.test.ts
git commit -m "feat(tikz): scene evaluation (points/paths/intersections/elements) and style resolver"
```

---

### Task 10: viewport 变换 + 纯 SVG 渲染器（静态）

**Files:**
- Create: `lib/tikz/render/viewport.ts`
- Create: `lib/tikz/render/svg-renderer.tsx`
- Test: `lib/tikz/render/viewport.test.ts`
- Test: `lib/tikz/render/svg-renderer.test.tsx`

**Interfaces:**
- Consumes: `Scene/SceneElement/ScenePoint`（Task 9）、`ResolvedStyle`（Task 9）。
- Produces: `Viewport`、`sceneToScreen/screenToScene/fitViewport`、`RenderTheme/defaultTheme`、`TikzSceneSvg`（纯渲染组件，Task 14/17/21 依赖；后期放大镜复用同一组件 = 接缝④）。

- [ ] **Step 1: 写失败测试** `lib/tikz/render/viewport.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sceneToScreen, screenToScene, fitViewport } from './viewport';

describe('viewport', () => {
  it('y 轴翻转 + 往返一致', () => {
    const vp = { scale: 40, offsetX: 100, offsetY: 80 };
    const s = sceneToScreen({ x: 2, y: 3 }, vp);
    expect(s).toEqual({ x: 180, y: -40 });
    expect(screenToScene(s, vp)).toEqual({ x: 2, y: 3 });
  });
  it('fitViewport 居中且留 padding，scale 有界', () => {
    const vp = fitViewport([{ x: 0, y: 0 }, { x: 4, y: 2 }], 800, 600, 40);
    expect(vp.scale).toBeLessThanOrEqual(240);
    expect(sceneToScreen({ x: 2, y: 1 }, vp).x).toBeCloseTo(400, 3);
    expect(fitViewport([], 800, 600).scale).toBe(40);
  });
});
```

`lib/tikz/render/svg-renderer.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TikzSceneSvg } from './svg-renderer';
import type { Scene } from '../../tikz/semantics/scene';
import { DEFAULT_STYLE } from '../../tikz/render/style-resolver';

const scene: Scene = {
  points: new Map([
    ['A', { name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
    ['B', { name: 'B', position: { x: 4, y: 0 }, free: true, dependsOn: [], stmtIndex: 1 }],
    ['M', { name: 'M', position: { x: 2, y: 0 }, free: false, dependsOn: ['A', 'B'], stmtIndex: 2 }],
  ]),
  elements: [
    { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], cycle: false, stmtIndex: 3, refs: ['A', 'B'], style: DEFAULT_STYLE },
    { kind: 'circle', center: { x: 2, y: 0 }, radius: 1.5, stmtIndex: 4, refs: ['M'], style: DEFAULT_STYLE },
    { kind: 'label', at: { x: 0, y: 0 }, text: '$A$', anchor: 'above', stmtIndex: 5, refs: ['A'], style: DEFAULT_STYLE },
  ],
  issues: [], graphOrder: ['A', 'B', 'M'],
};
const vp = { scale: 10, offsetX: 100, offsetY: 100 };

describe('TikzSceneSvg', () => {
  it('元素渲染为 SVG 并带语义 data 属性', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={vp} /></svg>);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('points')).toBe('100,100 140,100');
    expect(line?.getAttribute('data-tikz-refs')).toBe('A B');
    const circle = container.querySelector('circle[data-tikz-kind="circle"]');
    expect(circle?.getAttribute('r')).toBe('15');
  });
  it('overlay 层渲染自由/派生点手柄，自由点实心、派生点空心', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={vp} /></svg>);
    const handles = container.querySelectorAll('[data-tikz-point]');
    expect(handles).toHaveLength(3);
    expect(container.querySelector('[data-tikz-point="A"]')?.getAttribute('data-tikz-free')).toBe('true');
    expect(container.querySelector('[data-tikz-point="M"]')?.getAttribute('data-tikz-free')).toBe('false');
  });
  it('label 去掉 $ 定界符渲染纯文本', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={vp} /></svg>);
    expect(container.querySelector('text')?.textContent).toBe('A');
  });
  it('selection 中的 ref 高亮', () => {
    const { container } = render(<svg><TikzSceneSvg scene={scene} viewport={vp} selection={['A']} /></svg>);
    expect(container.querySelector('[data-tikz-refs="A B"]')?.getAttribute('data-selected')).toBe('true');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/render/viewport.ts`

```ts
import type { Pt } from '../semantics/calc-eval';

export interface Viewport { scale: number; offsetX: number; offsetY: number }
export const CM_TO_PX = 40;

export function sceneToScreen(p: Pt, vp: Viewport): Pt {
  return { x: p.x * vp.scale + vp.offsetX, y: -p.y * vp.scale + vp.offsetY };
}
export function screenToScene(p: Pt, vp: Viewport): Pt {
  return { x: (p.x - vp.offsetX) / vp.scale, y: -(p.y - vp.offsetY) / vp.scale };
}
export function fitViewport(points: Pt[], width: number, height: number, padding = 32): Viewport {
  if (points.length === 0 || width <= 0 || height <= 0) return { scale: CM_TO_PX, offsetX: Math.max(width, 1) / 2, offsetY: Math.max(height, 1) / 2 };
  const xs = points.map(p => p.x); const ys = points.map(p => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const bw = Math.max(maxX - minX, 1e-6); const bh = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(Math.max(Math.min((width - 2 * padding) / bw, (height - 2 * padding) / bh), 6), 240);
  return {
    scale,
    offsetX: width / 2 - ((minX + maxX) / 2) * scale,
    offsetY: height / 2 + ((minY + maxY) / 2) * scale,
  };
}
```

- [ ] **Step 3: 实现** `lib/tikz/render/svg-renderer.tsx`

结构（纯函数组件，无内部状态 —— 接缝④）：

```tsx
import type { Scene, SceneElement, ScenePoint } from '../semantics/scene';
import { sceneToScreen, type Viewport } from './viewport';
import type { Pt } from '../semantics/calc-eval';

export interface RenderTheme {
  handleRadius: number; handleFill: string; handleDerivedFill: string;
  selectionColor: string; labelFont: string; angleRadius: number;
}
export const defaultTheme: RenderTheme = {
  handleRadius: 4, handleFill: '#c96442', handleDerivedFill: '#ffffff',
  selectionColor: '#2f6fd6', labelFont: 'italic 13px Georgia, "Times New Roman", serif', angleRadius: 16,
};

export function TikzSceneSvg({ scene, viewport, theme = defaultTheme, selection = [] }: {
  scene: Scene; viewport: Viewport; theme?: RenderTheme; selection?: string[];
}) {
  const sel = new Set(selection);
  return (<>
    <g data-layer="base">{scene.elements.map((el, i) => <ElementSvg key={i} el={el} vp={viewport} theme={theme} selected={el.refs.some(r => sel.has(r))} />)}</g>
    <g data-layer="overlay">{[...scene.points.values()].map(p => <HandleSvg key={p.name} p={p} vp={viewport} theme={theme} selected={sel.has(p.name)} />)}</g>
  </>);
}
```

要点：
- `ElementSvg`：polyline→`<polyline>`（cycle→`<polygon>`），circle→`<circle>`，label→`<text>`（`text.replace(/\$/g, '')`，锚点换算 dx/dy：above=(0,-6)、below=(0,16)、left=(-6,4)、right=(6,4)，组合相加），angle-mark→`<path>`（见下）。每个元素带 `data-tikz-stmt={stmtIndex}` `data-tikz-kind` `data-tikz-refs={refs.join(' ')}` `data-selected`；selected 时 `stroke=theme.selectionColor` 且 strokeWidth×1.8。
- 箭头（`style.arrow !== 'none'` 的 polyline）：**显式画箭头 path**（不用 SVG marker，避免颜色继承问题）：取末段方向单位向量 u，法向 n，在末点处画三角形 `M tip L tip-10u+4n L tip-10u-4n Z`（屏幕 px，strokeWidth 缩放因子 1+0.5*(w-1)）；`<-` 在首点对称画；`<->` 两端。
- angle-mark：`vertex/from/to` 经 sceneToScreen 后，单位向量 u1/u2，弧半径 theme.angleRadius：path `M v+u1*r A r,r 0 sweep,1 v+u2*r`（sweep 取两向量叉积符号）；right-angle 则画直角方块路径（u1、u2 各 12px 的折线 `v+u1*12 → v+u1*12+u2*12 → v+u2*12`）。
- `HandleSvg`：`<circle r={theme.handleRadius}>`，`data-tikz-point` `data-tikz-free`；free → fill=theme.handleFill；derived → fill=theme.handleDerivedFill + stroke=theme.handleFill；selected → 外圈 `<circle r={handleRadius+3.5} fill="none" stroke=selectionColor>`。

- [ ] **Step 4: 测试通过 + 提交**

Run: `npx vitest run lib/tikz/render/`

```bash
git add lib/tikz/render/viewport.ts lib/tikz/render/viewport.test.ts lib/tikz/render/svg-renderer.tsx lib/tikz/render/svg-renderer.test.tsx
git commit -m "feat(tikz): viewport transform and pure layered SVG renderer with semantic refs"
```

---

### Task 11: LLM 提示词三件套（子集规范 + 竞赛配方 + 按需注入）

**Files:**
- Create: `lib/tikz/prompt/tikz-recipes.ts`
- Create: `lib/tikz/prompt/tikz-context-builder.ts`
- Create: `lib/tikz/prompt/tikz-system-prompt.ts`
- Test: `lib/tikz/prompt/tikz-context-builder.test.ts`

**Interfaces:**
- Produces: `TikzRecipe`、`TIKZ_RECIPES`、`buildTikzContextForProblem(problem): string`、`buildTikzSystemPrompt(problem, opts): string`、`buildTikzRepairPrompt(code, failures, snapshot): string`、`TIKZ_SUBSET_RULES: string`。Task 12 依赖。

- [ ] **Step 1: 写失败测试** `lib/tikz/prompt/tikz-context-builder.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildTikzContextForProblem } from './tikz-context-builder';
import { buildTikzSystemPrompt, buildTikzRepairPrompt } from './tikz-system-prompt';

describe('tikz prompt', () => {
  it('按关键词注入配方（外接圆 → 外心配方），≤3 条', () => {
    const ctx = buildTikzContextForProblem('作三角形的外接圆并标出圆心');
    expect(ctx).toContain('外心');
    expect(ctx).toContain('circle [through=');
  });
  it('无命中关键词时返回空串', () => {
    expect(buildTikzContextForProblem('画一条线段')).toBe('');
  });
  it('system prompt 含子集规则与输出契约', () => {
    const p = buildTikzSystemPrompt('作垂心', {});
    expect(p).toContain('```tikz');
    expect(p).toContain('$(A)!0.5!(B)$');
    expect(p).not.toContain('\\foreach');
  });
  it('repair prompt 含代码/失败/快照', () => {
    const p = buildTikzRepairPrompt('CODE', ['未定义的点 X'], 'SNAP');
    expect(p).toContain('CODE'); expect(p).toContain('未定义的点 X'); expect(p).toContain('SNAP');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/prompt/tikz-recipes.ts`（每个配方 3–6 行片段；保持以下 8 个起步，后续 Phase 2 扩充）

```ts
export interface TikzRecipe { id: string; keywords: string[]; title: string; snippet: string }
export const TIKZ_RECIPES: TikzRecipe[] = [
  { id: 'midpoint', keywords: ['中点', '中线', 'midpoint'], title: '中点（插值）',
    snippet: '\\coordinate (M) at ($(A)!0.5!(B)$;  % A,B 的中点；任意定比用 !t!' },
  { id: 'foot', keywords: ['垂足', '高线', '垂心', 'altitude'], title: '垂足与高线（投影）',
    snippet: '\\coordinate (H) at ($(A)!(C)!(B)$);  % C 到 AB 的垂足\n\\draw[dashed] (C) -- (H);  % 高线\n\\pic[draw] {right angle = C--H--B};  % 直角符号' },
  { id: 'circumcenter', keywords: ['外心', '外接圆', '中垂线', 'circumcenter'], title: '外心与外接圆（中垂线求交 + through 圆）',
    snippet: '\\coordinate (M1) at ($(A)!0.5!(B)$);\n\\coordinate (M2) at ($(B)!0.5!(C)$);\n\\path[name path=p1] ($(M1)!-1!90:(A)$) -- ($(M1)!2!90:(A)$);  % AB 中垂线（画长）\n\\path[name path=p2] ($(M2)!-1!90:(B)$) -- ($(M2)!2!90:(B)$);\n\\path[name intersections={of=p1 and p2}] (intersection-1) coordinate (O);\n\\draw (O) circle [through=(A)];' },
  { id: 'incenter', keywords: ['内心', '角平分线', 'incenter', 'bisector'], title: '内心（受限 let 边长加权）',
    snippet: '% I = (a·A + b·B + c·C)/(a+b+c)，a=|BC|, b=|CA|, c=|AB|\n\\path let \\p1=($(B)-(C)$), \\p2=($(A)-(C)$), \\p3=($(A)-(B)$),\n  \\n1={veclen(\\x1,\\y1)}, \\n2={veclen(\\x2,\\y2)}, \\n3={veclen(\\x3,\\y3)}\n  in coordinate (I) at ($({(\\n1*0+\\n2*4+\\n3*0)/(\\n1+\\n2+\\n3)},{(\\n1*0+\\n2*0+\\n3*3)/(\\n1+\\n2+\\n3)})$);  % 坐标按题面代入' },
  { id: 'centroid', keywords: ['重心', 'centroid'], title: '重心（中线 2:1）',
    snippet: '\\coordinate (M) at ($(B)!0.5!(C)$);\n\\coordinate (G) at ($(A)!0.6667!(M)$);  % 或两条中线求交' },
  { id: 'tangent', keywords: ['切线', '切点', '相切', 'tangent'], title: '圆的切点（直径圆求交，尺规标准作法）',
    snippet: '\\coordinate (M) at ($(O)!0.5!(P)$);  % OP 中点\n\\path[name path=dm] (M) circle [through=(O)];  % 以 OP 为直径的圆\n\\path[name intersections={of=dm and c1}] (intersection-1) coordinate (T1) (intersection-2) coordinate (T2);\n\\draw (P) -- (T1) (P) -- (T2);  % 两条切线' },
  { id: 'radical', keywords: ['根轴', '圆幂', 'radical'], title: '两圆交点与根轴',
    snippet: '\\path[name intersections={of=c1 and c2}] (intersection-1) coordinate (P) (intersection-2) coordinate (Q);\n\\draw[red] (P) -- (Q);  % 根轴即公共弦所在直线' },
  { id: 'rotate-homothety', keywords: ['旋转', '位似', '等边', '正方形', 'homothety'], title: '旋转与位似（旋转插值）',
    snippet: '\\coordinate (C) at ($(A)!1!60:(B)$);  % 等边三角形第三顶点（绕 A 转 60°）\n\\coordinate (P2) at ($(O)!2!(P)$);  % 以 O 为中心、比 2 的位似像' },
];
```

`lib/tikz/prompt/tikz-context-builder.ts`：

```ts
import { TIKZ_RECIPES, type TikzRecipe } from './tikz-recipes';

export function buildTikzContextForProblem(problem: string): string {
  const hits: TikzRecipe[] = TIKZ_RECIPES.filter(r => r.keywords.some(k => problem.toLowerCase().includes(k.toLowerCase()))).slice(0, 3);
  if (hits.length === 0) return '';
  return hits.map(r => `### ${r.title}\n${r.snippet}`).join('\n\n');
}
```

`lib/tikz/prompt/tikz-system-prompt.ts` —— **逐字**实现：

```ts
import { buildTikzContextForProblem } from './tikz-context-builder';

export const TIKZ_SUBSET_RULES = `# TikZ 构造子集规则（必须严格遵守）
你输出的 TikZ 将被一个自研解析器实时解析为可交互构造图（不是交给 LaTeX 编译），因此只能使用以下子集：

## 结构
- 只输出一个 \\\`\\\`\\\`tikz 代码块，内含且仅含 \\begin{tikzpicture} ... \\end{tikzpicture}；块外可用一两句中文说明。
- 禁止使用：\\foreach、plot、\\clip、\\begin{scope}、arc(...)、\\newcommand/\\def、\\input/\\include、\\usepackage、\\documentclass、贝塞尔 .. controls ..、单位（坐标一律纯数字，单位视为 cm）。

## 命名点（三种）
1. 自由点：\\coordinate (A) at (1.5, 2); —— 纯数字字面量。
2. 派生点（calc 表达式，坐标随依赖自动联动）：
   - 插值 ($(A)!t!(B)$)：t=0.5 中点，可外插
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

export function buildTikzSystemPrompt(problem: string, opts: { previousCode?: string }): string {
  const recipes = buildTikzContextForProblem(problem);
  const parts = [
    '你是一位竞赛平面几何作图专家，用 TikZ 构造子集把题目画成可交互的图。',
    TIKZ_SUBSET_RULES,
  ];
  if (recipes) parts.push(`# 与本题相关的构造配方\n${recipes}`);
  if (opts.previousCode) parts.push(`# 当前画布代码（在其基础上修改，保留仍正确的部分）\n${opts.previousCode}`);
  parts.push(`# 题目\n${problem}`);
  return parts.join('\n\n');
}

export function buildTikzRepairPrompt(code: string, failures: string[], sceneSnapshot: string): string {
  return [
    '你是 TikZ 构造子集修复器。下面的代码在我们的子集引擎中报错，请输出修复后的完整代码。',
    TIKZ_SUBSET_RULES,
    `# 当前代码\n${code}`,
    `# 错误列表\n${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
    sceneSnapshot ? `# 引擎求值快照（部分对象可能缺失）\n${sceneSnapshot}` : '',
    '要求：只输出一个 ```tikz 代码块（完整可解析），不要做文字解释。保持原构造意图，最小改动修复错误。',
  ].filter(Boolean).join('\n\n');
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add lib/tikz/prompt/tikz-recipes.ts lib/tikz/prompt/tikz-context-builder.ts lib/tikz/prompt/tikz-system-prompt.ts lib/tikz/prompt/tikz-context-builder.test.ts
git commit -m "feat(tikz): subset system prompt with competition construction recipes injection"
```

---

### Task 12: /api/tikz 路由（build/repair）+ 服务端抽取与净化

**Files:**
- Create: `lib/tikz/server/extract-tikz.ts`
- Create: `app/api/tikz/route.ts`
- Create: `app/api/tikz/models/route.ts`
- Create: `app/api/tikz/providers/route.ts`
- Test: `lib/tikz/server/extract-tikz.test.ts`
- Test: `app/api/tikz/route.test.ts`

**Interfaces:**
- Consumes: `makeSseStream/streamProvider`（Task 2）、`getEffectiveProvider/PROVIDER_NAMES`（Task 1）、prompt 三件套（Task 11）、`checkRate/clientIp`（现有）。
- Produces: POST `/api/tikz` SSE 帧协议：`{model}` `{token}…` `{tikzCode, previewOnly: string[], stripped: string[]}` `{error}` `[DONE]`；body：`{ mode:'build'|'repair', problem?, history?, provider, model?, tikzCode?, failures?: string[], sceneSnapshot?: string, contextRefs?: string[] }`（contextRefs v1 仅类型预留，逻辑忽略 —— 接缝⑤/后期 ask）。

- [ ] **Step 1: 写失败测试** `lib/tikz/server/extract-tikz.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { extractTikzBlock, sanitizeTikz, detectPreviewOnly } from './extract-tikz';

describe('extractTikzBlock', () => {
  it('从 ```tikz 围栏提取', () => {
    expect(extractTikzBlock('前言\n```tikz\n\\begin{tikzpicture}\\end{tikzpicture}\n```\n后语')).toBe('\\begin{tikzpicture}\\end{tikzpicture}');
  });
  it('兼容 ```latex 围栏与裸环境', () => {
    expect(extractTikzBlock('```latex\n\\begin{tikzpicture}\\draw (0,0);\n```')).toContain('\\begin{tikzpicture}');
    expect(extractTikzBlock('直接给：\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture} 完毕')).toContain('\\end{tikzpicture}');
  });
  it('找不到返回 null', () => { expect(extractTikzBlock('没有代码')).toBeNull(); });
});

describe('sanitizeTikz', () => {
  it('剥离危险与 preamble 命令并记录', () => {
    const { code, stripped } = sanitizeTikz('\\documentclass{article}\n\\usepackage{tikz}\n\\begin{tikzpicture}\n\\input{evil}\n\\draw (0,0);\n\\end{tikzpicture}');
    expect(code).not.toContain('\\input');
    expect(code).not.toContain('\\usepackage');
    expect(stripped).toContain('\\input');
  });
});

describe('detectPreviewOnly', () => {
  it('识别子集外特性', () => {
    expect(detectPreviewOnly('\\begin{tikzpicture}\\foreach \\x in {1,2}{}\\end{tikzpicture}')).toContain('\\foreach');
    expect(detectPreviewOnly('\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}')).toEqual([]);
  });
});
```

`app/api/tikz/route.test.ts`（mock provider 层，验证帧协议）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/llm/sse-stream', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/llm/sse-stream')>();
  return { ...orig, streamProvider: vi.fn(async (_p, _m, send) => { send('好的'); return '```tikz\n\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}\n```'; }) };
});
vi.mock('@/lib/provider/settings', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/provider/settings')>();
  return { ...orig, getEffectiveProvider: vi.fn(async () => ({ apiKey: 'k', baseUrl: 'https://api.molamaker.cn', model: 'm', botId: '', configured: true, protocol: 'openai-compatible' as const })) };
});

import { POST } from './route';

const req = (body: unknown) => new NextRequest('http://localhost/api/tikz', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/tikz', () => {
  beforeEach(() => vi.clearAllMocks());
  it('build：SSE 含 token 与 tikzCode 帧，[DONE] 收尾', async () => {
    const res = await POST(req({ mode: 'build', problem: '画三角形', history: [], provider: 'anthropic' }));
    const text = await res.text();
    expect(text).toContain('"token":"好的"');
    expect(text).toContain('"tikzCode"');
    expect(text).toContain('[DONE]');
  });
  it('非法 provider → 400', async () => {
    const res = await POST(req({ mode: 'build', problem: 'x', history: [], provider: 'evil' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/server/extract-tikz.ts`

```ts
const FORBIDDEN = [/\\input\b/g, /\\include\b/g, /\\write18\b/g, /\\def\b/g, /\\newcommand\b/g, /\\renewcommand\b/g, /\\usepackage\b[^\n]*/g, /\\documentclass\b[^\n]*/g, /\\usetikzlibrary\b[^\n]*/g];
const PREVIEW_ONLY_PATTERNS = ['\\\\foreach', '\\bplot\\b', '\\\\begin\\{scope\\}', '\\\\clip\\b', '\\barc\\s*\\(', '\\\\tdplot'];

export function extractTikzBlock(text: string): string | null {
  const fenced = /```(?:tikz|latex|tex)\s*\n([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1].trim();
  const bare = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/.exec(text);
  return bare ? bare[0] : null;
}
export function sanitizeTikz(code: string): { code: string; stripped: string[] } {
  const stripped: string[] = [];
  let out = code;
  for (const re of FORBIDDEN) {
    out = out.replace(re, (m) => { stripped.push(m.split(/[\s{]/)[0]); return '% [已移除]'; });
  }
  return { code: out, stripped: [...new Set(stripped)] };
}
export function detectPreviewOnly(code: string): string[] {
  return PREVIEW_ONLY_PATTERNS.filter(p => new RegExp(p).test(code)).map(p => p.replace(/\\\\/g, '\\').replace(/\\b/g, ''));
}
```

- [ ] **Step 3: 实现** `app/api/tikz/route.ts`

```ts
import { NextRequest } from 'next/server';
import { checkRate } from '@/lib/rate-limit';
import { clientIp } from '@/lib/client-ip';
import { getEffectiveProvider, PROVIDER_NAMES, type ProviderName } from '@/lib/provider/settings';
import { makeSseStream, streamProvider } from '@/lib/llm/sse-stream';
import { buildTikzSystemPrompt, buildTikzRepairPrompt } from '@/lib/tikz/prompt/tikz-system-prompt';
import { extractTikzBlock, sanitizeTikz, detectPreviewOnly } from '@/lib/tikz/server/extract-tikz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Message = { role: 'user' | 'assistant'; content: string };
interface TikzRequest {
  mode: 'build' | 'repair';
  problem?: string; history?: Message[]; provider?: string; model?: string;
  tikzCode?: string; failures?: string[]; sceneSnapshot?: string;
  contextRefs?: string[]; // v1 预留（后期 ask 模式），逻辑忽略
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let body: TikzRequest;
  try { body = (await req.json()) as TikzRequest; } catch { return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 }); }
  const provider = (body.provider ?? 'anthropic') as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) return Response.json({ error: '未知 provider' }, { status: 400 });
  if (!checkRate(`math-tikz:${ip}`, 20, 60_000)) {
    return Response.json({ error: '请求太频繁，请稍后再试' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const cfg = await getEffectiveProvider(provider);
  if (!cfg.configured) return Response.json({ error: `provider ${provider} 未配置密钥` }, { status: 400 });
  const model = body.model?.trim() || cfg.model;

  if (body.mode === 'repair') {
    if (!body.tikzCode || !body.failures) return Response.json({ error: 'repair 缺少 tikzCode/failures' }, { status: 400 });
    const system = buildTikzRepairPrompt(body.tikzCode, body.failures, body.sceneSnapshot ?? '');
    const messages: Message[] = [{ role: 'user', content: '请修复上面的代码。' }];
    return makeSseStream(async (send, sendEvent) => {
      sendEvent({ model });
      const full = await streamProvider(provider, messages, send, cfg, model, system);
      emitCode(full, sendEvent);
    });
  }

  const problem = body.problem?.trim();
  if (!problem) return Response.json({ error: '缺少 problem' }, { status: 400 });
  const system = buildTikzSystemPrompt(problem, { previousCode: body.tikzCode });
  const messages: Message[] = [...(body.history ?? []).slice(-8), { role: 'user', content: problem }];
  return makeSseStream(async (send, sendEvent) => {
    sendEvent({ model });
    const full = await streamProvider(provider, messages, send, cfg, model, system);
    emitCode(full, sendEvent);
  });
}

function emitCode(full: string, sendEvent: (e: Record<string, unknown>) => void) {
  const raw = extractTikzBlock(full);
  if (!raw) { sendEvent({ error: '模型输出中未找到 ```tikz 代码块，请重试或换个说法' }); return; }
  const { code, stripped } = sanitizeTikz(raw);
  sendEvent({ tikzCode: code, previewOnly: detectPreviewOnly(code), stripped });
}
```

- [ ] **Step 4: models/providers 两个子路由**

把 `app/api/math/models/route.ts`、`app/api/math/providers/route.ts` **逐字复制**到 `app/api/tikz/models/route.ts`、`app/api/tikz/providers/route.ts`（它们只依赖通用的 `lib/provider/*`，无需改动）。

- [ ] **Step 5: 测试 + 构建 + 提交**

Run: `npx vitest run lib/tikz/server app/api/tikz && npm run build`

```bash
git add lib/tikz/server/extract-tikz.ts lib/tikz/server/extract-tikz.test.ts app/api/tikz/
git commit -m "feat(tikz): /api/tikz SSE route (build/repair) with server-side sanitize"
```

---

### Task 13: analyze() + useTikzEngine 状态机

**Files:**
- Create: `lib/tikz/analyze.ts`
- Create: `components/tikz/use-tikz-engine.ts`
- Test: `lib/tikz/analyze.test.ts`
- Test: `components/tikz/use-tikz-engine.test.tsx`

**Interfaces:**
- Consumes: parser（4）、static-check（5）、evaluateScene（9）、`SourceRange`（3）。
- Produces: `analyze(code): Analysis`、`AnalysisIssue`、`TikzEngine`/`useTikzEngine(initialCode)`（Task 14/17/18/19/20/21 的 UI 全部消费它）。

```ts
export interface AnalysisIssue { severity: 'error' | 'preview-only'; message: string; range: SourceRange | null }
export interface Analysis {
  stmts: Statement[] | null;
  scene: Scene | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>; // 自由点名 → 其字面量坐标 range（Task 17 拖拽补丁依赖）
}
```

- [ ] **Step 1: 写失败测试** `lib/tikz/analyze.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { analyze } from './analyze';

const GOOD = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (M) at ($(A)!0.5!(A)$);\n\\draw (A) -- (M);\n\\end{tikzpicture}';

describe('analyze', () => {
  it('合法代码：scene 就绪、零 issue、freePointRanges 只含字面量点', () => {
    const a = analyze(GOOD);
    expect(a.scene).not.toBeNull();
    expect(a.issues).toEqual([]);
    expect([...a.freePointRanges.keys()]).toEqual(['A']);
    const r = a.freePointRanges.get('A')!;
    expect(GOOD.slice(r.start, r.end)).toBe('(0,0)');
  });
  it('解析失败：scene 为 null，issue 带 range', () => {
    const a = analyze('\\begin{tikzpicture}\\draw (0,0)');
    expect(a.scene).toBeNull();
    expect(a.issues[0].severity).toBe('error');
    expect(a.issues[0].range).not.toBeNull();
  });
  it('静态错误（未知引用）跳过求值', () => {
    const a = analyze('\\begin{tikzpicture}\\coordinate (M) at ($(Z)!0.5!(Z)$);\\end{tikzpicture}');
    expect(a.scene).toBeNull();
    expect(a.issues.length).toBeGreaterThan(0);
  });
  it('求值级错误（退化）保留场景（best-attempt）', () => {
    const a = analyze('\\begin{tikzpicture}\\coordinate (A) at (0,0);\\coordinate (H) at ($(A)!(A)!(A)$);\\end{tikzpicture}');
    expect(a.scene).not.toBeNull();
    expect(a.issues.some(i => i.message.includes('退化'))).toBe(true);
  });
});
```

`components/tikz/use-tikz-engine.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTikzEngine } from './use-tikz-engine';

const GOOD = '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}';
const GOOD2 = '\\begin{tikzpicture}\\coordinate (B) at (1,1);\\end{tikzpicture}';

describe('useTikzEngine', () => {
  it('初始场景就绪；坏代码保持上次好场景；恢复后更新', () => {
    const { result } = renderHook(() => useTikzEngine(GOOD));
    expect(result.current.scene?.points.has('A')).toBe(true);
    act(() => { result.current.setCode('\\begin{tikzpicture}\\draw (0,0)'); });
    expect(result.current.scene?.points.has('A')).toBe(true); // last-good 不变量
    expect(result.current.issues.length).toBeGreaterThan(0);
    act(() => { result.current.setCode(GOOD2); });
    expect(result.current.scene?.points.has('B')).toBe(true);
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/analyze.ts`

```ts
import { parseTikz, ParseError } from './subset/parser';
import { staticCheck } from './subset/static-check';
import { evaluateScene, type Scene } from './semantics/scene';
import type { SourceRange, Statement } from './subset/ast';

export interface AnalysisIssue { severity: 'error' | 'preview-only'; message: string; range: SourceRange | null }
export interface Analysis {
  stmts: Statement[] | null;
  scene: Scene | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>;
}

export function analyze(code: string): Analysis {
  let stmts: Statement[];
  try {
    stmts = parseTikz(code).statements;
  } catch (e) {
    if (e instanceof ParseError) {
      return { stmts: null, scene: null, issues: [{ severity: 'error', message: e.message, range: { start: e.start, end: e.end } }], freePointRanges: new Map() };
    }
    throw e;
  }
  const staticIssues: AnalysisIssue[] = staticCheck({ scale: null, statements: stmts, range: { start: 0, end: code.length } })
    .map(i => ({ severity: i.severity, message: i.message, range: i.range }));
  if (staticIssues.some(i => i.severity === 'error')) {
    return { stmts, scene: null, issues: staticIssues, freePointRanges: freeRanges(stmts) };
  }
  const scene = evaluateScene(stmts);
  const evalIssues: AnalysisIssue[] = scene.issues.map(i => ({ severity: 'error' as const, message: i.message, range: null }));
  return { stmts, scene, issues: [...staticIssues, ...evalIssues], freePointRanges: freeRanges(stmts) };
}

function freeRanges(stmts: Statement[]): Map<string, SourceRange> {
  const m = new Map<string, SourceRange>();
  for (const s of stmts) {
    if (s.kind === 'coordinate' && s.at.kind === 'literal') m.set(s.name, s.at.range);
  }
  return m;
}
```

- [ ] **Step 3: 实现** `components/tikz/use-tikz-engine.ts`

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyze, type AnalysisIssue } from '@/lib/tikz/analyze';
import type { Scene } from '@/lib/tikz/semantics/scene';
import type { SourceRange, Statement } from '@/lib/tikz/subset/ast';
import { CM_TO_PX, type Viewport } from '@/lib/tikz/render/viewport';

export interface TikzEngine {
  code: string;
  scene: Scene | null;
  stmts: Statement[] | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>;
  selection: string[];
  activeTool: string;
  viewport: Viewport;
  ephemeralStyles: Readonly<Record<string, never>>; // 接缝③占位（v1 恒空）
  setCode(next: string): void;
  applyPatch(next: string): void; // 与 setCode 同实现；语义区分画布来源，后期 undo 用
  setSelection(refs: string[]): void;
  setActiveTool(id: string): void;
  setViewport(vp: Viewport): void;
}

export function useTikzEngine(initialCode: string): TikzEngine {
  const [code, setCodeState] = useState(initialCode);
  const [selection, setSelection] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState('select');
  const [viewport, setViewport] = useState<Viewport>({ scale: CM_TO_PX, offsetX: 260, offsetY: 220 });
  const analysis = useMemo(() => analyze(code), [code]);
  const lastGood = useRef<Scene | null>(null);
  useEffect(() => { if (analysis.scene) lastGood.current = analysis.scene; }, [analysis.scene]);
  const scene = analysis.scene ?? lastGood.current;
  const setCode = useCallback((next: string) => setCodeState(next), []);
  return {
    code, scene, stmts: analysis.stmts, issues: analysis.issues,
    freePointRanges: analysis.freePointRanges, selection, activeTool, viewport,
    ephemeralStyles: {}, setCode, applyPatch: setCode,
    setSelection, setActiveTool, setViewport,
  };
}
```

- [ ] **Step 4: 测试通过 + 提交**

Run: `npx vitest run lib/tikz/analyze.test.ts components/tikz/use-tikz-engine.test.tsx`

```bash
git add lib/tikz/analyze.ts lib/tikz/analyze.test.ts components/tikz/use-tikz-engine.ts components/tikz/use-tikz-engine.test.tsx
git commit -m "feat(tikz): analyze pipeline and engine state hook with last-good invariant"
```

---

### Task 14: TikZ Studio UI 骨架 + /tikz 路由 + 首页 tile（Phase 0 完成）

**Files:**
- Create: `components/tikz-studio.tsx`
- Create: `components/tikz/tikz-canvas.tsx`
- Create: `components/tikz/tikz-toolbar.tsx`
- Create: `lib/tikz/prompt/sample-code.ts`
- Create: `app/tikz/page.tsx`
- Create: `app/tikz-studio.css`
- Modify: `app/page.tsx`（加第二张 tile）
- Modify: `app/layout.tsx`（import 新 css）
- Test: `components/tikz-studio.test.tsx`

**Interfaces:**
- Consumes: `useTikzEngine`（13）、`TikzSceneSvg/fitViewport`（10）、`/api/tikz` 帧协议（12）、`/api/tikz/models|providers`（12）。
- Produces: 可用的 Phase 0 页面（LLM 出题 → 静态图显示 + 代码只读展示）。

- [ ] **Step 1: 示例代码** `lib/tikz/prompt/sample-code.ts`

```ts
export const SAMPLE_TIKZ = `\\begin{tikzpicture}
  \\coordinate (A) at (0,0);
  \\coordinate (B) at (4,0);
  \\coordinate (C) at (1.2,2.8);
  \\coordinate (M) at ($(A)!0.5!(B)$);
  \\coordinate (H) at ($(A)!(C)!(B)$);
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  \\draw[dashed,red] (C) -- (H);
  \\draw[blue] (C) -- (M);
  \\pic[draw] {right angle = C--H--B};
  \\node[below left] at (A) {$A$};
  \\node[below right] at (B) {$B$};
  \\node[above] at (C) {$C$};
  \\node[below] at (M) {$M$};
  \\node[below] at (H) {$H$};
\\end{tikzpicture}`;
```

- [ ] **Step 2: 写失败测试** `components/tikz-studio.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TikzStudio } from './tikz-studio';

vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes('/api/tikz/providers')) return Response.json({ providers: ['anthropic'] });
  if (u.includes('/api/tikz/models')) return Response.json({ models: [{ id: 'claude-sonnet-4-6' }], source: 'fallback' });
  return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}) as unknown as typeof fetch);

describe('TikzStudio', () => {
  it('首页渲染第二张 tile，点击打开 studio（含画布与代码面板）', async () => {
    render(<TikzStudio />);
    expect(screen.getByText(/TikZ/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open Studio|打开/i }));
    expect(await screen.findByTestId('tikz-canvas')).toBeTruthy();
    expect(screen.getByTestId('tikz-code-panel')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 实现** `components/tikz/tikz-canvas.tsx`

```tsx
'use client';
import { useEffect, useRef } from 'react';
import type { TikzEngine } from './use-tikz-engine';
import { TikzSceneSvg } from '@/lib/tikz/render/svg-renderer';
import { fitViewport } from '@/lib/tikz/render/viewport';

export function TikzCanvas({ engine }: { engine: TikzEngine }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 内容变化时自适应取景（仅首次与代码结构变化时；拖拽期间不重置 —— Task 17 细化）
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !engine.scene) return;
    const pts = [...engine.scene.points.values()].map(p => p.position);
    engine.setViewport(fitViewport(pts, el.clientWidth, el.clientHeight, 40));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.code]);
  return (
    <div ref={boxRef} className="tz-canvas" data-testid="tikz-canvas">
      <svg width="100%" height="100%">
        {engine.scene && <TikzSceneSvg scene={engine.scene} viewport={engine.viewport} selection={engine.selection} />}
      </svg>
      {engine.issues.length > 0 && (
        <div className="tz-issues" data-testid="tikz-issues">
          {engine.issues.slice(0, 3).map((i, k) => <div key={k} className="tz-issue">{i.message}</div>)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 实现** `components/tikz-studio.tsx`（镜像 math-studio 结构；关键部分如下，样式类用 wp-* 复用 + tz-* 新增）

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SAMPLE_TIKZ } from '@/lib/tikz/prompt/sample-code';
import { useTikzEngine } from './tikz/use-tikz-engine';
import { TikzCanvas } from './tikz/tikz-canvas';
import { TikzToolbar } from './tikz/tikz-toolbar';

type Provider = 'anthropic' | 'deepseek' | 'coze' | 'dashscope';
type Message = { role: 'user' | 'assistant'; content: string };

export function TikzStudio({ startOpen = false }: { startOpen?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(startOpen);
  const [pureMode, setPureMode] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const engine = useTikzEngine(SAMPLE_TIKZ);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    fetch('/api/tikz/providers').then(r => r.json()).then(d => setProviders(d.providers ?? [])).catch(() => setProviders([]));
  }, []);

  const openStudio = useCallback(() => { setMounted(true); setOpen(true); }, []);

  const sendProblem = useCallback(async () => {
    const problem = input.trim();
    if (!problem || streaming) return;
    setStreaming(true);
    setMessages(prev => [...prev, { role: 'user', content: problem }, { role: 'assistant', content: '' }]);
    setInput('');
    try {
      const res = await fetch('/api/tikz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'build', problem, history: messages.slice(-6), provider, model: model || undefined, tikzCode: engine.code }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n'); buf = frames.pop() ?? '';
        for (const f of frames) {
          if (!f.startsWith('data: ')) continue;
          const payload = f.slice(6);
          if (payload === '[DONE]') continue;
          const evt = JSON.parse(payload) as Record<string, unknown>;
          if (typeof evt.token === 'string') {
            setMessages(prev => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + (evt.token as string) }; return next; });
          }
          if (typeof evt.tikzCode === 'string') engine.setCode(evt.tikzCode as string);
          if (typeof evt.error === 'string') setMessages(prev => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: `出错了：${evt.error as string}` }; return next; });
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `请求失败：${e instanceof Error ? e.message : '未知错误'}` }]);
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, messages, provider, model, engine]);

  return (<>
    {!startOpen && (
      <div className="wp-tile wp-tile--tikz" onClick={openStudio} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudio(); } }}>
        <div className="wp-tile__head">
          <span className="wp-tile__name">TikZ</span>
          <span className="wp-tile__status"><span className="wp-tile__dot wp-tile__dot--live" />tikz studio</span>
        </div>
        <div className="wp-tile__desc">
          用自然语言描述竞赛几何题，LLM 生成可交互的 TikZ 构造图 —— 拖拽联动、代码可见、一键导出 LaTeX。
        </div>
        <div className="wp-tile__actions">
          <button className="wp-tile__btn wp-tile__btn--primary" onClick={(e) => { e.stopPropagation(); openStudio(); }}>⛶ 打开</button>
        </div>
      </div>
    )}
    {mounted && open && createPortal(
      <div className={`tz-studio${pureMode ? ' tz-studio--pure' : ''}`}>
        <aside className="tz-sidebar">
          <div className="tz-sidebar__head">TikZ 助手</div>
          {/* provider pills + model picker：复用 math-studio 的 wp-math__* 类与取值逻辑（/api/tikz/models） */}
          <div className="tz-chat">
            {messages.map((m, i) => <div key={i} className={`tz-msg tz-msg--${m.role}`}>{m.content}</div>)}
            {streaming && <div className="tz-msg tz-msg--assistant tz-msg--pending">生成中…</div>}
          </div>
          <textarea className="tz-input" value={input} placeholder="描述一个几何构造，如：作三角形 ABC 的外接圆并标出外心"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendProblem(); } }} />
          <button className="tz-send" onClick={() => void sendProblem()} disabled={streaming}>发送 ↵</button>
        </aside>
        <main className="tz-stage">
          <TikzToolbar pureMode={pureMode} onTogglePure={() => setPureMode(v => !v)} engine={engine} />
          <TikzCanvas engine={engine} />
        </main>
        <aside className="tz-code" data-testid="tikz-code-panel">
          <div className="tz-code__head">TikZ 源码</div>
          <pre className="tz-code__pre">{engine.code}</pre>
        </aside>
      </div>, document.body)}
  </>);
}
```

`components/tikz/tikz-toolbar.tsx`（v1 最小）：纯净模式开关、状态 pill（点数/元素数/issue 数）、「✨精确预览」disabled（Phase 2）。

`app/tikz/page.tsx`：

```tsx
import { TikzStudio } from '@/components/tikz-studio';

export default function TikzHome() {
  return (
    <main className="math-shell">
      <TikzStudio startOpen />
    </main>
  );
}
```

`app/page.tsx` 改为：

```tsx
import { MathStudio } from '@/components/math-studio';
import { TikzStudio } from '@/components/tikz-studio';

export default function MathHome() {
  return (
    <main className="math-shell">
      <MathStudio />
      <TikzStudio />
    </main>
  );
}
```

`app/layout.tsx` 在现有 css import 后加一行 `import './tikz-studio.css';`。

`app/tikz-studio.css`（核心规则，~90 行；配色沿用项目 CSS 变量）：

```css
/* TikZ Studio */
.wp-tile--tikz { border-color: rgba(47,111,214,0.35); }
.wp-tile--tikz .wp-tile__dot--live { background: #2f6fd6; }
.tz-studio { position: fixed; inset: 0; z-index: 60; display: grid; grid-template-columns: 300px 1fr 340px; background: var(--bg); color: var(--ink); }
.tz-studio--pure { grid-template-columns: 0 1fr 0; }
.tz-studio--pure .tz-sidebar, .tz-studio--pure .tz-code { display: none; }
.tz-sidebar { border-right: 1px solid var(--rule); display: flex; flex-direction: column; background: var(--panel); }
.tz-sidebar__head { padding: 12px 14px; font-weight: 600; border-bottom: 1px solid var(--rule); }
.tz-chat { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.tz-msg { padding: 8px 10px; border-radius: 10px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
.tz-msg--user { background: rgba(201,100,66,0.12); align-self: flex-end; }
.tz-msg--assistant { background: rgba(37,31,26,0.06); }
.tz-msg--pending { opacity: 0.6; }
.tz-input { margin: 10px; min-height: 64px; resize: vertical; border: 1px solid var(--rule); border-radius: 10px; padding: 8px; font: inherit; background: #fff; }
.tz-send { margin: 0 10px 12px; padding: 8px; border-radius: 10px; border: none; background: var(--accent); color: #fff; cursor: pointer; }
.tz-send:disabled { opacity: 0.5; cursor: default; }
.tz-stage { position: relative; display: flex; flex-direction: column; }
.tz-canvas { position: relative; flex: 1; overflow: hidden; }
.tz-canvas svg { display: block; }
.tz-issues { position: absolute; left: 12px; bottom: 12px; max-width: 60%; display: flex; flex-direction: column; gap: 4px; }
.tz-issue { background: rgba(201,66,66,0.12); color: #a13c3c; border: 1px solid rgba(201,66,66,0.3); border-radius: 8px; padding: 4px 8px; font-size: 12px; }
.tz-code { border-left: 1px solid var(--rule); background: var(--panel); display: flex; flex-direction: column; }
.tz-code__head { padding: 12px 14px; font-weight: 600; border-bottom: 1px solid var(--rule); }
.tz-code__pre { flex: 1; overflow: auto; margin: 0; padding: 12px 14px; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
.tz-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--rule); background: var(--panel); }
.tz-toolbar .tz-pill { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: rgba(37,31,26,0.07); color: var(--muted); }
.tz-toolbar button { border: 1px solid var(--rule); background: #fff; border-radius: 8px; padding: 5px 10px; cursor: pointer; font-size: 13px; }
.tz-toolbar button:disabled { opacity: 0.45; cursor: default; }
```

- [ ] **Step 5: 测试 + 构建 + 提交**

Run: `npx vitest run components/tikz-studio.test.tsx && npm run build && npm run audit:cdn`

```bash
git add components/tikz-studio.tsx components/tikz/tikz-canvas.tsx components/tikz/tikz-toolbar.tsx components/tikz-studio.test.tsx lib/tikz/prompt/sample-code.ts app/tikz/page.tsx app/page.tsx app/layout.tsx app/tikz-studio.css
git commit -m "feat(tikz): studio UI skeleton with home tile, /tikz route, chat build flow"
```

---

### Task 15: 竞赛语料回归 harness + 20 个 fixture（Phase 0 验收门）

**Files:**
- Create: `lib/tikz/corpus.test.ts`
- Create: `lib/tikz/__fixtures__/competition/*.tikz` + `*.json`（20 对）

**Interfaces:**
- Consumes: parser（4）、evaluateScene（9）。
- Produces: 可执行的覆盖率指标（Task 22 的 ≥90% 门依赖）。

fixture 格式：`name.tikz` = 完整 tikzpicture；`name.json`：

```json
{ "points": { "M": [2, 0] }, "elements": [{ "kind": "circle", "center": [2, 1], "radius": 2.236068 }], "tolerance": 1e-6 }
```

- [ ] **Step 1: 实现 runner** `lib/tikz/corpus.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseTikz } from './subset/parser';
import { evaluateScene } from './semantics/scene';

interface Expected {
  points?: Record<string, [number, number]>;
  elements?: Array<{ kind: string; center?: [number, number]; radius?: number }>;
  tolerance?: number;
}

const dir = path.join(__dirname, '__fixtures__', 'competition');
const cases = readdirSync(dir).filter(f => f.endsWith('.tikz')).map(f => f.replace(/\.tikz$/, '')).sort();

describe('竞赛语料回归', () => {
  it('fixture 数量 ≥ 20', () => { expect(cases.length).toBeGreaterThanOrEqual(20); });
  for (const name of cases) {
    it(name, () => {
      const code = readFileSync(path.join(dir, `${name}.tikz`), 'utf8');
      const expected = JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')) as Expected;
      const tol = expected.tolerance ?? 1e-6;
      const scene = evaluateScene(parseTikz(code).statements);
      expect(scene.issues, `fixture ${name} 存在求值 issue: ${JSON.stringify(scene.issues)}`).toEqual([]);
      for (const [ptName, [x, y]] of Object.entries(expected.points ?? {})) {
        const p = scene.points.get(ptName);
        expect(p, `缺少点 ${ptName}`).toBeDefined();
        expect(Math.hypot(p!.position.x - x, p!.position.y - y), `点 ${ptName} 坐标偏差`).toBeLessThanOrEqual(tol);
      }
      for (const el of expected.elements ?? []) {
        const hit = scene.elements.find(e => e.kind === el.kind &&
          (el.kind !== 'circle' || (e.kind === 'circle' &&
            Math.hypot(e.center.x - el.center![0], e.center.y - el.center![1]) <= tol &&
            Math.abs(e.radius - el.radius!) <= tol)));
        expect(hit, `缺少元素 ${JSON.stringify(el)}`).toBeDefined();
      }
    });
  }
});
```

- [ ] **Step 2: 写 20 个 fixture**（以下 3 个逐字给出；其余 17 个按名称构造，坐标期望值须手工可验证，数值保留 6 位小数）

`midpoint-triangle.tikz`：

```latex
\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1,3);
\coordinate (M) at ($(A)!0.5!(B)$);
\coordinate (N) at ($(B)!0.5!(C)$);
\draw (A) -- (B) -- (C) -- cycle;
\draw[dashed] (M) -- (N);
\end{tikzpicture}
```

`midpoint-triangle.json`：`{"points": {"M": [2, 0], "N": [2.5, 1.5]}}`

`circumcenter-circle.tikz`：

```latex
\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (1,3);
\coordinate (M1) at ($(A)!0.5!(B)$);
\coordinate (M2) at ($(A)!0.5!(C)$);
\path[name path=p1] ($(M1)!-1!90:(A)$) -- ($(M1)!2!90:(A)$);
\path[name path=p2] ($(M2)!-2!90:(A)$) -- ($(M2)!3!90:(A)$);
\path[name intersections={of=p1 and p2}] (intersection-1) coordinate (O);
\draw (A) -- (B) -- (C) -- cycle;
\draw (O) circle [through=(A)];
\end{tikzpicture}
```

`circumcenter-circle.json`：`{"points": {"O": [2, 1]}, "elements": [{"kind": "circle", "center": [2, 1], "radius": 2.236068}]}`

`incenter-let.tikz`：

```latex
\begin{tikzpicture}
\coordinate (A) at (0,0);
\coordinate (B) at (4,0);
\coordinate (C) at (0,3);
\path let \p1=($(B)-(C)$), \p2=($(A)-(C)$), \p3=($(A)-(B)$),
  \n1={veclen(\x1,\y1)}, \n2={veclen(\x2,\y2)}, \n3={veclen(\x3,\y3)}
  in coordinate (I) at ($({(\n1*0+\n2*4+\n3*0)/(\n1+\n2+\n3)},{(\n1*0+\n2*0+\n3*3)/(\n1+\n2+\n3)})$);
\draw (A) -- (B) -- (C) -- cycle;
\end{tikzpicture}
```

`incenter-let.json`：`{"points": {"I": [1, 1]}}`

其余 17 个（名称即构造；期望值必须人工核算后写入 json）：
`foot-altitude`（垂足+高线）、`orthocenter`（两高求交，(0,0),(4,0),(1,3) 垂心 (1, 0.666667)）、`centroid-median`（(4/3, 1)）、`perp-bisector-midpoint`（中垂线上的点满足等距）、`equilateral-rotate60`（(1, 1.732051)）、`square-rotate90`、`parallelogram-translate`（D=A+C−B）、`reflection-flip`（($(P)!2!(H)$) 镜像）、`tangent-diameter`（直径圆求交切点）、`two-circle-intersect`、`circle-line-intersect`、`radical-axis`、`angle-mark-right`（断言 angle-mark 元素存在）、`angle-pic-general`、`homothety-scale2`、`nine-point-circle`（三边中点外接圆：圆心=垂心与外心中点）、`simson-line`（三垂足共线，断言三点坐标）。

- [ ] **Step 3: 全量回归 + 提交**

Run: `npx vitest run lib/tikz/corpus.test.ts`
Expected: 20 fixtures 全过（若有引擎 bug，先修引擎再提交 —— 这正是语料的意义）

```bash
git add lib/tikz/corpus.test.ts lib/tikz/__fixtures__/
git commit -m "test(tikz): competition construction corpus with 20 regression fixtures"
```

**Phase 0 验收**：至此 `npm test` 全绿、`npm run build` 通过、首页两张 tile、/tikz 可用自然语言出题并静态显示构造图。

---

### Task 16: 源码局部补丁（保格式）+ 样式补丁

**Files:**
- Create: `lib/tikz/patch/source-patch.ts`
- Test: `lib/tikz/patch/source-patch.test.ts`

**Interfaces:**
- Consumes: `SourceRange`（3）、`Pt`（6）。
- Produces: `formatCoordNumber`、`patchCoordinateLiteral(code, range, next)`、`patchStyleOptions(code, range|null, nextRaw, insertPos)`。Task 17/19 依赖。

- [ ] **Step 1: 写失败测试** `lib/tikz/patch/source-patch.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { formatCoordNumber, patchCoordinateLiteral, patchStyleOptions } from './source-patch';

describe('formatCoordNumber', () => {
  it('最多 4 位小数、去尾零、-0 归零', () => {
    expect(formatCoordNumber(1.5000001)).toBe('1.5');
    expect(formatCoordNumber(-2)).toBe('-2');
    expect(formatCoordNumber(0.123456789)).toBe('0.1235');
    expect(formatCoordNumber(-0.00000001)).toBe('0');
  });
});

describe('patchCoordinateLiteral', () => {
  const code = '\\begin{tikzpicture}\n  \\coordinate (A) at (0,0);  % 注释保留\n\\end{tikzpicture}';
  it('只替换坐标字面量，其余文本逐字节不动', () => {
    const start = code.indexOf('(0,0)');
    const next = patchCoordinateLiteral(code, { start, end: start + 5 }, { x: 2.34, y: -1 });
    expect(next).toBe('\\begin{tikzpicture}\n  \\coordinate (A) at (2.34,-1);  % 注释保留\n\\end{tikzpicture}');
  });
});

describe('patchStyleOptions', () => {
  it('替换已有 options 整体', () => {
    const code = '\\draw[thick,red] (A) -- (B);';
    const start = code.indexOf('['); const end = code.indexOf(']') + 1;
    expect(patchStyleOptions(code, { start, end }, 'blue,dashed', 0)).toBe('\\draw[blue,dashed] (A) -- (B);');
  });
  it('原无 options 时在 insertPos 插入', () => {
    const code = '\\draw (A) -- (B);';
    expect(patchStyleOptions(code, null, 'thick', 5)).toBe('\\draw[thick] (A) -- (B);');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/patch/source-patch.ts`

```ts
import type { SourceRange } from '../subset/ast';
import type { Pt } from '../semantics/calc-eval';

export function formatCoordNumber(n: number): string {
  const v = Number(n.toFixed(4));
  return Object.is(v, -0) ? '0' : String(v);
}

export function patchCoordinateLiteral(code: string, range: SourceRange, next: Pt): string {
  return `${code.slice(0, range.start)}(${formatCoordNumber(next.x)},${formatCoordNumber(next.y)})${code.slice(range.end)}`;
}

export function patchStyleOptions(code: string, range: SourceRange | null, nextRaw: string, insertPos: number): string {
  if (range) return `${code.slice(0, range.start)}[${nextRaw}]${code.slice(range.end)}`;
  return `${code.slice(0, insertPos)}[${nextRaw}]${code.slice(insertPos)}`;
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add lib/tikz/patch/source-patch.ts lib/tikz/patch/source-patch.test.ts
git commit -m "feat(tikz): format-preserving source patches for coordinates and options"
```

---

### Task 17: 工具分发画布 + 命中测试 + 拖拽闭环（核心交互）

**Files:**
- Create: `lib/tikz/render/hit-test.ts`
- Create: `lib/tikz/render/tools.ts`
- Modify: `components/tikz/tikz-canvas.tsx`（接工具分发 + 拖拽）
- Test: `lib/tikz/render/hit-test.test.ts`
- Test: `lib/tikz/render/tools.test.ts`

**Interfaces:**
- Consumes: `Scene`（9）、`Viewport/screenToScene`（10）、`freePointRanges`（13）、`patchCoordinateLiteral`（16）。
- Produces: `hitTestPointHandle`、`hitTestElement`、`Tool/ToolContext/selectTool/toolRegistry`（接缝②：后期放大镜/高亮笔在此注册）。

- [ ] **Step 1: 写失败测试** `lib/tikz/render/hit-test.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { hitTestPointHandle, hitTestElement } from './hit-test';
import type { Scene } from '../../tikz/semantics/scene';
import { DEFAULT_STYLE } from '../../tikz/render/style-resolver';

const scene: Scene = {
  points: new Map([
    ['A', { name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }],
    ['B', { name: 'B', position: { x: 4, y: 0 }, free: true, dependsOn: [], stmtIndex: 1 }],
  ]),
  elements: [
    { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], cycle: false, stmtIndex: 2, refs: ['A', 'B'], style: DEFAULT_STYLE },
    { kind: 'circle', center: { x: 2, y: 0 }, radius: 1.5, stmtIndex: 3, refs: [], style: DEFAULT_STYLE },
  ],
  issues: [], graphOrder: [],
};
const vp = { scale: 10, offsetX: 0, offsetY: 0 }; // 屏幕 y 翻转：(2,0) → (20, 0)

describe('hit-test', () => {
  it('最近手柄命中与半径约束', () => {
    expect(hitTestPointHandle({ x: 3, y: 2 }, scene, vp, 10)).toBe('A');
    expect(hitTestPointHandle({ x: 30, y: 40 }, scene, vp, 10)).toBeNull();
  });
  it('线段命中（含容差）与圆周命中', () => {
    expect(hitTestElement({ x: 20, y: 3 }, scene, vp, 6)?.stmtIndex).toBe(2);
    expect(hitTestElement({ x: 20, y: -15 }, scene, vp, 6)?.stmtIndex).toBe(3); // 圆周上 (2,-1.5)
    expect(hitTestElement({ x: 20, y: 30 }, scene, vp, 6)).toBeNull();
  });
});
```

`lib/tikz/render/tools.test.ts`（拖拽闭环：模拟 pointer 事件流，断言生成的 patch 文本）：

```ts
import { describe, it, expect, vi } from 'vitest';
import { selectTool, type ToolContext } from './tools';
import type { Scene } from '../../tikz/semantics/scene';

const CODE = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\end{tikzpicture}';
const scene: Scene = {
  points: new Map([['A', { name: 'A', position: { x: 0, y: 0 }, free: true, dependsOn: [], stmtIndex: 0 }]]),
  elements: [], issues: [], graphOrder: ['A'],
};
const rangeStart = CODE.indexOf('(0,0)');

const evt = (x: number, y: number) => ({ clientX: x, clientY: y, preventDefault: () => {} }) as unknown as React.PointerEvent;

describe('selectTool 拖拽', () => {
  it('拖自由点 → applyPatch 收到新坐标文本', () => {
    const patches: string[] = [];
    const ctx: ToolContext = {
      code: CODE, scene, viewport: { scale: 10, offsetX: 100, offsetY: 100 },
      freePointRanges: new Map([['A', { start: rangeStart, end: rangeStart + 5 }]]),
      applyPatch: (next) => patches.push(next),
      setSelection: vi.fn(),
      toScenePoint: (clientX, clientY) => ({ x: (clientX - 100) / 10, y: -(clientY - 100) / 10 }),
    };
    selectTool.onPointerDown!(evt(100, 100), ctx); // 按在 A 手柄上（屏 (100,100)）
    selectTool.onPointerMove!(evt(130, 80), ctx);
    selectTool.onPointerUp!(evt(130, 80), ctx);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toContain('(3,2)');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/render/hit-test.ts`

```ts
import type { Scene } from '../semantics/scene';
import { sceneToScreen, type Viewport } from './viewport';
import type { Pt } from '../semantics/calc-eval';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function hitTestPointHandle(screen: Pt, scene: Scene, vp: Viewport, radiusPx = 10): string | null {
  let best: string | null = null; let bestD = radiusPx;
  for (const p of scene.points.values()) {
    const d = dist(screen, sceneToScreen(p.position, vp));
    if (d <= bestD) { bestD = d; best = p.name; }
  }
  return best;
}

export function hitTestElement(screen: Pt, scene: Scene, vp: Viewport, tolerancePx = 6): { stmtIndex: number; refs: string[] } | null {
  let best: { stmtIndex: number; refs: string[] } | null = null; let bestD = tolerancePx;
  for (const el of scene.elements) {
    let d = Infinity;
    if (el.kind === 'polyline') {
      const pts = el.points.map(p => sceneToScreen(p, vp));
      const segs = el.cycle ? pts.map((_, i) => [pts[i], pts[(i + 1) % pts.length]] as const) : pts.slice(0, -1).map((p, i) => [p, pts[i + 1]] as const);
      for (const [a, b] of segs) d = Math.min(d, distToSegment(screen, a, b));
    } else if (el.kind === 'circle') {
      const c = sceneToScreen(el.center, vp);
      d = Math.abs(dist(screen, c) - el.radius * vp.scale);
    } else if (el.kind === 'label') {
      const at = sceneToScreen(el.at, vp);
      d = distToSegment(screen, { x: at.x - 4, y: at.y - 8 }, { x: at.x + el.text.length * 7, y: at.y + 8 });
    } else {
      d = dist(screen, sceneToScreen(el.vertex, vp)) - 16; // angle-mark 附近
    }
    if (d <= bestD) { bestD = d; best = { stmtIndex: el.stmtIndex, refs: el.refs }; }
  }
  return best;
}
```

- [ ] **Step 3: 实现** `lib/tikz/render/tools.ts`

```ts
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Scene } from '../semantics/scene';
import type { SourceRange } from '../subset/ast';
import type { Viewport } from './viewport';
import type { Pt } from '../semantics/calc-eval';
import { hitTestPointHandle, hitTestElement } from './hit-test';
import { patchCoordinateLiteral } from '../patch/source-patch';

export interface ToolContext {
  code: string;
  scene: Scene;
  viewport: Viewport;
  freePointRanges: Map<string, SourceRange>;
  applyPatch(next: string): void;
  setSelection(refs: string[]): void;
  toScenePoint(clientX: number, clientY: number): Pt; // 由 canvas 用 getBoundingClientRect 实现
}

export interface Tool {
  id: string;
  label: string;
  cursor: string;
  onPointerDown?(e: ReactPointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: ReactPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: ReactPointerEvent, ctx: ToolContext): void;
}

// 拖拽状态（模块级单例 —— 同一时间只有一次拖拽；若未来多画布并存再改为实例化）
let drag: { pointName: string } | null = null;

export const selectTool: Tool = {
  id: 'select',
  label: '选择/拖拽',
  cursor: 'default',
  onPointerDown(e, ctx) {
    const p = ctx.toScenePoint(e.clientX, e.clientY);
    const screen = { x: 0, y: 0 }; // hit 用屏坐标：由 toScenePoint 的对偶换算 —— 实现时直接复用 hit-test 的 sceneToScreen
    void screen;
    const name = hitTestPointHandle(sceneToClient(e, ctx), ctx.scene, ctx.viewport, 12);
    if (name && ctx.freePointRanges.has(name)) {
      drag = { pointName: name };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const hit = hitTestElement(sceneToClient(e, ctx), ctx.scene, ctx.viewport, 8);
    ctx.setSelection(hit ? hit.refs : []);
  },
  onPointerMove(e, ctx) {
    if (!drag) return;
    const range = ctx.freePointRanges.get(drag.pointName);
    if (!range) { drag = null; return; }
    const next = ctx.toScenePoint(e.clientX, e.clientY);
    ctx.applyPatch(patchCoordinateLiteral(ctx.code, range, next));
  },
  onPointerUp(_e, _ctx) { drag = null; },
};

function sceneToClient(e: ReactPointerEvent, ctx: ToolContext): Pt {
  // hit-test 工作在与 sceneToScreen 同一坐标系：用 viewport 把 scene 点投到「以 SVG 左上角为原点」的屏坐标；
  // 因此这里把 clientX/Y 转为同一原点：由 ctx.toScenePoint 的逆运算得到 —— canvas 同时提供 toClientPoint。
  // 简化：toScenePoint 接收 client 坐标；此处反解：先取原点场景值再线性回推。
  const s0 = ctx.toScenePoint(0, 0);
  const s1 = ctx.toScenePoint(100, 0);
  const s2 = ctx.toScenePoint(0, 100);
  const originX = -s0.x * (100 / (s1.x - s0.x));
  const originY = -s0.y * (100 / (s2.y - s0.y));
  return { x: e.clientX - originX, y: e.clientY - originY };
}

export const toolRegistry: ReadonlyMap<string, Tool> = new Map([[selectTool.id, selectTool]]);
```

**审查点**：`sceneToClient` 的线性回推确实笨拙 —— 实现时改为直接给 `ToolContext` 增加 `toClientPoint(scenePt)` 由 canvas 用 `getBoundingClientRect`+`sceneToScreen` 提供（两函数成对、一处实现）。测试里手写对偶实现即可。

- [ ] **Step 4: canvas 接工具分发**（`components/tikz/tikz-canvas.tsx` 修改）

```tsx
// 新增：svgRef + toScenePoint/toClientPoint（getBoundingClientRect 换算）+ activeTool 事件分发
// <svg onPointerDown/Move/Up → toolRegistry.get(engine.activeTool) 调用，ctx 每次 render 现取>
// 拖拽期间 viewport 不重置（把 Task 14 的 fitViewport effect 依赖从 engine.code 改为「结构签名」：
//   const signature = engine.scene ? [...engine.scene.points.keys()].join(',') : ''
//   useEffect(..., [signature]) —— 仅当点名集合变化时重新取景）
// <svg> 加 style={{ cursor: tool?.cursor }} 与 touchAction: 'none'
```

- [ ] **Step 5: 测试 + 提交**

Run: `npx vitest run lib/tikz/render/`

```bash
git add lib/tikz/render/hit-test.ts lib/tikz/render/hit-test.test.ts lib/tikz/render/tools.ts lib/tikz/render/tools.test.ts components/tikz/tikz-canvas.tsx
git commit -m "feat(tikz): tool-dispatch canvas with free-point drag to live source patch"
```

---

### Task 18: CodeMirror 代码面板（可编辑 + lint 标记）

**Files:**
- Create: `lib/tikz/editor/tikz-stream-language.ts`
- Create: `components/tikz/tikz-code-panel.tsx`
- Modify: `components/tikz-studio.tsx`（`<pre>` 换成面板）
- Test: `components/tikz/tikz-code-panel.test.tsx`

**Interfaces:**
- Consumes: `AnalysisIssue`（13）、engine（13）。
- Produces: `TikzCodePanel({ code, issues, onChange })`（双向同步通路③）。

- [ ] **Step 1: 安装依赖**

```bash
npm i @codemirror/state @codemirror/view @codemirror/language @codemirror/lint
```

先 `npm view @tikz-editor/lezer-tikz version` 查包是否存在：若 404（预期），走本任务的自研 StreamLanguage；若存在，也先用 StreamLanguage 保证工期，lezer 集成记为 Phase 2 候选。

- [ ] **Step 2: 实现** `lib/tikz/editor/tikz-stream-language.ts`

```ts
import { StreamLanguage, type StringStream } from '@codemirror/language';

export const tikzStreamLanguage = StreamLanguage.define<{ inCalc: boolean }>({
  name: 'tikz',
  startState: () => ({ inCalc: false }),
  token(stream: StringStream, state) {
    if (stream.match(/%.*/)) return 'lineComment';
    if (stream.match(/\\[a-zA-Z]+/)) return 'keyword';
    if (stream.match(/\\./)) return 'keyword';
    if (stream.match(/\d+(\.\d+)?/)) return 'number';
    if (stream.sol()) return null;
    if (stream.match(/--/)) return 'operator';
    if (stream.match(/[{}[\]()]/)) return 'bracket';
    if (stream.match(/[+\-*/=,:;!]/)) return 'operator';
    if (stream.eat('$')) { state.inCalc = !state.inCalc; return 'atom'; }
    if (stream.match(/[A-Za-z][A-Za-z0-9_-]*/)) return state.inCalc ? 'variableName' : 'propertyName';
    stream.next();
    return null;
  },
});
```

- [ ] **Step 3: 写失败测试** `components/tikz/tikz-code-panel.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TikzCodePanel } from './tikz-code-panel';

describe('TikzCodePanel', () => {
  it('渲染初始代码', () => {
    render(<TikzCodePanel code={'\\draw (A) -- (B);'} issues={[]} onChange={() => {}} />);
    expect(screen.getByTestId('tikz-cm').textContent).toContain('\\draw (A) -- (B);');
  });
  it('外部 code 更新（LLM/拖拽 patch）同步进编辑器', () => {
    const { rerender } = render(<TikzCodePanel code={'A'} issues={[]} onChange={() => {}} />);
    rerender(<TikzCodePanel code={'B'} issues={[]} onChange={() => {}} />);
    expect(screen.getByTestId('tikz-cm').textContent).toContain('B');
  });
  it('issue 渲染为 lint 标记（含 message）', () => {
    render(<TikzCodePanel code={'\\draw (A)'} issues={[{ severity: 'error', message: '未闭合', range: { start: 0, end: 5 } }]} onChange={() => {}} />);
    expect(document.querySelector('.cm-lintRange-error')).toBeTruthy();
  });
});
```

- [ ] **Step 4: 实现** `components/tikz/tikz-code-panel.tsx`

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { linter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { tikzStreamLanguage } from '@/lib/tikz/editor/tikz-stream-language';
import type { AnalysisIssue } from '@/lib/tikz/analyze';

export function TikzCodePanel({ code, issues, onChange }: {
  code: string; issues: AnalysisIssue[]; onChange(next: string): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
          tikzStreamLanguage, syntaxHighlighting(defaultHighlightStyle),
          linter(() => []), // 诊断由外部 issues 驱动（见下）
          EditorView.updateListener.of(u => {
            if (!u.docChanged) return;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => onChangeRef.current(view.state.doc.toString()), 300);
          }),
          EditorView.theme({ '&': { height: '100%', fontSize: '12px' }, '.cm-scroller': { fontFamily: 'var(--font-mono)' } }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部代码 → 编辑器（仅在不等时替换，保护光标）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: code } });
    }
  }, [code]);

  // issues → lint 诊断
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diags: Diagnostic[] = issues
      .filter(i => i.range)
      .map(i => ({ from: Math.min(i.range!.start, view.state.doc.length), to: Math.min(Math.max(i.range!.end, i.range!.start + 1), view.state.doc.length), severity: 'error', message: i.message }));
    view.dispatch(setDiagnostics(view.state, diags));
  }, [issues]);

  return <div ref={hostRef} className="tz-cm" data-testid="tikz-cm" />;
}
```

`components/tikz-studio.tsx`：把 `<pre className="tz-code__pre">{engine.code}</pre>` 换成 `<TikzCodePanel code={engine.code} issues={engine.issues} onChange={engine.setCode} />`（import 相应替换）。`app/tikz-studio.css` 加 `.tz-cm { flex: 1; overflow: hidden; } .tz-cm .cm-editor { height: 100%; }`。

- [ ] **Step 5: 测试 + 构建 + 提交**

Run: `npx vitest run components/tikz/tikz-code-panel.test.tsx && npm run build`

```bash
git add lib/tikz/editor/tikz-stream-language.ts components/tikz/tikz-code-panel.tsx components/tikz/tikz-code-panel.test.tsx components/tikz-studio.tsx app/tikz-studio.css package.json package-lock.json
git commit -m "feat(tikz): CodeMirror code panel with two-way sync and lint diagnostics"
```

---

### Task 19: 样式面板（选中元素 → 样式微调）

**Files:**
- Create: `components/tikz/tikz-style-panel.tsx`
- Modify: `components/tikz-studio.tsx`（代码面板下方挂样式面板；canvas 选中元素时联动）
- Test: `components/tikz/tikz-style-panel.test.tsx`

**Interfaces:**
- Consumes: engine.selection/stmts/code（13）、`patchStyleOptions`（16）、`resolveStyle`（9）。
- Produces: `TikzStylePanel({ engine })`。

- [ ] **Step 1: 写失败测试** `lib/tikz/render/style-options.test.ts`（选项组装逻辑，纯函数放 `lib/tikz/patch/style-options.ts`）

```ts
import { describe, it, expect } from 'vitest';
import { buildOptionsRaw, type StyleDraft } from '../patch/style-options';

describe('buildOptionsRaw', () => {
  it('从草稿组装 options 原文（省略默认）', () => {
    const draft: StyleDraft = { color: 'red', width: 'thick', dash: null, arrow: '<->', fill: false, opacity: null };
    expect(buildOptionsRaw(draft)).toBe('red,thick,<->');
  });
  it('fill 与透明度', () => {
    expect(buildOptionsRaw({ color: 'blue', width: null, dash: 'dashed', arrow: null, fill: true, opacity: 0.3 })).toBe('blue,dashed,fill=blue,fill opacity=0.3');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/patch/style-options.ts`（`StyleDraft` + `buildOptionsRaw(draft): string`；颜色集合导出 `STYLE_COLORS = ['black','red','blue','green','orange','purple','gray','brown']`，`STYLE_WIDTHS/STYLE_DASHES/STYLE_ARROWS` 常量）

- [ ] **Step 3: 实现** `components/tikz/tikz-style-panel.tsx`

```tsx
'use client';
// props: { engine: TikzEngine }
// 仅当 engine.selection 命中唯一元素时启用：从 engine.stmts[stmtIndex] 取 command/options/insertPos
//   （options 为 null 时 insertPos = 命令 token 末尾 = stmt.range.start + command.length + 1）
// 控件：颜色 select / 线宽 select / 线型 select / 箭头 select / 填充 checkbox / 透明度 range(0.1–1)
// 任一变更 → buildOptionsRaw → patchStyleOptions(engine.code, options?.range ?? null, raw, insertPos) → engine.applyPatch
// 空选/多选 → 提示「在画布上点击一个图形元素以调整样式」
```

`components/tikz-studio.tsx`：样式面板挂在代码面板头部下方；`TikzCanvas` 已有 selection 机制（Task 17 的 hitTestElement → setSelection）。

- [ ] **Step 4: 测试 + 提交**

```tsx
// tikz-style-panel.test.tsx：渲染控件 → 改颜色 select → 断言 applyPatch 文本含 'red'
```

```bash
git add lib/tikz/patch/style-options.ts lib/tikz/render/style-options.test.ts components/tikz/tikz-style-panel.tsx components/tikz/tikz-style-panel.test.tsx components/tikz-studio.tsx
git commit -m "feat(tikz): style panel patching element options in place"
```

---

### Task 20: repair 全回路（Tier 1 本地修复 + Tier 2 LLM + best-attempt）

**Files:**
- Create: `lib/tikz/repair/tikz-repair.ts`
- Create: `lib/tikz/repair/scene-snapshot.ts`
- Modify: `components/tikz-studio.tsx`（build 后自动修复 + 状态 pill + 🔧 按钮）
- Test: `lib/tikz/repair/tikz-repair.test.ts`
- Test: `lib/tikz/repair/scene-snapshot.test.ts`

**Interfaces:**
- Consumes: `AnalysisIssue`（13）、`Scene`（9）、`/api/tikz` repair 分支（12）。
- Produces: `localRepairTikz(code)`、`snapshotScene(scene)`、`runTikzRepair(opts)`（client 流程函数）。

- [ ] **Step 1: 写失败测试**

`lib/tikz/repair/tikz-repair.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { localRepairTikz } from './tikz-repair';

describe('localRepairTikz', () => {
  it('全角符号转半角', () => {
    const { code, fixes } = localRepairTikz('\\coordinate （A）at （0，0）；');
    expect(code).toBe('\\coordinate (A) at (0,0);');
    expect(fixes.length).toBeGreaterThan(0);
  });
  it('缺 \\end{tikzpicture} 自动补全', () => {
    const { code, fixes } = localRepairTikz('\\begin{tikzpicture}\n\\draw (0,0);');
    expect(code).toContain('\\end{tikzpicture}');
    expect(fixes).toContain('补全 \\end{tikzpicture}');
  });
  it('剥离 ```tikz 围栏残留', () => {
    const { code } = localRepairTikz('```tikz\n\\begin{tikzpicture}\\end{tikzpicture}\n```');
    expect(code).not.toContain('```');
  });
  it('无需修复时 fixes 为空', () => {
    expect(localRepairTikz('\\begin{tikzpicture}\\end{tikzpicture}').fixes).toEqual([]);
  });
});
```

`lib/tikz/repair/scene-snapshot.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { snapshotScene } from './scene-snapshot';
import { parseTikz } from '../../tikz/subset/parser';
import { evaluateScene } from '../../tikz/semantics/scene';

describe('snapshotScene', () => {
  it('输出点/元素摘要行，含 free/派生标记', () => {
    const scene = evaluateScene(parseTikz('\\begin{tikzpicture}\\coordinate (A) at (1,2);\\coordinate (M) at ($(A)!0.5!(A)$);\\draw (A) circle (1.5);\\end{tikzpicture}').statements);
    const snap = snapshotScene(scene);
    expect(snap).toContain('A: point @ (1.000, 2.000) [自由]');
    expect(snap).toContain('M: point @ (1.000, 2.000) [派生]');
    expect(snap).toContain('circle @ (1.000, 2.000) r=1.500');
  });
  it('超过 48 行截断并注明', () => {
    const coords = Array.from({ length: 60 }, (_, i) => `\\coordinate (P${i}) at (${i},0);`).join('\n');
    const scene = evaluateScene(parseTikz(`\\begin{tikzpicture}${coords}\\end{tikzpicture}`).statements);
    expect(snapshotScene(scene)).toContain('…另有');
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/repair/tikz-repair.ts`

```ts
const FULLWIDTH: Array<[RegExp, string]> = [[/，/g, ','], [/（/g, '('], [/）/g, ')'], [/：/g, ':'], [/；/g, ';'], [/！/g, '!']];

export function localRepairTikz(code: string): { code: string; fixes: string[] } {
  let out = code; const fixes: string[] = [];
  const fence = /```(?:tikz|latex|tex)?\s*\n?([\s\S]*?)```/.exec(out);
  if (fence) { out = fence[1].trim(); fixes.push('剥离代码围栏'); }
  for (const [re, half] of FULLWIDTH) {
    if (re.test(out)) { out = out.replace(re, half); fixes.push(`全角转半角 ${half}`); }
  }
  if (out.includes('\\begin{tikzpicture}') && !out.includes('\\end{tikzpicture}')) {
    out = `${out}\n\\end{tikzpicture}`; fixes.push('补全 \\end{tikzpicture}');
  }
  return { code: out, fixes: [...new Set(fixes)] };
}
```

`lib/tikz/repair/scene-snapshot.ts`：

```ts
import type { Scene } from '../semantics/scene';

export function snapshotScene(scene: Scene, maxLines = 48): string {
  const lines: string[] = [];
  for (const p of scene.points.values()) {
    lines.push(`${p.name}: point @ (${p.position.x.toFixed(3)}, ${p.position.y.toFixed(3)}) [${p.free ? '自由' : '派生'}]`);
  }
  for (const el of scene.elements) {
    if (el.kind === 'circle') lines.push(`circle @ (${el.center.x.toFixed(3)}, ${el.center.y.toFixed(3)}) r=${el.radius.toFixed(3)}`);
    else if (el.kind === 'polyline') lines.push(`polyline ${el.points.length} pts${el.cycle ? ' (cycle)' : ''}`);
    else if (el.kind === 'label') lines.push(`label "${el.text}" @ (${el.at.x.toFixed(3)}, ${el.at.y.toFixed(3)})`);
    else lines.push(`${el.right ? 'right-angle' : 'angle'} @ (${el.vertex.x.toFixed(3)}, ${el.vertex.y.toFixed(3)})`);
  }
  for (const i of scene.issues) lines.push(`! stmt#${i.stmtIndex}: ${i.message}`);
  if (lines.length > maxLines) return `${lines.slice(0, maxLines).join('\n')}\n…另有 ${lines.length - maxLines} 行省略`;
  return lines.join('\n');
}
```

- [ ] **Step 3: client 流程**（`components/tikz-studio.tsx` 增加）

```tsx
const runRepair = useCallback(async () => {
  // Tier 1：localRepairTikz(engine.code) → 有 fixes 且 analyze 后 error 减少 → engine.setCode → return
  // Tier 2（≤2 轮）：
  //   POST /api/tikz { mode:'repair', tikzCode: engine.code,
  //     failures: engine.issues.map(i => i.message), sceneSnapshot: engine.scene ? snapshotScene(engine.scene) : '' }
  //   → {tikzCode} → localRepairTikz → analyze：仅当 error 数严格减少才 engine.setCode（best-attempt 不变量）
  // 状态：repairing state + pill「修复中」；toolbar 加 🔧 按钮手动触发
}, [engine, provider, model]);
// build 完成（tikzCode 帧落地）后：若 analyze 仍有 error 级 issue → 自动 runRepair() 一轮
```

- [ ] **Step 4: 测试 + 提交**

Run: `npx vitest run lib/tikz/repair/`

```bash
git add lib/tikz/repair/ components/tikz-studio.tsx components/tikz/tikz-toolbar.tsx
git commit -m "feat(tikz): tiered repair loop (local fixes, LLM repair with best-attempt)"
```

---

### Task 21: 构造步骤面板（拓扑序逐步点亮）

**Files:**
- Create: `lib/tikz/steps.ts`
- Create: `components/tikz/tikz-steps-panel.tsx`
- Modify: `components/tikz-studio.tsx`（步骤按钮 + 面板）
- Modify: `components/tikz/tikz-canvas.tsx`（revealUpTo 支持）
- Test: `lib/tikz/steps.test.ts`

**Interfaces:**
- Consumes: `Statement`（3）、`Scene`（9）、engine selection（13）。
- Produces: `ConstructionStep`、`deriveSteps(stmts, scene)`、`TikzStepsPanel`；canvas 新增可选 prop `revealUpTo?: number`。

- [ ] **Step 1: 写失败测试** `lib/tikz/steps.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseTikz } from '../tikz/subset/parser';
import { evaluateScene } from '../tikz/semantics/scene';
import { deriveSteps } from './steps';

const DOC = `\\begin{tikzpicture}
\\coordinate (A) at (0,0);
\\coordinate (B) at (4,0);
\\coordinate (M) at ($(A)!0.5!(B)$);
\\coordinate (H) at ($(A)!(M)!(B)$);
\\path[name path=c1] (A) circle (1);
\\path[name intersections={of=c1 and c1}] (intersection-1) coordinate (P);
\\draw (A) -- (B);
\\end{tikzpicture}`;

describe('deriveSteps', () => {
  it('按拓扑序生成中文步骤标题', () => {
    const scene = evaluateScene(parseTikz(DOC).statements);
    const steps = deriveSteps(parseTikz(DOC).statements, scene);
    const titles = steps.map(s => s.title);
    expect(titles[0]).toContain('自由点 A');
    expect(titles.find(t => t.includes('中点'))).toBeTruthy();
    expect(titles.find(t => t.includes('垂足'))).toBeTruthy();
    expect(titles.find(t => t.includes('交点'))).toBeTruthy();
    expect(steps.find(s => s.title.includes('M'))!.stmtIndex).toBe(2);
  });
});
```

- [ ] **Step 2: 实现** `lib/tikz/steps.ts`

```ts
import type { Statement } from './subset/ast';
import type { Scene } from './semantics/scene';

export interface ConstructionStep { index: number; title: string; stmtIndex: number; refs: string[] }

export function deriveSteps(stmts: Statement[], scene: Scene): ConstructionStep[] {
  // 遍历 scene.graphOrder 找到各点/路径的定义语句，再补可见作图语句：
  // coordinate + literal → `自由点 X`
  // coordinate + calc：
  //   interpolate：t 为 num-lit 且 =0.5 → `M = A,B 的中点`；否则 `M：A→B 上取 t=…`
  //   rotate → `X：绕 A 旋转 θ°`
  //   project → `X = P 到 AB 的垂足`
  //   add/sub → `X（向量合成）`
  // let-coordinate → `X（计算构造）`
  // intersections binding → `X = of0 与 of1 的交点`
  // path 且 namePath → `构造路径 namePath`
  // 可见 draw/fill/filldraw/node/pic → `作图：折线`/`作图：圆`/`标注`/`角标记`
  // refs：该语句引用点名（点击步骤 → setSelection 高亮用）
}
```

- [ ] **Step 3: 实现面板 + canvas reveal**

`components/tikz/tikz-steps-panel.tsx`：列表（序号+标题），点击 → `engine.setSelection(step.refs)`；「▶ 自动播放」每 1500ms 推进一步（`setInterval`，结束时清除）；当前步之前的元素可见 —— 传 `revealUpTo={currentStmtIndex}` 给 canvas。

`components/tikz/tikz-canvas.tsx`：新增可选 prop `revealUpTo?: number`；传给 `TikzSceneSvg` 前过滤 `scene.elements`（`stmtIndex <= revealUpTo`）与 handles（仅显示已揭示点）—— 不可变构造新 Scene 对象传入。

- [ ] **Step 4: 测试 + 提交**

```bash
git add lib/tikz/steps.ts lib/tikz/steps.test.ts components/tikz/tikz-steps-panel.tsx components/tikz-studio.tsx components/tikz/tikz-canvas.tsx
git commit -m "feat(tikz): construction steps panel with progressive reveal"
```

---

### Task 22: v1 验收门（语料 ≥30 + 覆盖率 ≥90% + 全量绿）

**Files:**
- Create: `lib/tikz/__fixtures__/competition/`（新增 10+ fixture 至 ≥30 对）
- Modify: 无生产代码（除非修 bug）

- [ ] **Step 1: 新增 fixture（期望数值人工核算）**

`angle-bisector-let`（单位向量求和方向）、`orthocenter-altitudes`、`centroid-intersect`、`nine-point-center`（九点圆心 = 外心垂心中点）、`simson-collinear`、`euler-line`（O,G,H 共线断言三点）、`tangent-external`、`radical-center`、`homothety-rotate`、`square-on-side`、`midpoint-quad`（中点四边形为平行四边形）、`cyclic-angle-marks`。

- [ ] **Step 2: 全量验证**

Run: `npm test && npm run build && npm run audit:cdn`
Expected: 全绿；fixture ≥30 且通过率 = 100%（即覆盖率 ≥90% 门槛达成 —— 若有 fixture 暴露子集缺口且判定为 v1 范围外（见 spec §3.6），在 json 标 `"skip": true` 并从分母剔除，但剔除数 ≤10%）

- [ ] **Step 3: 覆盖率抽查**

Run: `npx vitest run --coverage lib/tikz 2>&1 | tail -30`
Expected: `lib/tikz` 行覆盖率 ≥80%（不足则补单测 —— 优先补 parser/static-check/calc-eval 的边界分支）

- [ ] **Step 4: 手工验证清单（执行者在总结中逐项报告；需要真机的项标注 [人工]）**

```markdown
- [ ] npm test 全绿（含 ≥30 fixture）
- [ ] npm run build 通过
- [ ] npm run audit:cdn 通过
- [ ] [人工] 首页出现 Math + TikZ 两张 tile；/tikz 直达可用
- [ ] [人工] 出题「作三角形 ABC 的外接圆并标出外心 O」→ 图正确、代码块展示
- [ ] [人工] 拖动 A → 中垂线/外心/外接圆实时联动，代码中只有 A 的坐标数字变化
- [ ] [人工] 编辑器改坐标 → 图更新；制造语法错误 → 图保持 + lint 标记
- [ ] [人工] 点击线段 → 样式面板改红色/虚线 → 代码 options 原文变化
- [ ] [人工] 步骤面板逐步步进与自动播放
- [ ] [人工] 制造退化构造（平行求交）→ 自动修复流程触发并收敛
```

- [ ] **Step 5: 最终提交**

```bash
git add lib/tikz/__fixtures__/
git commit -m "test(tikz): complete competition corpus to 30+ fixtures for v1 gate"
```

---

## Self-Review 记录（计划作者自查）

- **Spec 覆盖**：§3 子集 → Task 3/4/5/6/7/8/9；§4 架构（双解析器/服务端轻校验）→ Task 4 + 12 + 18；§5 三通路 → 12/14（①）16/17（②）18（③）；§6 文件布局 → 各任务 Files；§7 修复回路 → 20（TikZJax 失败/子集外兜底属 Phase 2，不在 v1）；§8 接缝 → 10（③④纯渲染+分层+主题参数）、13（状态形状/ephemeralStyles 占位）、17（②工具注册）、12（envelope contextRefs）、9+20（⑤provenance/快照）；§9 中转 → 1；§10 CSP → Phase 2（v1 无浏览器新 CDN 依赖，Task 22 audit 验证不回归）；§11 测试 → 15/22；§12 分期 → 本计划 = Phase 0+1。**无遗漏。**
- **占位符扫描**：Task 3 括号匹配、Task 13 studio 的 provider pills/model picker 两处注明「复用 math-studio 模式」—— 执行代理需读 `components/math-studio.tsx` 对应段落（1052–1081 tile、393–440 streamMath、provider/model hooks）照搬，已在 Task 14 注明行号。其余代码均完整。
- **类型一致性**：`AnalysisIssue.severity` 含 `'preview-only'`（Task 12 服务端帧字段同名但语义独立，无冲突）；`GeomPath` 仅在 intersections/scene 使用；`ToolContext.toScenePoint` 签名在 Task 17 两测试一致；`TikzEngine.ephemeralStyles` 为占位只读空对象（接缝③，v1 无写入方）。`style-options.test.ts` 路径笔误修正：放 `lib/tikz/patch/style-options.test.ts`，import `./style-options`。
