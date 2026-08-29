import { describe, expect, it } from 'vitest';
import { projectGeogebraCommandsToGeometryDoc } from './adapters/geogebra-geometry-doc';
import {
  buildGeometrySemanticSignature,
  compareGeometrySemanticSignatures,
  type GeometrySemanticSnapshotLike,
} from './semantic-signature';

function fixture() {
  return projectGeogebraCommandsToGeometryDoc({
    identity: { documentId: 'ggb-doc', epoch: 'epoch-1', revision: 2 },
    commands: [
      'A=(0,0)',
      'B=(4,0)',
      'AB=Segment(A,B)',
      'M=Midpoint(A,B)',
      'SetColor(AB,"green")',
    ],
  });
}

function remappedTikzLikeSnapshot(
  source: ReturnType<typeof fixture>,
): GeometrySemanticSnapshotLike {
  const ids = new Map(source.geometryDoc.semantic.ir.entities.map((entity, index) => (
    [entity.id, `tikz:entity:${index}`] as const
  )));
  const mapId = (id: string | undefined) => id ? ids.get(id) ?? id : undefined;
  const basis = {
    ...source.geometryDoc.basis,
    documentId: 'tikz-doc',
    epoch: 'tikz-epoch',
    sourceId: 'tikz-doc:tikz',
    sourceHash: 'aaaaaaaaaaaaaaaa',
    pluginSetDigest: 'tikz-semantic-kernel/v-test',
  };
  return {
    basis,
    semantic: {
      ...source.geometryDoc.semantic,
      basis,
      ir: {
        ...source.geometryDoc.semantic.ir,
        entities: source.geometryDoc.semantic.ir.entities.map((entity) => ({
          ...entity,
          id: mapId(entity.id)!,
          // A two-reference TikZ polyline and a GeoGebra Segment normalize to
          // the same renderer-neutral structural entity.
          kind: entity.name === 'AB' ? 'polyline' : entity.kind,
        })),
        constraints: source.geometryDoc.semantic.ir.constraints.map((constraint) => ({
          ...constraint,
          id: `tikz:${constraint.id}`,
          arguments: constraint.arguments.map((argument) => ({
            ...argument,
            ...(argument.entityId ? { entityId: mapId(argument.entityId)! } : {}),
          })),
        })),
        relations: source.geometryDoc.semantic.ir.relations.map((relation) => ({
          ...relation,
          id: `tikz:${relation.id}`,
          participants: relation.participants.map((participant) => ({
            ...participant,
            ...(participant.entityId ? { entityId: mapId(participant.entityId)! } : {}),
          })),
        })),
        styles: source.geometryDoc.semantic.ir.styles.map((style) => ({
          ...style,
          id: `tikz:${style.id}`,
          selector: {
            ...style.selector,
            entityIds: style.selector.entityIds?.map((id) => mapId(id)!),
          },
        })),
        metadata: { sourceLanguage: 'tikz' },
      },
    },
  };
}

describe('renderer-neutral geometry semantic signatures', () => {
  it('matches equivalent named topology across source languages and record ids', () => {
    const geogebra = fixture();
    const tikzLike = buildGeometrySemanticSignature(remappedTikzLikeSnapshot(geogebra));
    const comparison = compareGeometrySemanticSignatures(
      geogebra.semanticSignature,
      tikzLike,
    );

    expect(geogebra.semanticSignature.sourceLanguage).toBe('geogebra-command');
    expect(tikzLike.sourceLanguage).toBe('tikz');
    expect(comparison).toMatchObject({
      equivalent: true,
      semanticHashMatches: true,
      relationHashMatches: true,
    });
  });

  it('keeps presentation differences separate from mathematical equivalence', () => {
    const geogebra = fixture();
    const changedStyle = remappedTikzLikeSnapshot(geogebra);
    const style = changedStyle.semantic.ir.styles[0];
    const signature = buildGeometrySemanticSignature({
      ...changedStyle,
      semantic: {
        ...changedStyle.semantic,
        ir: {
          ...changedStyle.semantic.ir,
          styles: style ? [{ ...style, properties: { color: ['"purple"'] } }] : [],
        },
      },
    });
    const comparison = compareGeometrySemanticSignatures(
      geogebra.semanticSignature,
      signature,
    );

    expect(comparison.equivalent).toBe(true);
    expect(comparison.presentationHashMatches).toBe(false);
    expect(comparison.reasons).toContain('presentation-mismatch');
  });

  it('fails closed when an anonymous entity cannot receive a portable address', () => {
    const geogebra = fixture();
    const signature = buildGeometrySemanticSignature({
      ...geogebra.geometryDoc,
      semantic: {
        ...geogebra.geometryDoc.semantic,
        ir: {
          ...geogebra.geometryDoc.semantic.ir,
          entities: [
            ...geogebra.geometryDoc.semantic.ir.entities,
            { recordType: 'entity', id: 'anonymous', kind: 'custom' },
          ],
        },
      },
    });

    expect(signature.comparable).toBe(false);
    expect(signature.exclusions).toContainEqual({
      recordType: 'entity',
      recordId: 'anonymous',
      reason: 'anonymous-entity',
    });
  });
});
