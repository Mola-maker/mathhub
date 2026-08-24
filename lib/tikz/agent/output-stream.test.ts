import { describe, expect, it } from 'vitest';
import { createAgentVisibleOutputStream } from './output-stream';

describe('createAgentVisibleOutputStream', () => {
  it('streams prose but withholds an action fence split across chunks', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['我会添加九点圆。\n`', '``tikz-act', 'ion\n\\draw circle (2);\n```', '\n已准备好。']
      .forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('我会添加九点圆。\n\n已准备好。');
  });

  it('withholds ordinary TikZ examples from conversational prose', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    stream.push('示例：\n```tikz\n\\draw (0,0)--(1,1);\n```');
    stream.flush();
    expect(tokens.join('')).not.toContain('```tikz');
    expect(tokens.join('')).not.toContain('\\draw');
  });

  it('withholds an ordinary TikZ candidate for an attested create request', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    stream.push('正在准备。\n```tikz\n\\draw (0,0)--(1,1);\n```\n请稍候。');
    stream.flush();
    expect(tokens.join('')).toBe('正在准备。\n\n请稍候。');
  });

  it('withholds read-tool envelopes split across chunks', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['先检查。\n```tikz-agent-', 'tool\n{"callId":"c1"}', '\n```\n检查完成。']
      .forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('先检查。\n\n检查完成。');
  });

  it('withholds GeometryIntent envelopes split across chunks', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['准备修改。\n```tikz-geometry-', 'intent\n{"schemaVersion":"geometry-intent/v2"}', '\n```\n等待确认。']
      .forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('准备修改。\n\n等待确认。');
  });
  it('withholds MiniMax think blocks and stray closing tags across chunks', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['回答前', '<mm:thi', 'nk>内部推理', '</mm:th', 'ink>验证通过', '</mm:think>', '，可以执行。']
      .forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('回答前验证通过，可以执行。');
  });

  it('buffers an unlabelled ordinary Markdown fence and re-emits it intact', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['说明：\n```', '\n普通文本\n第二行', '\n```\n结束。'].forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('说明：\n```\n普通文本\n第二行\n```\n结束。');
  });

  it('withholds an unlabelled TikZ fence split across chunks', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['说明：\n`', '``\n\\dra', 'w (0,0)--(1,1);\n```\n完成。'].forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('说明：\n\n完成。');
  });

  it('withholds an unclosed unlabelled TikZ fence at flush', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['前言\n```\n', '\\begin{tikzpicture}\n\\draw (0,0);'].forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('前言\n');
  });

  it('preserves an unclosed ordinary Markdown fence at flush', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['前言\n```\n', '普通说明'].forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('前言\n```\n普通说明');
  });

  it('does not swallow a bounded-overflow ordinary Markdown fence', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    const body = '普通 Markdown 内容。'.repeat(4_000);
    stream.push('前言\n```\n');
    stream.push(body);
    stream.push('\n```\n结束。');
    stream.flush();
    expect(tokens.join('')).toBe(`前言\n\`\`\`\n${body}\n\`\`\`\n结束。`);
  });

  it('withholds a bare tikzpicture environment split across chunks', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    ['回答：', '\\begin{tikz', 'picture}\n\\draw (0,0);', '\\end{tikzpicture}\n完成。'].forEach(stream.push);
    stream.flush();
    expect(tokens.join('')).toBe('回答：\n完成。');
  });

  it('withholds an unclosed bare tikzpicture environment', () => {
    const tokens: string[] = [];
    const stream = createAgentVisibleOutputStream((token) => tokens.push(token));
    stream.push('回答：\\begin{tikzpicture}\\draw (0,0);');
    stream.flush();
    expect(tokens.join('')).toBe('回答：');
  });
});
