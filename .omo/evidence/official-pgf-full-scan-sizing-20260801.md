# Official PGF 3.1.11a full static scan sizing

Date: 2026-08-01

Scope: architecture sizing only. No TeX execution, project test, build, typecheck,
Docker, or browser validation was performed.

## Provenance

- Official release: PGF/TikZ 3.1.11a, 2025-08-29.
- Pinned release commit: `839974a3f895bfb86f5a8bc155f0886c918f1bff`.
- Local source used for the sizing scan:
  `C:\Program Files\MiKTeX\tex\generic\pgf`.
- `pgf.revision.tex` reports `3.1.11a` and date `2025-08-29`.
- A direct GitHub clone of the pinned tag was attempted first, but this machine
  could not connect to `github.com:443`; no repository checkout was created.

The installed source version matches the official release, but this sizing run
does not claim that the local MiKTeX tree itself proves the pinned Git commit.
The production generator still requires an explicit checkout plus version/SHA.

## Result

The offline generator scanned 180 `.code.tex` files.

- Raw scan: 14,746 entries, 27,071,993 bytes.
- Raw stable-ID duplicates: 99 rows detected before normalization.
- Generator was updated to collapse exact duplicates and deterministically
  disambiguate true ID collisions.
- Normalized scan: 14,654 entries, 26,932,282 bytes.
- Static entries: 1,888.
- Dynamic entries: 12,766.

The two apparent duplicate prefixes reported by a simple regex were escaped-quote
truncation artifacts; the complete generated IDs carry distinct stable suffixes.

Temporary output only:
`C:\Users\22494\AppData\Local\Temp\pgf-3.1.11a-full-registry-deduped.ts`.

## Architecture decision

A roughly 27 MB generated TypeScript object must not be imported into the browser
or eagerly validated/indexed in the request path. The full official inventory
will be a build-time artifact split by surface/namespace/status, with a compact
manifest and a server-side search index. Canvas and AI receive only bounded,
intent-selected capability slices. Dynamic entries remain source-preserving,
exact-render-only boundaries unless a reviewed semantic plugin exists.

The checked-in representative seed remains explicitly `exhaustive: false`; it is
not a substitute for the full generated artifact and must never be presented as
complete interactive TikZ coverage.
