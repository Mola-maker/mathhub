import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  applyTextPatch,
  applyTextPatches,
  minimalTextPatch,
  type TextPatch,
} from '../document/source-transaction';
import {
  insertBeforeTikzEndPatch,
  nextPointName,
  type AuthoringAnchor,
  type AuthoringElementKind,
} from '../authoring/source-builder';
import {
  CONSTRUCTION_TOOL_SPECS,
  constructionSpecRegistry,
  createPrimitiveConstructionPlan,
  isPrimitiveConstructionKind,
  type ConstructionCategory,
  type ConstructionToolSpec,
} from '../authoring/construction-catalog';
import {
  compileConstructionPlan,
  compileSourceCircleAdoption,
  ConstructionPlanValidationError,
  type ConstructionPlan,
} from '../authoring/construction-ir';
import {
  createConstructionPreviewIR,
  type ConstructionPreviewIR,
} from '../authoring/preview-ir';
import { qualifiedManagedEntityReference } from '../ir/persistent-entity-reference';
import type { SourceEditOrigin } from '../document/studio-document';
import type { SelectionTarget } from '../authoring/selection-target';
import {
  coordinateLiteralPatch,
  formatCoordNumber,
} from '../patch/source-patch';
import type { Pt } from '../semantics/calc-eval';
import type { Scene } from '../semantics/scene';
import type { SceneCircleDefinition } from '../semantics/scene';
import type { SourceRange } from '../subset/ast';
import type { DerivedDragResult } from '../solver/protocol';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { shortcutForTool } from '../commands/default-commands';
import { hitTestElement, hitTestPointHandle } from './hit-test';
import { sceneToScreen, type Viewport } from './viewport';

/**
 * Keep preview hit testing and the eventual authoring commit on the same
 * spatial contract.  A pointer that previews an existing point/circle must
 * resolve to that same input when the user releases the pointer.
 */
export const AUTHORING_POINT_HIT_TOLERANCE_PX = 12;
export const AUTHORING_CIRCLE_HIT_TOLERANCE_PX = 18;

export interface ToolElementHit {
  readonly kind: string;
  readonly sourceStableId?: string;
  readonly semanticEntityId: string;
  readonly renderPrimitiveId?: string;
  readonly sourceBindingIds?: readonly string[];
  readonly sourceRange?: SourceRange;
  readonly stmtIndex: number;
  readonly refs: readonly string[];
  readonly distance?: number;
}

export interface ToolCircleHit {
  readonly stableId: string;
  readonly stmtIndex: number;
  readonly sourceRange?: SourceRange;
  readonly refs: readonly string[];
  readonly centerName: string;
  readonly throughName: string | null;
  readonly center: Pt;
  readonly radius: number;
  readonly definition: SceneCircleDefinition;
}

export interface ToolContext {
  session: ToolInteractionSession;
  readOnly?: boolean;
  code: string;
  revision: number;
  scene: Scene;
  viewport: Viewport;
  freePointRanges: Map<string, SourceRange>;
  applySourcePatches(
    patches: readonly TextPatch[],
    origin: SourceEditOrigin,
    expectedRevision?: number,
  ): boolean;
  solveDerivedDrag?(
    pointName: string,
    target: Pt,
    sourceRevision: number,
  ): Promise<DerivedDragResult>;
  setSolverStatus?(status: string): void;
  /** Drag-derived source preview; creation uses ConstructionPreview instead. */
  previewPatch?(next: string | null): void;
  setConstructionPreview?(preview: ConstructionPreview | null): void;
  hitTestRenderPrimitive?(
    screen: Pt,
    tolerance: number,
  ): ToolElementHit | null;
  hitTestRenderCircle?(
    screen: Pt,
    tolerance: number,
  ): ToolCircleHit | null;
  setSelection(refs: string[], stmtIndex?: number | null): void;
  setSelectionTargets?(targets: readonly SelectionTarget[]): void;
  setHoveredStmtIndex?(stmtIndex: number | null): void;
  setViewport(viewport: Viewport): void;
  toScenePoint(clientX: number, clientY: number): Pt;
  toClientPoint(scenePoint: Pt): Pt;
}

export interface Tool {
  id: string;
  label: string;
  symbol: string;
  description: string;
  category: ConstructionCategory;
  aliases: readonly string[];
  shortcut?: string;
  inputSlots?: ConstructionToolSpec['inputSlots'];
  cursor: string;
  onPointerDown?(event: ReactPointerEvent, context: ToolContext): void;
  onPointerMove?(event: ReactPointerEvent, context: ToolContext): void;
  onPointerUp?(event: ReactPointerEvent, context: ToolContext): void;
  onPointerCancel?(event: ReactPointerEvent, context: ToolContext): void;
}

export interface ConstructionPreview {
  toolId: string;
  valid: boolean;
  prompt: string;
  anchors: readonly Pt[];
  pointer: Pt;
  candidate: Pt | null;
  candidateName: string | null;
  closePath: boolean;
  /** Same-plan preview projection; absent when the draft is incomplete. */
  previewIR?: ConstructionPreviewIR;
}

interface DragState {
  mode: 'free' | 'derived' | 'path';
  pointName: string;
  baseCode: string;
  baseRevision: number;
  range: SourceRange | null;
  circleConstraint?: {
    centerName: string;
    throughName: string | null;
    radius: number | null;
    angleRanges: readonly SourceRange[];
  };
  pendingPatches: TextPatch[];
  solving: boolean;
  queuedTarget: Pt | null;
  requestSequence: number;
  activeRequestSequence: number;
  released: boolean;
}

interface AuthoringState {
  toolId: string;
  spec: ConstructionToolSpec;
  kind: AuthoringElementKind | 'point' | null;
  baseCode: string;
  baseRevision: number;
  anchors: AuthoringAnchor[];
  resultName: string | null;
  /** Identity snapshot for the revision-bound source used by this gesture. */
  managedConstructionIds: ReadonlySet<string>;
  managedReferenceMarkers: ReadonlySet<string>;
}

interface PanState {
  pointerId: number;
  start: Pt;
  viewport: Viewport;
}

interface ManagedIdentityCache {
  readonly constructionIds: ReadonlySet<string>;
  readonly referenceMarkers: ReadonlySet<string>;
}

interface ConstructionAllocators {
  readonly nextName: (prefix: string) => string;
  readonly nextConstructionId: (prefix: string) => string;
}

/** Cache identity lookups once per authoring revision, not once per pointer move. */
function managedIdentityCache(source: string): ManagedIdentityCache {
  const constructionIds = new Set(
    parseManagedConstructionBlocks(source).map((block) => block.id),
  );
  const referenceMarkers = new Set<string>();
  const referencePattern = /managed:([A-Za-z0-9:_.%-]+):/g;
  let match: RegExpExecArray | null;
  while ((match = referencePattern.exec(source))) {
    const segments = match[1].split(':');
    for (let count = 1; count <= segments.length; count += 1) {
      referenceMarkers.add(`managed:${segments.slice(0, count).join(':')}:`);
    }
  }
  return { constructionIds, referenceMarkers };
}

/**
 * Shared deterministic allocators for preview and commit. The returned sets
 * are local snapshots; consuming a name never mutates the document or source.
 */
function constructionAllocators(
  pointNames: Iterable<string>,
  identity: ManagedIdentityCache,
  previewOnly = false,
): ConstructionAllocators {
  const reservedNames = new Set(pointNames);
  const reservedConstructionIds = new Set(identity.constructionIds);
  const nextName = (prefix: string): string => {
    const name = nextPointName(reservedNames, prefix);
    reservedNames.add(name);
    return name;
  };
  const nextConstructionId = (prefix: string): string => {
    const candidatePrefix = previewOnly ? `preview-${prefix}` : prefix;
    const referenced = (candidate: string): boolean => (
      identity.referenceMarkers.has(`managed:${candidate}:`)
    );
    if (
      !reservedConstructionIds.has(candidatePrefix)
      && (previewOnly || !referenced(candidatePrefix))
    ) {
      reservedConstructionIds.add(candidatePrefix);
      return candidatePrefix;
    }
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${candidatePrefix}-${index}`;
      if (
        !reservedConstructionIds.has(candidate)
        && (previewOnly || !referenced(candidate))
      ) {
        reservedConstructionIds.add(candidate);
        return candidate;
      }
    }
    throw new RangeError(`鏃犳硶鍒嗛厤鏂扮殑鏋勯€犳爣璇嗭細${candidatePrefix}`);
  };
  return { nextName, nextConstructionId };
}

export interface ToolInteractionSession {
  drag: DragState | null;
  authoring: AuthoringState | null;
  pan: PanState | null;
}

export function createToolInteractionSession(): ToolInteractionSession {
  return {
    drag: null,
    authoring: null,
    pan: null,
  };
}

export function cancelActiveToolInteraction(
  session: ToolInteractionSession,
  context?: ToolContext,
): void {
  session.drag = null;
  session.authoring = null;
  session.pan = null;
  context?.previewPatch?.(null);
  context?.setConstructionPreview?.(null);
  context?.setSolverStatus?.('');
}

function localScreen(event: ReactPointerEvent, context: ToolContext): Pt {
  return context.toClientPoint(context.toScenePoint(event.clientX, event.clientY));
}

function preferAngleMarkOverPoint(
  elementHit: ToolElementHit | null,
  pointName: string | null,
  screen: Pt,
  context: ToolContext,
): boolean {
  if (
    !elementHit
    || !pointName
    || !(
      elementHit.kind === 'angle'
      || elementHit.kind === 'right-angle'
      || elementHit.kind === 'angle-mark'
    )
    || elementHit.distance === undefined
  ) return false;
  const point = context.scene.points.get(pointName);
  if (!point) return false;
  const pointScreen = sceneToScreen(point.position, context.viewport);
  const pointDistance = Math.hypot(
    screen.x - pointScreen.x,
    screen.y - pointScreen.y,
  );
  return elementHit.distance < pointDistance;
}

function hitTestToolElement(
  screen: Pt,
  context: ToolContext,
  tolerance: number,
): ToolElementHit | null {
  const rendered = context.hitTestRenderPrimitive?.(screen, tolerance);
  if (rendered) return rendered;
  const sceneElement = hitTestElement(
    screen,
    context.scene,
    context.viewport,
    tolerance,
  );
  return sceneElement
    ? {
      kind: sceneElement.kind,
      sourceStableId: sceneElement.stableId,
      semanticEntityId: sceneElement.stableId,
      sourceBindingIds: [`binding:${sceneElement.stableId}`],
      stmtIndex: sceneElement.stmtIndex,
      refs: sceneElement.refs,
      distance: sceneElement.distance,
    }
    : null;
}

function selectionTargetForElementHit(
  hit: ToolElementHit,
): SelectionTarget {
  const provenance = {
    semanticEntityId: hit.semanticEntityId,
    renderPrimitiveId: hit.renderPrimitiveId,
    sourceBindingIds: hit.sourceBindingIds,
    sourceRange: hit.sourceRange,
  };
  return hit.sourceStableId
    ? {
      kind: 'entity',
      stableId: hit.sourceStableId,
      stmtIndex: hit.stmtIndex,
      entityKind: 'element',
      refs: hit.refs,
      ...provenance,
    }
    : {
      kind: 'statement',
      stmtIndex: hit.stmtIndex,
      refs: hit.refs,
      ...provenance,
    };
}

function hitTestCircle(
  screen: Pt,
  context: ToolContext,
  tolerancePx: number,
): ToolCircleHit | null {
  const rendered = context.hitTestRenderCircle?.(screen, tolerancePx);
  return rendered ?? null;
}

function clearDrag(context: ToolContext): void {
  context.session.drag = null;
  context.previewPatch?.(null);
}

function commitDrag(state: DragState, context: ToolContext): void {
  let committed = true;
  if (state.pendingPatches.length > 0) {
    committed = context.applySourcePatches(
      state.pendingPatches,
      'canvas',
      state.baseRevision,
    );
  }
  context.setSolverStatus?.(
    committed
      ? ''
      : '画板在拖动期间已更新，本次拖动未提交；请基于最新图形重试',
  );
  clearDrag(context);
}

function requestDerivedSolve(state: DragState, context: ToolContext, target: Pt): void {
  if (!context.solveDerivedDrag || context.session.drag !== state) return;
  if (state.solving) {
    // Coalesce high-frequency pointer events, but never discard the newest one.
    state.queuedTarget = target;
    return;
  }
  state.solving = true;
  state.queuedTarget = null;
  const requestSequence = ++state.requestSequence;
  state.activeRequestSequence = requestSequence;
  context.setSolverStatus?.(`正在保持约束拖动 ${state.pointName}…`);
  void context.solveDerivedDrag(state.pointName, target, state.baseRevision)
    .then((result) => {
      if (
        context.session.drag !== state
        || requestSequence !== state.activeRequestSequence
        || result.sourceRevision !== state.baseRevision
      ) return;
      state.solving = false;
      const queued = state.queuedTarget;
      state.queuedTarget = null;
      if (queued) {
        // A newer target owns both the preview and the eventual commit.
        requestDerivedSolve(state, context, queued);
        return;
      }
      if (result.status !== 'unsolved' && result.patches.length > 0) {
        state.pendingPatches = result.patches;
        context.previewPatch?.(applyTextPatches(state.baseCode, result.patches));
        context.setSolverStatus?.(
          result.status === 'underconstrained'
            ? `欠约束：已采用最小位移解（${result.variables.join(', ')}）`
            : '约束已保持',
        );
      } else {
        state.pendingPatches = [];
        context.previewPatch?.(null);
        context.setSolverStatus?.(result.message || '当前拖动目标无可行解');
      }

      if (state.released) commitDrag(state, context);
    })
    .catch((error: unknown) => {
      if (
        context.session.drag !== state
        || requestSequence !== state.activeRequestSequence
      ) return;
      state.solving = false;
      const queued = state.queuedTarget;
      state.queuedTarget = null;
      if (queued) {
        requestDerivedSolve(state, context, queued);
        return;
      }
      context.setSolverStatus?.(
        error instanceof Error ? `约束求解失败：${error.message}` : '约束求解失败',
      );
      if (state.released) clearDrag(context);
    });
}

function authoringAnchor(
  event: ReactPointerEvent,
  context: ToolContext,
  state: AuthoringState,
): AuthoringAnchor | null {
  const screen = localScreen(event, context);
  const slotIndex = Math.min(
    state.anchors.length,
    Math.max(0, state.spec.inputSlots.length - 1),
  );
  const slot = state.spec.inputSlots[slotIndex];

  if (slot?.accepts === 'circle') {
    const circle = hitTestCircle(
      screen,
      context,
      AUTHORING_CIRCLE_HIT_TOLERANCE_PX,
    );
    if (!circle) return null;
    const centerName = circle.centerName;
    const centerPoint = centerName
      ? context.scene.points.get(centerName)
      : null;
    if (!centerPoint || circle.radius <= 1e-8) return null;
    const throughName = circle.throughName;
    const throughPoint = throughName
      ? context.scene.points.get(throughName)
      : null;
    const pointer = context.toScenePoint(event.clientX, event.clientY);
    const pointerAngle = Math.atan2(
      pointer.y - circle.center.y,
      pointer.x - circle.center.x,
    );
    const baseAngle = throughPoint
      ? Math.atan2(
        throughPoint.position.y - circle.center.y,
        throughPoint.position.x - circle.center.x,
      )
      : 0;
    const angleDeg = ((pointerAngle - baseAngle) * 180) / Math.PI;
    return {
      name: `circle:${circle.stableId}`,
      position: {
        x: circle.center.x + Math.cos(pointerAngle) * circle.radius,
        y: circle.center.y + Math.sin(pointerAngle) * circle.radius,
      },
      existing: true,
      circle: {
        stableId: circle.stableId,
        stmtIndex: circle.stmtIndex,
        sourceRange: circle.sourceRange,
        centerName,
        throughName,
        center: circle.center,
        radius: circle.radius,
        angleDeg,
        definition: circle.definition,
      },
    };
  }

  const existingName = hitTestPointHandle(
    screen,
    context.scene,
    context.viewport,
    AUTHORING_POINT_HIT_TOLERANCE_PX,
  );
  if (existingName) {
    const point = context.scene.points.get(existingName)!;
    return {
      name: existingName,
      position: point.position,
      existing: true,
    };
  }

  if (!slot?.createOnEmpty) return null;

  const reserved = new Set([
    ...context.scene.points.keys(),
    ...state.anchors.map((anchor) => anchor.name),
  ]);
  return {
    name: nextPointName(reserved),
    position: context.toScenePoint(event.clientX, event.clientY),
    existing: false,
  };
}

/**
 * Build a draft ConstructionPlan without touching the document allocator.
 * Every allocator is local to this call, so pointer moves cannot consume
 * names or construction ids that the eventual commit must own.
 */
function draftPreviewPlan(
  context: ToolContext,
  spec: ConstructionToolSpec,
  state: AuthoringState | null,
  previewAnchor: AuthoringAnchor,
): { plan: ConstructionPlan; points: ReadonlyMap<string, Pt> } | null {
  const anchors = [
    ...(state?.anchors ?? []),
    previewAnchor,
  ];
  const pointNames = [
    ...context.scene.points.keys(),
    ...anchors.map((anchor) => anchor.name),
  ];
  const identity: ManagedIdentityCache = state
    ? {
      constructionIds: state.managedConstructionIds,
      referenceMarkers: state.managedReferenceMarkers,
    }
    : { constructionIds: new Set(), referenceMarkers: new Set() };
  const allocators = constructionAllocators(pointNames, identity, !state);
  const plan = spec.plan?.({
    anchors,
    nextName: allocators.nextName,
    nextConstructionId: allocators.nextConstructionId,
  })
    ?? (
      spec.category === 'primitive'
      && spec.kind
      && isPrimitiveConstructionKind(spec.kind)
        ? createPrimitiveConstructionPlan(spec.kind, {
          anchors,
          nextName: allocators.nextName,
          nextConstructionId: allocators.nextConstructionId,
        })
        : undefined
    );
  if (!plan) return null;
  const points = new Map<string, Pt>();
  for (const [name, scenePoint] of context.scene.points) {
    const position = scenePoint.position;
    if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
      points.set(name, { x: position.x, y: position.y });
    }
  }
  for (const anchor of anchors) {
    points.set(anchor.name, {
      x: anchor.position.x,
      y: anchor.position.y,
    });
  }
  if (plan.kind === 'tangent-at-point') {
    const circleAnchor = anchors.find((anchor) => anchor.circle != null);
    if (
      circleAnchor
      && Number.isFinite(circleAnchor.position.x)
      && Number.isFinite(circleAnchor.position.y)
    ) {
      points.set(plan.touch, {
        x: circleAnchor.position.x,
        y: circleAnchor.position.y,
      });
    }
  }
  return { plan, points };
}

function constructionPreview(
  event: ReactPointerEvent,
  context: ToolContext,
  spec: ConstructionToolSpec,
  state: AuthoringState | null,
): void {
  const screen = localScreen(event, context);
  const candidateName = hitTestPointHandle(
    screen,
    context.scene,
    context.viewport,
    AUTHORING_POINT_HIT_TOLERANCE_PX,
  );
  const pointer = context.toScenePoint(event.clientX, event.clientY);
  const candidate = candidateName
    ? context.scene.points.get(candidateName)?.position ?? null
    : null;
  const anchors = state?.anchors ?? [];
  const slotIndex = Math.min(
    anchors.length,
    Math.max(0, spec.inputSlots.length - 1),
  );
  const slot = spec.inputSlots[slotIndex];
  const circleElement = slot?.accepts === 'circle'
    ? hitTestCircle(
      screen,
      context,
      AUTHORING_CIRCLE_HIT_TOLERANCE_PX,
    )
    : null;
  const circleCandidate = circleElement
    ? (() => {
      const angle = Math.atan2(
        pointer.y - circleElement.center.y,
        pointer.x - circleElement.center.x,
      );
      return {
        x: circleElement.center.x + Math.cos(angle) * circleElement.radius,
        y: circleElement.center.y + Math.sin(angle) * circleElement.radius,
      };
    })()
    : null;
  const effectiveCandidate = slot?.accepts === 'circle'
    ? circleCandidate
    : candidate;
  const baseValid = Boolean(effectiveCandidate) || Boolean(slot?.createOnEmpty);
  const previewName = slot?.accepts === 'circle'
    ? circleElement?.stableId ?? '__preview_circle__'
    : candidateName ?? (
      slot?.createOnEmpty
        ? nextPointName(new Set([
          ...context.scene.points.keys(),
          ...anchors.map((anchor) => anchor.name),
        ]))
        : '__preview__'
    );
  const previewAnchor: AuthoringAnchor = {
    name: previewName,
    position: effectiveCandidate ?? pointer,
    existing: Boolean(effectiveCandidate),
    ...(circleElement
      ? {
        circle: {
          stableId: circleElement.stableId,
          stmtIndex: circleElement.stmtIndex,
          sourceRange: circleElement.sourceRange,
          centerName: circleElement.centerName,
          throughName: circleElement.throughName,
          center: circleElement.center,
          radius: circleElement.radius,
          angleDeg: 0,
          definition: circleElement.definition,
        },
      }
      : {}),
  };
  const validationMessage = (
    baseValid
    && !spec.variableArity
    && anchors.length + 1 >= spec.inputSlots.length
  )
    ? spec.validate?.([...anchors, previewAnchor]) ?? null
    : null;
  const valid = baseValid && !validationMessage;
  let previewIR: ConstructionPreviewIR | undefined;
  if (valid && (effectiveCandidate || slot?.createOnEmpty)) {
    try {
      const draft = draftPreviewPlan(context, spec, state, previewAnchor);
      if (draft) previewIR = createConstructionPreviewIR(draft.plan, draft.points);
    } catch {
      // Incomplete/invalid plans retain the generic anchor/path overlay. The
      // commit path remains the only writer and performs full validation.
      previewIR = undefined;
    }
  }
  context.setConstructionPreview?.({
    toolId: spec.id,
    valid,
    prompt: validationMessage ?? slot?.prompt ?? spec.description,
    anchors: anchors.map((anchor) => anchor.position),
    pointer,
    candidate: effectiveCandidate,
    candidateName: slot?.accepts === 'circle'
      ? circleElement?.stableId ?? null
      : candidateName,
    closePath: spec.kind === 'polygon' && anchors.length >= 2,
    previewIR,
  });
}

function sourceRangeOverlapsManagedDirectiveRegion(
  source: string,
  range: { readonly start: number; readonly end: number },
): boolean {
  const directive = /^[ \t]*%[ \t]*@mathgeo[ \t]+(begin|end)\b[^\r\n]*(?:\r?\n|$)/gmi;
  const openBegins: number[] = [];
  const protectedRanges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = directive.exec(source))) {
    if (match[1].toLowerCase() === 'begin') {
      openBegins.push(match.index);
      continue;
    }
    const start = openBegins.pop();
    protectedRanges.push({
      start: start ?? match.index,
      end: directive.lastIndex,
    });
  }
  for (const start of openBegins) {
    protectedRanges.push({ start, end: source.length });
  }
  return protectedRanges.some((protectedRange) => (
    range.start < protectedRange.end && range.end > protectedRange.start
  ));
}

function commitAuthoring(state: AuthoringState, context: ToolContext): void {
  // Creation uses the immutable ConstructionPreview overlay. Any source
  // preview belongs to the drag-only lane and must never leak into a commit.
  context.previewPatch?.(null);
  let finalAnchors = state.anchors;
  if (state.kind === 'point' && finalAnchors[0]?.existing) {
    context.setSelection([finalAnchors[0].name]);
    cancelActiveToolInteraction(context.session, context);
    return;
  }
  const pointNames = [
    ...context.scene.points.keys(),
    ...finalAnchors.map((anchor) => anchor.name),
  ];
  const allocators = constructionAllocators(pointNames, {
    constructionIds: state.managedConstructionIds,
    referenceMarkers: state.managedReferenceMarkers,
  });
  const nextName = allocators.nextName;
  const managedBlocks = parseManagedConstructionBlocks(state.baseCode);
  const nextConstructionId = allocators.nextConstructionId;
  let custom: {
    lines: readonly string[];
    selection: readonly string[];
    status: string;
  } | undefined;
  let outputSelection: readonly string[] = [];
  let constructionId: string | null = null;
  const adoptionPatches: TextPatch[] = [];
  const adoptionIds: string[] = [];
  try {
    const adoptedCircles = new Map<string, string>();
    finalAnchors = state.anchors.map((anchor) => {
      const circle = anchor.circle;
      if (!circle || !circle.stableId.startsWith('source:circle:')) {
        return anchor;
      }
      const reusedReference = adoptedCircles.get(circle.stableId);
      if (reusedReference) {
        return {
          ...anchor,
          name: `circle:${reusedReference}`,
          circle: { ...circle, stableId: reusedReference },
        };
      }
      const range = circle.sourceRange;
      if (
        !range
        || range.start < 0
        || range.end <= range.start
        || range.end > state.baseCode.length
      ) {
        throw new ConstructionPlanValidationError([{
          path: 'circle.sourceRange',
          message: 'raw circle cannot be adopted without its current source range',
        }]);
      }
      const owningManagedBlock = managedBlocks.find((block) => (
        range.start < block.range.end && range.end > block.range.start
      ));
      if (owningManagedBlock) {
        throw new ConstructionPlanValidationError([{
          path: 'circle.sourceRange',
          message: `circle source is already inside managed block ${owningManagedBlock.id}; repair or recompile that block before reuse`,
        }]);
      }
      if (sourceRangeOverlapsManagedDirectiveRegion(state.baseCode, range)) {
        throw new ConstructionPlanValidationError([{
          path: 'circle.sourceRange',
          message: 'circle source is inside a malformed managed directive region; repair the source before reuse',
        }]);
      }
      const adoptionId = nextConstructionId('source-circle');
      adoptionIds.push(adoptionId);
      const entityId = 'circle';
      const adoptedReference = qualifiedManagedEntityReference(
        adoptionId,
        entityId,
      );
      const compiledAdoption = compileSourceCircleAdoption({
        id: adoptionId,
        entityId,
        source: state.baseCode.slice(range.start, range.end),
        circle: circle.definition.kind === 'center-through'
          ? {
            center: circle.definition.centerName,
            through: circle.definition.throughName,
          }
          : {
            center: circle.definition.centerName,
            radius: circle.definition.radius,
          },
      });
      adoptionPatches.push({
        from: range.start,
        to: range.end,
        insert: compiledAdoption.lines.join('\n'),
      });
      adoptedCircles.set(circle.stableId, adoptedReference);
      return {
        ...anchor,
        name: `circle:${adoptedReference}`,
        circle: { ...circle, stableId: adoptedReference },
      };
    });
    const planContext = {
      anchors: finalAnchors,
      nextName,
      nextConstructionId,
    };
    const plan = state.spec.plan?.(planContext)
      ?? (
        state.spec.category === 'primitive'
        && state.spec.kind
        && isPrimitiveConstructionKind(state.spec.kind)
          ? createPrimitiveConstructionPlan(state.spec.kind, planContext)
          : undefined
      );
    outputSelection = plan?.outputs.map((output) => output.ref) ?? [];
    if (plan) {
      constructionId = plan.id;
      const ownedInputPlans = state.kind === 'point'
        ? []
        : finalAnchors
          .filter((anchor) => !anchor.existing)
          .map((anchor) => createPrimitiveConstructionPlan('point', {
            anchors: [anchor],
            nextName,
            nextConstructionId,
          }));
      const compiledInputs = ownedInputPlans.map((inputPlan) => (
        compileConstructionPlan(inputPlan)
      ));
      const compiled = compileConstructionPlan(plan);
      custom = {
        ...compiled,
        lines: [
          ...compiledInputs.flatMap((input) => input.lines),
          ...compiled.lines,
        ],
      };
    }
  } catch (error) {
    context.setSolverStatus?.(
      error instanceof ConstructionPlanValidationError
        ? `构造计划无效：${error.issues[0]?.message ?? error.message}`
        : error instanceof Error
          ? error.message
          : '构造计划无法编译',
    );
    cancelActiveToolInteraction(context.session, context);
    return;
  }
  if (!custom) {
    context.setSolverStatus?.('当前工具缺少 Construction IR 或源码编译器');
    cancelActiveToolInteraction(context.session, context);
    return;
  }
  if (
    custom.lines.length < 2
    || custom.lines[custom.lines.length - 1] !== '% @mathgeo end'
  ) {
    context.setSolverStatus?.(
      '构造编译器返回了不完整的 managed block，事务已拒绝',
    );
    cancelActiveToolInteraction(context.session, context);
    return;
  }
  const patch = insertBeforeTikzEndPatch(state.baseCode, custom.lines);
  const sourcePatches = [...adoptionPatches, patch];
  const prospectiveSource = applyTextPatches(state.baseCode, sourcePatches);
  const prospectiveBlocks = parseManagedConstructionBlocks(prospectiveSource);
  const prospectiveBlock = constructionId
    ? prospectiveBlocks.find((block) => block.id === constructionId)
    : null;
  const prospectiveAdoptionsAreValid = adoptionIds.every((adoptionId) => {
    const matches = prospectiveBlocks.filter((block) => block.id === adoptionId);
    return (
      matches.length === 1
      && matches[0].metadataStatus === 'valid'
      && matches[0].integrityStatus === 'valid'
    );
  });
  if (
    !prospectiveBlock
    || prospectiveBlock.metadataStatus !== 'valid'
    || prospectiveBlock.integrityStatus !== 'valid'
    || !prospectiveAdoptionsAreValid
  ) {
    context.setSolverStatus?.(
      '构造事务无法形成完整且指纹有效的 managed block，已拒绝写入',
    );
    cancelActiveToolInteraction(context.session, context);
    return;
  }
  // CodeMirror and the source broker both accept multi-change transactions,
  // but an adoption replacement may end exactly where the dependent block is
  // inserted. Collapse that boundary-touching set to one minimal source patch
  // so neither editor change ordering nor UTF-16 range association can split
  // the managed block.
  const transactionPatches = adoptionPatches.length === 0
    ? [patch]
    : [
      minimalTextPatch(
        state.baseCode,
        prospectiveSource,
      ),
    ].filter((value): value is TextPatch => value !== null);
  const committed = context.applySourcePatches(
    transactionPatches,
    'canvas',
    state.baseRevision,
  );
  if (committed) {
    const displayRefs = custom.selection.length > 0
      ? [...custom.selection]
      : outputSelection.length > 0
        ? [...outputSelection]
        : state.resultName
          ? [state.resultName]
          : finalAnchors.map((anchor) => anchor.name);
    if (context.setSelectionTargets) {
      const mappedPatchStart = patch.from + adoptionPatches.reduce(
        (delta, adoptionPatch) => (
          adoptionPatch.from <= patch.from
            ? delta + adoptionPatch.insert.length
              - (adoptionPatch.to - adoptionPatch.from)
            : delta
        ),
        0,
      );
      context.setSelectionTargets([{
        kind: 'source-block',
        sourceRevision: state.baseRevision + 1,
        range: {
          start: mappedPatchStart,
          end: mappedPatchStart + patch.insert.length,
        },
        refs: displayRefs,
      }]);
    } else {
      context.setSelection(displayRefs);
    }
    context.setSolverStatus?.(
      custom?.status
        ?? (state.kind === 'point'
        ? `已创建点 ${finalAnchors[0].name}`
        : state.resultName
          ? `已创建派生点 ${state.resultName}`
          : '已写回 TikZ 源码'),
    );
  } else {
    context.setSolverStatus?.(
      '画板在构造期间已更新，本次构造未提交；请基于最新图形重试',
    );
  }
  context.session.authoring = null;
  context.previewPatch?.(null);
  context.setConstructionPreview?.(null);
}

function requiredAnchorCount(kind: AuthoringElementKind | 'point'): number | null {
  if (kind === 'point' || kind === 'label') return 1;
  if (
    kind === 'angle'
    || kind === 'right-angle'
    || kind === 'perpendicular-foot'
  ) return 3;
  if (kind === 'polyline' || kind === 'polygon') return null;
  return 2;
}

function minimumAnchorCount(kind: AuthoringElementKind | 'point'): number {
  if (kind === 'polygon') return 3;
  if (kind === 'polyline') return 2;
  return requiredAnchorCount(kind) ?? 1;
}

function authoringInstruction(state: AuthoringState): string {
  const { kind, spec } = state;
  const count = state.anchors.length;
  if (!kind) {
    const nextSlot = spec.inputSlots[Math.min(count, spec.inputSlots.length - 1)];
    return `${count}/${spec.inputSlots.length} · ${nextSlot?.prompt ?? spec.description}`;
  }
  if (kind === 'polygon' || kind === 'polyline') {
    return `已选 ${count} 点；继续点击，双击或按 Enter 完成，Esc 取消`;
  }
  const required = requiredAnchorCount(kind) ?? 1;
  return `已选 ${count}/${required} 点`;
}

function creationTool(spec: ConstructionToolSpec): Tool {
  const kind = spec.kind ?? null;
  return {
    id: spec.id,
    label: spec.label,
    symbol: spec.symbol,
    description: spec.description,
    category: spec.category,
    aliases: spec.aliases,
    shortcut: shortcutForTool(spec.id) ?? spec.shortcut,
    inputSlots: spec.inputSlots,
    cursor: 'crosshair',
    onPointerDown(event, context) {
      // A tool switch or a prior drag can leave a source preview in the
      // interaction state. Creation always starts from persistent source.
      context.previewPatch?.(null);
      context.setConstructionPreview?.(null);
      if (
        !context.session.authoring
        || context.session.authoring.toolId !== spec.id
        || context.session.authoring.baseRevision !== context.revision
      ) {
        const identityCache = managedIdentityCache(context.code);
        context.session.authoring = {
          toolId: spec.id,
          spec,
          kind,
          baseCode: context.code,
          baseRevision: context.revision,
          anchors: [],
          resultName: spec.kind && spec.resultPrefix
            ? nextPointName(
              new Set(context.scene.points.keys()),
              spec.resultPrefix,
            )
            : null,
          managedConstructionIds: identityCache.constructionIds,
          managedReferenceMarkers: identityCache.referenceMarkers,
        };
      }
      const state = context.session.authoring;
      const minimum = kind ? minimumAnchorCount(kind) : spec.inputSlots.length;
      if (
        spec.variableArity
        && event.detail >= 2
        && state.anchors.length >= minimum
      ) {
        commitAuthoring(state, context);
        event.preventDefault();
        return;
      }

      const next = authoringAnchor(event, context, state);
      if (!next) {
        const slot = spec.inputSlots[Math.min(
          state.anchors.length,
          Math.max(0, spec.inputSlots.length - 1),
        )];
        context.setSolverStatus?.(
          slot?.accepts === 'circle'
            ? '请选择具有可逆圆定义语义的圆'
            : '请点击已有点',
        );
        event.preventDefault();
        return;
      }
      const first = state.anchors[0];
      const closeDistance = first
        ? Math.hypot(
          next.position.x - first.position.x,
          next.position.y - first.position.y,
        ) * context.viewport.scale
        : Number.POSITIVE_INFINITY;
      if (
        kind === 'polygon'
        && state.anchors.length >= minimum
        && closeDistance <= 12
      ) {
        commitAuthoring(state, context);
        event.preventDefault();
        return;
      }
      if (state.anchors.some((anchor) => anchor.name === next.name)) {
        context.setSolverStatus?.('请选择不同的已有点');
        event.preventDefault();
        return;
      }
      if (state.anchors.at(-1)?.name !== next.name) {
        state.anchors.push(next);
      }

      const required = spec.variableArity
        ? null
        : kind
          ? requiredAnchorCount(kind)
          : spec.inputSlots.length;
      if (required !== null && state.anchors.length >= required) {
        const validationMessage = spec.validate?.(state.anchors) ?? null;
        if (validationMessage) {
          state.anchors.pop();
          context.setSolverStatus?.(validationMessage);
          constructionPreview(event, context, spec, state);
          event.preventDefault();
          return;
        }
        commitAuthoring(state, context);
      } else {
        constructionPreview(event, context, spec, state);
        context.setSolverStatus?.(authoringInstruction(state));
      }
      event.preventDefault();
    },
    onPointerMove(event, context) {
      const state = context.session.authoring?.toolId === spec.id
        ? context.session.authoring
        : null;
      constructionPreview(event, context, spec, state);
    },
    onPointerCancel(_event, context) {
      cancelActiveToolInteraction(context.session, context);
    },
  };
}

export function finishActiveToolInteraction(context: ToolContext): boolean {
  const authoring = context.session.authoring;
  if (!authoring) return false;
  context.previewPatch?.(null);
  const minimum = authoring.kind
    ? minimumAnchorCount(authoring.kind)
    : authoring.spec.inputSlots.length;
  if (authoring.anchors.length < minimum) return false;
  commitAuthoring(authoring, context);
  return true;
}

export function stepBackActiveToolInteraction(context: ToolContext): boolean {
  const authoring = context.session.authoring;
  if (!authoring || authoring.anchors.length === 0) {
    cancelActiveToolInteraction(context.session, context);
    return false;
  }
  authoring.anchors.pop();
  context.previewPatch?.(null);
  context.setConstructionPreview?.(null);
  context.setSolverStatus?.(
    authoring.anchors.length === 0
      ? authoring.spec.description
      : authoringInstruction(authoring),
  );
  return true;
}

export const selectTool: Tool = {
  id: 'select',
  label: '选择/拖拽',
  symbol: '↖',
  description: '选择图元并拖动自由点或约束点',
  category: 'navigate',
  aliases: ['select', 'move', '选择', '移动'],
  shortcut: shortcutForTool('select'),
  cursor: 'default',
  onPointerDown(event, context) {
    const screen = localScreen(event, context);
    const elementHit = hitTestToolElement(screen, context, 8);
    if (elementHit?.kind === 'label') {
      if (context.setSelectionTargets) {
        context.setSelectionTargets([
          selectionTargetForElementHit(elementHit),
        ]);
      } else {
        context.setSelection([...elementHit.refs], elementHit.stmtIndex);
      }
      return;
    }

    const pointName = hitTestPointHandle(screen, context.scene, context.viewport, 12);
    if (
      pointName
      && !preferAngleMarkOverPoint(elementHit, pointName, screen, context)
    ) {
      const point = context.scene.points.get(pointName);
      if (point && context.setSelectionTargets) {
        context.setSelectionTargets([{
          kind: 'entity',
          stableId: point.stableId,
          stmtIndex: point.stmtIndex,
          entityKind: 'point',
          refs: [point.name],
        }]);
      } else {
        context.setSelection([pointName], point?.stmtIndex ?? null);
      }
      if (context.readOnly) return;
      const range = context.freePointRanges.get(pointName);
      if (
        range
        || point?.constraint
        || (point && !point.free && context.solveDerivedDrag)
      ) {
        context.session.drag = {
          mode: range
            ? 'free'
            : point?.constraint
              ? 'path'
              : 'derived',
          pointName,
          baseCode: context.code,
          baseRevision: context.revision,
          range: range ?? point?.constraint?.angleRanges[0] ?? null,
          circleConstraint: point?.constraint
            ? {
              centerName: point.constraint.centerName,
              throughName: point.constraint.throughName,
              radius: point.constraint.radius,
              angleRanges: point.constraint.angleRanges,
            }
            : undefined,
          pendingPatches: [],
          solving: false,
          queuedTarget: null,
          requestSequence: 0,
          activeRequestSequence: 0,
          released: false,
        };
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }
      return;
    }

    if (elementHit && context.setSelectionTargets) {
      context.setSelectionTargets([
        selectionTargetForElementHit(elementHit),
      ]);
    } else if (elementHit) {
      context.setSelection([...elementHit.refs], elementHit.stmtIndex);
    } else {
      context.setSelection([], null);
    }
  },
  onPointerMove(event, context) {
    const drag = context.session.drag;
    if (!drag) {
      const screen = localScreen(event, context);
      const pointName = hitTestPointHandle(screen, context.scene, context.viewport, 18);
      const point = pointName ? context.scene.points.get(pointName) : null;
      const element = hitTestToolElement(screen, context, 10);
      const anglePreferred = preferAngleMarkOverPoint(
        element,
        pointName,
        screen,
        context,
      );
      context.setHoveredStmtIndex?.(
        anglePreferred
          ? element?.stmtIndex ?? null
          : point?.stmtIndex ?? element?.stmtIndex ?? null,
      );
      return;
    }
    if (context.revision !== drag.baseRevision) {
      context.setSolverStatus?.(
        '画板在拖动期间已更新，已取消过期预览',
      );
      clearDrag(context);
      return;
    }
    const next = context.toScenePoint(event.clientX, event.clientY);
    if (drag.mode === 'free' && drag.range) {
      const patch = coordinateLiteralPatch(drag.baseCode, drag.range, next);
      drag.pendingPatches = [patch];
      context.previewPatch?.(applyTextPatch(drag.baseCode, patch));
    } else if (
      drag.mode === 'path'
      && drag.circleConstraint
      && drag.circleConstraint.angleRanges.length > 0
    ) {
      const center = context.scene.points.get(
        drag.circleConstraint.centerName,
      )?.position;
      const through = drag.circleConstraint.throughName
        ? context.scene.points.get(drag.circleConstraint.throughName)?.position
        : null;
      if (!center || (drag.circleConstraint.throughName && !through)) {
        context.setSolverStatus?.('圆上点的宿主圆已失效');
        return;
      }
      const baseAngle = through
        ? Math.atan2(through.y - center.y, through.x - center.x)
        : 0;
      const targetAngle = Math.atan2(
        next.y - center.y,
        next.x - center.x,
      );
      let angleDeg = ((targetAngle - baseAngle) * 180) / Math.PI;
      if (angleDeg > 180) angleDeg -= 360;
      if (angleDeg <= -180) angleDeg += 360;
      const insert = formatCoordNumber(angleDeg);
      const patches: TextPatch[] = drag.circleConstraint.angleRanges.map((range) => ({
        from: range.start,
        to: range.end,
        insert,
      }));
      drag.pendingPatches = patches;
      context.previewPatch?.(applyTextPatches(drag.baseCode, patches));
    } else {
      requestDerivedSolve(drag, context, next);
    }
    event.preventDefault();
  },
  onPointerUp(event, context) {
    const drag = context.session.drag;
    if (!drag) return;
    const state = drag;
    if (state.mode === 'free' || state.mode === 'path') {
      commitDrag(state, context);
    } else {
      state.released = true;
      requestDerivedSolve(
        state,
        context,
        context.toScenePoint(event.clientX, event.clientY),
      );
    }
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  },
  onPointerCancel(_event, context) {
    clearDrag(context);
    context.setHoveredStmtIndex?.(null);
  },
};

export const panTool: Tool = {
  id: 'pan',
  label: '平移',
  symbol: '✥',
  description: '拖动画布；滚轮可缩放',
  category: 'navigate',
  aliases: ['pan', 'hand', '平移'],
  shortcut: shortcutForTool('pan'),
  cursor: 'grab',
  onPointerDown(event, context) {
    context.session.pan = {
      pointerId: event.pointerId,
      start: localScreen(event, context),
      viewport: context.viewport,
    };
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  },
  onPointerMove(event, context) {
    const pan = context.session.pan;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const current = localScreen(event, context);
    context.setViewport({
      ...pan.viewport,
      offsetX: pan.viewport.offsetX + current.x - pan.start.x,
      offsetY: pan.viewport.offsetY + current.y - pan.start.y,
    });
    event.preventDefault();
  },
  onPointerUp(event, context) {
    if (context.session.pan?.pointerId === event.pointerId) {
      context.session.pan = null;
    }
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  },
  onPointerCancel(_event, context) {
    context.session.pan = null;
  },
};

const constructionTools = new Map(
  CONSTRUCTION_TOOL_SPECS.map((spec) => [spec.id, creationTool(spec)]),
);

function requiredTool(id: string): Tool {
  const tool = constructionTools.get(id);
  if (!tool || !constructionSpecRegistry.has(id)) {
    throw new Error(`缺少构造工具 ${id}`);
  }
  return tool;
}

export const pointTool = requiredTool('point');
export const segmentTool = requiredTool('segment');
export const vectorTool = requiredTool('vector');
export const lineTool = requiredTool('line');
export const rayTool = requiredTool('ray');
export const polylineTool = requiredTool('polyline');
export const polygonTool = requiredTool('polygon');
export const rectangleTool = requiredTool('rectangle');
export const circleTool = requiredTool('circle');
export const labelTool = requiredTool('label');
export const angleTool = requiredTool('angle');
export const rightAngleTool = requiredTool('right-angle');
export const midpointTool = requiredTool('midpoint');
export const perpendicularFootTool = requiredTool('perpendicular-foot');

export const AUTHORING_TOOLS: readonly Tool[] = [
  selectTool,
  panTool,
  ...constructionTools.values(),
];

export const toolRegistry: ReadonlyMap<string, Tool> = new Map([
  ...AUTHORING_TOOLS.map((tool) => [tool.id, tool] as const),
]);
