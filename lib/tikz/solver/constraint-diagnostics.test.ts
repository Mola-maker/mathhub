import { describe, expect, it } from 'vitest';
import type { GeometryConstraint, GeometryEntity } from '../ir/model';
import { diagnoseConstraintStructure } from './constraint-diagnostics';

function point(id: string): GeometryEntity {
  return { recordType: 'entity', id, kind: 'point' };
}

function constraint(
  id: string,
  kind: string,
  entityIds: readonly string[],
): GeometryConstraint {
  return {
    recordType: 'constraint',
    id,
    kind,
    arguments: entityIds.map((entityId, index) => ({
      role: `argument-${index + 1}`,
      entityId,
    })),
    enabled: true,
  };
}

describe('diagnoseConstraintStructure', () => {
  it('keeps triangle-center and concyclic planning components estimable', () => {
    const report = diagnoseConstraintStructure({
      entities: [
        'A', 'B', 'C', 'O',
        'D', 'E', 'F', 'H',
        'P', 'Q', 'R', 'S',
      ].map(point),
      constraints: [
        constraint('circumcenter', 'circumcenter', ['O', 'A', 'B', 'C']),
        constraint('orthocenter', 'orthocenter', ['H', 'D', 'E', 'F']),
        constraint('concyclic', 'concyclic', ['P', 'Q', 'R', 'S']),
      ],
      relations: [],
    });

    expect(report.mode).toBe('structural-planning-only');
    expect(report.components).toHaveLength(3);
    expect(report.components.find((component) => (
      component.constraintIds.includes('circumcenter')
    ))?.estimatedDof).toBe(6);
    expect(report.components.find((component) => (
      component.constraintIds.includes('orthocenter')
    ))?.estimatedDof).toBe(6);
    expect(report.components.find((component) => (
      component.constraintIds.includes('concyclic')
    ))?.estimatedDof).toBe(7);
    expect(report.diagnostics.some((item) => (
      item.code === 'unknown' && item.message.includes('symbolic DoF weight')
    ))).toBe(false);
  });
});
