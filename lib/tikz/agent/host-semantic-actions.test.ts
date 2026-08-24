import { describe, expect, it } from 'vitest';
import type { GeometryAiContext } from '../ir/ai-context';
import { hostSemanticActionForRequest } from './host-semantic-actions';

function context(): GeometryAiContext {
  return {
    schemaVersion: 'geometry-ai-context/v1',
    basis: {
      documentId: 'doc', epoch: 'epoch', revision: 1,
      sourceId: 'doc:tikz', sourceHash: 'hash', hashAlgorithm: 'fnv1a64-utf8',
      kernelHash: 'kernel', projectionHash: 'projection', pluginSetDigest: 'plugins',
    },
    projection: {
      status: 'complete', semanticCoverage: 1,
      exactSourcePreserved: true, exactRenderingIsAuthoritative: true,
    },
    entities: [
      { id: 'entity:center', kind: 'point', name: 'N', tags: ['nine-point-circle', 'center'] },
      { id: 'entity:circle', kind: 'circle', tags: ['nine-point-circle'] },
    ],
    constraints: [], relations: [], styles: [],
    focus: {
      requestedRefs: ['entity:circle', 'entity:center'],
      resolvedEntityIds: ['entity:circle', 'entity:center'],
      closureEntityIds: ['entity:circle', 'entity:center'],
      unresolvedRefs: [], depth: 3, truncated: false,
    },
    construction: {
      constructionCatalogDigest: 'catalog',
      authorizationScopeFingerprint: 'scope',
      intentTools: [{
        toolId: 'label', category: 'primitive', inputKinds: ['point'], minInputs: 1, maxInputs: 1,
        requestedNameKeys: [], parameterSchema: 'label-text', currentInputReady: true,
        outputSlots: [],
      }],
      sourceMapSchemaVersion: 'geometry-source-map/v1',
      authorizedBindingIds: ['binding:block', 'binding:center', 'binding:document:tikzpicture-body-end'],
      sourceBindings: [
        {
          id: 'binding:block', role: 'custom', sourceId: 'doc:tikz',
          targets: [], range: { start: 10, end: 100 }, writable: false, opaque: false,
          insertionPolicy: 'none', writeCapabilities: ['update-managed-presentation'],
          managedConstructionId: 'npc',
          managedPresentationTargets: [{
            entityId: 'entity:circle', slotId: 'circle-render', role: 'nine-point-circle-render',
          }],
          entityIds: ['entity:circle'], renderTargets: [],
        },
        {
          id: 'binding:center', role: 'custom', sourceId: 'doc:tikz',
          targets: [], range: { start: 20, end: 30 }, writable: false, opaque: false,
          insertionPolicy: 'none', writeCapabilities: [], managedConstructionId: 'npc',
          managedSourceRecordId: 'entity-center', entityIds: ['entity:center'], renderTargets: [],
        },
        {
          id: 'binding:document:tikzpicture-body-end', role: 'custom', sourceId: 'doc:tikz',
          targets: [], range: { start: 100, end: 100 }, writable: true, opaque: false,
          insertionPolicy: 'tikzpicture-body', writeCapabilities: ['create-managed-construction'],
          createCapabilityFingerprint: 'create', entityIds: [], renderTargets: [],
        },
      ],
      opaqueNodes: [], managedConstructions: [],
    },
    protocol: {
      writeMode: 'revision-hash-bound-transaction',
      opaquePolicy: 'preserve-never-invent-semantics',
      staleWritePolicy: 'reject',
    },
    truncation: { truncated: false, omitted: {} },
  };
}

describe('hostSemanticActionForRequest', () => {
  it('builds a bounded managed style intent for one focused nine-point circle', () => {
    expect(hostSemanticActionForRequest(
      '\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272\u7c97\u7ebf',
      context(),
    )).toMatchObject({
      fence: 'tikz-managed-presentation',
      payload: {
        operation: {
          bindingId: 'binding:block',
          targetEntityId: 'entity:circle',
          style: { color: 'red', width: 'very thick' },
        },
      },
    });
  });

  it('creates a separate label intent bound to the declared center output', () => {
    expect(hostSemanticActionForRequest(
      '\u7ed9\u4e5d\u70b9\u5706\u52a0\u4e0a\u6807\u7b7e\uff0c\u5199\u4e0a\u201c\u4e5d\u70b9\u5706\u201d',
      context(),
    )).toMatchObject({
      fence: 'tikz-construction-intent',
      payload: {
        toolId: 'label',
        bindingIds: ['binding:center'],
        parameters: { text: '\u4e5d\u70b9\u5706' },
      },
    });
  });

  it('combines style and label into one host-only atomic semantic batch', () => {
    expect(hostSemanticActionForRequest(
      '\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272\u7c97\u7ebf\uff0c\u5e76\u52a0\u6807\u7b7e\u201c\u4e5d\u70b9\u5706\u201d',
      context(),
    )).toMatchObject({
      fence: 'host-semantic-action-batch',
      payload: {
        schemaVersion: 'host-semantic-action-batch/v1',
        styleIntent: {
          operation: {
            constructionId: 'npc',
            targetEntityId: 'entity:circle',
            style: { color: 'red', width: 'very thick' },
          },
        },
        labelIntent: {
          toolId: 'label',
          bindingIds: ['binding:center'],
          parameters: { text: '\u4e5d\u70b9\u5706' },
        },
      },
    });
  });

  it('combines one style update and several named labels into one host action set', () => {
    const value = context();
    const multi: GeometryAiContext = {
      ...value,
      entities: [
        ...value.entities,
        { id: 'entity:P', kind: 'point', name: 'P' },
        { id: 'entity:L', kind: 'point', name: 'L' },
      ],
      focus: {
        ...value.focus,
        resolvedEntityIds: [...value.focus.resolvedEntityIds, 'entity:P', 'entity:L'],
        closureEntityIds: [...value.focus.closureEntityIds, 'entity:P', 'entity:L'],
      },
      construction: {
        ...value.construction,
        authorizedBindingIds: [
          ...value.construction.authorizedBindingIds,
          'binding:P',
          'binding:L',
        ],
        sourceBindings: [
          ...value.construction.sourceBindings,
          ...(['P', 'L'] as const).map((name, index) => ({
            id: `binding:${name}`,
            role: 'custom' as const,
            sourceId: 'doc:tikz',
            targets: [],
            range: { start: 31 + index, end: 32 + index },
            writable: false,
            opaque: false,
            insertionPolicy: 'none' as const,
            writeCapabilities: [],
            managedConstructionId: 'npc',
            managedSourceRecordId: `entity-${name}`,
            entityIds: [`entity:${name}`],
            renderTargets: [],
          })),
        ],
      },
    };
    expect(hostSemanticActionForRequest(
      '把待证四边形改为紫色粗线，并给 P、L 和 N 添加标签',
      multi,
    )).toMatchObject({
      fence: 'host-semantic-action-set',
      payload: {
        schemaVersion: 'host-semantic-action-set/v1',
        styleIntent: { operation: { style: { color: 'purple', width: 'very thick' } } },
        labelIntents: [
          { parameters: { text: 'P' } },
          { parameters: { text: 'L' } },
          { parameters: { text: 'N' } },
        ],
      },
    });
  });

  it('fails closed when presentation ownership is ambiguous', () => {
    const value = context();
    const duplicate = {
      ...value,
      construction: {
        ...value.construction,
        sourceBindings: [
          ...value.construction.sourceBindings,
          {
            ...value.construction.sourceBindings[0]!,
            id: 'binding:block-2',
            managedConstructionId: 'npc-2',
          },
        ],
      },
    };
    expect(hostSemanticActionForRequest(
      '\u628a\u4e5d\u70b9\u5706\u6539\u6210\u7ea2\u8272',
      duplicate,
    )).toBeNull();
  });
});
