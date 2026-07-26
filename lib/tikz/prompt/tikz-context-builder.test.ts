import { describe, expect, it } from 'vitest';
import { buildTikzContextForProblem } from './tikz-context-builder';
import { buildTikzRepairPrompt, buildTikzSystemPrompt } from './tikz-system-prompt';

describe('tikz prompt', () => {
  it('按关键词注入配方（外接圆 → 外心配方），且不超过三条', () => {
    const context = buildTikzContextForProblem('作三角形的外接圆并标出圆心，再作垂心与中点和旋转');
    expect(context).toContain('外心');
    expect(context).toContain('circle [through=');
    expect(context.match(/^### /gm)).toHaveLength(3);
  });

  it('无命中关键词时返回空串', () => {
    expect(buildTikzContextForProblem('画一条线段')).toBe('');
  });

  it('system prompt 含子集规则、输出契约和禁用命令声明', () => {
    const prompt = buildTikzSystemPrompt('作垂心', {});
    expect(prompt).toContain('```tikz');
    expect(prompt).toContain('$(A)!0.5!(B)$');
    expect(prompt).toContain('禁止使用：\\foreach');
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

