import { describe, expect, it } from 'vitest';
import {
  GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP,
  GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS,
  GEOMETRY_PROBLEM_SOURCE_IDS,
  getGeometryProblemSourceDescriptor,
  isGeometryProblemSourceId,
} from './source-catalog';

describe('geometry problem source catalog', () => {
  it('keeps the source id union and descriptor map closed and complete', () => {
    const mapIds = Object.keys(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP).sort();
    const declaredIds = [...GEOMETRY_PROBLEM_SOURCE_IDS].sort();

    expect(declaredIds).toEqual([
      'formalgeo',
      'geometry3k',
      'geoqa',
      'leaneuclid',
      'mathnet',
      'olympiadbench',
      'unigeo',
    ]);
    expect(mapIds).toEqual(declaredIds);
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS).toHaveLength(declaredIds.length);
    expect(Object.isFrozen(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP)).toBe(true);

    for (const descriptor of GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS) {
      expect(descriptor.id).toBeTruthy();
      expect(descriptor.label).toBeTruthy();
      expect(() => new URL(descriptor.projectUrl)).not.toThrow();
      expect(() => new URL(descriptor.datasetUrl)).not.toThrow();
      expect(isGeometryProblemSourceId(descriptor.id)).toBe(true);
      expect(descriptor.note.length).toBeGreaterThan(0);
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.datasetLicense)).toBe(true);
      expect(Object.isFrozen(descriptor.codeLicense)).toBe(true);
    }
  });

  it('marks only the two bounded remote adapters as live-search sources', () => {
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS
      .filter((descriptor) => descriptor.accessMode === 'live-search')
      .map((descriptor) => descriptor.id))
      .toEqual(['mathnet', 'olympiadbench']);
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP.formalgeo.accessMode)
      .toBe('restricted-opt-in');
  });

  it('does not allow registry-only sources to be used for distribution, commerce, or training', () => {
    const registrySources = GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS
      .filter((descriptor) => descriptor.accessMode === 'registry-only');

    expect(registrySources.map((descriptor) => descriptor.id)).toEqual([
      'geometry3k',
      'geoqa',
      'unigeo',
      'leaneuclid',
    ]);
    for (const descriptor of registrySources) {
      expect(descriptor.redistribution).not.toBe('allowed');
      expect(descriptor.commercial).not.toBe('allowed');
      expect(descriptor.training).not.toBe('allowed');
      expect(descriptor.sourceMaterialRights).toBe('review-required');
    }
  });

  it('records the named upstream license facts without clearing source material', () => {
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP.mathnet.datasetLicense).toMatchObject({
      id: 'CC-BY-4.0',
      basis: 'dataset-card',
    });
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP.mathnet.sourceMaterialRights)
      .toBe('conditional');
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP.olympiadbench).toMatchObject({
      codeLicense: { id: 'MIT', basis: 'repository' },
      datasetLicense: { id: 'Apache-2.0', basis: 'dataset-card' },
      sourceMaterialRights: 'review-required',
    });
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP.leaneuclid.codeLicense.id).toBe('MIT');
    expect(GEOMETRY_PROBLEM_SOURCE_DESCRIPTOR_MAP.formalgeo).toMatchObject({
      accessMode: 'restricted-opt-in',
      commercial: 'blocked',
      training: 'blocked',
    });
  });

  it('fails closed for unknown source ids', () => {
    expect(getGeometryProblemSourceDescriptor('mathnet').id).toBe('mathnet');
    expect(() => getGeometryProblemSourceDescriptor('not-a-source')).toThrow(
      'Unknown geometry problem source: not-a-source',
    );
    expect(isGeometryProblemSourceId('not-a-source')).toBe(false);
  });
});
