import type { Pt } from '../semantics/calc-eval';
import type { Scene, SceneElement, ScenePoint } from '../semantics/scene';
import type { SourceRange } from '../subset/ast';
import { labelOffset } from './label-layout';
import { DEFAULT_ANGLE_MARK_RADIUS } from './svg-decoration-primitives';
import { sceneToScreen, type Viewport } from './viewport';

export interface RenderTheme {
  handleRadius: number;
  handleFill: string;
  handleDerivedFill: string;
  selectionColor: string;
  hoverColor: string;
  labelFont: string;
  angleRadius: number;
}

export const defaultTheme: RenderTheme = {
  handleRadius: 4,
  handleFill: '#0a84ff',
  handleDerivedFill: '#ffffff',
  selectionColor: '#0a84ff',
  hoverColor: '#64b5ff',
  labelFont: 'italic 13px Georgia, "Times New Roman", serif',
  angleRadius: DEFAULT_ANGLE_MARK_RADIUS,
};

interface ElementProps {
  el: SceneElement;
  vp: Viewport;
  theme: RenderTheme;
  selected: boolean;
  hovered: boolean;
  sourceRange?: SourceRange;
}

function unit(from: Pt, to: Pt): Pt | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : null;
}

function arrowPath(tip: Pt, direction: Pt, strokeWidth: number): string {
  const factor = 1 + 0.5 * Math.max(strokeWidth - 1, 0);
  const length = 10 * factor;
  const halfWidth = 4 * factor;
  const normal = { x: -direction.y, y: direction.x };
  const base = {
    x: tip.x - direction.x * length,
    y: tip.y - direction.y * length,
  };
  return [
    `M ${tip.x} ${tip.y}`,
    `L ${base.x + normal.x * halfWidth} ${base.y + normal.y * halfWidth}`,
    `L ${base.x - normal.x * halfWidth} ${base.y - normal.y * halfWidth}`,
    'Z',
  ].join(' ');
}

function Arrows({
  points,
  arrow,
  color,
  strokeWidth,
}: {
  points: Pt[];
  arrow: 'none' | '->' | '<-' | '<->';
  color: string;
  strokeWidth: number;
}) {
  if (arrow === 'none' || points.length < 2) return null;
  const firstDirection = unit(points[1], points[0]);
  const lastDirection = unit(points[points.length - 2], points[points.length - 1]);
  return (
    <g data-tikz-decoration="arrows" fill={color} pointerEvents="none">
      {(arrow === '<-' || arrow === '<->') && firstDirection
        ? <path d={arrowPath(points[0], firstDirection, strokeWidth)} />
        : null}
      {(arrow === '->' || arrow === '<->') && lastDirection
        ? <path d={arrowPath(points[points.length - 1], lastDirection, strokeWidth)} />
        : null}
    </g>
  );
}

function anglePath(el: Extract<SceneElement, { kind: 'angle-mark' }>, vp: Viewport, theme: RenderTheme): string {
  const vertex = sceneToScreen(el.vertex, vp);
  const from = sceneToScreen(el.from, vp);
  const to = sceneToScreen(el.to, vp);
  const first = unit(vertex, from);
  const second = unit(vertex, to);
  if (!first || !second) return '';

  if (el.right) {
    const size = 12;
    const p1 = { x: vertex.x + first.x * size, y: vertex.y + first.y * size };
    const corner = { x: p1.x + second.x * size, y: p1.y + second.y * size };
    const p2 = { x: vertex.x + second.x * size, y: vertex.y + second.y * size };
    return `M ${p1.x} ${p1.y} L ${corner.x} ${corner.y} L ${p2.x} ${p2.y}`;
  }

  const radius = theme.angleRadius;
  const start = { x: vertex.x + first.x * radius, y: vertex.y + first.y * radius };
  const end = { x: vertex.x + second.x * radius, y: vertex.y + second.y * radius };
  const cross = first.x * second.y - first.y * second.x;
  const sweep = cross >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${end.x} ${end.y}`;
}

function semanticProps(
  el: SceneElement,
  selected: boolean,
  hovered: boolean,
  sourceRange?: SourceRange,
) {
  return {
    'data-tikz-id': el.stableId,
    'data-tikz-source-binding': `binding:${el.stableId}`,
    'data-tikz-stmt': el.stmtIndex,
    'data-tikz-kind': el.kind,
    'data-tikz-refs': el.refs.join(' '),
    'data-tikz-source-start': sourceRange?.start,
    'data-tikz-source-end': sourceRange?.end,
    'data-selected': selected ? 'true' : undefined,
    'data-hovered': hovered ? 'true' : undefined,
  };
}

function ElementSvg({
  el,
  vp,
  theme,
  selected,
  hovered,
  sourceRange,
}: ElementProps) {
  const stroke = selected
    ? theme.selectionColor
    : hovered
      ? theme.hoverColor
      : el.style.stroke;
  const strokeWidth = selected
    ? el.style.strokeWidth * 1.8
    : hovered
      ? el.style.strokeWidth * 1.45
      : el.style.strokeWidth;
  const common = {
    ...semanticProps(el, selected, hovered, sourceRange),
    stroke,
    strokeWidth,
    strokeDasharray: el.style.dash ?? undefined,
    fill: el.style.fill ?? 'none',
    fillOpacity: el.style.fillOpacity,
    opacity: el.style.opacity,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (el.kind === 'polyline') {
    const points = el.points.map((point) => sceneToScreen(point, vp));
    const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
    return (
      <g>
        {el.cycle
          ? <polygon {...common} points={pointString} />
          : <polyline {...common} points={pointString} />}
        <Arrows
          points={points}
          arrow={el.style.arrow}
          color={stroke}
          strokeWidth={strokeWidth}
        />
      </g>
    );
  }

  if (el.kind === 'circle') {
    const center = sceneToScreen(el.center, vp);
    return <circle {...common} cx={center.x} cy={center.y} r={el.radius * vp.scale} />;
  }

  if (el.kind === 'label') {
    const at = sceneToScreen(el.at, vp);
    const offset = labelOffset(el.anchor);
    return (
      <text
        {...semanticProps(el, selected, hovered, sourceRange)}
        x={at.x + offset.x}
        y={at.y + offset.y}
        fill={selected ? theme.selectionColor : el.style.stroke}
        opacity={el.style.opacity}
        style={{ font: theme.labelFont }}
        textAnchor={offset.x < 0 ? 'end' : offset.x > 0 ? 'start' : 'middle'}
      >
        {el.text.replace(/\$/g, '')}
      </text>
    );
  }

  return (
    <path
      {...common}
      d={anglePath(el, vp, theme)}
      fill="none"
    />
  );
}

function HandleSvg({
  point,
  vp,
  theme,
  selected,
  hovered,
  sourceRange,
}: {
  point: ScenePoint;
  vp: Viewport;
  theme: RenderTheme;
  selected: boolean;
  hovered: boolean;
  sourceRange?: SourceRange;
}) {
  const screen = sceneToScreen(point.position, vp);
  return (
    <g
      data-tikz-handle={point.name}
      data-tikz-id={point.stableId}
      data-tikz-source-binding={`binding:${point.stableId}`}
      data-tikz-source-start={sourceRange?.start}
      data-tikz-source-end={sourceRange?.end}
      data-hovered={hovered ? 'true' : undefined}
    >
      {selected
        ? (
          <circle
            className="tz-selection-halo"
            cx={screen.x}
            cy={screen.y}
            r={theme.handleRadius + 3.5}
            fill="none"
            stroke={theme.selectionColor}
            pointerEvents="none"
          />
        )
        : null}
      <circle
        className="tz-point-handle"
        cx={screen.x}
        cy={screen.y}
        r={theme.handleRadius}
        fill={point.free ? theme.handleFill : theme.handleDerivedFill}
        stroke={hovered ? theme.hoverColor : theme.handleFill}
        data-tikz-point={point.name}
        data-tikz-free={String(point.free)}
        data-selected={selected ? 'true' : undefined}
      />
    </g>
  );
}

export function TikzSceneSvg({
  scene,
  viewport,
  theme = defaultTheme,
  selection = [],
  selectedStmtIndex = null,
  hoveredStmtIndex = null,
  sourceBindingRanges = new Map(),
}: {
  scene: Scene;
  viewport: Viewport;
  theme?: RenderTheme;
  selection?: string[];
  selectedStmtIndex?: number | null;
  hoveredStmtIndex?: number | null;
  sourceBindingRanges?: ReadonlyMap<string, SourceRange>;
}) {
  const selected = new Set(selection);
  return (
    <>
      <g data-layer="base">
        {scene.elements.map((element) => (
          <ElementSvg
            key={element.stableId}
            el={element}
            vp={viewport}
            theme={theme}
            selected={
              selectedStmtIndex === element.stmtIndex
              || (selectedStmtIndex === null && element.refs.some((ref) => selected.has(ref)))
            }
            hovered={hoveredStmtIndex === element.stmtIndex}
            sourceRange={sourceBindingRanges.get(`binding:${element.stableId}`)}
          />
        ))}
      </g>
      <g data-layer="overlay">
        {[...scene.points.values()].filter((point) => !point.internal).map((point) => (
          <HandleSvg
            key={point.stableId}
            point={point}
            vp={viewport}
            theme={theme}
            selected={selected.has(point.name)}
            hovered={hoveredStmtIndex === point.stmtIndex}
            sourceRange={sourceBindingRanges.get(`binding:${point.stableId}`)}
          />
        ))}
      </g>
    </>
  );
}
