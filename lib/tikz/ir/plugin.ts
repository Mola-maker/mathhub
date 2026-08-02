import type {
  SemanticPluginDescriptor,
} from './capabilities';
import type {
  GeometryKernelInputEnvelope,
  GeometryKernelOutputEnvelope,
} from './io';
import type { GeometryDiagnostic } from './model';
import type {
  GeometryProjectionRequest,
  GeometryProjectionResult,
} from './projection';
import type {
  GeometryTransactionRequest,
  GeometryTransactionResult,
} from './transactions';

export type MaybePromise<T> = T | Promise<T>;

export interface SemanticPluginContext {
  signal?: AbortSignal;
  now: () => number;
  reportDiagnostic?: (diagnostic: GeometryDiagnostic) => void;
}

/**
 * A semantic plugin owns translation for a declared geometry/source dialect.
 * Projection is required; transaction and arbitrary channel I/O are optional
 * so read-only importers and render-only plugins remain valid participants.
 */
export interface GeometrySemanticPlugin {
  readonly descriptor: SemanticPluginDescriptor;

  project(
    request: GeometryProjectionRequest,
    context: SemanticPluginContext,
  ): MaybePromise<GeometryProjectionResult>;

  applyTransaction?(
    request: GeometryTransactionRequest,
    context: SemanticPluginContext,
  ): MaybePromise<GeometryTransactionResult>;

  handleInput?(
    envelope: GeometryKernelInputEnvelope,
    context: SemanticPluginContext,
  ): MaybePromise<
    GeometryKernelOutputEnvelope
    | readonly GeometryKernelOutputEnvelope[]
    | null
  >;

  dispose?(): MaybePromise<void>;
}

export type SemanticPlugin = GeometrySemanticPlugin;
