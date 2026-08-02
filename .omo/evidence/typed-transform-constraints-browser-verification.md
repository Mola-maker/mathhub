# Typed transform constraints browser verification

Date: 2026-08-01

Environment: local Next.js development server at
`http://localhost:3000/tikz`, controlled through the in-app Edge browser.
Docker was not used. Tests, build, lint, typecheck, and TeX compilation were
not run.

## Source scenario

Loaded four named points A, B, C, D and the reference segment C--D. The initial
page showed `4 points / 1 element` and `construction valid`.

## Verified transforms

1. Transform -> Point reflection, B about A:
   - emitted `point-reflection(source=B, center=A, result=R1)`;
   - retained the existing exact TikZ writer `R1 = 2A - B`;
   - emitted a typed result entity, dependency relations, and output.
2. Transform -> Rotate 90 degrees, B about A:
   - emitted `rotation(source=B, center=A, result=R2, angleDegrees=90)`;
   - the angle is a scalar constraint parameter rather than an inferred tag.
3. Transform -> Homothety x2, B about A:
   - emitted `homothety(source=B, center=A, result=S1, scale=2)`;
   - the ratio is explicitly available to Geometry IR and AI context.
4. Transform -> Axis reflection, B about line C--D:
   - emitted
     `line-reflection(source=B, axisStart=C, axisEnd=D, foot=H1, result=R3)`;
   - emitted both projection-foot and reflected-point entities/outputs;
   - emitted separate dependency edges for H1 and R3;
   - preserved the writer formulas `H1 = projection(B, CD)` and
     `R3 = 2H1 - B`.

After all four operations the page showed `9 points / 1 element` and
`construction valid`. No Next.js runtime overlay appeared.

CodeMirror virtualizes off-screen lines. Each constraint was inspected
immediately after its own transaction; the editor was then moved to the end to
confirm the complete line-reflection records, formulas, and `% @mathgeo end`
marker.
