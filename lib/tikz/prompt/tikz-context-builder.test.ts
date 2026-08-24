import { describe, expect, it } from 'vitest';
import { buildTikzContextForProblem } from './tikz-context-builder';
import { buildTikzRepairPrompt, buildTikzSystemPrompt } from './tikz-system-prompt';

describe('tikz prompt', () => {
  it('按关键词注入配方（外接圆 → 外心配方），且不超过三条', () => {
    const context = buildTikzContextForProblem('作三角形的外接圆并标出圆心，再作垂心与中点和旋转');
    expect(context).toContain('外心');
    expect(context).toContain('circle through=');
    expect(context.match(/^### /gm)).toHaveLength(3);
  });

  it('无命中关键词时返回空串', () => {
    expect(buildTikzContextForProblem('画一条线段')).toBe('');
  });

  it('system prompt 含双通道规则、输出契约和禁用命令声明', () => {
    const prompt = buildTikzSystemPrompt('作垂心', {});
    expect(prompt).toContain('```tikz');
    expect(prompt).toContain('$(A)!0.5!(B)$');
    // The dual-lane rule is now stated as the interactive projection versus the
    // isolated exact-TeX renderer; the renderer's toolchain names are an
    // implementation detail the prompt deliberately no longer leaks.
    expect(prompt).toContain('isolated exact-TeX renderer');
    expect(prompt).toContain('interactive projection');
    expect(prompt).toContain('\\input');
    expect(prompt).toContain('\\write18');
  });

  it('system prompt 将复杂依赖构造约束为一个 host-resolved DAG', () => {
    const prompt = buildTikzSystemPrompt('先作三个中点，再作它们的外接圆', {});
    expect(prompt).toContain('"kind": "construct-dag"');
    expect(prompt).toContain('outputKey');
    expect(prompt).toContain('outputSlots');
    expect(prompt).toContain('source-ordered acyclic steps');
    expect(prompt).toContain('all-or-none');
  });

  it('九点圆命中单一宿主管理的复合构造配方', () => {
    const context = buildTikzContextForProblem('画一个九点圆');
    expect(context).toContain('九点圆');
    expect(context).toContain('GeometryIntent/v2');
    expect(context).toContain('toolId "nine-point-circle"');
    expect(context).toContain('atomically');
    expect(context).toContain('Never expand a');
    expect(context).toContain('construction-plan create proposal');
    expect(context).not.toContain('coordinate (Ha)');
  });

  it('previousCode 只在提供时注入', () => {
    expect(buildTikzSystemPrompt('画三角形', {})).not.toContain('当前画布代码');
    expect(buildTikzSystemPrompt('画三角形', { previousCode: 'OLD' })).toContain('OLD');
  });

  it('repair prompt 含代码、失败与快照', () => {
    const prompt = buildTikzRepairPrompt('CODE', ['未定义的点 X'], 'SNAP');
    expect(prompt).toContain('CODE');
    expect(prompt).toContain('未定义的点 X');
    expect(prompt).toContain('SNAP');
  });
});
