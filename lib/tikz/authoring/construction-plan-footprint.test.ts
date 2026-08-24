import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from './construction-catalog';
import type { AuthoringAnchor } from './source-builder';
import { validateConstructionPlanSemanticFootprint } from './construction-plan-footprint';

function pointAnchor(index: number): AuthoringAnchor {
  return {
    name: `P${index + 1}`,
    position: { x: index + 1, y: (index + 1) * (index + 2) },
    existing: true,
  };
}

function circleAnchor(index: number): AuthoringAnchor {
  const centerName = `O${index + 1}`;
  const throughName = `T${index + 1}`;
  const radius = index + 2;
  return {
    name: `CircleHit${index + 1}`,
    position: { x: radius, y: 0 },
    existing: true,
    circle: {
      stableId: `managed:circle-${index + 1}:circle`,
      semanticEntityId: `scene-circle-${index + 1}`,
      sourceBindingId: `binding:scene-circle-${index + 1}`,
      stmtIndex: index,
      centerName,
      throughName,
      center: { x: 0, y: 0 },
      radius,
      angleDeg: 30 + index,
      definition: {
        kind: 'center-through',
        centerName,
        throughName,
      },
    },
  };
}

describe('ConstructionPlan semantic footprint registry', () => {
  it('accepts every catalog tool plan, including variable primitive arity', () => {
    for (const spec of CONSTRUCTION_TOOL_SPECS) {
      let nameIndex = 0;
      let constructionIndex = 0;
      const anchors = spec.inputSlots.map((slot, index) => (
        slot.accepts === 'circle' ? circleAnchor(index) : pointAnchor(index)
      ));
      const plan = createCatalogConstructionPlan(spec, {
        anchors,
        nextName: (prefix) => `${prefix}${++nameIndex}`,
        nextConstructionId: (prefix) => `${prefix}-${++constructionIndex}`,
      });
      expect(
        validateConstructionPlanSemanticFootprint(plan),
        spec.id,
      ).toEqual([]);
    }
  });

  it('rejects a catalog plan after an otherwise valid extra relation is attached', () => {
    const segment = CONSTRUCTION_TOOL_SPECS.find((spec) => spec.id === 'segment')!;
    const plan = createCatalogConstructionPlan(segment, {
      anchors: [pointAnchor(0), pointAnchor(1)],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'segment-footprint',
    });
    const forged = {
      ...plan,
      relations: [
        ...plan.relations,
        {
          recordType: 'relation' as const,
          id: 'extra-dependency',
          kind: 'depends-on' as const,
          from: 'entity-segment-footprint',
          to: 'P1',
          directed: true,
        },
      ],
    };

    expect(validateConstructionPlanSemanticFootprint(forged)).toEqual([
      expect.objectContaining({ path: 'relations' }),
    ]);
  });
});
