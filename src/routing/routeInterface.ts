import { Position } from "@xyflow/react";

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteJump {
  segmentIndex: number;
  point: RoutePoint;
  radius: number;
}

const RENDERED_ENDPOINT_MEASUREMENT_TOLERANCE = 1;
const CONNECTION_PREVIEW_STUB = 14;
const CONNECTION_PREVIEW_CLEARANCE = 6;

export interface ConnectionPreviewBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function endpointStub(point: RoutePoint, position: Position): RoutePoint {
  if (position === Position.Left) return { x: point.x - CONNECTION_PREVIEW_STUB, y: point.y };
  if (position === Position.Right) return { x: point.x + CONNECTION_PREVIEW_STUB, y: point.y };
  if (position === Position.Top) return { x: point.x, y: point.y - CONNECTION_PREVIEW_STUB };
  return { x: point.x, y: point.y + CONNECTION_PREVIEW_STUB };
}

function horizontal(position: Position): boolean {
  return position === Position.Left || position === Position.Right;
}

function expandedPreviewBounds(bounds: ConnectionPreviewBounds): ConnectionPreviewBounds {
  return {
    left: bounds.left - CONNECTION_PREVIEW_CLEARANCE,
    right: bounds.right + CONNECTION_PREVIEW_CLEARANCE,
    top: bounds.top - CONNECTION_PREVIEW_CLEARANCE,
    bottom: bounds.bottom + CONNECTION_PREVIEW_CLEARANCE,
  };
}

function previewSegmentCrossesBounds(
  start: RoutePoint,
  end: RoutePoint,
  bounds: ConnectionPreviewBounds,
): boolean {
  if (start.y === end.y) {
    return start.y > bounds.top && start.y < bounds.bottom &&
      Math.max(start.x, end.x) > bounds.left && Math.min(start.x, end.x) < bounds.right;
  }
  if (start.x === end.x) {
    return start.x > bounds.left && start.x < bounds.right &&
      Math.max(start.y, end.y) > bounds.top && Math.min(start.y, end.y) < bounds.bottom;
  }
  return true;
}

function previewCandidateIsClear(
  points: readonly RoutePoint[],
  bounds: readonly ConnectionPreviewBounds[],
): boolean {
  return points.slice(1).every((point, index) =>
    bounds.every((obstacle) => !previewSegmentCrossesBounds(points[index], point, obstacle))
  );
}

function previewCandidateScore(points: readonly RoutePoint[]): readonly [number, number, string] {
  const length = points.slice(1).reduce((total, point, index) =>
    total + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
  const bends = Math.max(0, compactOrthogonalPoints(points).length - 2);
  const signature = points.map((point) => `${point.x},${point.y}`).join(";");
  return [length, bends, signature];
}

function comparePreviewCandidates(left: readonly RoutePoint[], right: readonly RoutePoint[]): number {
  const leftScore = previewCandidateScore(left);
  const rightScore = previewCandidateScore(right);
  return leftScore[0] - rightScore[0] ||
    leftScore[1] - rightScore[1] ||
    leftScore[2].localeCompare(rightScore[2]);
}

/**
 * Finds the shortest deterministic orthogonal middle that stays outside both
 * terminal cards. Full-scene obstacles deliberately remain the scene router's
 * responsibility; this bounded helper only enforces endpoint-node clearance.
 */
function routePreviewMiddle(
  from: RoutePoint,
  to: RoutePoint,
  terminalBounds: readonly ConnectionPreviewBounds[],
): RoutePoint[] {
  const obstacles = terminalBounds.map(expandedPreviewBounds);
  const xTracks = [
    from.x,
    to.x,
    (from.x + to.x) / 2,
    ...obstacles.flatMap((bounds) => [
      bounds.left - CONNECTION_PREVIEW_STUB,
      bounds.right + CONNECTION_PREVIEW_STUB,
    ]),
  ];
  const yTracks = [
    from.y,
    to.y,
    (from.y + to.y) / 2,
    ...obstacles.flatMap((bounds) => [
      bounds.top - CONNECTION_PREVIEW_STUB,
      bounds.bottom + CONNECTION_PREVIEW_STUB,
    ]),
  ];
  const candidates: RoutePoint[][] = [
    [from, { x: to.x, y: from.y }, to],
    [from, { x: from.x, y: to.y }, to],
    ...xTracks.map((x) => [from, { x, y: from.y }, { x, y: to.y }, to]),
    ...yTracks.map((y) => [from, { x: from.x, y }, { x: to.x, y }, to]),
  ].map(compactOrthogonalPoints);
  const clear = candidates.filter((candidate) => previewCandidateIsClear(candidate, obstacles));
  return (clear.length > 0 ? clear : candidates).sort(comparePreviewCandidates)[0];
}

function stableRenderedEndpoint(planned: RoutePoint, rendered: RoutePoint): RoutePoint {
  return Math.abs(planned.x - rendered.x) < RENDERED_ENDPOINT_MEASUREMENT_TOLERANCE &&
    Math.abs(planned.y - rendered.y) < RENDERED_ENDPOINT_MEASUREMENT_TOLERANCE
    ? { ...planned }
    : { ...rendered };
}

function routeAxis(left: RoutePoint, right: RoutePoint): "h" | "v" {
  return Math.abs(right.x - left.x) >= Math.abs(right.y - left.y) ? "h" : "v";
}

/**
 * Normalizes an already orthogonal polyline without changing its geometry.
 * Reversals are retained because they can be necessary for a locked endpoint
 * approach; their legality is decided by the scene verifier.
 */
export function compactOrthogonalPoints(points: readonly RoutePoint[]): RoutePoint[] {
  const unique = points.filter(
    (point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1];
    const next = unique[index + 1];
    const incomingAxis = routeAxis(previous, point);
    const outgoingAxis = routeAxis(point, next);
    if (incomingAxis !== outgoingAxis) return true;
    const incomingDirection = incomingAxis === "h"
      ? Math.sign(point.x - previous.x)
      : Math.sign(point.y - previous.y);
    const outgoingDirection = outgoingAxis === "h"
      ? Math.sign(next.x - point.x)
      : Math.sign(next.y - point.y);
    return incomingDirection !== outgoingDirection;
  });
}

export function drawOrthogonalRoute(points: readonly RoutePoint[], jumps: readonly RouteJump[] = []): string {
  const compact = compactOrthogonalPoints(points);
  if (compact.length === 0) return "";
  const commands = [`M ${compact[0].x}, ${compact[0].y}`];
  compact.slice(1).forEach((point, segmentIndex) => {
    const previous = compact[segmentIndex];
    const axis = previous.y === point.y ? "h" : "v";
    const direction = axis === "h" ? Math.sign(point.x - previous.x) : Math.sign(point.y - previous.y);
    const segmentJumps = jumps
      .filter((jump) => jump.segmentIndex === segmentIndex)
      .sort((left, right) => direction * (
        axis === "h" ? left.point.x - right.point.x : left.point.y - right.point.y
      ));
    segmentJumps.forEach((jump) => {
      if (axis === "h") {
        commands.push(
          `L ${jump.point.x - direction * jump.radius}, ${jump.point.y}`,
          `Q ${jump.point.x}, ${jump.point.y - jump.radius * 2} ${jump.point.x + direction * jump.radius}, ${jump.point.y}`,
        );
      } else {
        commands.push(
          `L ${jump.point.x}, ${jump.point.y - direction * jump.radius}`,
          `Q ${jump.point.x + jump.radius * 2}, ${jump.point.y} ${jump.point.x}, ${jump.point.y + direction * jump.radius}`,
        );
      }
    });
    commands.push(`L ${point.x}, ${point.y}`);
  });
  return commands.join(" ");
}

export function orthogonalizeRoutePoints(
  points: readonly RoutePoint[],
  sourcePosition: Position,
  targetPosition: Position,
): RoutePoint[] {
  if (points.length < 2) return [...points];
  const orthogonal: RoutePoint[] = [{ ...points[0] }];
  points.slice(1).forEach((point, offset) => {
    const previous = orthogonal.at(-1)!;
    if (previous.x !== point.x && previous.y !== point.y) {
      const pairIndex = offset + 1;
      const isFirstPair = pairIndex === 1;
      const isLastPair = pairIndex === points.length - 1;
      const horizontal = isFirstPair
        ? sourcePosition === "left" || sourcePosition === "right"
        : isLastPair
          ? !(targetPosition === "left" || targetPosition === "right")
          : true;
      orthogonal.push(horizontal
        ? { x: point.x, y: previous.y }
        : { x: previous.x, y: point.y });
    }
    orthogonal.push({ ...point });
  });
  return compactOrthogonalPoints(orthogonal);
}

/**
 * Builds a disposable, port-normal preview while a pointer connection is in
 * progress. Attached targets get an outward stub at both ends; a free pointer
 * only preserves the fixed port normal and never implies a committed route.
 */
export function routeConnectionPreview({
  from,
  to,
  fromPosition,
  toPosition,
  targetAttached,
  fromBounds,
  toBounds,
}: {
  from: RoutePoint;
  to: RoutePoint;
  fromPosition: Position;
  toPosition: Position;
  targetAttached: boolean;
  fromBounds?: ConnectionPreviewBounds;
  toBounds?: ConnectionPreviewBounds;
}): RoutePoint[] {
  const fromStub = endpointStub(from, fromPosition);
  if (!targetAttached) {
    const middle = fromBounds
      ? routePreviewMiddle(fromStub, to, [fromBounds])
      : horizontal(fromPosition)
        ? [fromStub, { x: to.x, y: fromStub.y }, to]
        : [fromStub, { x: fromStub.x, y: to.y }, to];
    return compactOrthogonalPoints([from, ...middle]);
  }

  const toStub = endpointStub(to, toPosition);
  if (fromBounds && toBounds) {
    return compactOrthogonalPoints([
      from,
      ...routePreviewMiddle(fromStub, toStub, [fromBounds, toBounds]),
      to,
    ]);
  }
  const middle = horizontal(fromPosition) === horizontal(toPosition)
    ? horizontal(fromPosition)
      ? [
          { x: (fromStub.x + toStub.x) / 2, y: fromStub.y },
          { x: (fromStub.x + toStub.x) / 2, y: toStub.y },
        ]
      : [
          { x: fromStub.x, y: (fromStub.y + toStub.y) / 2 },
          { x: toStub.x, y: (fromStub.y + toStub.y) / 2 },
        ]
    : horizontal(fromPosition)
      ? [{ x: toStub.x, y: fromStub.y }]
      : [{ x: fromStub.x, y: toStub.y }];
  return compactOrthogonalPoints([from, fromStub, ...middle, toStub, to]);
}

/**
 * Adapts a committed scene route to React Flow's current rendered endpoints.
 * The adjacent endpoint legs move with their Ports, so measurement rounding or
 * a live node gesture cannot create diagonal or sub-pixel correction bends.
 */
export function adaptRouteEndpoints(
  points: readonly RoutePoint[],
  source: RoutePoint,
  target: RoutePoint,
  sourcePosition: Position,
  targetPosition: Position,
): RoutePoint[] {
  if (points.length < 2) return [...points];
  const next = points.map((point) => ({ ...point }));
  const renderedSource = stableRenderedEndpoint(points[0], source);
  const renderedTarget = stableRenderedEndpoint(points[points.length - 1], target);
  next[0] = renderedSource;
  next[next.length - 1] = renderedTarget;
  if (next.length > 2) {
    if (sourcePosition === Position.Left || sourcePosition === Position.Right) next[1].y = renderedSource.y;
    else next[1].x = renderedSource.x;
    if (targetPosition === Position.Left || targetPosition === Position.Right) next[next.length - 2].y = renderedTarget.y;
    else next[next.length - 2].x = renderedTarget.x;
  }
  return orthogonalizeRoutePoints(next, sourcePosition, targetPosition);
}

/** Rehydrates the sole persisted routing input: user-authored local waypoints. */
export function restoreManualRoute({
  source,
  target,
  waypoints,
  origin,
  sourcePosition,
  targetPosition,
}: {
  source: RoutePoint;
  target: RoutePoint;
  waypoints: readonly RoutePoint[];
  origin: RoutePoint;
  sourcePosition: Position;
  targetPosition: Position;
}): RoutePoint[] {
  const absolute = waypoints.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y }));
  if (absolute.length > 0) {
    if (sourcePosition === "left" || sourcePosition === "right") absolute[0].y = source.y;
    else absolute[0].x = source.x;
    const last = absolute.at(-1)!;
    if (targetPosition === "left" || targetPosition === "right") last.y = target.y;
    else last.x = target.x;
  }
  return orthogonalizeRoutePoints(
    [source, ...absolute, target],
    sourcePosition,
    targetPosition,
  );
}
