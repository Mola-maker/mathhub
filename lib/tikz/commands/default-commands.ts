import {
  CommandRegistry,
  type CommandDefinition,
} from './command-registry';

export interface DefaultCommandContext extends Record<string, unknown> {
  closeStudio?: () => unknown;
  togglePalette?: () => unknown;
  activateTool?: (toolId: string) => unknown;
  finishConstruction?: () => unknown;
  backConstruction?: () => unknown;
  deleteSelection?: () => unknown;
  activeConstruction?: boolean;
  hasSelection?: boolean;
}

const activeConstruction = {
  key: 'construction-active',
  test: ({ context }: { context: DefaultCommandContext }) => Boolean(context.activeConstruction),
};

const hasSelection = {
  key: 'selection-present',
  test: ({ context }: { context: DefaultCommandContext }) => Boolean(context.hasSelection),
};

interface ToolShortcut {
  id: string;
  label: string;
  shortcut: string;
}

/**
 * Stable, non-overlapping activation chords.  These are intentionally kept
 * independent of the construction catalog's legacy one-letter hints so the
 * registry can diagnose and prevent collisions before UI wiring occurs.
 */
export const DEFAULT_TOOL_SHORTCUTS: readonly ToolShortcut[] = [
  { id: 'select', label: '选择/拖拽', shortcut: 'V' },
  { id: 'pan', label: '平移画布', shortcut: 'H' },
  { id: 'point', label: '自由点', shortcut: 'P' },
  { id: 'segment', label: '线段', shortcut: 'L' },
  { id: 'vector', label: '向量', shortcut: 'Shift+V' },
  { id: 'line', label: '直线', shortcut: 'Shift+L' },
  { id: 'ray', label: '射线', shortcut: 'Shift+R' },
  { id: 'polyline', label: '折线', shortcut: 'Shift+G' },
  { id: 'polygon', label: '多边形', shortcut: 'G' },
  { id: 'rectangle', label: '矩形', shortcut: 'Q' },
  { id: 'circle', label: '圆', shortcut: 'C' },
  { id: 'label', label: '标注', shortcut: 'T' },
  { id: 'angle', label: '角', shortcut: 'A' },
  { id: 'right-angle', label: '直角', shortcut: 'R' },
  { id: 'midpoint', label: '中点', shortcut: 'M' },
  { id: 'perpendicular-foot', label: '垂足', shortcut: 'F' },
  { id: 'point-on-circle', label: '圆上点', shortcut: 'D' },
  { id: 'parallel-line', label: '平行线', shortcut: 'K' },
  { id: 'perpendicular-line', label: '垂线', shortcut: 'N' },
  { id: 'perpendicular-bisector', label: '中垂线', shortcut: 'B' },
  { id: 'angle-bisector', label: '角平分线', shortcut: 'Shift+B' },
  { id: 'circumcircle', label: '三点圆', shortcut: 'O' },
  { id: 'tangent-at-point', label: '切线', shortcut: 'J' },
  { id: 'reflect-point', label: '点反射', shortcut: 'X' },
  { id: 'reflect-line', label: '轴反射', shortcut: 'Shift+X' },
  { id: 'rotate-90', label: '旋转 90°', shortcut: 'E' },
  { id: 'homothety-2', label: '位似 ×2', shortcut: 'S' },
  { id: 'inversion-point', label: '反演点', shortcut: 'I' },
  { id: 'radical-axis', label: '根轴', shortcut: 'Y' },
  { id: 'cyclic-quadrilateral', label: '圆内接四边形', shortcut: 'U' },
  { id: 'complete-quadrilateral', label: '完全四边形', shortcut: 'Shift+U' },
];

export function shortcutForTool(toolId: string): string | undefined {
  return DEFAULT_TOOL_SHORTCUTS.find((tool) => tool.id === toolId)?.shortcut;
}

function toolActivationCommand(tool: ToolShortcut): CommandDefinition<DefaultCommandContext> {
  return {
    id: `tool.activate.${tool.id}`,
    title: `激活${tool.label}`,
    scope: 'canvas',
    allowInEditable: false,
    shortcuts: [tool.shortcut],
    execute: (context) => context.activateTool?.(tool.id),
  };
}

export const DEFAULT_COMMANDS: readonly CommandDefinition<DefaultCommandContext>[] = [
  {
    id: 'studio.close',
    title: '关闭画板',
    scope: 'studio',
    priority: 10,
    allowInEditable: true,
    shortcuts: ['Escape'],
    execute: (context) => context.closeStudio?.(),
  },
  {
    id: 'palette.toggle',
    title: '切换命令面板',
    scope: 'global',
    priority: 100,
    allowInEditable: true,
    shortcuts: ['Mod+K'],
    execute: (context) => context.togglePalette?.(),
  },
  {
    id: 'construction.finish',
    title: '完成构造',
    scope: 'canvas',
    priority: 90,
    when: activeConstruction,
    shortcuts: ['Enter'],
    execute: (context) => context.finishConstruction?.(),
  },
  {
    id: 'construction.back',
    title: '撤回上一个输入',
    scope: 'canvas',
    priority: 90,
    when: activeConstruction,
    shortcuts: ['Escape'],
    execute: (context) => context.backConstruction?.(),
  },
  {
    id: 'selection.delete',
    title: '删除选中图元',
    scope: 'canvas',
    priority: 100,
    when: hasSelection,
    shortcuts: ['Delete', 'Backspace'],
    execute: (context) => context.deleteSelection?.(),
  },
  ...DEFAULT_TOOL_SHORTCUTS.map(toolActivationCommand),
];

export function createDefaultCommandRegistry(): CommandRegistry<DefaultCommandContext> {
  const registry = new CommandRegistry<DefaultCommandContext>();
  registry.registerMany(DEFAULT_COMMANDS);
  return registry;
}
