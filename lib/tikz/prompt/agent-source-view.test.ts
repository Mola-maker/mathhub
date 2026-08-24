import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from '../authoring/construction-catalog';
import { compileConstructionPlan } from '../authoring/construction-ir';
import { tikzSourceForAgent } from './agent-source-view';

describe('tikzSourceForAgent', () => {
  it('masks only valid managed records while preserving every source offset', () => {
    const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => candidate.id === 'midpoint');
    if (!spec) throw new TypeError('Midpoint Catalog tool is unavailable.');
    const plan = createCatalogConstructionPlan(spec, {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 4, y: 0 }, existing: true },
      ],
      nextName: () => 'M',
      nextConstructionId: () => 'agent-source-midpoint',
    });
    const source = [
      '\\begin{tikzpicture}',
      compileConstructionPlan(plan).lines.join('\r\n'),
      '\\end{tikzpicture}',
    ].join('\r\n');
    const view = tikzSourceForAgent(source);
    expect(view).toHaveLength(source.length);
    expect(view).not.toContain('"recordType"');
    expect(view).toContain('[internal semantic record hidden]');
    expect([...view.matchAll(/\r\n/gu)].map((match) => match.index))
      .toEqual([...source.matchAll(/\r\n/gu)].map((match) => match.index));
    expect(view.indexOf('\\coordinate (M)')).toBe(source.indexOf('\\coordinate (M)'));
  });

  it('does not conceal malformed record text from diagnostics', () => {
    const malformed = '% @mathgeo record {not-json}\n\\draw (0,0)--(1,1);';
    expect(tikzSourceForAgent(malformed)).toBe(malformed);
  });
});
