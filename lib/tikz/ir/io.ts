import type { GeometryIoChannel } from './capabilities';
import type {
  GeometryDiagnostic,
  GeometryRevisionBasis,
  JsonObject,
  RenderArtifactReference,
  RenderingTruth,
  SourceDocument,
  SourceTextPatch,
} from './model';
import type {
  GeometryProjectionRequest,
  GeometryProjectionResult,
} from './projection';
import type {
  GeometryTransactionRequest,
  GeometryTransactionResult,
} from './transactions';

export const GEOMETRY_IO_SCHEMA_VERSION = 'geometry-io/v1' as const;

export interface GeometryIoEnvelopeBase<
  TChannel extends GeometryIoChannel,
  TDirection extends 'input' | 'output',
  TPayload,
> {
  schemaVersion: typeof GEOMETRY_IO_SCHEMA_VERSION;
  messageId: string;
  channel: TChannel;
  direction: TDirection;
  documentId: string;
  payload: TPayload;
  basis?: GeometryRevisionBasis;
  correlationId?: string;
  causationId?: string;
  producerId?: string;
  metadata?: JsonObject;
}

export type SourceInputPayload =
  | {
    kind: 'snapshot';
    source: SourceDocument;
  }
  | {
    kind: 'patches';
    basis: GeometryRevisionBasis;
    patches: readonly SourceTextPatch[];
  }
  | {
    kind: 'projection-request';
    request: GeometryProjectionRequest;
  };

export type SourceOutputPayload =
  | {
    kind: 'apply-transaction';
    transaction: GeometryTransactionRequest;
  }
  | {
    kind: 'projection-result';
    result: GeometryProjectionResult;
  }
  | {
    kind: 'transaction-result';
    result: GeometryTransactionResult;
  };

export type AiInputPayload =
  | {
    kind: 'intent';
    intent: string;
    context?: JsonObject;
  }
  | {
    kind: 'transaction-proposal';
    transaction: GeometryTransactionRequest;
    rationale?: string;
  }
  | {
    kind: 'projection-request';
    request: GeometryProjectionRequest;
  };

export type AiOutputPayload =
  | {
    kind: 'semantic-context';
    result: GeometryProjectionResult;
  }
  | {
    kind: 'proposal-result';
    result: GeometryTransactionResult;
  }
  | {
    kind: 'diagnostics';
    diagnostics: readonly GeometryDiagnostic[];
  };

export type CanvasInputPayload =
  | {
    kind: 'intent';
    intent: string;
    selection?: readonly string[];
    parameters?: JsonObject;
  }
  | {
    kind: 'transaction-proposal';
    transaction: GeometryTransactionRequest;
  }
  | {
    kind: 'projection-request';
    request: GeometryProjectionRequest;
  };

export type CanvasOutputPayload =
  | {
    kind: 'projection-result';
    result: GeometryProjectionResult;
  }
  | {
    kind: 'transaction-result';
    result: GeometryTransactionResult;
  }
  | {
    kind: 'preview';
    basis: GeometryRevisionBasis;
    rendering: RenderingTruth;
  };

export interface CompilerRequest {
  jobId: string;
  basis: GeometryRevisionBasis;
  source: SourceDocument;
  target: string;
  options?: JsonObject;
}

export interface CompilerResult {
  jobId: string;
  basis: GeometryRevisionBasis;
  status: 'complete' | 'failed' | 'cancelled';
  artifacts: readonly RenderArtifactReference[];
  diagnostics: readonly GeometryDiagnostic[];
  rendererId?: string;
  metadata?: JsonObject;
}

export type CompilerInputPayload =
  | {
    kind: 'compile-result';
    result: CompilerResult;
  }
  | {
    kind: 'compiler-diagnostic';
    jobId?: string;
    diagnostics: readonly GeometryDiagnostic[];
  };

export type CompilerOutputPayload =
  | {
    kind: 'compile-request';
    request: CompilerRequest;
  }
  | {
    kind: 'cancel';
    jobId: string;
  };

export type SourceInputEnvelope<TPayload = SourceInputPayload> =
  GeometryIoEnvelopeBase<'source', 'input', TPayload>;
export type SourceOutputEnvelope<TPayload = SourceOutputPayload> =
  GeometryIoEnvelopeBase<'source', 'output', TPayload>;

export type AiInputEnvelope<TPayload = AiInputPayload> =
  GeometryIoEnvelopeBase<'ai', 'input', TPayload>;
export type AiOutputEnvelope<TPayload = AiOutputPayload> =
  GeometryIoEnvelopeBase<'ai', 'output', TPayload>;

export type CanvasInputEnvelope<TPayload = CanvasInputPayload> =
  GeometryIoEnvelopeBase<'canvas', 'input', TPayload>;
export type CanvasOutputEnvelope<TPayload = CanvasOutputPayload> =
  GeometryIoEnvelopeBase<'canvas', 'output', TPayload>;

export type CompilerInputEnvelope<TPayload = CompilerInputPayload> =
  GeometryIoEnvelopeBase<'compiler', 'input', TPayload>;
export type CompilerOutputEnvelope<TPayload = CompilerOutputPayload> =
  GeometryIoEnvelopeBase<'compiler', 'output', TPayload>;

export type GeometryKernelInputEnvelope =
  | SourceInputEnvelope
  | AiInputEnvelope
  | CanvasInputEnvelope
  | CompilerInputEnvelope;

export type GeometryKernelOutputEnvelope =
  | SourceOutputEnvelope
  | AiOutputEnvelope
  | CanvasOutputEnvelope
  | CompilerOutputEnvelope;
