/** Drawing modes sent to POST /api/math (default: draw). */
export type DrawingCommand =
  | 'draw'
  | 'continue'
  | 'draw_steps'
  | 'translate_tikz'
  | 'solve_optional'
  | 'algebra';

/** Client-only meta commands — no LLM call. */
export type MetaCommand = 'model' | 'status' | 'rulesggb';

export type StudioCommand = DrawingCommand | MetaCommand;

export type ParsedStudioInput =
  | { kind: 'meta'; command: MetaCommand; raw: string }
  | { kind: 'drawing'; command: DrawingCommand; body: string; raw: string }
  | { kind: 'plain'; command: DrawingCommand; body: string; raw: string };

export type CommandSpec = {
  name: StudioCommand;
  label: string;
  summary: string;
  usage: string;
  meta?: boolean;
};

export const STUDIO_COMMANDS: CommandSpec[] = [
  {
    name: 'draw',
    label: '/draw',
    summary: '核心绘图（默认）— 完整精确复现题目图形，说明极简',
    usage: '/draw [题目描述…]',
  },
  {
    name: 'continue',
    label: '/continue',
    summary: '续画 — 在现有画布上补充/修正（也可写：基础上|继续|补充|修改|保留图）',
    usage: '/continue [补充说明…]',
  },
  {
    name: 'draw_steps',
    label: '/draw_steps',
    summary: '分步/分色展示作图或证明过程（SetColor 分层）',
    usage: '/draw_steps [题目或过程描述…]',
  },
  {
    name: 'translate_tikz',
    label: '/translate_tikz',
    summary: '将 TikZ/tkz 语义翻译为 GeoGebra，禁止 echo TikZ',
    usage: '/translate_tikz\n\\begin{tikzpicture}…',
  },
  {
    name: 'solve_optional',
    label: '/solve_optional',
    summary: '简要解答/证明，但 GeoGebra 图仍须完整',
    usage: '/solve_optional [题目…]',
  },
  {
    name: 'algebra',
    label: '/algebra',
    summary: '纯代数/CAS，可不输出 GGB',
    usage: '/algebra [算式或方程…]',
  },
  {
    name: 'model',
    label: '/model',
    summary: '返回当前选中的作图模型',
    usage: '/model',
    meta: true,
  },
  {
    name: 'status',
    label: '/status',
    summary: '返回 Studio 状态与上下文数量',
    usage: '/status',
    meta: true,
  },
  {
    name: 'rulesggb',
    label: '/rulesggb',
    summary: '返回 GeoGebra 官方命令规范与完整命令索引',
    usage: '/rulesggb',
    meta: true,
  },
];

const COMMAND_NAMES = new Set(STUDIO_COMMANDS.map((c) => c.name));

const DEFAULT_DRAWING_COMMAND: DrawingCommand = 'draw';

export function isDrawingCommand(name: string): name is DrawingCommand {
  return name === 'draw'
    || name === 'continue'
    || name === 'draw_steps'
    || name === 'translate_tikz'
    || name === 'solve_optional'
    || name === 'algebra';
}

export function isMetaCommand(name: string): name is MetaCommand {
  return name === 'model' || name === 'status' || name === 'rulesggb';
}

export function isStudioCommand(name: string): name is StudioCommand {
  return COMMAND_NAMES.has(name as StudioCommand);
}

/** Parse leading `/command` from user input. Plain text → default `draw`. */
export function parseStudioInput(raw: string): ParsedStudioInput {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) {
    return {
      kind: 'plain',
      command: DEFAULT_DRAWING_COMMAND,
      body: trimmed,
      raw: trimmed,
    };
  }

  const match = trimmed.match(/^\/([a-z_]+)\s*([\s\S]*)$/);
  if (!match) {
    return {
      kind: 'plain',
      command: DEFAULT_DRAWING_COMMAND,
      body: trimmed,
      raw: trimmed,
    };
  }

  const [, name, rest] = match;
  if (!isStudioCommand(name)) {
    return {
      kind: 'plain',
      command: DEFAULT_DRAWING_COMMAND,
      body: trimmed,
      raw: trimmed,
    };
  }

  if (isMetaCommand(name)) {
    return { kind: 'meta', command: name, raw: trimmed };
  }

  return {
    kind: 'drawing',
    command: name,
    body: rest.trim(),
    raw: trimmed,
  };
}

/** Commands whose body may be empty (mode-only). */
export function allowsEmptyBody(command: DrawingCommand): boolean {
  return command === 'draw' || command === 'continue';
}

export function formatCommandPaletteHelp(filter = ''): string {
  const q = filter.trim().toLowerCase();
  const rows = STUDIO_COMMANDS.filter(
    (c) => !q || c.name.includes(q) || c.label.includes(q) || c.summary.includes(q),
  );
  const lines = [
    '**Math Studio 斜杠命令**（输入 `/` 唤起）',
    '',
    ...rows.map((c) => `- **${c.label}** — ${c.summary}\n  \`${c.usage}\``),
    '',
    '未加前缀时默认为 `/draw`。',
  ];
  return lines.join('\n');
}

export function filterCommandSpecs(query: string): CommandSpec[] {
  const q = query.replace(/^\//, '').trim().toLowerCase();
  if (!q) return STUDIO_COMMANDS;
  return STUDIO_COMMANDS.filter(
    (c) => c.name.startsWith(q) || c.label.slice(1).startsWith(q),
  );
}

export function commandRequiresGgb(command: DrawingCommand): boolean {
  return command !== 'algebra';
}

export function commandUsesContinuationCanvas(command: DrawingCommand): boolean {
  return command === 'continue' || command === 'draw_steps';
}
