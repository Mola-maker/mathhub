'use client';

import { useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const MAX_RENDERED_PROSE_CHARS = 32_000;
const MAX_ARTIFACTS = 4;
const MAX_ARTIFACT_CHARS = 24_000;
const MAX_CLARIFICATION_CHOICES = 5;
const COMPLETE_FENCE = /```([^\r\n`]*)\r?\n([\s\S]*?)```/gu;
const BARE_TIKZ_DOCUMENT = /\\begin\s*\{\s*tikzpicture\s*\}[\s\S]*?\\end\s*\{\s*tikzpicture\s*\}/giu;
const PRIVILEGED_ARTIFACT_LANGUAGE = /^(?:tikz-agent-|tikz-action$|tikz-patch$|tikz-construction-|tikz-managed-presentation$)/iu;

export interface AssistantCodeArtifact {
  readonly language: string;
  readonly code: string;
  readonly lineCount: number;
  readonly truncated: boolean;
}

export interface AssistantClarificationChoice {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface AssistantMessagePresentation {
  readonly prose: string;
  readonly artifacts: readonly AssistantCodeArtifact[];
  readonly hiddenProtocolArtifacts: number;
  readonly truncated: boolean;
  readonly clarification?: {
    readonly question: string;
    readonly choices: readonly AssistantClarificationChoice[];
  };
}

function compactMarkdownLabel(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function extractClarification(prose: string): {
  prose: string;
  clarification?: AssistantMessagePresentation['clarification'];
} {
  const lines = prose.split(/\r?\n/u);
  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === '') last -= 1;
  if (last < 1) return { prose };

  const bullet = /^\s*(?:[-*\u2022]|\d+[.)])\s+(.+?)\s*$/u;
  const choices: AssistantClarificationChoice[] = [];
  let firstChoice = last + 1;
  for (let index = last; index >= 0 && choices.length < MAX_CLARIFICATION_CHOICES; index -= 1) {
    const match = bullet.exec(lines[index]!);
    if (!match) {
      if (lines[index]!.trim() === '' && choices.length > 0) continue;
      break;
    }
    const label = compactMarkdownLabel(match[1] ?? '');
    if (!label || label.length > 80) return { prose };
    choices.unshift({ id: `choice-${index}`, label, value: label });
    firstChoice = index;
  }
  if (choices.length < 2) return { prose };

  let questionIndex = firstChoice - 1;
  while (questionIndex >= 0 && lines[questionIndex]!.trim() === '') questionIndex -= 1;
  if (questionIndex < 0) return { prose };
  const question = compactMarkdownLabel(lines[questionIndex]!);
  if (
    !question
    || question.length > 240
    || !/(?:[?\uff1f]\s*$|\u8bf7(?:\u9009\u62e9|\u786e\u8ba4|\u6307\u5b9a)|\u4f60\u5e0c\u671b|\u9700\u8981.*\u9009\u62e9|\b(?:which|choose|select|confirm)\b)/iu.test(question)
  ) return { prose };

  return {
    prose: lines.slice(0, questionIndex).join('\n').trim(),
    clarification: { question, choices },
  };
}

/**
 * Build a bounded, display-only view of untrusted model prose. Executable
 * envelopes are never rendered, and ordinary code is separated into a
 * collapsed artifact so it cannot dominate the conversation.
 */
export function presentAssistantMessage(source: string): AssistantMessagePresentation {
  const artifacts: AssistantCodeArtifact[] = [];
  let hiddenProtocolArtifacts = 0;
  let prose = source.replace(COMPLETE_FENCE, (_match, rawLanguage: string, rawCode: string) => {
    const language = rawLanguage.trim().toLowerCase() || 'text';
    if (PRIVILEGED_ARTIFACT_LANGUAGE.test(language)) {
      hiddenProtocolArtifacts += 1;
      return '\n';
    }
    if (artifacts.length < MAX_ARTIFACTS) {
      const code = rawCode.length > MAX_ARTIFACT_CHARS
        ? rawCode.slice(0, MAX_ARTIFACT_CHARS)
        : rawCode;
      artifacts.push({
        language,
        code,
        lineCount: rawCode.split(/\r?\n/u).length,
        truncated: rawCode.length > MAX_ARTIFACT_CHARS,
      });
    }
    return '\n';
  });
  prose = prose.replace(BARE_TIKZ_DOCUMENT, (code) => {
    if (artifacts.length < MAX_ARTIFACTS) {
      artifacts.push({
        language: 'tikz',
        code: code.slice(0, MAX_ARTIFACT_CHARS),
        lineCount: code.split(/\r?\n/u).length,
        truncated: code.length > MAX_ARTIFACT_CHARS,
      });
    }
    return '\n';
  });
  const clarification = extractClarification(prose.trim());
  prose = clarification.prose;
  const truncated = prose.length > MAX_RENDERED_PROSE_CHARS;
  if (truncated) prose = prose.slice(0, MAX_RENDERED_PROSE_CHARS);
  return {
    prose,
    artifacts,
    hiddenProtocolArtifacts,
    truncated,
    ...(clarification.clarification ? { clarification: clarification.clarification } : {}),
  };
}

/** History carries conversational meaning only; UI artifacts are regenerated. */
export function assistantHistoryText(source: string): string {
  const presentation = presentAssistantMessage(source);
  return [
    presentation.prose,
    presentation.clarification
      ? `${presentation.clarification.question}\n${presentation.clarification.choices
        .map((choice) => `- ${choice.value}`)
        .join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n').trim();
}

function AssistantArtifacts({ artifacts }: { artifacts: readonly AssistantCodeArtifact[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (artifacts.length === 0) return null;
  return (
    <div className="tz-answer-artifacts" aria-label="回答附件">
      {artifacts.map((artifact, index) => (
        <details className="tz-answer-artifact" key={`${artifact.language}:${index}`}>
          <summary>
            <span>代码附件</span>
            <small>{artifact.language.toUpperCase()} · {artifact.lineCount} 行</small>
          </summary>
          <pre><code>{artifact.code}</code></pre>
          <button
            type="button"
            onClick={() => {
              const clipboard = globalThis.navigator?.clipboard;
              if (!clipboard) return;
              void clipboard.writeText(artifact.code).then(() => setCopied(index)).catch(() => undefined);
            }}
          >
            {copied === index ? '已复制' : '复制代码'}
          </button>
          {artifact.truncated ? <small>附件过长，仅显示前 24,000 字符。</small> : null}
        </details>
      ))}
    </div>
  );
}

export function AssistantMathMarkdown({
  source,
  className = 'tz-answer__markdown',
}: {
  source: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
        }}
      >
        {source.slice(0, MAX_RENDERED_PROSE_CHARS)}
      </ReactMarkdown>
    </div>
  );
}

export function AssistantMessageContent({
  content,
  pending = false,
  onChooseClarification,
}: {
  content: string;
  pending?: boolean;
  onChooseClarification?(choice: AssistantClarificationChoice): void;
}) {
  const clarificationTitleId = useId();
  const presentation = useMemo(() => presentAssistantMessage(content), [content]);
  const hasDisplayContent = Boolean(
    presentation.prose
    || presentation.artifacts.length > 0
    || presentation.clarification,
  );

  return (
    <div className="tz-answer">
      {presentation.prose ? (
        <AssistantMathMarkdown source={presentation.prose} />
      ) : null}
      {presentation.truncated ? (
        <p className="tz-answer__notice" role="status">回答过长，已在 32,000 字符处截断。</p>
      ) : null}
      {presentation.clarification ? (
        <section className="tz-clarification-card" aria-labelledby={clarificationTitleId}>
          <span className="tz-clarification-card__eyebrow">需要你的选择</span>
          <strong id={clarificationTitleId}>{presentation.clarification.question}</strong>
          <div className="tz-clarification-card__choices" role="group" aria-label="澄清选项">
            {presentation.clarification.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => onChooseClarification?.(choice)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <small>选择只会回填对话输入框，不会直接修改画板。</small>
        </section>
      ) : null}
      <AssistantArtifacts artifacts={presentation.artifacts} />
      {!hasDisplayContent && pending ? (
        <span className="tz-answer__thinking" role="status">正在思考</span>
      ) : null}
      {!hasDisplayContent && !pending ? <span className="tz-answer__empty">已完成</span> : null}
    </div>
  );
}
