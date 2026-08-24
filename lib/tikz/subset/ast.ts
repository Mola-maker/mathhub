import type { TikzOptionSequence } from '../syntax/option-sequence';
import type { TikzCoordinateTransform } from './coordinate-transform';

export interface SourceRange { start: number; end: number }

export type CoordExpr =
  | { kind: 'literal'; x: number | NumExpr; y: number | NumExpr; range: SourceRange }
  | { kind: 'ref'; name: string; anchor?: 'center'; range: SourceRange }
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
  | { kind: 'num-call'; fn: 'sin' | 'cos'; arg: NumExpr; range: SourceRange }
  | { kind: 'veclen'; x: NumExpr; y: NumExpr; range: SourceRange };

export type LetBinding =
  | { type: 'point'; name: string; value: CoordExpr; range: SourceRange }
  | { type: 'num'; name: string; value: NumExpr; range: SourceRange };

export interface StyleOptions {
  raw: string;
  range: SourceRange;
  /** Ordered, lossless pgfkeys projection. Never normalize this into a map. */
  sequence: TikzOptionSequence;
}

export type CircleRadius =
  | { kind: 'literal'; value: number; range: SourceRange }
  | { kind: 'through'; point: CoordExpr; range: SourceRange };

export type PathSpec =
  | { type: 'polyline'; points: CoordExpr[]; cycle: boolean; range: SourceRange }
  | {
    type: 'rectangle';
    first: CoordExpr;
    opposite: CoordExpr;
    range: SourceRange;
  }
  | {
    type: 'cubic-bezier';
    start: CoordExpr;
    control1: CoordExpr;
    control2: CoordExpr;
    end: CoordExpr;
    range: SourceRange;
  }
  | {
    type: 'circular-arc';
    start: CoordExpr;
    startAngleDeg: number;
    endAngleDeg: number;
    radius: number;
    /** Lossless numeric slots used by Canvas/AI writeback. */
    parameterSources: {
      startAngle: { value: number; range: SourceRange };
      endAngle: { value: number; range: SourceRange };
      radius: { value: number; range: SourceRange };
    };
    range: SourceRange;
  }
  | {
    type: 'ellipse';
    center: CoordExpr;
    xRadius: number;
    yRadius: number;
    /** Lossless numeric slots used by Canvas/AI scale writeback. */
    parameterSources: {
      xRadius: { value: number; range: SourceRange };
      yRadius: { value: number; range: SourceRange };
    };
    range: SourceRange;
  }
  | { type: 'circle'; center: CoordExpr; radius: CircleRadius; range: SourceRange };

export interface IntersectionBinding { index: number; name: string; range: SourceRange }

export type GraphConnector = '--' | '->' | '<-' | '<->' | '-!-';

export interface GraphNodeSpec {
  name: string;
  text: string;
  options: StyleOptions | null;
  range: SourceRange;
}

export interface GraphEdgeSpec {
  from: string;
  to: string;
  connector: GraphConnector;
  options: StyleOptions | null;
  range: SourceRange;
}

type StatementSyntax =
  | { kind: 'coordinate'; name: string; at: CoordExpr; range: SourceRange }
  | { kind: 'let-coordinate'; bindings: LetBinding[]; name: string; at: CoordExpr; range: SourceRange }
  | { kind: 'path'; command: 'draw' | 'path' | 'fill' | 'filldraw'; options: StyleOptions | null; specs: PathSpec[]; namePath: string | null; intersections: { of: [string, string]; bindings: IntersectionBinding[] } | null; range: SourceRange }
  | { kind: 'graph'; options: StyleOptions | null; nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[]; range: SourceRange }
  | { kind: 'node'; options: StyleOptions | null; at: CoordExpr; text: string; range: SourceRange }
  | { kind: 'pic'; picType: 'angle' | 'right-angle'; points: [string, string, string]; options: StyleOptions | null; range: SourceRange };

export type Statement = StatementSyntax & {
  /** Static coordinate CTM projected from enclosing scopes/path options. */
  coordinateTransform?: TikzCoordinateTransform;
  /** Ordered presentation options inherited from supported enclosing scopes. */
  inheritedStyleRaw?: string;
};

export interface TikzPicture { scale: number | null; statements: Statement[]; range: SourceRange }

export class ParseError extends Error {
  constructor(message: string, public readonly start: number, public readonly end: number) {
    super(message);
    this.name = 'ParseError';
  }
}
