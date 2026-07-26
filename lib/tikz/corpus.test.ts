import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateScene } from './semantics/scene';
import { parseTikz } from './subset/parser';

interface Expected {
  points?: Record<string, [number, number]>;
  elements?: Array<{ kind: string; center?: [number, number]; radius?: number }>;
  tolerance?: number;
}

const directory = path.join(process.cwd(), 'lib', 'tikz', '__fixtures__', 'competition');
const cases = readdirSync(directory)
  .filter((file) => file.endsWith('.tikz'))
  .map((file) => file.replace(/\.tikz$/, ''))
  .sort();

describe('竞赛语料回归', () => {
  it('fixture 数量 ≥ 20', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  for (const name of cases) {
    it(name, () => {
      const code = readFileSync(path.join(directory, `${name}.tikz`), 'utf8');
      const expected = JSON.parse(
        readFileSync(path.join(directory, `${name}.json`), 'utf8'),
      ) as Expected;
      const tolerance = expected.tolerance ?? 1e-6;
      const scene = evaluateScene(parseTikz(code).statements);

      expect(
        scene.issues,
        `fixture ${name} 存在求值 issue: ${JSON.stringify(scene.issues)}`,
      ).toEqual([]);

      for (const [pointName, [x, y]] of Object.entries(expected.points ?? {})) {
        const point = scene.points.get(pointName);
        expect(point, `缺少点 ${pointName}`).toBeDefined();
        expect(
          Math.hypot(point!.position.x - x, point!.position.y - y),
          `点 ${pointName} 坐标偏差`,
        ).toBeLessThanOrEqual(tolerance);
      }

      for (const expectedElement of expected.elements ?? []) {
        const hit = scene.elements.find((element) => {
          if (element.kind !== expectedElement.kind) return false;
          if (expectedElement.kind !== 'circle') return true;
          if (element.kind !== 'circle' || !expectedElement.center || expectedElement.radius === undefined) {
            return false;
          }
          return Math.hypot(
            element.center.x - expectedElement.center[0],
            element.center.y - expectedElement.center[1],
          ) <= tolerance && Math.abs(element.radius - expectedElement.radius) <= tolerance;
        });
        expect(hit, `缺少元素 ${JSON.stringify(expectedElement)}`).toBeDefined();
      }
    });
  }
});
