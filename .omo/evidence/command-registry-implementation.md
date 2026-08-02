# Command registry implementation evidence

## Scope

Owned files only:

- `lib/tikz/commands/command-registry.ts`
- `lib/tikz/commands/default-commands.ts`

No component, renderer, construction-catalog, or tool-registry files were
changed by this subtask. No Vitest, build, lint, or typecheck command was run,
per the parent task's verification boundary.

## Static scenarios and binary observables

| Scenario | Invocation / source check | Observable |
| --- | --- | --- |
| Cross-platform normalization | `normalizeShortcut('Mod+K', 'windows')`, `normalizeShortcut('Mod+K', 'macos')`, `formatShortcut('Mod+K', 'macos')` | Registered bindings retain symbolic `Mod+K`; materialization maps it to `Control+K` on Windows/Linux and `Meta+K` on macOS; macOS label is `⌘K`. |
| Event normalization | `CommandRegistry.resolve({ shortcut: { key: 'k', metaKey: true }, scope: 'global', platform: 'macos' })` | Event materializes to `Meta+K` and can resolve a `Mod+K` binding. |
| Collision behavior | `detectConflicts()` compares canonical shortcut, overlapping scope (`global` or equal), and condition key | Equal-priority candidates return `status: 'ambiguous'`; `dispatch()` does not execute either handler. Different priorities return the deterministic winner plus a warning diagnostic. |
| Editable guard | `resolve({ shortcut: 'V', scope: 'canvas', editable: true })` against a default tool activation | The candidate is filtered unless `allowInEditable: true`; palette/studio commands explicitly opt in. |
| Registration lifecycle | `register`, returned `registration.unregister()`, `unregister(id)`, `register(..., { replace: true })` | IDs are unique by default, unregister is boolean/idempotent, and replacement preserves registration ordering. |
| Default command coverage | `DEFAULT_COMMANDS` / `DEFAULT_TOOL_SHORTCUTS` | Contains reserved `studio.close`, `palette.toggle`, `construction.finish`, `construction.back`, `selection.delete`, and `tool.activate.*`; tool shortcut list is unique (legacy `Q` and `Alt+P` collisions are not carried over). |

## Artifact paths

- Implementation: `lib/tikz/commands/command-registry.ts`
- Default command set: `lib/tikz/commands/default-commands.ts`
- This record: `.omo/evidence/command-registry-implementation.md`

