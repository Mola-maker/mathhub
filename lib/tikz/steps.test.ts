import { describe, expect, it } from 'vitest';
import { evaluateScene } from './semantics/scene';
import { parseTikz } from './subset/parser';
import { deriveSteps } from './steps';

const DOCUMENT = `\\begin{tikzpicture}
\\coordinate (A) at (0,0);
\\coordinate (B) at (4,0);
\\coordinate (M) at ($(A)!0.5!(B)$);
\\coordinate (H) at ($(A)!(M)!(B)$);
\\path[name path=c1] (A) circle (1);
\\path[name intersections={of=c1 and c1}] (intersection-1) coordinate (P);
\\draw (A) -- (B);
\\end{tikzpicture}`;

describe('deriveSteps', () => {
  it('按构造顺序生成中文步骤标题', () => {
    const statements = parseTikz(DOCUMENT).statements;
    const scene = evaluateScene(statements);
    const steps = deriveSteps(statements, scene);
    const titles = steps.map((step) => step.title);
    expect(titles[0]).toContain('自由点 A');
    expect(titles.find((title) => title.includes('中点'))).toBeTruthy();
    expect(titles.find((title) => title.includes('垂足'))).toBeTruthy();
    expect(titles.find((title) => title.includes('交点'))).toBeTruthy();
    expect(steps.find((step) => step.title.includes('M'))?.stmtIndex).toBe(2);
  });
});
