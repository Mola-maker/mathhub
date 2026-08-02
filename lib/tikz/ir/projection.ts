import type {
  GeometryDiagnostic,
  GeometryRevisionBasis,
  GeometryTruthKind,
  GeometryTruthProjection,
  JsonObject,
  SourceDocument,
} from './model';

export const GEOMETRY_PROJECTION_SCHEMA_VERSION = 'geometry-projection/v1' as const;

export interface GeometryProjectionRequest {
  schemaVersion: typeof GEOMETRY_PROJECTION_SCHEMA_VERSION;
  requestId: string;
  documentId: string;
  basis: GeometryRevisionBasis;
  targets: readonly GeometryTruthKind[];
  source?: SourceDocument;
  previousProjection?: GeometryProjection;
  preferredPluginId?: string;
  options?: JsonObject;
}

export interface GeometryProjection {
  schemaVersion: typeof GEOMETRY_PROJECTION_SCHEMA_VERSION;
  projectionId: string;
  requestId: string;
  pluginId: string;
  basis: GeometryRevisionBasis;
  status: 'complete' | 'partial';
  truths: GeometryTruthProjection;
  diagnostics: readonly GeometryDiagnostic[];
}

export interface GeometryProjectionSuccessResult {
  ok: true;
  status: 'complete' | 'partial';
  projection: GeometryProjection;
}

export interface GeometryProjectionFailureResult {
  ok: false;
  status: 'unsupported' | 'invalid' | 'error';
  requestId: string;
  pluginId?: string;
  basis: GeometryRevisionBasis;
  diagnostics: readonly GeometryDiagnostic[];
  message?: string;
}

export type GeometryProjectionResult =
  | GeometryProjectionSuccessResult
  | GeometryProjectionFailureResult;
