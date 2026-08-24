import type { SelectionTarget } from '../authoring/selection-target';
import type { Pt } from '../semantics/calc-eval';
import type { ScreenRect } from './selection-marquee';
import type { SelectionTransformHandle } from './selection-transform-handles';

export const CANVAS_INTERACTION_SESSION_SCHEMA_VERSION =
  'canvas-interaction-session/v1' as const;

export interface CanvasInteractionBasis {
  readonly revision: number;
  readonly sourceHash: string;
  readonly kernelHash?: string;
  readonly projectionHash?: string;
}

export type CanvasInteractionCancellationReason =
  | 'escape'
  | 'pointer-cancel'
  | 'tool-switch'
  | 'source-change'
  | 'stale-revision'
  | 'commit-rejected'
  | 'solver-failed'
  | 'replaced';

export interface CanvasInteractionOutcome {
  readonly interactionId: string;
  readonly result: 'completed' | 'cancelled';
  readonly reason?: CanvasInteractionCancellationReason;
}

export interface CanvasInteractionPreviewOwner {
  readonly interactionId: string;
  readonly basis: CanvasInteractionBasis;
  readonly toolId: string;
}

interface CanvasInteractionBase {
  readonly schemaVersion: typeof CANVAS_INTERACTION_SESSION_SCHEMA_VERSION;
  readonly sequence: number;
  readonly basis: CanvasInteractionBasis;
  readonly toolId: string;
  readonly lastOutcome?: CanvasInteractionOutcome;
}

export interface IdleCanvasInteractionSession extends CanvasInteractionBase {
  readonly phase: 'idle';
}

interface ActiveCanvasInteractionBase extends CanvasInteractionBase {
  readonly interactionId: string;
  readonly pointerId: number;
  readonly start: Pt;
  readonly current: Pt;
}

export interface MarqueeCanvasInteractionSession extends ActiveCanvasInteractionBase {
  readonly phase: 'box-selecting';
  readonly toolId: 'select';
  readonly additive: boolean;
  readonly baseTargets: readonly SelectionTarget[];
}

export interface TransformCanvasInteractionSession extends ActiveCanvasInteractionBase {
  readonly phase: 'transforming';
  readonly toolId: 'select';
  readonly handle: SelectionTransformHandle;
  readonly bounds: ScreenRect;
}

export interface ToolCanvasInteractionSession extends ActiveCanvasInteractionBase {
  readonly phase: 'pressed' | 'dragging' | 'constructing' | 'panning' | 'committing';
}

export type CanvasInteractionSession =
  | IdleCanvasInteractionSession
  | MarqueeCanvasInteractionSession
  | TransformCanvasInteractionSession
  | ToolCanvasInteractionSession;

export type CanvasInteractionAction =
  | {
    readonly type: 'begin-marquee';
    readonly pointerId: number;
    readonly start: Pt;
    readonly additive: boolean;
    readonly baseTargets: readonly SelectionTarget[];
  }
  | {
    readonly type: 'begin-transform';
    readonly pointerId: number;
    readonly start: Pt;
    readonly handle: SelectionTransformHandle;
    readonly bounds: ScreenRect;
  }
  | {
    readonly type: 'begin-tool';
    readonly pointerId: number;
    readonly start: Pt;
    readonly toolId: string;
    readonly phase: ToolCanvasInteractionSession['phase'];
  }
  | {
    readonly type: 'promote-tool';
    readonly pointerId: number;
    readonly phase: ToolCanvasInteractionSession['phase'];
  }
  | { readonly type: 'move'; readonly pointerId: number; readonly current: Pt }
  | { readonly type: 'finish'; readonly pointerId: number }
  | {
    readonly type: 'cancel';
    readonly pointerId?: number;
    readonly reason: CanvasInteractionCancellationReason;
  }
  | {
    readonly type: 'synchronize';
    readonly basis: CanvasInteractionBasis;
    readonly toolId: string;
  };

export type CanvasPointerEventKind =
  | 'pointer-down'
  | 'pointer-move'
  | 'pointer-up'
  | 'pointer-cancel';

function sameBasis(left: CanvasInteractionBasis, right: CanvasInteractionBasis): boolean {
  return left.revision === right.revision
    && left.sourceHash === right.sourceHash
    && left.kernelHash === right.kernelHash
    && left.projectionHash === right.projectionHash;
}

function idleFrom(
  state: CanvasInteractionSession,
  outcome?: CanvasInteractionOutcome,
  basis: CanvasInteractionBasis = state.basis,
  toolId: string = state.toolId,
): IdleCanvasInteractionSession {
  return {
    schemaVersion: CANVAS_INTERACTION_SESSION_SCHEMA_VERSION,
    phase: 'idle',
    sequence: state.sequence,
    basis,
    toolId,
    ...(outcome ? { lastOutcome: outcome } : state.lastOutcome ? {
      lastOutcome: state.lastOutcome,
    } : {}),
  };
}

export function createCanvasInteractionSession(
  basis: CanvasInteractionBasis,
  toolId = 'select',
): IdleCanvasInteractionSession {
  return {
    schemaVersion: CANVAS_INTERACTION_SESSION_SCHEMA_VERSION,
    phase: 'idle',
    sequence: 0,
    basis,
    toolId,
  };
}

/**
 * Decide pointer ownership before any mutable tool adapter or DOM capture runs.
 *
 * Hover moves are allowed while idle. Once a semantic interaction is active,
 * only its owning pointer may move/finish/cancel it. Multi-tap constructions
 * are the sole exception: a new pointer may continue the same tool without
 * manufacturing a second interaction or stealing a drag/pan/transform.
 */
export function canvasInteractionAcceptsPointer(
  state: CanvasInteractionSession,
  event: {
    readonly kind: CanvasPointerEventKind;
    readonly pointerId: number;
    readonly toolId: string;
  },
): boolean {
  if (state.phase === 'idle') {
    return event.kind === 'pointer-down' || event.kind === 'pointer-move';
  }
  if (event.kind === 'pointer-down') {
    return state.phase === 'constructing' && state.toolId === event.toolId;
  }
  return state.pointerId === event.pointerId;
}

function interactionId(
  state: IdleCanvasInteractionSession,
  pointerId: number,
  kind: string,
): string {
  return [
    'canvas',
    state.basis.revision,
    state.sequence + 1,
    pointerId,
    kind,
  ].join(':');
}

export function canvasInteractionReducer(
  state: CanvasInteractionSession,
  action: CanvasInteractionAction,
): CanvasInteractionSession {
  if (action.type === 'synchronize') {
    if (state.phase === 'idle') {
      return sameBasis(state.basis, action.basis) && state.toolId === action.toolId
        ? state
        : idleFrom(state, undefined, action.basis, action.toolId);
    }
    const reason: CanvasInteractionCancellationReason | null = !sameBasis(
      state.basis,
      action.basis,
    )
      ? state.basis.revision !== action.basis.revision
        ? 'stale-revision'
        : 'source-change'
      : state.toolId !== action.toolId
        ? 'tool-switch'
        : null;
    return reason
      ? idleFrom(state, {
          interactionId: state.interactionId,
          result: 'cancelled',
          reason,
        }, action.basis, action.toolId)
      : state;
  }

  if (action.type === 'cancel') {
    if (
      state.phase === 'idle'
      || (action.pointerId !== undefined && action.pointerId !== state.pointerId)
    ) return state;
    return idleFrom(state, {
      interactionId: state.interactionId,
      result: 'cancelled',
      reason: action.reason,
    });
  }

  if (action.type === 'move') {
    return state.phase !== 'idle' && state.pointerId === action.pointerId
      ? { ...state, current: action.current }
      : state;
  }

  if (action.type === 'promote-tool') {
    return state.phase !== 'idle'
      && state.phase !== 'box-selecting'
      && state.phase !== 'transforming'
      && state.pointerId === action.pointerId
      ? { ...state, phase: action.phase }
      : state;
  }

  if (action.type === 'finish') {
    if (state.phase === 'idle' || state.pointerId !== action.pointerId) return state;
    return idleFrom(state, {
      interactionId: state.interactionId,
      result: 'completed',
    });
  }

  if (state.phase !== 'idle') {
    // A construction is one semantic interaction even when it takes several
    // clicks. Touch input may allocate a fresh pointer id for every tap, so
    // transfer pointer ownership without manufacturing a second interaction
    // or losing the revision-bound basis captured by the first click.
    if (
      action.type === 'begin-tool'
      && state.phase === 'constructing'
      && action.phase === 'constructing'
      && state.toolId === action.toolId
    ) {
      return {
        ...state,
        pointerId: action.pointerId,
        start: action.start,
        current: action.start,
      };
    }
    return state;
  }
  const sequence = state.sequence + 1;
  if (action.type === 'begin-marquee') {
    return {
      ...state,
      phase: 'box-selecting',
      sequence,
      interactionId: interactionId(state, action.pointerId, 'marquee'),
      pointerId: action.pointerId,
      toolId: 'select',
      start: action.start,
      current: action.start,
      additive: action.additive,
      baseTargets: action.baseTargets,
    };
  }
  if (action.type === 'begin-transform') {
    return {
      ...state,
      phase: 'transforming',
      sequence,
      interactionId: interactionId(state, action.pointerId, 'transform'),
      pointerId: action.pointerId,
      toolId: 'select',
      start: action.start,
      current: action.start,
      handle: action.handle,
      bounds: action.bounds,
    };
  }
  return {
    ...state,
    phase: action.phase,
    sequence,
    interactionId: interactionId(state, action.pointerId, action.phase),
    pointerId: action.pointerId,
    toolId: action.toolId,
    start: action.start,
    current: action.start,
  };
}

export function canvasInteractionActive(
  state: CanvasInteractionSession,
): state is Exclude<CanvasInteractionSession, IdleCanvasInteractionSession> {
  return state.phase !== 'idle';
}

/**
 * Bind preview output to the semantic interaction that produced it. Pointer
 * IDs are intentionally excluded because touch multi-tap constructions may
 * transfer pointer ownership while retaining one interaction.
 */
export function canvasInteractionPreviewOwner(
  state: CanvasInteractionSession,
): CanvasInteractionPreviewOwner | null {
  return canvasInteractionActive(state)
    ? {
        interactionId: state.interactionId,
        basis: state.basis,
        toolId: state.toolId,
      }
    : null;
}

export function canvasInteractionOwnsPreview(
  state: CanvasInteractionSession,
  owner: CanvasInteractionPreviewOwner | null | undefined,
): boolean {
  return Boolean(
    owner
    && canvasInteractionActive(state)
    && state.interactionId === owner.interactionId
    && state.toolId === owner.toolId
    && sameBasis(state.basis, owner.basis),
  );
}
