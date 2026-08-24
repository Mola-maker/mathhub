import type { Pt } from '../semantics/calc-eval';
import { flattenCircularArc } from '../geometry/circular-arc';
import {
  ellipticalArcSvgUnitPath,
  flattenEllipticalArc,
} from '../geometry/elliptical-arc';
import type { Scene, SceneElement, ScenePoint } from '../semantics/scene';
import type { SourceRange } from '../subset/ast';
import { labelOffset } from './label-layout';
import { DEFAULT_ANGLE_MARK_RADIUS, SvgArrows } from './svg-decoration-primitives';
import {
  presentationDashArray,
  presentationDashOffset,
  presentationFont,
  presentationStrokeWidth,
} from './presentation-scale';
import { sceneToScreen, tikzPresentationScale, type Viewport } from './viewport';

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
  // KaTeX_Math is already loaded by the Studio shell and tracks Computer
  // Modern's italic metrics much more closely than the previous Georgia
  // approximation used by the interactive surface.
  labelFont: 'italic 13px KaTeX_Math, "Times New Roman", serif',
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

function anglePath(el: Extract<SceneElement, { kind: 'angle-mark' }>, vp: Viewport, theme: RenderTheme): string {
  const vertex = sceneToScreen(el.vertex, vp);
  const from = sceneToScreen(el.from, vp);
  const to = sceneToScreen(el.to, vp);
  const first = unit(vertex, from);
  const second = unit(vertex, to);
  if (!first || !second) return '';

  const radius = presentationStrokeWidth(theme.angleRadius, vp);
  if (el.right) {
    const p1 = { x: vertex.x + first.x * radius, y: vertex.y + first.y * radius };
    const corner = { x: p1.x + second.x * radius, y: p1.y + second.y * radius };
    const p2 = { x: vertex.x + second.x * radius, y: vertex.y + second.y * radius };
    return `M ${p1.x} ${p1.y} L ${corner.x} ${corner.y} L ${p2.x} ${p2.y}`;
  }
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
  // Keep presentation truth independent from editor selection state. The
  // selection/hover feedback is provided by overlay CSS and handles.
  const stroke = el.style.stroke;
  const strokeWidth = presentationStrokeWidth(el.style.strokeWidth, vp);
  const common = {
    ...semanticProps(el, selected, hovered, sourceRange),
    stroke,
    strokeWidth,
    strokeDasharray: presentationDashArray(el.style.dash, vp),
    strokeDashoffset: presentationDashOffset(el.style.dashOffset, vp),
    fill: el.style.fill ?? 'none',
    fillOpacity: el.style.fillOpacity,
    strokeOpacity: el.style.strokeOpacity,
    opacity: el.style.opacity,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinecap: el.style.lineCap,
    strokeLinejoin: el.style.lineJoin,
    strokeMiterlimit: el.style.miterLimit,
  };

  if (el.kind === 'polyline') {
    const points = el.points.map((point) => sceneToScreen(point, vp));
    const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
    return (
      <g>
        {el.cycle
          ? <polygon {...common} points={pointString} />
          : <polyline {...common} points={pointString} />}
        <SvgArrows
          points={points}
          arrow={el.style.arrow}
          arrowTip={el.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(vp)}
          opacity={el.style.opacity * el.style.strokeOpacity}
        />
      </g>
    );
  }

  if (el.kind === 'cubic-bezier') {
    const start = sceneToScreen(el.start, vp);
    const control1 = sceneToScreen(el.control1, vp);
    const control2 = sceneToScreen(el.control2, vp);
    const end = sceneToScreen(el.end, vp);
    return (
      <g>
        <path
          {...common}
          d={`M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`}
          fill="none"
        />
        <SvgArrows
          points={[start, control1, control2, end]}
          arrow={el.style.arrow}
          arrowTip={el.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(vp)}
          opacity={el.style.opacity * el.style.strokeOpacity}
        />
      </g>
    );
  }
  if (el.kind === 'circular-arc') {
    const start = sceneToScreen(el.start, vp);
    const end = sceneToScreen(el.end, vp);
    const delta = el.endAngleDeg - el.startAngleDeg;
    const arrowPoints = flattenCircularArc(el, 6).map((point) => sceneToScreen(point, vp));
    return (
      <g>
        <path
          {...common}
          d={`M ${start.x} ${start.y} A ${el.radius * vp.scale} ${el.radius * vp.scale} 0 ${Math.abs(delta) > 180 ? 1 : 0} ${delta < 0 ? 1 : 0} ${end.x} ${end.y}`}
          fill="none"
        />
        <SvgArrows
          points={[...arrowPoints]}
          arrow={el.style.arrow}
          arrowTip={el.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(vp)}
          opacity={el.style.opacity * el.style.strokeOpacity}
        />
      </g>
    );
  }
  if (el.kind === 'elliptical-arc') {
    const center = sceneToScreen(el.center, vp);
    const transform = [
      el.axisX.x * vp.scale,
      -el.axisX.y * vp.scale,
      el.axisY.x * vp.scale,
      -el.axisY.y * vp.scale,
      center.x,
      center.y,
    ].join(' ');
    const arrowPoints = flattenEllipticalArc(el, 6)
      .map((point) => sceneToScreen(point, vp));
    return (
      <g>
        <path
          {...common}
          d={ellipticalArcSvgUnitPath(el)}
          transform={`matrix(${transform})`}
          fill="none"
        />
        <SvgArrows
          points={arrowPoints}
          arrow={el.style.arrow}
          arrowTip={el.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(vp)}
          opacity={el.style.opacity * el.style.strokeOpacity}
        />
      </g>
    );
  }

  if (el.kind === 'circle') {
    const center = sceneToScreen(el.center, vp);
    return <circle {...common} cx={center.x} cy={center.y} r={el.radius * vp.scale} />;
  }


  if (el.kind === 'ellipse') {
    const center = sceneToScreen(el.center, vp);
    return (
      <ellipse
        {...common}
        cx={center.x}
        cy={center.y}
        rx={el.xRadius * vp.scale}
        ry={el.yRadius * vp.scale}
        transform={el.rotationDegrees === 0
          ? undefined
          : `rotate(${-el.rotationDegrees} ${center.x} ${center.y})`}
      />
    );
  }
  if (el.kind === 'label') {
    const at = sceneToScreen(el.at, vp);
    const offset = labelOffset(el.anchor, tikzPresentationScale(vp));
    return (
      <text
        {...semanticProps(el, selected, hovered, sourceRange)}
        x={at.x + offset.x}
        y={at.y + offset.y}
        fill={el.style.stroke}
        fillOpacity={el.style.textOpacity}
        opacity={el.style.opacity}
        style={{ font: presentationFont(theme.labelFont, vp) }}
        textAnchor={offset.x < 0 ? 'end' : offset.x > 0 ? 'start' : 'middle'}
      >
        {el.text.replace(/\$/g, '')}
      </text>
    );
  }

  if (el.kind === 'graph-node') {
    const center = sceneToScreen(el.center, vp);
    return (
      <g {...semanticProps(el, selected, hovered, sourceRange)}>
        {el.outlined
          ? (
            <circle
              cx={center.x}
              cy={center.y}
              r={el.radius * vp.scale}
              stroke={el.style.stroke}
              strokeWidth={presentationStrokeWidth(el.style.strokeWidth, vp)}
              fill={el.style.fill ?? 'white'}
              fillOpacity={el.style.fillOpacity}
              vectorEffect="non-scaling-stroke"
            />
          )
          : null}
        <text
          x={center.x}
          y={center.y}
          fill={el.style.stroke}
          style={{ font: presentationFont(theme.labelFont, vp) }}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {el.text.replace(/\$/g, '')}
        </text>
      </g>
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
        className="tz-point-hit-target"
        cx={screen.x}
        cy={screen.y}
        r={theme.handleRadius + 5}
        fill="transparent"
        stroke="none"
        data-tikz-point={point.name}
        data-tikz-free={String(point.free)}
      />
      <circle
        className="tz-point-handle"
        cx={screen.x}
        cy={screen.y}
        r={theme.handleRadius}
        fill={point.free ? theme.handleFill : theme.handleDerivedFill}
        stroke={hovered ? theme.hoverColor : theme.handleFill}
        opacity={selected || hovered ? 1 : 0}
        pointerEvents="none"
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
