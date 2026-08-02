# Source-neutral creation preview — local browser verification

Date: 2026-08-01

Environment: local Next.js dev server at `http://localhost:3000/tikz`; in-app browser. No Docker, test suite, build, lint, typecheck, or TeX command was run.

## Preview remains ephemeral

- Source contained only free points `A`, `B`, and `C`.
- Selected `折线`, clicked `A` and `B`, then moved the pointer.
- `[data-tool-preview]` and `.tz-construction-preview` each had one live overlay.
- The editor still showed exactly the original five source lines and `3 点 · 0 图元`; no managed block or raw TikZ preview was written.

## Step-back and cancel

- First `Escape` stepped the variable-arity construction from two anchors to one and removed the overlay.
- Second `Escape` cleared the remaining anchor; the instruction reset to `逐点点击，双击或 Enter 完成`.
- The editor source stayed unchanged throughout and the preview overlay count remained zero after cancellation.

## Commit

- Repeated the construction with `A`, `B`, `C`, then pressed `Enter`.
- Exactly one schema-v2 managed block `polyline-A-B-C` was inserted.
- Result: `3 点 · 1 图元`, `构造有效`, preview overlay count zero.
- The Inspector resolved the polyline to a semantic entity, interactive render primitive, managed record bindings, and `managed-recompile` writeback strategy.

This confirms the architecture boundary: creation preview is overlay-only, while source mutation is a single pointer/keyboard completion transaction.
