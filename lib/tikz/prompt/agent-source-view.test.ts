import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from '../authoring/construction-catalog';
import { compileConstructionPlan } from '../authoring/construction-ir';
import { tikzSourceForAgent } from './agent-source-view';

describe('tikzSourceForAgent', () => {
  it('compacts trusted managed records without changing the stored source', () => {
    const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'midpoint');
    if (!spec) throw new TypeError('Midpoint Catalog tool is unavailable');
    let ordinal = 0;
    const plan = createCatalogConstructionPlan(spec, {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}${++ordinal}`,
      nextConstructionId: () => 'agent-source-midpoint-1',
    });
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
      compileConstructionPlan(plan).lines.join('\n'),
      '\\end{tikzpicture}',
    ].join('\n');
    const original = `${source}`;

    const view = tikzSourceForAgent(source);

    expect(source).toBe(original);
    expect(view).toContain('% @mathgeo record [internal semantic record hidden]');
    expect(view).not.toContain('"recordType"');
    expect(view.length).toBeLessThan(source.length);
    expect(view).toContain('\\coordinate (A) at (0,0);');
    expect(view).toContain('\\coordinate (B) at (2,0);');
  });

  it('does not conceal malformed record text from diagnostics', () => {
    const malformed = '% @mathgeo record {not-json}\n\\draw (0,0)--(1,1);';
    expect(tikzSourceForAgent(malformed)).toBe(malformed);
  });
});
