import type { ConstructionIntent } from '../authoring/construction-intent';
import type { GeometryAiContext } from '../ir/ai-context';
import type { AiManagedPresentationIntent } from '../ir/ai-managed-presentation-intent';
import type { HostSemanticActionBatch } from '../ir/host-semantic-action-batch';
import type { HostSemanticActionSet } from '../ir/host-semantic-action-set';

export type HostSemanticAction =
  | { readonly fence: 'tikz-managed-presentation'; readonly payload: AiManagedPresentationIntent }
  | { readonly fence: 'tikz-construction-intent'; readonly payload: ConstructionIntent }
  | { readonly fence: 'host-semantic-action-batch'; readonly payload: HostSemanticActionBatch }
  | { readonly fence: 'host-semantic-action-set'; readonly payload: HostSemanticActionSet };

type ManagedStyle = AiManagedPresentationIntent['operation']['style'];
type MutableManagedStyle = {
  -readonly [Key in keyof ManagedStyle]: ManagedStyle[Key];
};

function managedStyle(
  problem: string,
): AiManagedPresentationIntent['operation']['style'] | null {
  const style: MutableManagedStyle = {};
  const colors: readonly [RegExp, NonNullable<ManagedStyle['color']>][] = [
    [/(?:\u7ea2\u8272?|\bred\b)/iu, 'red'],
    [/(?:\u84dd\u8272?|\bblue\b)/iu, 'blue'],
    [/(?:\u7eff\u8272?|\bgreen\b)/iu, 'green'],
    [/(?:\u6a59\u8272?|\borange\b)/iu, 'orange'],
    [/(?:\u7d2b\u8272?|\bpurple\b)/iu, 'purple'],
    [/(?:\u7070\u8272?|\bgr[ae]y\b)/iu, 'gray'],
    [/(?:\u68d5\u8272?|\bbrown\b)/iu, 'brown'],
    [/(?:\u9ed1\u8272?|\bblack\b)/iu, 'black'],
  ];
  const color = colors.find(([pattern]) => pattern.test(problem));
  if (color) style.color = color[1];
  if (/(?:\u8d85\u7c97|ultra\s+thick)/iu.test(problem)) style.width = 'ultra thick';
  else if (/(?:\u5f88\u7c97|\u7c97\u7ebf|\u52a0\u7c97|very\s+thick)/iu.test(problem)) {
    style.width = 'very thick';
  } else if (/(?:\u7a0d\u7c97|\bthick\b)/iu.test(problem)) style.width = 'thick';
  else if (/(?:\u7ec6\u7ebf|\bthin\b)/iu.test(problem)) style.width = 'thin';
  if (/(?:\u5bc6\u865a\u7ebf|densely\s+dashed)/iu.test(problem)) style.dash = 'densely dashed';
  else if (/(?:\u865a\u7ebf|\bdashed\b)/iu.test(problem)) style.dash = 'dashed';
  else if (/(?:\u70b9\u7ebf|\u70b9\u72b6|\bdotted\b)/iu.test(problem)) style.dash = 'dotted';
  return Object.keys(style).length > 0 ? style : null;
}

function annotationText(problem: string): string | null {
  const quoted = /[\u201c\u300c\u300e"']([^\u201d\u300d\u300f"']{1,80})[\u201d\u300d\u300f"']/u.exec(problem)?.[1];
  const written = /(?:\u5199\u4e0a|\u6807\u4e3a|\u547d\u540d\u4e3a)\s*([^,\uff0c.\u3002;\uff1b\n]{1,80})/u.exec(problem)?.[1];
  const text = (quoted ?? written ?? (
    /(?:\u4e5d\u70b9\u5706|nine[\s-]?point\s+circle|euler\s+circle)/iu.test(problem)
      ? '\u4e5d\u70b9\u5706'
      : ''
  )).trim();
  if (
    text.length === 0
    || text.length > 80
    || /[\\{}%\r\n]/u.test(text)
  ) return null;
  return text;
}

function actionId(prefix: string, revision: number, target: string): string {
  const safeTarget = target.replace(/[^A-Za-z0-9_-]+/gu, '-').slice(-72);
  return `${prefix}-${revision}-${safeTarget}`;
}

function requestedNamedLabels(problem: string): readonly string[] {
  if (!/(?:\u6807\u7b7e|\u6807\u6ce8|label|annotat(?:e|ion))/iu.test(problem)) return [];
  const names = problem.match(/(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9_]{0,15}(?![A-Za-z0-9_])/gu)
    ?? [];
  return [...new Set(names)].slice(0, 16);
}

function labelIntentForEntity(
  context: GeometryAiContext,
  insertion: GeometryAiContext['construction']['sourceBindings'][number],
  binding: GeometryAiContext['construction']['sourceBindings'][number],
  entityId: string,
  text: string,
): ConstructionIntent | null {
  if (
    context.basis.hashAlgorithm !== 'fnv1a64-utf8'
    || !insertion.createCapabilityFingerprint
  ) return null;
  const id = actionId('host-label', context.basis.revision, `${entityId}-${text}`);
  return {
    schemaVersion: 'construction-intent/v1',
    intentId: id,
    idempotencyKey: id,
    basis: {
      ...context.basis,
      hashAlgorithm: 'fnv1a64-utf8',
      kernelHash: context.basis.kernelHash!,
      projectionHash: context.basis.projectionHash!,
      pluginSetDigest: context.basis.pluginSetDigest!,
      constructionCatalogDigest: context.construction.constructionCatalogDigest,
    },
    operation: 'create',
    capability: {
      bindingId: insertion.id,
      fingerprint: insertion.createCapabilityFingerprint,
      scopeFingerprint: context.construction.authorizationScopeFingerprint,
    },
    toolId: 'label',
    bindingIds: [binding.id],
    requestedNames: {},
    parameters: { text },
  };
}

/**
 * Deterministic high-confidence actions for follow-up edits whose semantic
 * target is already unique in the server-attested focus. This is an Agent
 * tool fast path, not a second source truth: the returned intent still goes
 * through the ordinary compiler, client cross-check and Broker replay.
 */
export function hostSemanticActionForRequest(
  problem: string,
  context: GeometryAiContext,
): HostSemanticAction | null {
  const style = managedStyle(problem);
  const requestsLabel = /(?:\u6807\u7b7e|\u6807\u6ce8|label|annotat(?:e|ion))/iu.test(problem);
  const presentationCandidates = context.construction.sourceBindings.flatMap((binding) => (
    binding.writeCapabilities.includes('update-managed-presentation')
      ? (binding.managedPresentationTargets ?? []).flatMap((target) => (
        context.focus.resolvedEntityIds.includes(target.entityId)
          ? [{ binding, target }]
          : []
      ))
      : []
  ));
  let styleAction: Extract<HostSemanticAction, { fence: 'tikz-managed-presentation' }> | null = null;
  if (style && presentationCandidates.length === 1) {
    const { binding, target } = presentationCandidates[0]!;
    if (!binding.managedConstructionId) return null;
    const id = actionId('host-style', context.basis.revision, target.entityId);
    styleAction = {
      fence: 'tikz-managed-presentation',
      payload: {
        schemaVersion: 'managed-presentation-intent/v1',
        intentId: id,
        idempotencyKey: id,
        basis: context.basis,
        focusBindingIds: [binding.id],
        readBindingIds: [binding.id],
        operation: {
          kind: 'set-managed-style',
          bindingId: binding.id,
          sourceId: binding.sourceId,
          constructionId: binding.managedConstructionId,
          targetEntityId: target.entityId,
          style,
        },
        rationale: 'Host-resolved unique managed presentation target.',
      },
    };
  }

  if (!requestsLabel) return styleAction;
  const namedLabels = requestedNamedLabels(problem).filter((name) => (
    context.entities.some((entity) => entity.name === name)
  ));
  const sharedInsertion = context.construction.sourceBindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
    && binding.writeCapabilities.includes('create-managed-construction')
    && binding.createCapabilityFingerprint
  ));
  const sharedLabelTool = context.construction.intentTools.find((tool) => (
    tool.toolId === 'label'
    && tool.parameterSchema === 'label-text'
    && tool.minInputs === 1
    && tool.maxInputs === 1
  ));
  if (namedLabels.length > 1 && sharedInsertion && sharedLabelTool) {
    const labelIntents = namedLabels.flatMap((name) => {
      const entities = context.entities.filter((entity) => (
        entity.name === name
        && context.focus.resolvedEntityIds.includes(entity.id)
      ));
      if (entities.length !== 1) return [];
      const entity = entities[0]!;
      const bindings = context.construction.sourceBindings.filter((binding) => (
        binding.id !== sharedInsertion.id
        && binding.entityIds.length === 1
        && binding.entityIds[0] === entity.id
      ));
      if (bindings.length !== 1) return [];
      const intent = labelIntentForEntity(
        context,
        sharedInsertion,
        bindings[0]!,
        entity.id,
        name,
      );
      return intent ? [intent] : [];
    });
    if (labelIntents.length !== namedLabels.length || !styleAction) return null;
    const actionSetId = actionId(
      'host-style-label-set',
      context.basis.revision,
      namedLabels.join('-'),
    );
    return {
      fence: 'host-semantic-action-set',
      payload: {
        schemaVersion: 'host-semantic-action-set/v1',
        actionSetId,
        idempotencyKey: actionSetId,
        styleIntent: styleAction.payload,
        labelIntents,
      },
    };
  }
  const text = annotationText(problem);
  const centerCandidates = context.entities.filter((entity) => (
    entity.kind === 'point'
    && entity.tags?.includes('center')
    && context.focus.resolvedEntityIds.includes(entity.id)
  ));
  const insertion = context.construction.sourceBindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
    && binding.writeCapabilities.includes('create-managed-construction')
    && binding.createCapabilityFingerprint
  ));
  const center = centerCandidates[0];
  const centerBindings = center ? context.construction.sourceBindings.filter((binding) => (
    binding.entityIds.length === 1
    && binding.entityIds[0] === center.id
    && binding.id !== insertion?.id
  )) : [];
  const labelTool = context.construction.intentTools.find((tool) => (
    tool.toolId === 'label'
    && tool.parameterSchema === 'label-text'
    && tool.minInputs === 1
    && tool.maxInputs === 1
  ));
  if (!text || centerCandidates.length !== 1 || centerBindings.length !== 1 || !insertion || !labelTool) {
    return null;
  }
  if (context.basis.hashAlgorithm !== 'fnv1a64-utf8') return null;
  const id = actionId('host-label', context.basis.revision, center.id);
  const labelAction: Extract<HostSemanticAction, { fence: 'tikz-construction-intent' }> = {
    fence: 'tikz-construction-intent',
    payload: {
      schemaVersion: 'construction-intent/v1',
      intentId: id,
      idempotencyKey: id,
      basis: {
        ...context.basis,
        hashAlgorithm: 'fnv1a64-utf8',
        kernelHash: context.basis.kernelHash!,
        projectionHash: context.basis.projectionHash!,
        pluginSetDigest: context.basis.pluginSetDigest!,
        constructionCatalogDigest: context.construction.constructionCatalogDigest,
      },
      operation: 'create',
      capability: {
        bindingId: 'binding:document:tikzpicture-body-end',
        fingerprint: insertion.createCapabilityFingerprint!,
        scopeFingerprint: context.construction.authorizationScopeFingerprint,
      },
      toolId: 'label',
      bindingIds: [centerBindings[0]!.id],
      requestedNames: {},
      parameters: { text },
    },
  };
  if (!styleAction) return labelAction;
  const ownerBinding = presentationCandidates[0]?.binding;
  if (
    !ownerBinding?.managedConstructionId
    || centerBindings[0]!.managedConstructionId !== ownerBinding.managedConstructionId
  ) return null;
  const batchId = actionId(
    'host-style-label',
    context.basis.revision,
    ownerBinding.managedConstructionId,
  );
  return {
    fence: 'host-semantic-action-batch',
    payload: {
      schemaVersion: 'host-semantic-action-batch/v1',
      batchId,
      idempotencyKey: batchId,
      styleIntent: styleAction.payload,
      labelIntent: labelAction.payload,
    },
  };
}
