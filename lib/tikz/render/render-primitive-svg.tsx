import type { Pt } from '../semantics/calc-eval';
import { clipParametricLineToFrame, type ScreenFrame } from './line-clip';
import { labelOffset } from './label-layout';
import type {
  DecodedRenderPrimitive,
  DecodedRenderPrimitiveSet,
} from './render-primitive-decoder';
import {
  angleMarkPath,
  SvgArrows,
} from './svg-decoration-primitives';
import { defaultTheme, type RenderTheme } from './svg-renderer';
import { sceneToScreen, type Viewport } from './viewport';

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
  theme: RenderTheme,
  selected: boolean,
  hovered: boolean,
): string {
  if (selected) return theme.selectionColor;
  if (hovered) return theme.hoverColor;
  return primitive.style.stroke;
}

function strokeWidthOf(
  primitive: DecodedRenderPrimitive,
  selected: boolean,
  hovered: boolean,
): number {
  if (selected) return primitive.style.strokeWidth * 1.8;
  if (hovered) return primitive.style.strokeWidth * 1.45;
  return primitive.style.strokeWidth;
}

function pathPoints(
  primitive: Extract<
    DecodedRenderPrimitive,
    { kind: 'segment' | 'vector' | 'line' | 'ray' }
  >,
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
  primitive: Extract<
    DecodedRenderPrimitive,
    {
      kind:
        | 'segment'
        | 'vector'
        | 'line'
        | 'ray'
        | 'polyline'
        | 'polygon';
    }
  >;
  viewport: Viewport;
  frame: ScreenFrame;
  theme: RenderTheme;
  selected: boolean;
  hovered: boolean;
}) {
  const screenPoints = primitive.kind === 'polyline' || primitive.kind === 'polygon'
    ? primitive.points.map((point) => sceneToScreen(point, viewport))
    : pathPoints(primitive, viewport, frame);
  if (!screenPoints || screenPoints.length < 2) return null;

  const stroke = strokeOf(primitive, theme, selected, hovered);
  const strokeWidth = strokeWidthOf(primitive, selected, hovered);
  const common = {
    ...semanticProps(primitive, selected, hovered),
    stroke,
    strokeWidth,
    strokeDasharray: primitive.style.dash,
    fill: primitive.kind === 'polygon'
      ? primitive.style.fill ?? 'none'
      : 'none',
    fillOpacity: primitive.style.fillOpacity,
    opacity: primitive.style.opacity,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
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
        color={stroke}
        strokeWidth={strokeWidth}
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
  const strokeWidth = strokeWidthOf(primitive, selected, hovered);
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
        strokeDasharray={primitive.style.dash}
        fill={primitive.style.fill ?? 'none'}
        fillOpacity={primitive.style.fillOpacity}
        opacity={primitive.style.opacity}
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  if (primitive.kind === 'label') {
    const at = sceneToScreen(primitive.at, viewport);
    const offset = labelOffset(primitive.anchor ?? '');
    return (
      <text
        {...semanticProps(primitive, selected, hovered)}
        x={at.x + offset.x}
        y={at.y + offset.y}
        fill={stroke}
        opacity={primitive.style.opacity}
        style={{ font: theme.labelFont }}
        textAnchor={offset.x < 0 ? 'end' : offset.x > 0 ? 'start' : 'middle'}
      >
        {primitive.text.replace(/\$/g, '')}
      </text>
    );
  }

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
        radius: theme.angleRadius,
      })}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={primitive.style.dash}
      fill="none"
      opacity={primitive.style.opacity}
      vectorEffect="non-scaling-stroke"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
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
        className="tz-point-handle"
        cx={screen.x}
        cy={screen.y}
        r={theme.handleRadius}
        fill={primitive.free ? theme.handleFill : theme.handleDerivedFill}
        stroke={hovered ? theme.hoverColor : theme.handleFill}
        data-tikz-point={primitive.pointName}
        data-tikz-free={String(primitive.free)}
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
