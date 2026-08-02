import type {
  GeometryTruthKind,
  JsonObject,
} from './model';
import type { GeometryOperationKind } from './transactions';

export const GEOMETRY_SEMANTIC_PLUGIN_API_VERSION = 1 as const;

export type GeometryIoChannel = 'source' | 'ai' | 'canvas' | 'compiler';
export type GeometryIoDirection = 'input' | 'output';
export type CapabilityLevel = 'full' | 'partial' | 'read-only' | 'unsupported';

export interface GeometryIoCapability {
  channel: GeometryIoChannel;
  input: boolean;
  output: boolean;
  messageKinds?: readonly string[];
}

export interface GeometryRoundTripGuarantees {
  losslessSourceReferences: boolean;
  preservesOpaqueNodes: boolean;
  revisionBoundWrites: boolean;
  hashBoundWrites: boolean;
}

/**
 * Declarative plugin capabilities. All semantic vocabularies are open strings
 * so a Euclidean/TikZ plugin never limits other geometry or source systems.
 */
export interface GeometryCapabilityDescriptor {
  sourceLanguages: readonly string[];
  truthSupport: Readonly<Record<GeometryTruthKind, CapabilityLevel>>;
  entityKinds: readonly string[];
  constraintKinds: readonly string[];
  relationKinds: readonly string[];
  styleProperties?: readonly string[];
  operationKinds: readonly GeometryOperationKind[];
  io: readonly GeometryIoCapability[];
  projectionTargets: readonly string[];
  renderTargets?: readonly string[];
  guarantees: GeometryRoundTripGuarantees;
  extensions?: JsonObject;
}

export type CapabilityDescriptor = GeometryCapabilityDescriptor;

export interface SemanticPluginDescriptor {
  id: string;
  version: string;
  apiVersion: typeof GEOMETRY_SEMANTIC_PLUGIN_API_VERSION;
  displayName?: string;
  description?: string;
  priority?: number;
  capabilities: GeometryCapabilityDescriptor;
}

export interface SemanticPluginResolutionRequest {
  pluginId?: string;
  sourceLanguageId?: string;
  truth?: GeometryTruthKind;
  operation?: GeometryOperationKind;
  ioChannel?: GeometryIoChannel;
  ioDirection?: GeometryIoDirection;
  projectionTarget?: string;
  renderTarget?: string;
}
