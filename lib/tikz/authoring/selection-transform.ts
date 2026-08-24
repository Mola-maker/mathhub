import type { GeometryDoc } from '../ir/geometry-doc';
import { buildDependencyGraph } from '../ir/invalidation';
import { coordinateLiteralPatch, formatCoordNumber } from '../patch/source-patch';
import type { TextPatch } from '../document/source-transaction';
import { analyze } from '../analyze';
import { sourceCoordinateForWorldPoint } from '../subset/coordinate-transform';
import { flattenEllipse } from '../geometry/ellipse';
import { flattenEllipticalArc } from '../geometry/elliptical-arc';

export type SelectionTransform =
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'rotate'; readonly degrees: number; readonly center: { readonly x: number; readonly y: number } | 'selection' }
  | { readonly kind: 'scale'; readonly factor: number; readonly center: { readonly x: number; readonly y: number } | 'selection' }
  | { readonly kind: 'reflect'; readonly lineStart: { readonly x: number; readonly y: number }; readonly lineEnd: { readonly x: number; readonly y: number } };

export type SelectionTransformParameterWrite =
  | {
    readonly kind: 'circle-radius' | 'ellipse-x-radius' | 'ellipse-y-radius';
    readonly semanticEntityId: string;
    readonly range: { readonly start: number; readonly end: number };
    readonly sourceValue: number;
    readonly targetValue: number;
    readonly targetWorldRadius: number;
    readonly insert: string;
  }
  | {
    readonly kind: 'arc-start-angle' | 'arc-end-angle' | 'arc-radius';
    readonly semanticEntityId: string;
    readonly range: { readonly start: number; readonly end: number };
    readonly sourceValue: number;
    readonly targetValue: number;
    readonly targetWorldValue: number;
    readonly insert: string;
  }
  | {
    readonly kind: 'ellipse-rotation';
    readonly semanticEntityId: string;
    readonly range: { readonly start: number; readonly end: number };
    readonly sourceValue: number;
    readonly targetValue: number;
    readonly targetWorldRotationDegrees: number;
    readonly insert: string;
  };

export interface SelectionTransformPlan {
  readonly selectedEntityIds: readonly string[];
  readonly variableEntityIds: readonly string[];
  /** Every semantic entity that can change when the writable drivers move. */
  readonly impactedEntityIds: readonly string[];
  /** Changed dependents outside the explicit selection and its driver points. */
  readonly externalImpactedEntityIds: readonly string[];
  /** Canonical transformed position for every writable driver. */
  readonly targets: readonly {
    readonly semanticEntityId: string;
    readonly pointName: string;
    readonly target: { readonly x: number; readonly y: number };
  }[];
  /** Canonical non-point source slots required for a complete transform. */
  readonly parameterWrites: readonly SelectionTransformParameterWrite[];
  /** Direct-coordinate compatibility patches. Managed drivers are compiled by the selection writer. */
  readonly patches: readonly TextPatch[];
  /** Explicit Broker-replayable transform; selection-relative pivots are resolved. */
  readonly transform: Exclude<SelectionTransform, { kind: 'rotate' | 'scale' }>
    | { readonly kind: 'rotate'; readonly degrees: number; readonly center: { readonly x: number; readonly y: number } }
    | { readonly kind: 'scale'; readonly factor: number; readonly center: { readonly x: number; readonly y: number } };
}

export interface SelectionTransformCapability {
  readonly status: 'ready' | 'warning' | 'blocked';
  readonly selectedEntityIds: readonly string[];
  readonly variableEntityIds: readonly string[];
  readonly impactedEntityIds: readonly string[];
  readonly externalImpactedEntityIds: readonly string[];
  readonly patchCount: number;
  readonly reason?: string;
  readonly plan?: SelectionTransformPlan;
}

export function assertSelectionTransformImpactAcknowledged(
  plan: SelectionTransformPlan,
  acknowledgedExternalImpactedEntityIds: readonly string[] | undefined,
): void {
  if (plan.externalImpactedEntityIds.length === 0) return;
  const acknowledged = [...new Set(acknowledgedExternalImpactedEntityIds ?? [])].sort();
  if (JSON.stringify(acknowledged) !== JSON.stringify(plan.externalImpactedEntityIds)) {
    throw new TypeError(
      `此变换会影响选区外 ${plan.externalImpactedEntityIds.length} 个对象，需要确认完整影响域后才能应用。`,
    );
  }
}

function pointPosition(entity: GeometryDoc['semantic']['ir']['entities'][number]) {
  const x = entity.parameters?.x;
  const y = entity.parameters?.y;
  return typeof x === 'number' && Number.isFinite(x)
    && typeof y === 'number' && Number.isFinite(y)
    ? { x, y }
    : null;
}

function jsonPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number' && Number.isFinite(candidate.y)
    ? { x: candidate.x, y: candidate.y }
    : null;
}

function circleRadiusSource(
  entity: GeometryDoc['semantic']['ir']['entities'][number],
): {
  range: { start: number; end: number };
  value: number;
  coordinateScale: number;
} | null {
  const value = entity.parameters?.sourceRadius;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as {
    range?: unknown;
    value?: unknown;
    coordinateScale?: unknown;
  };
  const range = source.range as { start?: unknown; end?: unknown } | undefined;
  return range
    && typeof range.start === 'number' && Number.isInteger(range.start) && range.start >= 0
    && typeof range.end === 'number' && Number.isInteger(range.end) && range.end > range.start
    && typeof source.value === 'number' && Number.isFinite(source.value) && source.value > 0
    && typeof source.coordinateScale === 'number'
    && Number.isFinite(source.coordinateScale) && source.coordinateScale > 0
    ? {
      range: { start: range.start, end: range.end },
      value: source.value,
      coordinateScale: source.coordinateScale,
    }
    : null;
}

function ellipseParameterSources(
  entity: GeometryDoc['semantic']['ir']['entities'][number],
): {
  xRadius: { range: { start: number; end: number }; value: number };
  yRadius: { range: { start: number; end: number }; value: number };
  coordinateScale: number | null;
  coordinateRotationDegrees: number | null;
  coordinateTransformSimilarity: boolean;
  localRotation: { range: { start: number; end: number }; value: number } | null;
} | null {
  const raw = entity.parameters?.sourceEllipseParameters;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const numericSlot = (value: unknown, positive = true) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const slot = value as { range?: unknown; value?: unknown };
    const range = slot.range as { start?: unknown; end?: unknown } | undefined;
    return range
      && typeof range.start === 'number' && Number.isInteger(range.start) && range.start >= 0
      && typeof range.end === 'number' && Number.isInteger(range.end) && range.end > range.start
      && typeof slot.value === 'number' && Number.isFinite(slot.value)
      && (!positive || slot.value > 0)
      ? { range: { start: range.start, end: range.end }, value: slot.value }
      : null;
  };
  const xRadius = numericSlot(source.xRadius);
  const yRadius = numericSlot(source.yRadius);
  const localRotation = source.localRotation === null
    ? null
    : numericSlot(source.localRotation, false);
  return xRadius
    && yRadius
    && (source.sourceKind === undefined || source.sourceKind === 'ellipse')
    && (
      source.coordinateScale === null
      || (
        typeof source.coordinateScale === 'number'
        && Number.isFinite(source.coordinateScale)
        && source.coordinateScale > 0
      )
    )
    && (
      source.coordinateRotationDegrees === null
      || (
        typeof source.coordinateRotationDegrees === 'number'
        && Number.isFinite(source.coordinateRotationDegrees)
      )
    )
    && (
      source.coordinateTransformSimilarity === undefined
      || typeof source.coordinateTransformSimilarity === 'boolean'
    )
    && (source.localRotation === null || localRotation !== null)
    ? {
      xRadius,
      yRadius,
      coordinateScale: source.coordinateScale as number | null,
      coordinateRotationDegrees: source.coordinateRotationDegrees as number | null,
      coordinateTransformSimilarity: source.coordinateTransformSimilarity !== false,
      localRotation,
    }
    : null;
}

function completeNamedCubicVariableIds(
  entity: GeometryDoc['semantic']['ir']['entities'][number],
  entities: ReadonlyMap<string, GeometryDoc['semantic']['ir']['entities'][number]>,
): string[] | null {
  if (entity.kind !== 'cubic-bezier') return null;
  const origins = entity.parameters?.pointOrigins;
  if (!Array.isArray(origins) || origins.length !== 4) return null;
  const entitiesByName = new Map<string, GeometryDoc['semantic']['ir']['entities'][number]>();
  const ambiguousNames = new Set<string>();
  for (const candidate of entities.values()) {
    if (!candidate.name) continue;
    if (entitiesByName.has(candidate.name)) ambiguousNames.add(candidate.name);
    else entitiesByName.set(candidate.name, candidate);
  }
  const required: string[] = [];
  for (const rawOrigin of origins) {
    if (!rawOrigin || typeof rawOrigin !== 'object' || Array.isArray(rawOrigin)) return null;
    const origin = rawOrigin as { kind?: unknown; name?: unknown };
    if (origin.kind !== 'named' || typeof origin.name !== 'string' || ambiguousNames.has(origin.name)) {
      return null;
    }
    const point = entitiesByName.get(origin.name);
    if (
      !point
      || point.kind !== 'point'
      || (point.parameters?.free !== true && !point.tags?.includes('free'))
      || !pointPosition(point)
    ) return null;
    required.push(point.id);
  }
  return [...new Set(required)].sort();
}

function arcParameterSources(
  entity: GeometryDoc['semantic']['ir']['entities'][number],
): {
  startAngle: { range: { start: number; end: number }; value: number };
  endAngle: { range: { start: number; end: number }; value: number };
  radius: { range: { start: number; end: number }; value: number };
  coordinateScale: number;
  coordinateRotationDegrees: number;
} | null {
  const raw = entity.parameters?.sourceArcParameters;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const numericSlot = (value: unknown, positive = false) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const slot = value as { range?: unknown; value?: unknown };
    const range = slot.range as { start?: unknown; end?: unknown } | undefined;
    if (
      !range
      || typeof range.start !== 'number' || !Number.isInteger(range.start) || range.start < 0
      || typeof range.end !== 'number' || !Number.isInteger(range.end) || range.end <= range.start
      || typeof slot.value !== 'number' || !Number.isFinite(slot.value)
      || (positive && slot.value <= 0)
    ) return null;
    return {
      range: { start: range.start, end: range.end },
      value: slot.value,
    };
  };
  const startAngle = numericSlot(source.startAngle);
  const endAngle = numericSlot(source.endAngle);
  const radius = numericSlot(source.radius, true);
  return startAngle
    && endAngle
    && radius
    && typeof source.coordinateScale === 'number'
    && Number.isFinite(source.coordinateScale)
    && source.coordinateScale > 0
    && typeof source.coordinateRotationDegrees === 'number'
    && Number.isFinite(source.coordinateRotationDegrees)
    ? {
      startAngle,
      endAngle,
      radius,
      coordinateScale: source.coordinateScale,
      coordinateRotationDegrees: source.coordinateRotationDegrees,
    }
    : null;
}

function entityDefinitionPoints(
  entity: GeometryDoc['semantic']['ir']['entities'][number],
): readonly { x: number; y: number }[] {
  const parameters = entity.parameters;
  if (entity.kind === 'point') {
    const position = pointPosition(entity);
    return position ? [position] : [];
  }
  if (entity.kind === 'polyline' || entity.kind === 'polygon') {
    return Array.isArray(parameters?.points)
      ? parameters.points.flatMap((value) => {
        const point = jsonPoint(value);
        return point ? [point] : [];
      })
      : [];
  }
  if (entity.kind === 'cubic-bezier') {
    return ['start', 'control1', 'control2', 'end'].flatMap((key) => {
      const point = jsonPoint(parameters?.[key]);
      return point ? [point] : [];
    });
  }
  if (entity.kind === 'circle' || entity.kind === 'circular-arc') {
    const center = jsonPoint(parameters?.center);
    const radius = parameters?.radius;
    if (!center || typeof radius !== 'number' || !Number.isFinite(radius)) return [];
    return [
      { x: center.x - radius, y: center.y },
      { x: center.x + radius, y: center.y },
      { x: center.x, y: center.y - radius },
      { x: center.x, y: center.y + radius },
    ];
  }
  if (entity.kind === 'ellipse') {
    const center = jsonPoint(parameters?.center);
    const xRadius = parameters?.xRadius;
    const yRadius = parameters?.yRadius;
    const rotationDegrees = parameters?.rotationDegrees;
    if (
      !center
      || typeof xRadius !== 'number' || !Number.isFinite(xRadius)
      || typeof yRadius !== 'number' || !Number.isFinite(yRadius)
      || typeof rotationDegrees !== 'number' || !Number.isFinite(rotationDegrees)
    ) return [];
    return [...flattenEllipse({ center, xRadius, yRadius, rotationDegrees }, 48)];
  }
  if (entity.kind === 'elliptical-arc') {
    const center = jsonPoint(parameters?.center);
    const axisX = jsonPoint(parameters?.axisX);
    const axisY = jsonPoint(parameters?.axisY);
    const startAngleDeg = parameters?.startAngleDeg;
    const endAngleDeg = parameters?.endAngleDeg;
    if (
      !center || !axisX || !axisY
      || typeof startAngleDeg !== 'number' || !Number.isFinite(startAngleDeg)
      || typeof endAngleDeg !== 'number' || !Number.isFinite(endAngleDeg)
    ) return [];
    return [...flattenEllipticalArc({
      center,
      axisX,
      axisY,
      startAngleDeg,
      endAngleDeg,
    }, 5)];
  }
  if (entity.kind === 'label') {
    const at = jsonPoint(parameters?.at);
    return at ? [at] : [];
  }
  if (entity.kind === 'angle-mark' || entity.kind === 'right-angle-mark') {
    return ['vertex', 'from', 'to'].flatMap((key) => {
      const point = jsonPoint(parameters?.[key]);
      return point ? [point] : [];
    });
  }
  return [];
}

/**
 * Resolve the user-visible selection pivot from semantic definition bounds.
 * Infinite lines/rays deliberately use their defining points, matching the
 * Canvas handle layout and keeping the pivot independent of pan/zoom.
 */
export function selectionTransformSelectionCenter(
  geometryDoc: GeometryDoc,
  selectedEntityIds: readonly string[],
): { x: number; y: number } | null {
  const selected = new Set(selectedEntityIds);
  const points = geometryDoc.semantic.ir.entities.flatMap((entity) => (
    selected.has(entity.id) ? entityDefinitionPoints(entity) : []
  ));
  if (points.length === 0) return null;
  const bounds = points.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    minY: Math.min(current.minY, point.y),
    maxX: Math.max(current.maxX, point.x),
    maxY: Math.max(current.maxY, point.y),
  }), {
    minX: points[0]!.x,
    minY: points[0]!.y,
    maxX: points[0]!.x,
    maxY: points[0]!.y,
  });
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function transformPoint(
  point: { x: number; y: number },
  transform: Exclude<SelectionTransform, { kind: 'rotate' | 'scale' }>
    | { readonly kind: 'rotate'; readonly degrees: number; readonly center: { readonly x: number; readonly y: number } }
    | { readonly kind: 'scale'; readonly factor: number; readonly center: { readonly x: number; readonly y: number } },
) {
  if (transform.kind === 'translate') {
    return { x: point.x + transform.dx, y: point.y + transform.dy };
  }
  if (transform.kind === 'rotate') {
    const angle = transform.degrees * Math.PI / 180;
    const x = point.x - transform.center.x;
    const y = point.y - transform.center.y;
    return {
      x: transform.center.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: transform.center.y + x * Math.sin(angle) + y * Math.cos(angle),
    };
  }
  if (transform.kind === 'scale') {
    if (!Number.isFinite(transform.factor) || Math.abs(transform.factor) < 1e-9) {
      throw new TypeError('Selection scale factor must be finite and non-zero.');
    }
    return {
      x: transform.center.x + (point.x - transform.center.x) * transform.factor,
      y: transform.center.y + (point.y - transform.center.y) * transform.factor,
    };
  }
  const dx = transform.lineEnd.x - transform.lineStart.x;
  const dy = transform.lineEnd.y - transform.lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) throw new TypeError('Reflection axis is degenerate.');
  const t = ((point.x - transform.lineStart.x) * dx + (point.y - transform.lineStart.y) * dy) / lengthSquared;
  const projection = {
    x: transform.lineStart.x + t * dx,
    y: transform.lineStart.y + t * dy,
  };
  return { x: 2 * projection.x - point.x, y: 2 * projection.y - point.y };
}

function canonicalParameterNumber(value: number): number {
  return Number(formatCoordNumber(value));
}

function arcParameterWrites(
  entity: GeometryDoc['semantic']['ir']['entities'][number],
  transform: SelectionTransformPlan['transform'],
): SelectionTransformParameterWrite[] {
  if (entity.kind !== 'circular-arc' || transform.kind === 'translate') return [];
  const source = arcParameterSources(entity);
  const startWorld = entity.parameters?.startAngleDeg;
  const endWorld = entity.parameters?.endAngleDeg;
  const radiusWorld = entity.parameters?.radius;
  if (
    !source
    || typeof startWorld !== 'number' || !Number.isFinite(startWorld)
    || typeof endWorld !== 'number' || !Number.isFinite(endWorld)
    || typeof radiusWorld !== 'number' || !Number.isFinite(radiusWorld) || radiusWorld <= 0
  ) {
    throw new TypeError(`Circular arc ${entity.id} has no complete source parameter slots.`);
  }
  const angleWrite = (
    kind: 'arc-start-angle' | 'arc-end-angle',
    slot: typeof source.startAngle,
    targetValue: number,
    targetWorldValue: number,
  ): SelectionTransformParameterWrite => {
    const canonicalTarget = canonicalParameterNumber(targetValue);
    return {
      kind,
      semanticEntityId: entity.id,
      range: slot.range,
      sourceValue: slot.value,
      targetValue: canonicalTarget,
      targetWorldValue: canonicalParameterNumber(targetWorldValue),
      insert: formatCoordNumber(canonicalTarget),
    };
  };
  const radiusWrite = (factor: number): SelectionTransformParameterWrite => {
    const targetValue = canonicalParameterNumber(source.radius.value * factor);
    return {
      kind: 'arc-radius',
      semanticEntityId: entity.id,
      range: source.radius.range,
      sourceValue: source.radius.value,
      targetValue,
      targetWorldValue: canonicalParameterNumber(radiusWorld * factor),
      insert: formatCoordNumber(targetValue),
    };
  };

  if (transform.kind === 'rotate') {
    return [
      angleWrite('arc-start-angle', source.startAngle,
        source.startAngle.value + transform.degrees, startWorld + transform.degrees),
      angleWrite('arc-end-angle', source.endAngle,
        source.endAngle.value + transform.degrees, endWorld + transform.degrees),
    ];
  }
  if (transform.kind === 'scale') {
    const factor = Math.abs(transform.factor);
    const writes: SelectionTransformParameterWrite[] = [radiusWrite(factor)];
    if (transform.factor < 0) {
      writes.push(
        angleWrite('arc-start-angle', source.startAngle,
          source.startAngle.value + 180, startWorld + 180),
        angleWrite('arc-end-angle', source.endAngle,
          source.endAngle.value + 180, endWorld + 180),
      );
    }
    return writes;
  }

  const dx = transform.lineEnd.x - transform.lineStart.x;
  const dy = transform.lineEnd.y - transform.lineStart.y;
  if (dx * dx + dy * dy < 1e-12) throw new TypeError('Reflection axis is degenerate.');
  const axisDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
  const sourceTarget = (slotValue: number) => (
    2 * axisDegrees - slotValue - 2 * source.coordinateRotationDegrees
  );
  const worldTarget = (worldValue: number) => 2 * axisDegrees - worldValue;
  return [
    angleWrite('arc-start-angle', source.startAngle,
      sourceTarget(source.startAngle.value), worldTarget(startWorld)),
    angleWrite('arc-end-angle', source.endAngle,
      sourceTarget(source.endAngle.value), worldTarget(endWorld)),
  ];
}

/** Broker-replayable authorization domain for a whole-selection transform. */
export function selectionTransformVariableEntityIds(
  geometryDoc: GeometryDoc,
  selectedEntityIds: readonly string[],
): string[] {
  const selected = new Set(selectedEntityIds);
  if (selected.size === 0) throw new TypeError('Select at least one object to transform.');
  const entities = new Map(geometryDoc.semantic.ir.entities.map((entity) => [entity.id, entity]));
  for (const id of selected) {
    if (!entities.has(id)) throw new TypeError(`Selection entity ${id} is not current.`);
  }
  const graph = buildDependencyGraph(geometryDoc.semantic.ir.relations);
  const entityIdByReference = new Map<string, string>();
  for (const entity of geometryDoc.semantic.ir.entities) {
    entityIdByReference.set(entity.id, entity.id);
    if (entity.name && !entityIdByReference.has(entity.name)) {
      entityIdByReference.set(entity.name, entity.id);
    }
  }
  const closure = new Set(selected);
  const queue = [...selected].sort();
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependency of graph.dependencies.get(current) ?? []) {
      if (closure.has(dependency)) continue;
      closure.add(dependency);
      queue.push(dependency);
    }
    const references = entities.get(current)?.parameters?.references;
    if (Array.isArray(references)) {
      for (const reference of references) {
        if (typeof reference !== 'string') continue;
        const dependency = entityIdByReference.get(reference);
        if (!dependency || closure.has(dependency)) continue;
        closure.add(dependency);
        queue.push(dependency);
      }
    }
    queue.sort();
  }
  return [...closure].flatMap((id) => {
    const entity = entities.get(id);
    return entity
      && entity.kind === 'point'
      && (entity.parameters?.free === true || entity.tags?.includes('free'))
      && pointPosition(entity)
      ? [entity.id]
      : [];
  }).sort();
}

function selectionTransformImpact(
  geometryDoc: GeometryDoc,
  selectedEntityIds: readonly string[],
  variableEntityIds: readonly string[],
) {
  const graph = buildDependencyGraph(geometryDoc.semantic.ir.relations);
  const entityIdByReference = new Map<string, string>();
  for (const entity of geometryDoc.semantic.ir.entities) {
    entityIdByReference.set(entity.id, entity.id);
    if (entity.name && !entityIdByReference.has(entity.name)) {
      entityIdByReference.set(entity.name, entity.id);
    }
  }
  const referenceDependents = new Map<string, Set<string>>();
  for (const entity of geometryDoc.semantic.ir.entities) {
    const references = entity.parameters?.references;
    if (!Array.isArray(references)) continue;
    for (const reference of references) {
      if (typeof reference !== 'string') continue;
      const dependency = entityIdByReference.get(reference);
      if (!dependency) continue;
      const dependents = referenceDependents.get(dependency) ?? new Set<string>();
      dependents.add(entity.id);
      referenceDependents.set(dependency, dependents);
    }
  }
  const impacted = new Set(variableEntityIds);
  const queue = [...variableEntityIds].sort();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = new Set([
      ...(graph.dependents.get(current) ?? []),
      ...(referenceDependents.get(current) ?? []),
    ]);
    for (const dependent of dependents) {
      if (impacted.has(dependent)) continue;
      impacted.add(dependent);
      queue.push(dependent);
    }
    queue.sort();
  }
  const selected = new Set(selectedEntityIds);
  const drivers = new Set(variableEntityIds);
  const impactedEntityIds = [...impacted].sort();
  return {
    impactedEntityIds,
    externalImpactedEntityIds: impactedEntityIds.filter((id) => (
      !selected.has(id) && !drivers.has(id)
    )),
  };
}

/** Resolve selected objects to their writable free-point dependency closure. */
export function planSelectionTransform(
  source: string,
  geometryDoc: GeometryDoc,
  selectedEntityIds: readonly string[],
  transform: SelectionTransform,
): SelectionTransformPlan {
  const entities = new Map(geometryDoc.semantic.ir.entities.map((entity) => [entity.id, entity]));
  const selectedEntities = selectedEntityIds.map((id) => entities.get(id)).filter(Boolean);
  const variableEntityIds = selectionTransformVariableEntityIds(
    geometryDoc,
    selectedEntityIds,
  );
  const variableEntityIdSet = new Set(variableEntityIds);
  const isRectangle = (entity: GeometryDoc['semantic']['ir']['entities'][number]) => (
    entity.kind === 'polygon'
    && entity.parameters?.sourcePathOperator === 'rectangle'
  );
  const cubicIsComplete = (entity: GeometryDoc['semantic']['ir']['entities'][number]) => {
    const required = completeNamedCubicVariableIds(entity, entities);
    return required !== null && required.every((id) => variableEntityIdSet.has(id));
  };
  const unsupported = selectedEntities.find((entity) => (
      (isRectangle(entity!) && (transform.kind === 'rotate' || transform.kind === 'reflect'))
      || (entity!.kind === 'cubic-bezier' && !cubicIsComplete(entity!))
      || (
        entity!.kind === 'ellipse'
        && transform.kind !== 'translate'
        && (
          (transform.kind === 'scale' && ellipseParameterSources(entity!) === null)
          || (
            transform.kind === 'rotate'
            && !ellipseParameterSources(entity!)?.localRotation
          )
          || transform.kind === 'reflect'
        )
      )
      || (
        entity!.kind === 'circular-arc'
        && transform.kind !== 'translate'
        && arcParameterSources(entity!) === null
      )
      || (
        entity!.kind === 'elliptical-arc'
        && transform.kind !== 'translate'
      )
      || (
        entity!.kind === 'circle'
        && transform.kind === 'scale'
        && (
          entity!.parameters?.circleDefinition as { kind?: unknown } | undefined
        )?.kind === 'center-radius'
        && circleRadiusSource(entity!) === null
      )
  ));
  if (unsupported) {
    throw new TypeError(
      `图元 ${unsupported.id} 的 ${unsupported.kind} 参数槽尚未全部接入选区变换，已阻止不完整改写。`,
    );
  }
  const variableEntities = variableEntityIds.map((id) => entities.get(id)!);
  if (variableEntities.length === 0) {
    throw new TypeError('The selection has no writable free-point transform domain.');
  }
  const analysis = analyze(source, geometryDoc.basis.revision);
  if (analysis.status !== 'complete') {
    throw new TypeError('Selection transform requires a complete semantic projection.');
  }
  const visibleSelectionCenter = selectionTransformSelectionCenter(
    geometryDoc,
    selectedEntityIds,
  );
  const selectionCenter = visibleSelectionCenter ?? variableEntities.reduce((sum, entity) => {
    const position = pointPosition(entity)!;
    return { x: sum.x + position.x, y: sum.y + position.y };
  }, { x: 0, y: 0 });
  if (!visibleSelectionCenter) {
    selectionCenter.x /= variableEntities.length;
    selectionCenter.y /= variableEntities.length;
  }
  const resolvedTransform = transform.kind === 'rotate'
    ? { ...transform, center: transform.center === 'selection' ? selectionCenter : transform.center }
    : transform.kind === 'scale'
      ? { ...transform, center: transform.center === 'selection' ? selectionCenter : transform.center }
      : transform;
  const targets = variableEntities.map((entity) => {
    const position = pointPosition(entity);
    if (!position || !entity.name) {
      throw new TypeError(`Point ${entity.name ?? entity.id} has no canonical transform position.`);
    }
    return {
      semanticEntityId: entity.id,
      pointName: entity.name,
      target: transformPoint(position, resolvedTransform),
    };
  });
  const parameterWrites: SelectionTransformParameterWrite[] = selectedEntities.flatMap((entity) => {
    if (!entity) return [];
    if (entity.kind === 'circular-arc') {
      return arcParameterWrites(entity, resolvedTransform);
    }
    if (entity.kind === 'ellipse' && resolvedTransform.kind === 'rotate') {
      const sourceParameters = ellipseParameterSources(entity);
      const worldRotation = entity.parameters?.rotationDegrees;
      if (
        !sourceParameters?.localRotation
        || !sourceParameters.coordinateTransformSimilarity
        || typeof worldRotation !== 'number'
        || !Number.isFinite(worldRotation)
      ) return [];
      const targetValue = canonicalParameterNumber(
        sourceParameters.localRotation.value + resolvedTransform.degrees,
      );
      return [{
        kind: 'ellipse-rotation' as const,
        semanticEntityId: entity.id,
        range: sourceParameters.localRotation.range,
        sourceValue: sourceParameters.localRotation.value,
        targetValue,
        targetWorldRotationDegrees: canonicalParameterNumber(
          worldRotation + resolvedTransform.degrees,
        ),
        insert: formatCoordNumber(targetValue),
      }];
    }
    if (entity.kind === 'ellipse' && resolvedTransform.kind === 'scale') {
      const sourceParameters = ellipseParameterSources(entity);
      const xRadius = entity.parameters?.xRadius;
      const yRadius = entity.parameters?.yRadius;
      if (
        !sourceParameters
        || typeof xRadius !== 'number' || !Number.isFinite(xRadius) || xRadius <= 0
        || typeof yRadius !== 'number' || !Number.isFinite(yRadius) || yRadius <= 0
      ) return [];
      const factor = Math.abs(resolvedTransform.factor);
      return ([
        ['ellipse-x-radius', sourceParameters.xRadius, xRadius],
        ['ellipse-y-radius', sourceParameters.yRadius, yRadius],
      ] as const).map(([kind, slot, worldRadius]) => {
        const targetValue = canonicalParameterNumber(slot.value * factor);
        return {
          kind,
          semanticEntityId: entity.id,
          range: slot.range,
          sourceValue: slot.value,
          targetValue,
          targetWorldRadius: canonicalParameterNumber(worldRadius * factor),
          insert: formatCoordNumber(targetValue),
        };
      });
    }
    if (entity.kind !== 'circle' || resolvedTransform.kind !== 'scale') return [];
    const sourceRadius = circleRadiusSource(entity);
    const worldRadius = entity.parameters?.radius;
    if (!sourceRadius || typeof worldRadius !== 'number' || !Number.isFinite(worldRadius)) {
      return [];
    }
    const factor = Math.abs(resolvedTransform.factor);
    const targetValue = canonicalParameterNumber(sourceRadius.value * factor);
    return [{
      kind: 'circle-radius' as const,
      semanticEntityId: entity.id,
      range: sourceRadius.range,
      sourceValue: sourceRadius.value,
      targetValue,
      targetWorldRadius: canonicalParameterNumber(worldRadius * factor),
      insert: `(${formatCoordNumber(targetValue)})`,
    }];
  });
  const patches = [...targets.flatMap((target) => {
    const range = analysis.freePointRanges.get(target.pointName);
    if (!range) return [];
    const sourceTarget = sourceCoordinateForWorldPoint(
      analysis.freePointTransforms.get(target.pointName),
      target.target,
    );
    return [coordinateLiteralPatch(source, range, {
      x: Number(formatCoordNumber(sourceTarget.x)),
      y: Number(formatCoordNumber(sourceTarget.y)),
    })];
  }), ...parameterWrites.map((write) => ({
    from: write.range.start,
    to: write.range.end,
    insert: write.insert,
  }))];
  const impact = selectionTransformImpact(
    geometryDoc,
    selectedEntityIds,
    variableEntityIds,
  );
  const impacted = new Set(impact.impactedEntityIds);
  const incompleteImpactedEntity = geometryDoc.semantic.ir.entities.find((entity) => (
    impacted.has(entity.id)
    && (
      (isRectangle(entity) && (transform.kind === 'rotate' || transform.kind === 'reflect'))
      || (entity.kind === 'cubic-bezier' && !cubicIsComplete(entity))
      || (
        entity.kind === 'ellipse'
        && transform.kind !== 'translate'
        && (
          !selectedEntityIds.includes(entity.id)
          || (transform.kind === 'scale' && ellipseParameterSources(entity) === null)
          || (
            transform.kind === 'rotate'
            && !ellipseParameterSources(entity)?.localRotation
          )
          || transform.kind === 'reflect'
        )
      )
      || (
        entity.kind === 'circle'
        && transform.kind === 'scale'
        && selectedEntityIds.includes(entity.id)
        && (
          entity.parameters?.circleDefinition as { kind?: unknown } | undefined
        )?.kind === 'center-radius'
        && circleRadiusSource(entity) === null
      )
    )
  ));
  if (incompleteImpactedEntity) {
    throw new TypeError(
      `Transform would partially update dependent ${incompleteImpactedEntity.kind} ${incompleteImpactedEntity.id}.`,
    );
  }
  if (transform.kind === 'reflect') {
    const orientedKinds = new Set([
      'simson-line',
      'fermat-point',
      'rotate-90',
      'point-on-circle',
      'tangent-at-point',
    ]);
    const orientedBinding = geometryDoc.construction.bindings.find((binding) => (
      orientedKinds.has(String(binding.metadata?.managedPlanKind ?? ''))
      && binding.targets.some((target) => (
        target.recordType === 'entity' && impacted.has(target.id)
      ))
    ));
    if (orientedBinding) {
      throw new TypeError(
        `Reflection requires an orientation-aware recompile for ${String(orientedBinding.metadata?.managedPlanKind)}.`,
      );
    }
  }
  return {
    selectedEntityIds: [...new Set(selectedEntityIds)].sort(),
    variableEntityIds,
    ...impact,
    targets,
    parameterWrites,
    patches,
    transform: resolvedTransform,
  };
}


/**
 * Read-only capability projection for UI and agent widgets. It never probes by
 * committing a transaction and therefore cannot leave a partial transform.
 */
export function analyzeSelectionTransformCapability(
  source: string,
  geometryDoc: GeometryDoc,
  selectedEntityIds: readonly string[],
  transform: SelectionTransform,
): SelectionTransformCapability {
  try {
    const plan = planSelectionTransform(source, geometryDoc, selectedEntityIds, transform);
    return {
      status: plan.externalImpactedEntityIds.length > 0 ? 'warning' : 'ready',
      selectedEntityIds: plan.selectedEntityIds,
      variableEntityIds: plan.variableEntityIds,
      impactedEntityIds: plan.impactedEntityIds,
      externalImpactedEntityIds: plan.externalImpactedEntityIds,
      patchCount: plan.targets.length + plan.parameterWrites.length,
      plan,
    };
  } catch (error) {
    return {
      status: 'blocked',
      selectedEntityIds: [...new Set(selectedEntityIds)].sort(),
      variableEntityIds: [],
      impactedEntityIds: [],
      externalImpactedEntityIds: [],
      patchCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
