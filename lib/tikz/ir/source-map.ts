import type {
  ConstructionBinding,
  GeometryBindableRecordReference,
  GeometryConstraint,
  GeometryRelation,
  GeometryStyle,
  GeometryTruthSet,
  JsonObject,
} from './model';

export const GEOMETRY_SOURCE_MAP_SCHEMA_VERSION = 'geometry-source-map/v1' as const;

export interface GeometrySourceMapRenderTarget {
  rendererId: string;
  target: string;
  renderRevision: number;
  primitiveIds: readonly string[];
}

export interface GeometrySourceMapEntry {
  id: string;
  bindingId: string;
  sourceId: string;
  range: { start: number; end: number };
  writable: boolean;
  semanticTargets: readonly GeometryBindableRecordReference[];
  entityIds: readonly string[];
  renderTargets: readonly GeometrySourceMapRenderTarget[];
  metadata?: JsonObject;
}

export interface GeometrySourceMap {
  schemaVersion: typeof GEOMETRY_SOURCE_MAP_SCHEMA_VERSION;
  basis: GeometryTruthSet['semantic']['basis'];
  entries: readonly GeometrySourceMapEntry[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function entityIdsForBinding(
  binding: ConstructionBinding,
  constraints: ReadonlyMap<string, GeometryConstraint>,
  relations: ReadonlyMap<string, GeometryRelation>,
  styles: ReadonlyMap<string, GeometryStyle>,
): string[] {
  return unique(binding.targets.flatMap((target) => {
    if (target.recordType === 'entity') return [target.id];
    if (target.recordType === 'constraint') {
      return constraints.get(target.id)?.arguments.flatMap((argument) =>
        argument.entityId ? [argument.entityId] : []) ?? [];
    }
    if (target.recordType === 'relation') {
      return relations.get(target.id)?.participants.flatMap((participant) =>
        participant.entityId ? [participant.entityId] : []) ?? [];
    }
    if (target.recordType === 'style') {
      return styles.get(target.id)?.selector.entityIds ?? [];
    }
    return [];
  }));
}

/**
 * Compose the lossless Source → Semantic → Render mappings already present in
 * the three truth lanes. No lane becomes a second writable document.
 */
export function buildGeometrySourceMap(
  truths: GeometryTruthSet,
): GeometrySourceMap {
  const constraints = new Map(
    truths.semantic.ir.constraints.map((constraint) => [constraint.id, constraint]),
  );
  const relations = new Map(
    truths.semantic.ir.relations.map((relation) => [relation.id, relation]),
  );
  const styles = new Map(
    truths.semantic.ir.styles.map((style) => [style.id, style]),
  );

  const entries = truths.construction.bindings.map((binding) => {
    const entityIds = entityIdsForBinding(
      binding,
      constraints,
      relations,
      styles,
    );
    const renderTargets = truths.rendering.flatMap((rendering) => {
      const primitiveIds = rendering.primitives
        .filter((primitive) =>
          primitive.entityIds.some((entityId) => entityIds.includes(entityId)))
        .map((primitive) => primitive.id)
        .sort();
      return primitiveIds.length > 0
        ? [{
          rendererId: rendering.rendererId,
          target: rendering.target,
          renderRevision: rendering.renderRevision,
          primitiveIds,
        }]
        : [];
    });
    return {
      id: `source-map:${binding.id}`,
      bindingId: binding.id,
      sourceId: binding.source.document.sourceId,
      range: { ...binding.source.range },
      writable: binding.writable,
      semanticTargets: binding.targets.map((target) => ({ ...target })),
      entityIds,
      renderTargets,
      metadata: {
        bindingKind: binding.kind,
        role: binding.role,
      },
    };
  });

  return {
    schemaVersion: GEOMETRY_SOURCE_MAP_SCHEMA_VERSION,
    basis: truths.semantic.basis,
    entries,
  };
}

export function sourceMapEntriesAtOffset(
  sourceMap: GeometrySourceMap,
  sourceId: string,
  offset: number,
): readonly GeometrySourceMapEntry[] {
  return sourceMap.entries.filter((entry) => (
    entry.sourceId === sourceId
    && entry.range.start <= offset
    && offset <= entry.range.end
  ));
}

export function sourceMapEntriesForSemanticRecord(
  sourceMap: GeometrySourceMap,
  target: GeometryBindableRecordReference,
): readonly GeometrySourceMapEntry[] {
  return sourceMap.entries.filter((entry) =>
    entry.semanticTargets.some((candidate) => (
      candidate.recordType === target.recordType
      && candidate.id === target.id
    )));
}

export function sourceMapEntriesForRenderPrimitive(
  sourceMap: GeometrySourceMap,
  rendererId: string,
  primitiveId: string,
): readonly GeometrySourceMapEntry[] {
  return sourceMap.entries.filter((entry) =>
    entry.renderTargets.some((target) => (
      target.rendererId === rendererId
      && target.primitiveIds.includes(primitiveId)
    )));
}
