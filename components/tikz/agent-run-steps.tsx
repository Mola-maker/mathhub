import { motion } from 'motion/react';
import type { TikzAgentEvent } from '@/lib/tikz/agent/protocol';
import type { TikzAgentToolCallState } from '@/lib/tikz/agent/run-reducer';

export function AgentRunSteps({
  steps,
  toolCalls = [],
}: {
  steps: readonly TikzAgentEvent[];
  toolCalls?: readonly TikzAgentToolCallState[];
}) {
  if (steps.length === 0) return null;
  const current = steps.at(-1)!;
  const entries = [
    ...steps
      .filter((step) => !step.type.startsWith('tool.'))
      .map((step) => ({ kind: 'step' as const, sequence: step.sequence, step })),
    ...toolCalls.map((toolCall) => ({
      kind: 'tool' as const,
      sequence: toolCall.firstSequence,
      toolCall,
    })),
  ].sort((left, right) => left.sequence - right.sequence);
  return (
    <details className="tz-agent-timeline">
      <summary>{current.title} · 查看过程（{entries.length} 步）</summary>
      <ol className="tz-agent-steps" aria-label="AI 执行步骤">
        {entries.map((entry) => {
          if (entry.kind === 'tool') {
            const toolCall = entry.toolCall;
            const statusLabel = toolCall.status === 'running'
              ? '运行中'
              : toolCall.status === 'completed'
                ? '已完成'
                : toolCall.status === 'rejected' ? '已拒绝' : '已取消';
            return (
              <motion.li
                key={`tool:${toolCall.toolCallId}`}
                layout
                data-tool-call-id={toolCall.toolCallId}
                className={`tz-agent-step tz-agent-step--tool-${toolCall.status}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <span className="tz-agent-step__dot" aria-hidden="true" />
                <span>
                  <strong>{toolCall.title}</strong>
                  <small>{toolCall.toolName} · {statusLabel}</small>
                  {toolCall.detail ? <small>{toolCall.detail}</small> : null}
                </span>
              </motion.li>
            );
          }
          const step = entry.step;
          return (
            <motion.li
              key={step.eventId}
              layout
              className={`tz-agent-step tz-agent-step--${step.type.replaceAll('.', '-')}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <span className="tz-agent-step__dot" aria-hidden="true" />
              <span>
                <strong>{step.title}</strong>
                {step.detail ? <small>{step.detail}</small> : null}
              </span>
            </motion.li>
          );
        })}
      </ol>
    </details>
  );
}
