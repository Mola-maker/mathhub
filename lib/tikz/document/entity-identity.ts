import type { StudioTransactionRecord } from './studio-document';
import type { TextPatch } from './source-transaction';
import type { Scene } from '../semantics/scene';
import type { SourceRange, Statement } from '../subset/ast';

interface EntityDescriptor {
  slot: string;
  kind: string;
  semanticKey: string;
  range: SourceRange;
}

interface IdentityRecord extends EntityDescriptor {
  stableId: string;
}

function createStableId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `tz_${uuid}` : `tz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function mapPosition(
  position: number,
  patches: readonly TextPatch[],
  association: -1 | 1,
): number {
  let delta = 0;
  const ordered = [...patches].sort((a, b) => a.from - b.from);
  for (const patch of ordered) {
    if (position < patch.from || (position === patch.from && association < 0)) break;
    if (position > patch.to || (position === patch.to && association > 0)) {
      delta += patch.insert.length - (patch.to - patch.from);
      continue;
    }
    return patch.from + delta + (association < 0 ? 0 : patch.insert.length);
  }
  return position + delta;
}

function mapRange(
  range: SourceRange,
  transactions: readonly StudioTransactionRecord[],
): SourceRange {
  let mapped = range;
  for (const transaction of transactions) {
    mapped = {
      start: mapPosition(mapped.start, transaction.patches, -1),
      end: mapPosition(mapped.end, transaction.patches, 1),
    };
  }
  return mapped;
}

function statementRange(stmts: Statement[], stmtIndex: number): SourceRange {
  return stmts[stmtIndex]?.range ?? { start: 0, end: 0 };
}

function elementSemanticKey(
  element: Scene['elements'][number],
  ordinal: number,
): string {
  const refs = element.refs.join('\u0000');
  switch (element.kind) {
    case 'polyline':
      return `element:polyline:${ordinal}:${element.cycle ? 'closed' : 'open'}:${refs}`;
    case 'circle':
      return `element:circle:${ordinal}:${refs}`;
    case 'label':
      // Label text and anchor are editable properties of the same semantic
      // object. They must not mint a new identity after an Inspector write.
      return `element:label:${ordinal}:${refs}`;
    case 'angle-mark':
      return `element:angle-mark:${ordinal}:${element.right ? 'right' : 'arc'}:${refs}`;
  }
}

function describe(scene: Scene, stmts: Statement[]): EntityDescriptor[] {
  const descriptors: EntityDescriptor[] = [];
  for (const [name, point] of scene.points) {
    descriptors.push({
      slot: `point:${name}`,
      kind: 'point',
      semanticKey: `point:${name}`,
      range: statementRange(stmts, point.stmtIndex),
    });
  }
  const ordinalByStatement = new Map<number, number>();
  scene.elements.forEach((element, index) => {
    const ordinal = ordinalByStatement.get(element.stmtIndex) ?? 0;
    ordinalByStatement.set(element.stmtIndex, ordinal + 1);
    const range = statementRange(stmts, element.stmtIndex);
    descriptors.push({
      slot: `element:${index}`,
      kind: `element:${element.kind}`,
      // Identity is semantic and deliberately excludes source spelling and
      // style. Whole-block managed recompiles may rewrite both while the
      // selected geometry object remains the same.
      semanticKey: elementSemanticKey(element, ordinal),
      range,
    });
  });
  return descriptors;
}

function rangeDistance(a: SourceRange, b: SourceRange): number {
  return Math.abs(a.start - b.start) + Math.abs(a.end - b.end);
}

export class EntityIdentityRegistry {
  private revision = 0;
  private records: IdentityRecord[] = [];

  reconcile(
    scene: Scene,
    stmts: Statement[],
    _source: string,
    sourceRevision: number,
    transactions: readonly StudioTransactionRecord[],
  ): Scene {
    const relevant = transactions
      .filter((transaction) => (
        transaction.fromRevision >= this.revision
        && transaction.toRevision <= sourceRevision
      ))
      .sort((a, b) => a.fromRevision - b.fromRevision);
    const previous = this.records.map((record) => ({
      ...record,
      range: mapRange(record.range, relevant),
    }));
    const nextDescriptors = describe(scene, stmts);
    const claimed = new Set<string>();
    const assigned = new Map<string, string>();

    for (const descriptor of nextDescriptors) {
      const exact = previous.find((record) => (
        !claimed.has(record.stableId)
        && record.semanticKey === descriptor.semanticKey
      ));
      if (!exact) continue;
      claimed.add(exact.stableId);
      assigned.set(descriptor.slot, exact.stableId);
    }

    for (const descriptor of nextDescriptors) {
      if (assigned.has(descriptor.slot)) continue;
      const nearest = previous
        .filter((record) => !claimed.has(record.stableId) && record.kind === descriptor.kind)
        .map((record) => ({ record, distance: rangeDistance(record.range, descriptor.range) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearest || nearest.distance > 128) continue;
      claimed.add(nearest.record.stableId);
      assigned.set(descriptor.slot, nearest.record.stableId);
    }

    for (const descriptor of nextDescriptors) {
      if (!assigned.has(descriptor.slot)) {
        assigned.set(descriptor.slot, createStableId());
      }
    }

    const points = new Map(
      [...scene.points].map(([name, point]) => [
        name,
        { ...point, stableId: assigned.get(`point:${name}`)! },
      ]),
    );
    const elements = scene.elements.map((element, index) => ({
      ...element,
      stableId: assigned.get(`element:${index}`)!,
    }));

    this.records = nextDescriptors.map((descriptor) => ({
      ...descriptor,
      stableId: assigned.get(descriptor.slot)!,
    }));
    this.revision = sourceRevision;
    return { ...scene, points, elements };
  }
}
