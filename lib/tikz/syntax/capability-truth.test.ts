import { describe, expect, it } from 'vitest';
import {
  assertTikzSyntaxCatalogIntegrity,
  TIKZ_SYNTAX_CATALOG_BY_ID,
} from './catalog';
import { createTikzAiCompactSchema } from './query';
import exactProfile from './exact-profile.json';
import { TIKZ_LIBRARY_NAMES } from './types';

function entry(id: string) {
  const value = TIKZ_SYNTAX_CATALOG_BY_ID.get(id);
  if (!value) throw new Error(`missing capability fixture ${id}`);
  return value;
}

describe('TikZ capability truth', () => {
  it('keeps legacy flags derived from the evidence-backed truth', () => {
    expect(() => assertTikzSyntaxCatalogIntegrity()).not.toThrow();
  });

  it('does not advertise PGF basic-layer macros as Canvas editable', () => {
    const basicPath = entry('basic-layer:paths');
    expect(basicPath.truth.preserve.status).toBe('verified');
    expect(basicPath.truth.interactive.status).toBe('blocked');
    expect(basicPath.capabilities.interactive).toBe(false);
  });

  it('marks broad interactive chapters as partial instead of complete', () => {
    const paths = entry('core:paths');
    expect(paths.truth.semantic.status).toBe('partial');
    expect(paths.truth.interactive.status).toBe('partial');
    expect(paths.truth.interactive.evidence).toContain('broker-replayed-writer');
  });

  it('separates verified, conditional, and policy-blocked exact surfaces', () => {
    expect(entry('tikz-library:calc').truth.exact.status).toBe('verified');
    expect(entry('tikz-library:matrix').truth.exact.status).toBe('conditional');
    expect(entry('system-layer:externalization').truth.exact.status).toBe('blocked');
    expect(entry('system-layer:externalization').capabilities.exact).toBe(false);
  });

  it('classifies every official TikZ library exactly once in the exact profile', () => {
    expect(exactProfile.schemaVersion).toBe('tikz-exact-profile/v2');
    expect(exactProfile.driverPolicy).toBe('dvisvgm-paths-exact/v1');
    expect(exactProfile.maxSvgBytes).toBe(4 * 1024 * 1024);
    expect(exactProfile.runtimeCapabilities).toEqual({
      texEngine: 'tectonic',
      executionMode: 'only-cached',
      luaExecution: false,
      graphDrawing: 'syntax-only',
    });
    expect(exactProfile.requiredCompanionProfiles.luaGraphDrawing)
      .toBe('tikz-luatex-graphdrawing-v1');
    const classified = [
      ...exactProfile.verifiedLibraries,
      ...exactProfile.conditionalLibraries,
    ];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual([...TIKZ_LIBRARY_NAMES].sort());
    expect(exactProfile.verifiedLibraries.every((library) => (
      exactProfile.wrapperLibraries.includes(library)
    ))).toBe(true);
  });

  it('publishes evidence-backed statuses to the bounded AI schema', () => {
    const schema = createTikzAiCompactSchema([
      entry('core:paths'),
      entry('tikz-library:matrix'),
    ]);
    expect(schema.entries[0]?.support).toMatchObject({
      semantic: 'partial',
      interactive: 'partial',
      exact: 'verified',
    });
    expect(schema.entries[1]?.support).toMatchObject({
      interactive: 'blocked',
      exact: 'conditional',
    });
  });

  it('advertises static graph syntax as exact while leaving Lua graph drawing outside the standard profile', () => {
    expect(exactProfile.verifiedLibraries).toContain('graphs');
    expect(exactProfile.verifiedLibraries).toContain('graphs.standard');
    expect(exactProfile.wrapperLibraries).not.toContain('graphdrawing');
    expect(entry('graph-drawing:usage-tikz').truth.exact).toMatchObject({
      status: 'blocked',
      evidence: expect.arrayContaining([
        'compiler-runtime:graph-drawing-syntax-only',
        'compiler-profile-required:tikz-luatex-graphdrawing-v1',
      ]),
    });
  });
});
