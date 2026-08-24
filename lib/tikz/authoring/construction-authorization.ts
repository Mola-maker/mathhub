import { hashSource } from '../document/source-hash';
import type { GeometryRevisionBasis } from '../ir/model';
import { CONSTRUCTION_CATALOG_DIGEST } from './construction-catalog';

export function constructionAuthorizationScopeFingerprint(input: {
  readonly basis: GeometryRevisionBasis;
  readonly authorizedBindingIds: readonly string[];
  readonly createCapabilityFingerprint: string;
}): string {
  return hashSource(JSON.stringify({
    schemaVersion: 'construction-authorization-scope/v1',
    documentId: input.basis.documentId,
    epoch: input.basis.epoch,
    revision: input.basis.revision,
    sourceId: input.basis.sourceId ?? '',
    sourceHash: input.basis.sourceHash,
    kernelHash: input.basis.kernelHash ?? '',
    projectionHash: input.basis.projectionHash ?? '',
    pluginSetDigest: input.basis.pluginSetDigest ?? '',
    constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    createCapabilityFingerprint: input.createCapabilityFingerprint,
    authorizedBindingIds: input.authorizedBindingIds,
  }));
}
