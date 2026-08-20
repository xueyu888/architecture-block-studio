import { compactOrthogonalPoints, type RoutePoint } from "./routeInterface";
import type {
  RoutingDirection,
  RoutingObjective,
  RoutingRect,
} from "./routingScene";

export interface RouteSegment {
  a: RoutePoint;
  b: RoutePoint;
  axis: "h" | "v";
}

export function directionVector(direction: RoutingDirection): RoutePoint {
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

export function oppositeDirection(direction: RoutingDirection): RoutingDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

export function pointKey(point: RoutePoint): string {
  return `${point.x},${point.y}`;
}

export function samePoint(left: RoutePoint, right: RoutePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

export function routeSegments(points: readonly RoutePoint[]): RouteSegment[] {
  return points.slice(1).flatMap<RouteSegment>((point, index) => {
    const previous = points[index];
    if (samePoint(previous, point)) return [];
    if (previous.y === point.y) return [{ a: previous, b: point, axis: "h" as const }];
    if (previous.x === point.x) return [{ a: previous, b: point, axis: "v" as const }];
    return [];
  });
}

export function routeLength(points: readonly RoutePoint[]): number {
  return points.slice(1).reduce(
    (length, point, index) => length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y),
    0,
  );
}

export function routeBends(points: readonly RoutePoint[]): number {
  const segments = routeSegments(points);
  return Math.max(0, segments.slice(1).reduce((bends, segment, index) =>
    bends + (segment.axis === segments[index].axis ? 0 : 1), 0));
}

export function routeBounds(points: readonly RoutePoint[]): RoutingRect {
  return points.reduce<RoutingRect>((bounds, point) => ({
    left: Math.min(bounds.left, point.x),
    right: Math.max(bounds.right, point.x),
    top: Math.min(bounds.top, point.y),
    bottom: Math.max(bounds.bottom, point.y),
  }), {
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  });
}

export function boundsMayInteract(left: RoutingRect, right: RoutingRect, padding = 0): boolean {
  return left.right + padding >= right.left && right.right + padding >= left.left &&
    left.bottom + padding >= right.top && right.bottom + padding >= left.top;
}

export function shortSegmentCount(points: readonly RoutePoint[], minimumLength: number): number {
  return routeSegments(points).filter((segment) =>
    Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y) < minimumLength
  ).length;
}

export function inflateRect(rect: RoutingRect, amount: number): RoutingRect {
  return {
    left: rect.left - amount,
    right: rect.right + amount,
    top: rect.top - amount,
    bottom: rect.bottom + amount,
  };
}

export function rectContainsPointInterior(rect: RoutingRect, point: RoutePoint): boolean {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

export function segmentIntersectsRectInterior(segment: RouteSegment, rect: RoutingRect): boolean {
  if (segment.axis === "h") {
    const min = Math.min(segment.a.x, segment.b.x);
    const max = Math.max(segment.a.x, segment.b.x);
    return segment.a.y > rect.top && segment.a.y < rect.bottom && max > rect.left && min < rect.right;
  }
  const min = Math.min(segment.a.y, segment.b.y);
  const max = Math.max(segment.a.y, segment.b.y);
  return segment.a.x > rect.left && segment.a.x < rect.right && max > rect.top && min < rect.bottom;
}

export function pathIsClear(points: readonly RoutePoint[], obstacles: readonly RoutingRect[]): boolean {
  const segments = routeSegments(points);
  return segments.length === Math.max(0, points.length - 1) &&
    segments.every((segment) => obstacles.every((obstacle) => !segmentIntersectsRectInterior(segment, obstacle)));
}

function orderedRange(left: number, right: number): [number, number] {
  return left <= right ? [left, right] : [right, left];
}

export function segmentOverlapLength(left: RouteSegment, right: RouteSegment): number {
  if (left.axis !== right.axis) return 0;
  if (left.axis === "h") {
    if (left.a.y !== right.a.y) return 0;
    const [leftMin, leftMax] = orderedRange(left.a.x, left.b.x);
    const [rightMin, rightMax] = orderedRange(right.a.x, right.b.x);
    return Math.max(0, Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin));
  }
  if (left.a.x !== right.a.x) return 0;
  const [leftMin, leftMax] = orderedRange(left.a.y, left.b.y);
  const [rightMin, rightMax] = orderedRange(right.a.y, right.b.y);
  return Math.max(0, Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin));
}

export function segmentsViolateParallelSeparation(
  left: RouteSegment,
  right: RouteSegment,
  minimumSeparation: number,
): boolean {
  if (left.axis !== right.axis) return false;
  const perpendicularGap = left.axis === "h"
    ? Math.abs(left.a.y - right.a.y)
    : Math.abs(left.a.x - right.a.x);
  if (perpendicularGap >= minimumSeparation) return false;
  const [leftStart, leftEnd] = left.axis === "h"
    ? orderedRange(left.a.x, left.b.x)
    : orderedRange(left.a.y, left.b.y);
  const [rightStart, rightEnd] = right.axis === "h"
    ? orderedRange(right.a.x, right.b.x)
    : orderedRange(right.a.y, right.b.y);
  return Math.min(leftEnd, rightEnd) > Math.max(leftStart, rightStart);
}

export function segmentsCross(left: RouteSegment, right: RouteSegment): boolean {
  if (left.axis === right.axis) return false;
  const horizontal = left.axis === "h" ? left : right;
  const vertical = left.axis === "v" ? left : right;
  const [minX, maxX] = orderedRange(horizontal.a.x, horizontal.b.x);
  const [minY, maxY] = orderedRange(vertical.a.y, vertical.b.y);
  return vertical.a.x > minX && vertical.a.x < maxX && horizontal.a.y > minY && horizontal.a.y < maxY;
}

export function routeHasSelfIntersection(points: readonly RoutePoint[]): boolean {
  const segments = routeSegments(points);
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 2; rightIndex < segments.length; rightIndex += 1) {
      if (leftIndex === 0 && rightIndex === segments.length - 1 && samePoint(points[0], points.at(-1)!)) continue;
      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (segmentOverlapLength(left, right) > 0 || segmentsCross(left, right)) return true;
      if ([left.a, left.b].some((point) => samePoint(point, right.a) || samePoint(point, right.b))) return true;
    }
  }
  return false;
}

export function routeHasReversal(points: readonly RoutePoint[]): boolean {
  const segments = routeSegments(points);
  return segments.slice(1).some((segment, index) => {
    const previous = segments[index];
    if (previous.axis !== segment.axis) return false;
    const previousDelta = previous.axis === "h"
      ? previous.b.x - previous.a.x
      : previous.b.y - previous.a.y;
    const currentDelta = segment.axis === "h"
      ? segment.b.x - segment.a.x
      : segment.b.y - segment.a.y;
    return Math.sign(previousDelta) !== Math.sign(currentDelta);
  });
}

export function routeRespectsFacingMonotonicity(
  points: readonly RoutePoint[],
  source: RoutePoint,
  target: RoutePoint,
  sourceOutward: RoutingDirection,
  targetOutward: RoutingDirection,
): boolean {
  const deltas = points.slice(1).map((point, index) => ({
    x: point.x - points[index].x,
    y: point.y - points[index].y,
  }));
  if (sourceOutward === "right" && targetOutward === "left" && source.x <= target.x) {
    return deltas.every((delta) => delta.x >= 0);
  }
  if (sourceOutward === "left" && targetOutward === "right" && source.x >= target.x) {
    return deltas.every((delta) => delta.x <= 0);
  }
  if (sourceOutward === "bottom" && targetOutward === "top" && source.y <= target.y) {
    return deltas.every((delta) => delta.y >= 0);
  }
  if (sourceOutward === "top" && targetOutward === "bottom" && source.y >= target.y) {
    return deltas.every((delta) => delta.y <= 0);
  }
  return true;
}

export function routeSignature(points: readonly RoutePoint[]): string {
  return compactOrthogonalPoints([...points]).map(pointKey).join(";");
}

/** Stable route ordering that is independent of the scene's absolute origin. */
export function relativeRouteSignature(
  points: readonly RoutePoint[],
  origin: RoutePoint = points[0] ?? { x: 0, y: 0 },
): string {
  return routeSignature(points.map((point) => ({
    x: point.x - origin.x,
    y: point.y - origin.y,
  })));
}

export function stableTextHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function compareRoutingObjectives(left: RoutingObjective, right: RoutingObjective): number {
  const numeric: Array<keyof Omit<RoutingObjective, "signature">> = [
    "unrouted",
    "capacityViolations",
    "crossings",
    "maximumDetour",
    "totalDetour",
    "bends",
    "shortSegments",
  ];
  for (const key of numeric) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return left.signature.localeCompare(right.signature);
}

export function endpointSideIsRespected(
  endpoint: RoutePoint,
  neighbor: RoutePoint,
  outward: RoutingDirection,
): boolean {
  if (outward === "left") return neighbor.y === endpoint.y && neighbor.x < endpoint.x;
  if (outward === "right") return neighbor.y === endpoint.y && neighbor.x > endpoint.x;
  if (outward === "top") return neighbor.x === endpoint.x && neighbor.y < endpoint.y;
  return neighbor.x === endpoint.x && neighbor.y > endpoint.y;
}
