import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { EntityIdentityRegistry } from './entity-identity';
import { StudioDocument } from './studio-document';

function bind(registry: EntityIdentityRegistry, document: StudioDocument) {
  const snapshot = document.getSnapshot();
  const analysis = analyze(snapshot.source, snapshot.revision);
  if (!analysis.scene || !analysis.stmts) throw new Error('expected valid scene');
  return registry.reconcile(
    analysis.scene,
    analysis.stmts,
    snapshot.source,
    snapshot.revision,
    document.getTransactionsSince(0),
  );
}

describe('EntityIdentityRegistry', () => {
  it('空白和前置注释变化后保持点与图元 stableId', () => {
    const source = '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\draw (A)--(1,1);\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const registry = new EntityIdentityRegistry();
    const first = bind(registry, document);
    const pointId = first.points.get('A')?.stableId;
    const elementId = first.elements[0].stableId;

    document.applyPatch(
      { from: 0, to: 0, insert: '% comment\n' },
      'keyboard',
      document.getSnapshot().revision,
    );
    const second = bind(registry, document);

    expect(second.points.get('A')?.stableId).toBe(pointId);
    expect(second.elements[0].stableId).toBe(elementId);
  });

  it('点改名但语句位置相同也通过range reconciliation保持身份', () => {
    const source = '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const registry = new EntityIdentityRegistry();
    const firstId = bind(registry, document).points.get('A')?.stableId;
    const at = source.indexOf('(A)') + 1;
    document.applyPatch({ from: at, to: at + 1, insert: 'P' }, 'keyboard', 0);
    expect(bind(registry, document).points.get('P')?.stableId).toBe(firstId);
  });
});
