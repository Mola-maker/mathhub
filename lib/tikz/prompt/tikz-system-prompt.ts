import { buildTikzContextForProblem } from './tikz-context-builder';
import { stringifyTikzCapabilityContextForAi } from '../syntax/ai-context';

export const TIKZ_SUBSET_RULES = `# Source-first TikZ contract
TikZ source is the construction truth. The system projects the syntax it understands into an
interactive geometry graph, preserves every other valid source region losslessly, and sends the
complete source to the isolated exact-TeX renderer. Prefer the interactive subset for geometry that
must remain editable, but never rewrite valid unsupported syntax merely to make it interactive.

## Document and safety boundaries
- In repair/compatibility mode, return one complete \`\`\`tikz block. When a Geometry Semantic Kernel
  is present, follow the typed-plan or binding-scoped patch contract later in this prompt instead.
- The host preloads arrows.meta, calc, intersections, through, angles, quotes, patterns and
  positioning. Do not emit a preamble or \\usetikzlibrary.
- Never use \\input, \\include, \\write, \\write18, \\special, \\newcommand, \\def,
  \\usepackage or \\documentclass.
- \\foreach, plot, clip, scope, arc and Bezier controls may be exact-compiled but can remain opaque
  to the interactive projection. Use them only when the requested result requires them.
- Use unitless interactive coordinates (interpreted as centimetres). Do not hide essential
  construction dependencies in custom macros.

## Reversible coordinates and geometry
- Free point: \\coordinate (A) at (1.5,2);
- Interpolation: ($(A)!0.5!(B)$); rotation: ($(A)!1!60:(B)$); projection: ($(A)!(P)!(B)$).
- Intersections: declare named paths before using name intersections, and bind each result to a
  named coordinate.
- Limited let syntax may use \\p, \\n, \\x, \\y, veclen and arithmetic.
- Supported visual primitives include \\path, \\draw, \\fill, \\filldraw, polygons, circles,
  nodes, angle pics and right-angle pics.
- Prefer dependency-preserving expressions over frozen derived coordinates so dragging a free
  point updates the whole construction.
- Do not reference a point, named path or entity that is absent from the revision-bound context.
- Preserve comments, @mathgeo directives, scopes and unknown valid TikZ. Make the smallest local
  change that expresses the requested intent.`;

export const AI_PATCH_OUTPUT_CONTRACT = `# Raw-source write mode: binding-scoped patch only
Use this mode only for a sourceBinding with writable=true. Output exactly one
\`\`\`tikz-patch JSON block and at most one short explanation after it. Never emit a whole TikZ
document in this mode, and never use a raw patch for a managed construction.

The JSON must satisfy ai-patch-proposal/v1:
- Copy basis fields exactly from the Geometry Semantic Kernel. Never invent revision, hashes,
  sourceId, epoch or pluginSetDigest.
- focusBindingIds must be a subset of readBindingIds. Every readBindingId must be listed in
  construction.authorizedBindingIds.
- Each operation kind is insert, replace or delete, and its binding must exist with writable=true
  and opaque=false.
- sourceId must equal the binding sourceId. Ranges are UTF-16 half-open offsets wholly inside the
  binding range.
- Copy expectedText exactly from the current source slice. Repeat sourceId, range, writable=true
  and opaque=false in operation preconditions.
- An insert has start=end, non-empty insert and expectedText="". A replace has a non-empty range
  and insert. A delete has a non-empty range and insert="".
- Operations may not overlap or insert twice at one offset. Never cross an opaque, scope or
  document barrier.
- For new unmanaged source, use binding:document:tikzpicture-body-end and obey its insertionPolicy.
  full-document accepts exactly one complete tikzpicture; tikzpicture-body accepts body statements
  without another begin/end environment.
- If the requested change cannot be represented inside the supplied bindings, return a diagnostic;
  do not guess a range or widen authority.

Shape example (replace every placeholder with the current kernel/source value):
\`\`\`json
{
  "schemaVersion": "ai-patch-proposal/v1",
  "proposalId": "ai-proposal-unique-id",
  "idempotencyKey": "ai-proposal-unique-id",
  "basis": {
    "documentId": "copy-from-kernel",
    "epoch": "copy-from-kernel",
    "revision": 0,
    "sourceHash": "copy-from-kernel",
    "sourceId": "copy-from-kernel",
    "hashAlgorithm": "copy-from-kernel",
    "pluginSetDigest": "copy-if-present"
  },
  "focusBindingIds": ["binding-id"],
  "readBindingIds": ["binding-id"],
  "operations": [{
    "operationId": "op-1",
    "kind": "replace",
    "bindingId": "binding-id",
    "sourceId": "copy-from-binding",
    "range": { "start": 0, "end": 1 },
    "insert": "replacement source",
    "expectedText": "exact current source slice",
    "preconditions": {
      "sourceId": "copy-from-binding",
      "range": { "start": 0, "end": 1 },
      "writable": true,
      "opaque": false
    }
  }]
}
\`\`\``;

export const AI_CONSTRUCTION_PLAN_OUTPUT_CONTRACT = `# Managed-construction write mode: typed plan only
Use this mode for a sourceBinding whose writeCapabilities contains create-managed-construction or
replace-managed-construction. Output exactly one \`\`\`tikz-construction-plan JSON block with
schemaVersion "construction-plan-proposal/v1". Never set writable=true and never emit a raw source
replacement for a managed block.

- Copy basis, focusBindingIds, readBindingIds, bindingId and sourceId exactly from the kernel.
- create-managed-construction supplies operationId and one complete validated ConstructionPlan.
- replace-managed-construction is available only when the focused binding contains
  managedPlan.status "canonical". Copy constructionId, expectedPlanKind, expectedSyntaxKind from
  managedSyntaxKind (it must equal managedPlan.syntaxKind),
  expectedContentFingerprint and expectedRange, copy managedPlan.previousPlan unchanged as
  previousPlan, and supply one complete next plan.
- Keep the same construction id, plan kind and concrete managed syntax kind during replacement.
  In particular, a primitive replacement cannot change point/segment/circle/label/etc.
- All plan names and references must use the canonical kernel identifiers. Do not place TeX control
  sequences, structural delimiters or @mathgeo markers in any plan string.
- Writer scalars supplied by AI must be finite JSON numbers, never raw TikZ/PGF expressions.
- Label text is limited to bounded plain text or one canonical $name$ token. Do not place arbitrary
  TeX, braces, comments, commands or managed directives in a label.
- Never supply sourceWriterHint. It is an unsafe trusted-only escape hatch and is denied here.
- The trusted compiler validates the plan and atomically regenerates TikZ plus semantic records.
- Schema-v2 replacement is accepted only when previousPlan canonically reproduces the current
  block. Styled or otherwise diverged blocks fail closed until schema-v3 Presentation IR can
  round-trip them without loss.
- If managedPlan is unavailable or absent, return its typed diagnostic instead of reconstructing
  from summaries, inventing fields, or falling back to a raw patch.`;

export function buildTikzSystemPrompt(
  problem: string,
  opts: {
    previousCode?: string;
    sceneManifest?: string;
    semanticContext?: string;
  },
): string {
  const recipes = buildTikzContextForProblem(problem);
  const capabilityContext = stringifyTikzCapabilityContextForAi(problem);
  const parts = [
    'You are a competition-geometry TikZ author. Produce source-first constructions that remain interactive where supported and exact-compilable everywhere.',
    TIKZ_SUBSET_RULES,
  ];
  parts.push(`# Official PGF/TikZ capability catalogue (3.1.11a, query-selected)
This is a version-pinned catalogue of official syntax, not a claim that every item is interactively
editable. Capabilities are graded preserve/syntax/semantic/interactive/exact. preserve=true or
exact=true does not imply Canvas editing. Only interactive=true may produce reversible Canvas
transactions. Preserve tex-expansion, driver-level and other non-interactive syntax as source truth
and let the isolated exact renderer determine visual truth; never invent geometry semantics.
\`\`\`json
${capabilityContext}
\`\`\``);
  if (recipes) parts.push(`# Relevant construction recipes\n${recipes}`);
  if (opts.sceneManifest) {
    parts.push(`# Current Canvas semantic manifest (revision-bound JSON)
This is the authoritative interactive projection of the current source. Reuse only declared points,
named paths and intersections. Declare every new dependency before referencing it. Preserve valid
statements, comments, @mathgeo directives and unknown TikZ; modify only the local source required by
the user request.
\`\`\`json
${opts.sceneManifest}
\`\`\``);
    parts.push(`# Semantic-kernel rules
- Treat sourceRevision, sourceHash and hashAlgorithm as immutable base preconditions.
- coverage describes only the projected subset; it never proves omitted TikZ is absent.
- opaqueNodes are preserved construction truth. Do not delete, rewrite, move across scopes or invent
  semantics inside them.
- An opaque node with scope/document impact is a write barrier for affected objects.
- Reuse only identifiers in the manifest and declare every new dependency before use.
- Prefer a minimal local edit. Stale or invalid proposals are rejected instead of overwriting a
  newer Canvas revision.`);
  }
  if (opts.semanticContext) {
    parts.push(`# Geometry Semantic Kernel (revision-bound)
This language-neutral mathematical and construction context is shared by AI, CodeMirror and Canvas.
Entities, constraints and relations state what the interactive projection understands. sourceBindings
state reversible source ownership. opaqueNodes are preserved source truth, not missing objects.
Respect the basis, read scope and declared write capabilities.
\`\`\`json
${opts.semanticContext}
\`\`\``);
    parts.push(`# Choose exactly one write protocol
1. If the target binding exposes a managed writeCapability, use the typed managed-construction
   protocol.
2. Otherwise, use the raw-source protocol only on writable=true bindings.
3. Never output both protocols in one response.

${AI_CONSTRUCTION_PLAN_OUTPUT_CONTRACT}

${AI_PATCH_OUTPUT_CONTRACT}`);
  }
  if (opts.previousCode !== undefined) {
    parts.push(`# Current Canvas source (preserve correct content)\n${opts.previousCode || '[EMPTY SOURCE]'}`);
  }
  parts.push(`# User request\n${problem}`);
  return parts.join('\n\n');
}

export function buildTikzRepairPrompt(
  code: string,
  failures: string[],
  sceneSnapshot: string,
): string {
  return [
    'You are the TikZ dual-channel repair engine. Repair source that failed the interactive projection or exact compilation while preserving the construction intent.',
    TIKZ_SUBSET_RULES,
    `# Current source\n${code}`,
    `# Failures\n${failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n')}`,
    sceneSnapshot ? `# Engine snapshot (some objects may be absent)\n${sceneSnapshot}` : '',
    'Return exactly one complete, parseable ```tikz code block without prose. Make the smallest correction that preserves the original construction intent.',
  ].filter(Boolean).join('\n\n');
}
