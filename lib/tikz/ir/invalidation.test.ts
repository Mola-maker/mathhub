import { describe, expect, it } from 'vitest';
import type { GeometryRelation } from './model';
import { buildDependencyGraph, dependencyPairs } from './invalidation';

describe('Geometry IR dependency ABI', () => {
  it('treats Catalog depends-on from as dependent and to as dependency', () => {
    const relation: GeometryRelation = {
      recordType: 'relation',
      id: 'relation:managed:radical-axis:result-circle-1',
      kind: 'depends-on',
      directed: true,
      participants: [
        { role: 'from', entityId: 'managed:radical-axis:result' },
        { role: 'to', entityId: 'source-circle-1' },
      ],
    };

    expect(dependencyPairs(relation)).toEqual([{
      dependent: 'managed:radical-axis:result',
      dependency: 'source-circle-1',
    }]);
    expect(buildDependencyGraph([relation]).dependents.get('source-circle-1'))
      .toEqual(new Set(['managed:radical-axis:result']));
  });
});
