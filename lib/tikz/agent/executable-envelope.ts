export type TikzExecutableEnvelopeKind =
  | 'tool'
  | 'plain-action'
  | 'typed-patch'
  | 'typed-plan'
  | 'typed-intent'
  | 'typed-presentation'
  | 'semantic-intent';

export interface TikzExecutableEnvelope {
  readonly kind: TikzExecutableEnvelopeKind;
  readonly body: string;
  readonly start: number;
  readonly end: number;
}

export interface TikzExecutableEnvelopeClassification {
  readonly envelopes: readonly TikzExecutableEnvelope[];
  readonly openingCount: number;
  readonly malformed: boolean;
  readonly toolCount: number;
  readonly plainActionCount: number;
  /** GeometryIntent/v2 is the only model-facing typed write language. */
  readonly semanticIntentCount: number;
  /** Legacy typed envelopes remain readable only for host/Broker compatibility. */
  readonly legacyTypedActionCount: number;
  readonly typedActionCount: number;
}

const LABEL_TO_KIND = {
  'tikz-agent-tool': 'tool',
  'tikz-action': 'plain-action',
  'tikz-patch': 'typed-patch',
  'tikz-construction-plan': 'typed-plan',
  'tikz-construction-intent': 'typed-intent',
  'tikz-managed-presentation': 'typed-presentation',
  'tikz-geometry-intent': 'semantic-intent',
} as const satisfies Readonly<Record<string, TikzExecutableEnvelopeKind>>;

const EXECUTABLE_OPENING = /```(?:tikz-agent-tool|tikz-action|tikz-patch|tikz-construction-plan|tikz-construction-intent|tikz-managed-presentation|tikz-geometry-intent)\b/giu;
const COMPLETE_EXECUTABLE = /```(tikz-agent-tool|tikz-action|tikz-patch|tikz-construction-plan|tikz-construction-intent|tikz-managed-presentation|tikz-geometry-intent)\b(?:[ \t]*\r?\n)?([\s\S]*?)```/giu;

/**
 * Classify every executable model envelope before any one protocol parser is
 * allowed to consume it. This prevents a valid first action from hiding a
 * second, mixed, or unclosed executable block.
 */
export function classifyTikzExecutableEnvelopes(
  output: string,
): TikzExecutableEnvelopeClassification {
  const openingCount = [...output.matchAll(EXECUTABLE_OPENING)].length;
  const envelopes: TikzExecutableEnvelope[] = [];
  for (const match of output.matchAll(COMPLETE_EXECUTABLE)) {
    const label = match[1]!.toLowerCase() as keyof typeof LABEL_TO_KIND;
    envelopes.push({
      kind: LABEL_TO_KIND[label],
      body: (match[2] ?? '').trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  const toolCount = envelopes.filter((item) => item.kind === 'tool').length;
  const plainActionCount = envelopes.filter((item) => item.kind === 'plain-action').length;
  const semanticIntentCount = envelopes.filter((item) => item.kind === 'semantic-intent').length;
  const typedActionCount = envelopes.length - toolCount - plainActionCount;
  const legacyTypedActionCount = typedActionCount - semanticIntentCount;
  return {
    envelopes,
    openingCount,
    malformed: openingCount !== envelopes.length,
    toolCount,
    plainActionCount,
    semanticIntentCount,
    legacyTypedActionCount,
    typedActionCount,
  };
}
