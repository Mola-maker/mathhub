import type { Pt } from '../semantics/calc-eval';
import { flattenCircularArc } from '../geometry/circular-arc';
import {
  ellipticalArcSvgUnitPath,
  flattenEllipticalArc,
} from '../geometry/elliptical-arc';
import { clipParametricLineToFrame, type ScreenFrame } from './line-clip';
import { labelOffset } from './label-layout';
import type {
  DecodedRenderPrimitive,
  DecodedRenderPrimitiveOf,
  DecodedRenderPrimitiveSet,
} from './render-primitive-decoder';
import {
  angleMarkPath,
  SvgArrows,
} from './svg-decoration-primitives';
import { defaultTheme, type RenderTheme } from './svg-renderer';
import {
  presentationDashArray,
  presentationDashOffset,
  presentationFont,
  presentationStrokeWidth,
} from './presentation-scale';
import { sceneToScreen, tikzPresentationScale, type Viewport } from './viewport';

function primitiveSelected(
  primitive: DecodedRenderPrimitive,
  selectedPrimitiveIds: ReadonlySet<string>,
  selectedEntityIds: ReadonlySet<string>,
  selectedRefs: ReadonlySet<string>,
  selectedStmtIndex: number | null,
): boolean {
  if (selectedPrimitiveIds.size > 0 || selectedEntityIds.size > 0) {
    return (
      selectedPrimitiveIds.has(primitive.primitiveId)
      || primitive.entityIds.some((entityId) => selectedEntityIds.has(entityId))
    );
  }
  if (
    selectedStmtIndex !== null
    && primitive.statementIndex === selectedStmtIndex
  ) return true;
  if (selectedStmtIndex !== null) return false;
  if (
    primitive.kind === 'point'
    && primitive.pointName
    && selectedRefs.has(primitive.pointName)
  ) return true;
  return primitive.references.some((reference) => selectedRefs.has(reference));
}

function semanticProps(
  primitive: DecodedRenderPrimitive,
  selected: boolean,
  hovered: boolean,
) {
  const entityId = primitive.entityIds[0] ?? primitive.primitiveId;
  return {
    'data-tikz-id': entityId,
    'data-tikz-primitive': primitive.primitiveId,
    'data-tikz-source-binding': primitive.sourceBindingIds[0],
    'data-tikz-stmt': primitive.statementIndex ?? undefined,
    'data-tikz-kind': primitive.kind,
    'data-tikz-refs': primitive.references.join(' '),
    'data-tikz-source-start': primitive.sourceRange?.start,
    'data-tikz-source-end': primitive.sourceRange?.end,
    'data-selected': selected ? 'true' : undefined,
    'data-hovered': hovered ? 'true' : undefined,
  };
}

function strokeOf(
  primitive: DecodedRenderPrimitive,
  _theme: RenderTheme,
  _selected: boolean,
  _hovered: boolean,
): string {
  // Selection and hover are editor overlays. Mutating the document stroke
  // here makes the interactive surface diverge from exact TeX output and
  // contaminates VLM parity captures.
  return primitive.style.stroke;
}

function strokeWidthOf(
  primitive: DecodedRenderPrimitive,
  viewport: Viewport,
  _selected: boolean,
  _hovered: boolean,
): number {
  return presentationStrokeWidth(primitive.style.strokeWidth, viewport);
}

function pathPoints(
  primitive: DecodedRenderPrimitiveOf<'segment' | 'vector' | 'line' | 'ray'>,
  viewport: Viewport,
  frame: ScreenFrame,
): readonly [Pt, Pt] | null {
  const first = sceneToScreen(primitive.points[0], viewport);
  const second = sceneToScreen(primitive.points[1], viewport);
  if (primitive.kind === 'line') {
    return clipParametricLineToFrame(first, second, frame, 'line');
  }
  if (primitive.kind === 'ray') {
    // Keep the positive arrow tip on the visible SVG edge. Outward padding is
    // useful for an undecorated infinite line, but would place a ray arrow
    // outside the SVG clipping region.
    return clipParametricLineToFrame(first, second, frame, 'ray', 0);
  }
  return [first, second];
}

function PathPrimitiveSvg({
  primitive,
  viewport,
  frame,
  theme,
  selected,
  hovered,
}: {
  primitive: DecodedRenderPrimitiveOf<
    'segment' | 'vector' | 'line' | 'ray' | 'polyline' | 'polygon'
  >;
  viewport: Viewport;
  frame: ScreenFrame;
  theme: RenderTheme;
  selected: boolean;
  hovered: boolean;
}) {
  // A positive check on the two-point kinds narrows the grouped discriminant;
  // testing for 'polyline'/'polygon' cannot exclude the two-point member.
  const screenPoints = primitive.kind === 'segment'
    || primitive.kind === 'vector'
    || primitive.kind === 'line'
    || primitive.kind === 'ray'
    ? pathPoints(primitive, viewport, frame)
    : primitive.points.map((point) => sceneToScreen(point, viewport));
  if (!screenPoints || screenPoints.length < 2) return null;

  const stroke = strokeOf(primitive, theme, selected, hovered);
  const strokeWidth = strokeWidthOf(primitive, viewport, selected, hovered);
  const common = {
    ...semanticProps(primitive, selected, hovered),
    stroke,
    strokeWidth,
    strokeDasharray: presentationDashArray(primitive.style.dash, viewport),
    strokeDashoffset: presentationDashOffset(primitive.style.dashOffset, viewport),
    fill: primitive.kind === 'polygon'
      ? primitive.style.fill ?? 'none'
      : 'none',
    fillOpacity: primitive.style.fillOpacity,
    strokeOpacity: primitive.style.strokeOpacity,
    opacity: primitive.style.opacity,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinecap: primitive.style.lineCap,
    strokeLinejoin: primitive.style.lineJoin,
    strokeMiterlimit: primitive.style.miterLimit,
  };
  const pointString = screenPoints
    .map((point) => `${point.x},${point.y}`)
    .join(' ');

  return (
    <g>
      {primitive.kind === 'polygon'
        ? <polygon {...common} points={pointString} />
        : <polyline {...common} points={pointString} />}
      <SvgArrows
        points={screenPoints}
        arrow={primitive.style.arrow}
        arrowTip={primitive.style.arrowTip}
        color={stroke}
        strokeWidth={strokeWidth}
        presentationScale={tikzPresentationScale(viewport)}
        opacity={primitive.style.opacity * primitive.style.strokeOpacity}
      />
    </g>
  );
}

function ElementPrimitiveSvg({
  primitive,
  viewport,
  frame,
  theme,
  selected,
  hovered,
}: {
  primitive: Exclude<DecodedRenderPrimitive, { kind: 'point' }>;
  viewport: Viewport;
  frame: ScreenFrame;
  theme: RenderTheme;
  selected: boolean;
  hovered: boolean;
}) {
  if (
    primitive.kind === 'segment'
    || primitive.kind === 'vector'
    || primitive.kind === 'line'
    || primitive.kind === 'ray'
    || primitive.kind === 'polyline'
    || primitive.kind === 'polygon'
  ) {
    return (
      <PathPrimitiveSvg
        primitive={primitive}
        viewport={viewport}
        frame={frame}
        theme={theme}
        selected={selected}
        hovered={hovered}
      />
    );
  }

  const stroke = strokeOf(primitive, theme, selected, hovered);
  const strokeWidth = strokeWidthOf(primitive, viewport, selected, hovered);
  if (primitive.kind === 'cubic-bezier') {
    const start = sceneToScreen(primitive.start, viewport);
    const control1 = sceneToScreen(primitive.control1, viewport);
    const control2 = sceneToScreen(primitive.control2, viewport);
    const end = sceneToScreen(primitive.end, viewport);
    return (
      <g>
        <path
          {...semanticProps(primitive, selected, hovered)}
          d={`M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
          strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)}
          fill="none"
          strokeOpacity={primitive.style.strokeOpacity}
          opacity={primitive.style.opacity}
          vectorEffect="non-scaling-stroke"
          strokeLinecap={primitive.style.lineCap}
          strokeLinejoin={primitive.style.lineJoin}
          strokeMiterlimit={primitive.style.miterLimit}
        />
        <SvgArrows
          points={[start, control1, control2, end]}
          arrow={primitive.style.arrow}
          arrowTip={primitive.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(viewport)}
          opacity={primitive.style.opacity * primitive.style.strokeOpacity}
        />
      </g>
    );
  }
  if (primitive.kind === 'circular-arc') {
    const start = sceneToScreen(primitive.start, viewport);
    const end = sceneToScreen(primitive.end, viewport);
    const delta = primitive.endAngleDeg - primitive.startAngleDeg;
    const arrowPoints = flattenCircularArc(primitive, 6)
      .map((point) => sceneToScreen(point, viewport));
    const largeArc = Math.abs(delta) > 180 ? 1 : 0;
    const sweep = delta < 0 ? 1 : 0;
    return (
      <g>
        <path
          {...semanticProps(primitive, selected, hovered)}
          d={`M ${start.x} ${start.y} A ${primitive.radius * viewport.scale} ${primitive.radius * viewport.scale} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`}
          stroke={stroke} strokeWidth={strokeWidth}
          strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
          strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)} fill="none"
          strokeOpacity={primitive.style.strokeOpacity}
          opacity={primitive.style.opacity} vectorEffect="non-scaling-stroke"
          strokeLinecap={primitive.style.lineCap} strokeLinejoin={primitive.style.lineJoin}
          strokeMiterlimit={primitive.style.miterLimit}
        />
        <SvgArrows
          points={arrowPoints}
          arrow={primitive.style.arrow}
          arrowTip={primitive.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(viewport)}
          opacity={primitive.style.opacity * primitive.style.strokeOpacity}
        />
      </g>
    );
  }
  if (primitive.kind === 'elliptical-arc') {
    const center = sceneToScreen(primitive.center, viewport);
    const arrowPoints = flattenEllipticalArc(primitive, 6)
      .map((point) => sceneToScreen(point, viewport));
    const transform = [
      primitive.axisX.x * viewport.scale,
      -primitive.axisX.y * viewport.scale,
      primitive.axisY.x * viewport.scale,
      -primitive.axisY.y * viewport.scale,
      center.x,
      center.y,
    ].join(' ');
    return (
      <g>
        <path
          {...semanticProps(primitive, selected, hovered)}
          d={ellipticalArcSvgUnitPath(primitive)}
          transform={`matrix(${transform})`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
          strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)}
          fill="none"
          strokeOpacity={primitive.style.strokeOpacity}
          opacity={primitive.style.opacity}
          vectorEffect="non-scaling-stroke"
          strokeLinecap={primitive.style.lineCap}
          strokeLinejoin={primitive.style.lineJoin}
          strokeMiterlimit={primitive.style.miterLimit}
        />
        <SvgArrows
          points={arrowPoints}
          arrow={primitive.style.arrow}
          arrowTip={primitive.style.arrowTip}
          color={stroke}
          strokeWidth={strokeWidth}
          presentationScale={tikzPresentationScale(viewport)}
          opacity={primitive.style.opacity * primitive.style.strokeOpacity}
        />
      </g>
    );
  }
  if (primitive.kind === 'circle') {
    const center = sceneToScreen(primitive.center, viewport);
    return (
      <circle
        {...semanticProps(primitive, selected, hovered)}
        cx={center.x}
        cy={center.y}
        r={primitive.radius * viewport.scale}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
        strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)}
        fill={primitive.style.fill ?? 'none'}
        fillOpacity={primitive.style.fillOpacity}
        strokeOpacity={primitive.style.strokeOpacity}
        opacity={primitive.style.opacity}
        vectorEffect="non-scaling-stroke"
        strokeLinecap={primitive.style.lineCap}
        strokeLinejoin={primitive.style.lineJoin}
        strokeMiterlimit={primitive.style.miterLimit}
      />
    );
  }
  if (primitive.kind === 'graph-node') {
    const center = sceneToScreen(primitive.center, viewport);
    const radius = primitive.radius * viewport.scale;
    return (
      <g {...semanticProps(primitive, selected, hovered)}>
        {primitive.outlined
          ? (
            <circle
              cx={center.x}
              cy={center.y}
              r={radius}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
              strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)}
              fill={primitive.style.fill ?? 'white'}
              fillOpacity={primitive.style.fillOpacity}
              strokeOpacity={primitive.style.strokeOpacity}
              opacity={primitive.style.opacity}
              vectorEffect="non-scaling-stroke"
            />
          )
          : null}
        <text
          x={center.x}
          y={center.y}
          fill={stroke}
          fillOpacity={primitive.style.textOpacity}
          opacity={primitive.style.opacity}
          style={{ font: presentationFont(theme.labelFont, viewport) }}
          textAnchor="middle"
          dominantBaseline="central"
          pointerEvents="none"
        >
          {primitive.text.replace(/\$/g, '')}
        </text>
      </g>
    );
  }
  if (primitive.kind === 'ellipse') {
    const center = sceneToScreen(primitive.center, viewport);
    return (
      <ellipse
        {...semanticProps(primitive, selected, hovered)}
        cx={center.x}
        cy={center.y}
        rx={primitive.xRadius * viewport.scale}
        ry={primitive.yRadius * viewport.scale}
        transform={primitive.rotationDegrees === 0
          ? undefined
          : `rotate(${-primitive.rotationDegrees} ${center.x} ${center.y})`}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
        strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)}
        fill={primitive.style.fill ?? 'none'}
        fillOpacity={primitive.style.fillOpacity}
        strokeOpacity={primitive.style.strokeOpacity}
        opacity={primitive.style.opacity}
        vectorEffect="non-scaling-stroke"
        strokeLinecap={primitive.style.lineCap}
        strokeLinejoin={primitive.style.lineJoin}
        strokeMiterlimit={primitive.style.miterLimit}
      />
    );
  }
  if (primitive.kind === 'label') {
    const at = sceneToScreen(primitive.at, viewport);
    const offset = labelOffset(
      primitive.anchor ?? '',
      tikzPresentationScale(viewport),
    );
    return (
      <text
        {...semanticProps(primitive, selected, hovered)}
        x={at.x + offset.x}
        y={at.y + offset.y}
        fill={stroke}
        fillOpacity={primitive.style.textOpacity}
        opacity={primitive.style.opacity}
        style={{ font: presentationFont(theme.labelFont, viewport) }}
        textAnchor={offset.x < 0 ? 'end' : offset.x > 0 ? 'start' : 'middle'}
      >
        {primitive.text.replace(/\$/g, '')}
      </text>
    );
  }

  if (primitive.kind === 'angle' || primitive.kind === 'right-angle') {
    const vertex = sceneToScreen(primitive.vertex, viewport);
    const from = sceneToScreen(primitive.from, viewport);
    const to = sceneToScreen(primitive.to, viewport);
    return (
      <path
        {...semanticProps(primitive, selected, hovered)}
        d={angleMarkPath({
          vertex,
          from,
          to,
          right: primitive.kind === 'right-angle',
          radius: presentationStrokeWidth(theme.angleRadius, viewport),
        })}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={presentationDashArray(primitive.style.dash, viewport)}
        strokeDashoffset={presentationDashOffset(primitive.style.dashOffset, viewport)}
        fill="none"
        strokeOpacity={primitive.style.strokeOpacity}
        opacity={primitive.style.opacity}
        vectorEffect="non-scaling-stroke"
        strokeLinecap={primitive.style.lineCap}
        strokeLinejoin={primitive.style.lineJoin}
        strokeMiterlimit={primitive.style.miterLimit}
      />
    );
  }

  return null;
}

function PointPrimitiveSvg({
  primitive,
  viewport,
  theme,
  selected,
  hovered,
}: {
  primitive: Extract<DecodedRenderPrimitive, { kind: 'point' }>;
  viewport: Viewport;
  theme: RenderTheme;
  selected: boolean;
  hovered: boolean;
}) {
  const screen = sceneToScreen(primitive.position, viewport);
  return (
    <g
      {...semanticProps(primitive, selected, hovered)}
      data-tikz-handle={primitive.pointName}
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
        data-tikz-point={primitive.pointName}
        data-tikz-free={String(primitive.free)}
      />
      <circle
        className="tz-point-handle"
        cx={screen.x}
        cy={screen.y}
        r={theme.handleRadius}
        fill={primitive.free ? theme.handleFill : theme.handleDerivedFill}
        stroke={hovered ? theme.hoverColor : theme.handleFill}
        opacity={selected || hovered ? 1 : 0}
        pointerEvents="none"
      />
    </g>
  );
}

export function TikzRenderPrimitiveSvg({
  rendering,
  viewport,
  frame,
  theme = defaultTheme,
  selection = [],
  selectedRenderPrimitiveIds = [],
  selectedSemanticEntityIds = [],
  selectedStmtIndex = null,
  hoveredStmtIndex = null,
}: {
  rendering: DecodedRenderPrimitiveSet;
  viewport: Viewport;
  frame: ScreenFrame;
  theme?: RenderTheme;
  selection?: readonly string[];
  selectedRenderPrimitiveIds?: readonly string[];
  selectedSemanticEntityIds?: readonly string[];
  selectedStmtIndex?: number | null;
  hoveredStmtIndex?: number | null;
}) {
  const selectedRefs = new Set(selection);
  const selectedPrimitiveIds = new Set(selectedRenderPrimitiveIds);
  const selectedEntityIds = new Set(selectedSemanticEntityIds);
  const elements = rendering.primitives.filter(
    (primitive): primitive is Exclude<DecodedRenderPrimitive, { kind: 'point' }> => (
      primitive.kind !== 'point'
    ),
  );
  const points = rendering.primitives.filter(
    (primitive): primitive is Extract<DecodedRenderPrimitive, { kind: 'point' }> => (
      primitive.kind === 'point'
    ),
  );

  return (
    <>
      <g
        data-layer="render-diagnostics"
        data-tikz-render-decode-issues={rendering.issues.length}
        aria-hidden="true"
      />
      <g data-layer="base" data-render-source="geometry-truth">
        {elements.map((primitive) => {
          const selected = primitiveSelected(
            primitive,
            selectedPrimitiveIds,
            selectedEntityIds,
            selectedRefs,
            selectedStmtIndex,
          );
          return (
            <ElementPrimitiveSvg
              key={primitive.primitiveId}
              primitive={primitive}
              viewport={viewport}
              frame={frame}
              theme={theme}
              selected={selected}
              hovered={hoveredStmtIndex === primitive.statementIndex}
            />
          );
        })}
      </g>
      <g data-layer="overlay" data-render-source="geometry-truth">
        {points.map((primitive) => {
          const selected = primitiveSelected(
            primitive,
            selectedPrimitiveIds,
            selectedEntityIds,
            selectedRefs,
            selectedStmtIndex,
          );
          return (
            <PointPrimitiveSvg
              key={primitive.primitiveId}
              primitive={primitive}
              viewport={viewport}
              theme={theme}
              selected={selected}
              hovered={hoveredStmtIndex === primitive.statementIndex}
            />
          );
        })}
      </g>
    </>
  );
}
