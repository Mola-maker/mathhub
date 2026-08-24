import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrimitiveConstructionPlan } from '@/lib/tikz/authoring/construction-catalog';
import { compileNewManagedConstructionPlan } from '@/lib/tikz/authoring/construction-ir-v3';
import { decodeManagedConstructionPlan } from '@/lib/tikz/authoring/construction-plan-codec';
import { StudioDocument } from '@/lib/tikz/document/studio-document';
import { parseManagedConstructionBlocks } from '@/lib/tikz/semantics/managed-construction';
import { TikzCodePanel } from './tikz-code-panel';

afterEach(() => cleanup());

describe('TikzCodePanel', () => {
  it('渲染 StudioDocument 初始源码', () => {
    const studioDocument = new StudioDocument('\\draw (A) -- (B);');
    render(<TikzCodePanel document={studioDocument} issues={[]} />);
    expect(screen.getByTestId('tikz-cm').textContent).toContain('\\draw (A) -- (B);');
    expect(screen.getByRole('textbox', { name: 'TikZ 源码编辑器' })).toBeTruthy();
  });

  it('AI/画布补丁经 CodeMirror transaction 同步并保留 origin', () => {
    const studioDocument = new StudioDocument('A');
    render(<TikzCodePanel document={studioDocument} issues={[]} />);
    act(() => {
      studioDocument.replaceSource('B', 'ai');
    });
    expect(screen.getByTestId('tikz-cm').textContent).toContain('B');
    expect(studioDocument.getSnapshot()).toMatchObject({
      source: 'B',
      revision: 1,
      lastTransaction: { origin: 'ai' },
    });
  });

  it('issue 渲染为 lint 标记（含 message）', () => {
    const studioDocument = new StudioDocument('\\draw (A)');
    render(
      <TikzCodePanel
        document={studioDocument}
        issues={[{
          severity: 'error',
          message: '未闭合',
          range: { start: 0, end: 5 },
        }]}
      />,
    );
    expect(document.querySelector('.cm-lintRange-error')).toBeTruthy();
  });

  it('默认折叠画布构造的内部 record JSON，但唯一真源仍可完整解码与重放', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'canvas-segment-1',
    });
    const source = `${compileNewManagedConstructionPlan(plan).lines.join('\n')}\n`;
    const studioDocument = new StudioDocument(source);
    const block = parseManagedConstructionBlocks(
      studioDocument.getSnapshot().source,
    )[0]!;
    const decoded = decodeManagedConstructionPlan(
      studioDocument.getSnapshot().source,
      block,
    );

    expect(source).toContain('% @mathgeo record {"recordType"');
    expect(decoded.ok).toBe(true);
    render(<TikzCodePanel document={studioDocument} issues={[]} />);

    const editor = screen.getByTestId('tikz-cm');
    expect(editor.textContent).toContain('内部语义');
    expect(editor.textContent).not.toContain('"recordType"');
    expect(editor.textContent).toContain('\\draw (A) -- (B);');
    expect(studioDocument.getSnapshot().source).toBe(source);

    fireEvent.click(screen.getByRole('button', { name: /展开 .*条内部语义/ }));
    expect(editor.textContent).toContain('"recordType"');
    expect(studioDocument.getSnapshot().source).toBe(source);

    fireEvent.click(screen.getByRole('button', { name: /折叠 .*条内部语义/ }));
    expect(editor.textContent).not.toContain('"recordType"');
    expect(studioDocument.getSnapshot().source).toBe(source);
  });
});
