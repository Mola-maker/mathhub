import { describe, expect, it } from 'vitest';
import { requiresGeometryProofObservation } from './proof-intent-policy';

describe('proof-solving GeometryIntent policy', () => {
  it('requires a proof observation for olympiad reasoning and auxiliary construction', () => {
    expect(requiresGeometryProofObservation('证明三垂足共线，并作必要辅助线')).toBe(true);
    expect(requiresGeometryProofObservation('Solve this olympiad geometry theorem')).toBe(true);
  });

  it('does not block a direct diagram creation request', () => {
    expect(requiresGeometryProofObservation('画一个九点圆')).toBe(false);
    expect(requiresGeometryProofObservation('把圆改成红色')).toBe(false);
  });
});
