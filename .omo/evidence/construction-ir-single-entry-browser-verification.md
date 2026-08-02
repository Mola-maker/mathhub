# Construction IR single-entry browser verification

Date: 2026-08-01

Environment: local Next.js development server at
`http://localhost:3000/tikz`, controlled through the in-app Edge browser.
Docker was not used. Tests, build, lint, typecheck, and TeX compilation were
not run.

## Architecture change

- Removed the unused `ConstructionBuildResult`, optional catalog `build()`
  callback, `buildFromPlan()`, and nine duplicate `build()` implementations.
- Runtime authoring now has one source-producing path only:
  `ConstructionToolSpec.plan` (or the primitive plan factory) ->
  `compileConstructionPlan` -> source patch -> Transaction Broker.
- Raw source-circle adoption is a first-class schema-v2 compiler operation,
  `compileSourceCircleAdoption`, not a catalog-level line writer. Its managed
  block and the dependent typed plan are validated together and collapsed into
  one Broker patch.
- Repository search found no consumer of the deleted callback. This is an
  intentional breaking cleanup: future tools cannot add a second catalog-level
  source writer beside the typed plan compiler.

## Browser scenario

- After hot reload the default document rendered as
  `5 points / 9 elements` and `construction valid`, with no Next runtime/build
  overlay.
- Selected Competition -> Invert point, then B as the source point, A as the
  inversion center, and C as the radius point.
- The page advanced to `6 points / 10 elements`, remained valid, and did not
  show the `missing Construction IR` diagnostic.
- The source editor contained a schema-v2 `inversion-point` block with typed
  input/entity/constraint/relation/output records, followed by the expected
  PGF `let` construction and visual B--Inv1 guide.

This browser check verifies a competition-level tool still traverses the
single typed authoring entry after deleting the dead compatibility writer.
