export interface SourceRange { start: number; end: number }

export type CoordExpr =
  | { kind: 'literal'; x: number; y: number; range: SourceRange }
  | { kind: 'ref'; name: string; range: SourceRange }
  | { kind: 'calc'; expr: CalcExpr; range: SourceRange };

export type CalcExpr =
  | { op: 'coord'; coord: CoordExpr; range: SourceRange }
  | { op: 'add' | 'sub'; left: CalcExpr; right: CalcExpr; range: SourceRange }
  | { op: 'interpolate'; a: CalcExpr; t: NumExpr; b: CalcExpr; range: SourceRange }
  | { op: 'rotate'; a: CalcExpr; t: NumExpr; angleDeg: NumExpr; b: CalcExpr; range: SourceRange }
  | { op: 'project'; a: CalcExpr; p: CalcExpr; b: CalcExpr; range: SourceRange };

export type NumExpr =
  | { kind: 'num-lit'; value: number; range: SourceRange }
  | { kind: 'num-var'; name: string; range: SourceRange }
  | { kind: 'num-comp'; pvar: string; axis: 'x' | 'y'; range: SourceRange }
  | { kind: 'num-bin'; binop: '+' | '-' | '*' | '/'; left: NumExpr; right: NumExpr; range: SourceRange }
  | { kind: 'veclen'; x: NumExpr; y: NumExpr; range: SourceRange };

export type LetBinding =
  | { type: 'point'; name: string; value: CoordExpr; range: SourceRange }
  | { type: 'num'; name: string; value: NumExpr; range: SourceRange };

export interface StyleOptions { raw: string; range: SourceRange }

export type CircleRadius =
  | { kind: 'literal'; value: number; range: SourceRange }
  | { kind: 'through'; point: CoordExpr; range: SourceRange };

export type PathSpec =
  | { type: 'polyline'; points: CoordExpr[]; cycle: boolean; range: SourceRange }
  | { type: 'circle'; center: CoordExpr; radius: CircleRadius; range: SourceRange };

export interface IntersectionBinding { index: number; name: string; range: SourceRange }

export type Statement =
  | { kind: 'coordinate'; name: string; at: CoordExpr; range: SourceRange }
  | { kind: 'let-coordinate'; bindings: LetBinding[]; name: string; at: CoordExpr; range: SourceRange }
  | { kind: 'path'; command: 'draw' | 'path' | 'fill' | 'filldraw'; options: StyleOptions | null; specs: PathSpec[]; namePath: string | null; intersections: { of: [string, string]; bindings: IntersectionBinding[] } | null; range: SourceRange }
  | { kind: 'node'; options: StyleOptions | null; at: CoordExpr; text: string; range: SourceRange }
  | { kind: 'pic'; picType: 'angle' | 'right-angle'; points: [string, string, string]; options: StyleOptions | null; range: SourceRange };

export interface TikzPicture { scale: number | null; statements: Statement[]; range: SourceRange }

export class ParseError extends Error {
  constructor(message: string, public readonly start: number, public readonly end: number) {
    super(message);
    this.name = 'ParseError';
  }
}