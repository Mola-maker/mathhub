import type { MetaCommand } from '@/lib/math/math-drawing/commands';
import { formatGgbRulesReference } from '@/lib/math/math-drawing/rules-reference';

export type StudioStatusSnapshot = {
  provider: string;
  model: string | null;
  messageCount: number;
  ggbReady: boolean;
  ggbDrawReady: boolean;
  lastGgbCommandCount: number;
  streaming: boolean;
  lastLookupCommandCount: number | null;
  activeModel: string | null;
};

export function formatMetaCommandResponse(
  command: MetaCommand,
  status: StudioStatusSnapshot,
): string {
  switch (command) {
    case 'model':
      return status.model
        ? `**当前作图模型**\n- Provider: \`${status.provider}\`\n- Model: \`${status.model}\`${status.activeModel && status.activeModel !== status.model ? `\n- 上次请求: \`${status.activeModel}\`` : ''}`
        : `**当前作图模型**\n- Provider: \`${status.provider}\`\n- Model: （Coze bot / 未选择）`;

    case 'status':
      return [
        '**Math Studio 状态**',
        `- 对话消息: ${status.messageCount}`,
        `- GeoGebra 加载: ${status.ggbReady ? '是' : '否'}`,
        `- 可执行作图: ${status.ggbDrawReady ? '是' : '否'}`,
        `- 画布上次成功命令数: ${status.lastGgbCommandCount}`,
        `- 上次 lookup 命中命令数: ${status.lastLookupCommandCount ?? '—'}`,
        `- 流式中: ${status.streaming ? '是' : '否'}`,
        `- 模型: \`${status.model ?? '—'}\``,
      ].join('\n');

    case 'rulesggb':
      return formatGgbRulesReference();

    default:
      return '';
  }
}
