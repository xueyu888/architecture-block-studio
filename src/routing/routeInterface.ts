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
