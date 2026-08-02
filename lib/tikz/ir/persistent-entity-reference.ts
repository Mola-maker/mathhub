/** Stable across Scene/RenderPrimitive reprojections and browser reloads. */
export function qualifiedManagedEntityReference(
  constructionId: string,
  recordId: string,
): string {
  return `managed:${constructionId}:${recordId}`;
}

export type PersistentSourceCircleDefinition =
  | {
    readonly kind: 'center-through';
    readonly centerName: string;
    readonly throughName: string;
  }
  | {
    readonly kind: 'center-radius';
    readonly centerName: string;
    readonly radius: number;
  };

function encodedReferencePart(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Definition signature used only to select a raw circle in the current source
 * revision. It is not a durable entity identity: another statement can acquire
 * the same definition after an edit. Before a dependent construction is
 * persisted, the raw circle must be adopted into an explicit managed entity.
 */
export function qualifiedSourceCircleReference(
  definition: PersistentSourceCircleDefinition,
): string | null {
  const centerName = definition.centerName.trim();
  if (!centerName) return null;
  const center = encodedReferencePart(centerName);
  if (definition.kind === 'center-through') {
    const throughName = definition.throughName.trim();
    if (!throughName) return null;
    return `source:circle:center:${center}:through:${encodedReferencePart(throughName)}`;
  }
  if (!Number.isFinite(definition.radius) || definition.radius <= 0) {
    return null;
  }
  const radius = Object.is(definition.radius, -0)
    ? '0'
    : String(definition.radius);
  return `source:circle:center:${center}:radius:${radius}`;
}
