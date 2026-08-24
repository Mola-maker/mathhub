import {
  CONSTRUCTION_CATALOG_DIGEST,
  constructionIntentContract,
  constructionSpecRegistry,
} from '../authoring/construction-catalog';
import { hashSource } from '../document/source-hash';
import type { GeometryDoc } from '../ir/geometry-doc';
import type { GeometryEntity, GeometryExpression } from '../ir/model';
import {
  geometryFlowBasisMatches,
  type GeometryFlowBasis,
  type GeometryFlowWidget,
} from './widget-protocol';

export type GeometryFlowStepMode = 'explain' | 'inspect';
type FlowStep = GeometryFlowWidget['steps'][number];

export const GEOMETRY_FLOW_STEP_ACTION_SCHEMA =
  'geometry-flow-step-host-action/v1' as const;

export interface GeometryFlowStepOperation {
  readonly operationId: string;
  readonly toolId: string;
  readonly inputEntityIds: readonly string[];
  readonly existingOutputEntityIds: readonly string[];
}

export interface GeometryFlowStepHostAction {
  readonly schemaVersion: typeof GEOMETRY_FLOW_STEP_ACTION_SCHEMA;
  readonly actionId: string;
  /**
   * A flow card attests an existing construction.  It never grants create,
   * rename, style, transform, or delete authority.
   */
  readonly mode: 'inspect-existing-construction';
  readonly basis: GeometryFlowBasis;
  readonly constructionCatalogDigest: string;
  readonly operations: readonly GeometryFlowStepOperation[];
}

const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function compactLine(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

function expressionEntityIds(expression: GeometryExpression | undefined): string[] {
  if (!expression) return [];
  if (expression.kind === 'entity-reference') return [expression.entityId];
  if (expression.kind !== 'operation') return [];
  return expression.arguments.flatMap(expressionEntityIds);
}

function operationKey(toolId: string, inputEntityIds: readonly string[]): string {
  return `${toolId}\u0000${inputEntityIds.join('\u0000')}`;
}

function actionIdentity(
  basis: GeometryFlowBasis,
  operations: readonly GeometryFlowStepOperation[],
): string {
  return `flow-step-${hashSource(JSON.stringify({
    basis,
    constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    operations,
  }))}`;
}

function validatedOperation(
  toolId: string,
  inputEntityIds: readonly string[],
  existingOutputEntityIds: readonly string[],
  entitiesById: ReadonlyMap<string, GeometryEntity>,
): GeometryFlowStepOperation | null {
  const spec = constructionSpecRegistry.get(toolId);
  if (!spec) return null;
  const contract = constructionIntentContract(spec);
  if (
    inputEntityIds.length < contract.minInputs
    || inputEntityIds.length > contract.maxInputs
    || inputEntityIds.length > 64
    || new Set(inputEntityIds).size !== inputEntityIds.length
    || inputEntityIds.some((entityId) => !ENTITY_ID.test(entityId))
    || existingOutputEntityIds.length === 0
    || existingOutputEntityIds.length > 16
    || new Set(existingOutputEntityIds).size !== existingOutputEntityIds.length
    || existingOutputEntityIds.some((entityId) => !ENTITY_ID.test(entityId))
  ) return null;
  for (let index = 0; index < inputEntityIds.length; index += 1) {
    const accepted = contract.inputKinds[index] ?? contract.repeatedInputKind;
    const inputEntityId = inputEntityIds[index];
    if (!inputEntityId) return null;
    const entity = entitiesById.get(inputEntityId);
    if (!accepted || !entity || entity.kind !== accepted) return null;
  }
  for (const outputId of existingOutputEntityIds) {
    const output = entitiesById.get(outputId);
    if (
      !output
      || output.definition?.kind !== 'operation'
      || output.definition.operator !== toolId
      || expressionEntityIds(output.definition).join('\u0000') !== inputEntityIds.join('\u0000')
    ) return null;
  }
  return {
    operationId: `ensure-${hashSource(operationKey(toolId, inputEntityIds))}`,
    toolId,
    inputEntityIds: [...inputEntityIds],
    existingOutputEntityIds: [...existingOutputEntityIds],
  };
}

/** Resolve a host flow step to closed Catalog operations bound to GeometryDoc. */
export function buildGeometryFlowStepHostAction(
  flow: GeometryFlowWidget,
  step: FlowStep,
  geometryDoc: GeometryDoc | null | undefined,
): GeometryFlowStepHostAction | null {
  if (!geometryDoc || !geometryFlowBasisMatches(flow, geometryDoc.basis)) return null;
  const toolId = step.constructionToolId;
  if (!toolId || !constructionSpecRegistry.has(toolId)) return null;
  const refs = new Set((step.entityRefs ?? []).filter((entityId) => ENTITY_ID.test(entityId)));
  if (refs.size === 0) return null;
  const entitiesById = new Map(geometryDoc.semantic.ir.entities.map((entity) => [entity.id, entity]));
  const grouped = new Map<string, { inputs: string[]; outputs: string[] }>();
  for (const outputId of refs) {
    const output = entitiesById.get(outputId);
    if (output?.definition?.kind !== 'operation' || output.definition.operator !== toolId) continue;
    const inputs = expressionEntityIds(output.definition);
    if (inputs.length === 0 || inputs.some((entityId) => !refs.has(entityId))) continue;
    const key = operationKey(toolId, inputs);
    const group = grouped.get(key) ?? { inputs, outputs: [] };
    group.outputs.push(outputId);
    grouped.set(key, group);
  }
  const operations = [...grouped.values()].flatMap((group) => {
    const operation = validatedOperation(toolId, group.inputs, group.outputs, entitiesById);
    return operation ? [operation] : [];
  });
  if (operations.length === 0 || operations.length > 16) return null;
  const basis = flow.basis!;
  return {
    schemaVersion: GEOMETRY_FLOW_STEP_ACTION_SCHEMA,
    actionId: actionIdentity(basis, operations),
    mode: 'inspect-existing-construction',
    basis,
    constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    operations,
  };
}

/** Re-attest a browser-supplied action against the current GeometryDoc. */
export function validateGeometryFlowStepHostAction(
  value: unknown,
  geometryDoc: GeometryDoc | null | undefined,
): GeometryFlowStepHostAction | null {
  if (!geometryDoc || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GeometryFlowStepHostAction>;
  if (
    candidate.schemaVersion !== GEOMETRY_FLOW_STEP_ACTION_SCHEMA
    || candidate.mode !== 'inspect-existing-construction'
    || candidate.constructionCatalogDigest !== CONSTRUCTION_CATALOG_DIGEST
    || !candidate.basis
    || !geometryFlowBasisMatches(
      { kind: 'geometry-flow', title: 'host', basis: candidate.basis, steps: [] },
      geometryDoc.basis,
    )
    || !Array.isArray(candidate.operations)
    || candidate.operations.length === 0
    || candidate.operations.length > 16
  ) return null;
  const entitiesById = new Map(geometryDoc.semantic.ir.entities.map((entity) => [entity.id, entity]));
  const operations: GeometryFlowStepOperation[] = [];
  const operationIds = new Set<string>();
  for (const raw of candidate.operations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const operation = raw as Partial<GeometryFlowStepOperation>;
    if (
      typeof operation.operationId !== 'string'
      || operationIds.has(operation.operationId)
      || typeof operation.toolId !== 'string'
      || !Array.isArray(operation.inputEntityIds)
      || !operation.inputEntityIds.every((item): item is string => typeof item === 'string')
      || !Array.isArray(operation.existingOutputEntityIds)
      || !operation.existingOutputEntityIds.every((item): item is string => typeof item === 'string')
    ) return null;
    const validated = validatedOperation(
      operation.toolId,
      operation.inputEntityIds,
      operation.existingOutputEntityIds,
      entitiesById,
    );
    if (!validated || validated.operationId !== operation.operationId) return null;
    operationIds.add(validated.operationId);
    operations.push(validated);
  }
  const basis: GeometryFlowBasis = {
    documentId: geometryDoc.basis.documentId,
    epoch: geometryDoc.basis.epoch,
    revision: geometryDoc.basis.revision,
    sourceHash: geometryDoc.basis.sourceHash,
    ...(geometryDoc.basis.kernelHash
      ? { kernelHash: geometryDoc.basis.kernelHash }
      : {}),
    ...(geometryDoc.basis.projectionHash
      ? { projectionHash: geometryDoc.basis.projectionHash }
      : {}),
    ...(geometryDoc.basis.pluginSetDigest
      ? { pluginSetDigest: geometryDoc.basis.pluginSetDigest }
      : {}),
  };
  const actionId = actionIdentity(basis, operations);
  if (candidate.actionId !== actionId) return null;
  return {
    schemaVersion: GEOMETRY_FLOW_STEP_ACTION_SCHEMA,
    actionId,
    mode: 'inspect-existing-construction',
    basis,
    constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    operations,
  };
}

export function geometryFlowStepActionDraft(action: GeometryFlowStepHostAction): string {
  return [
    `请只读复核当前动态推导步骤（已绑定 ${action.operations.length} 个宿主语义操作）。`,
    '根据类型化宿主动作与当前 GeometryDoc 解释输入、已有输出和依赖关系。',
    '本轮不要创建、重命名、改样式、变换或删除任何画板对象。',
    '不要在聊天正文展开大段 TikZ 代码。',
  ].join('\n');
}

export function geometryFlowStepExplanationDraft(
  flow: GeometryFlowWidget,
  step: FlowStep,
): string {
  return [
    '解释该步骤使用的几何关系、当前画板证据与下一步推导；本轮不要修改画板。',
    `只读推导标题：${compactLine(flow.title, 160)}。`,
    `只读步骤标题：${compactLine(step.title, 160)}。`,
    `只读步骤说明：${compactLine(step.explanation, 900)}`,
    '不要在聊天正文展开大段 TikZ 代码。',
  ].join('\n');
}

export function canOfferGeometryFlowStepAction(
  flow: GeometryFlowWidget,
  step: FlowStep,
): boolean {
  return Boolean(
    flow.basis
    && step.constructionToolId
    && constructionSpecRegistry.has(step.constructionToolId)
    && step.entityRefs?.some((entityId) => ENTITY_ID.test(entityId)),
  );
}
