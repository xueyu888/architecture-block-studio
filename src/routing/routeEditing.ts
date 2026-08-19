import type { Position } from "@xyflow/react";
import {
  compactOrthogonalPoints,
  orthogonalizeRoutePoints,
  type RoutePoint,
} from "./routeInterface";

export interface EditableRouteSegment {
  index: number;
  axis: "h" | "v";
  midpoint: RoutePoint;
  length: number;
}

export interface EditableRouteBend {
  index: number;
  point: RoutePoint;
}

const MIN_EDITABLE_SEGMENT_LENGTH = 20;

export function routeAxis(left: RoutePoint, right: RoutePoint): "h" | "v" {
  return Math.abs(right.x - left.x) >= Math.abs(right.y - left.y) ? "h" : "v";
}

function segmentLength(left: RoutePoint, right: RoutePoint): number {
  return Math.abs(right.x - left.x) + Math.abs(right.y - left.y);
}

function scaffoldShortestRoute(points: RoutePoint[]): RoutePoint[] {
  if (points.length < 2) return points;
  let longestIndex = 0;
  let longestLength = -1;
  points.slice(0, -1).forEach((point, index) => {
    const length = segmentLength(point, points[index + 1]);
    if (length > longestLength) {
      longestLength = length;
      longestIndex = index;
    }
  });
  const start = points[longestIndex];
  const end = points[longestIndex + 1];
  const first = { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 };
  const second = { x: start.x + (end.x - start.x) * 2 / 3, y: start.y + (end.y - start.y) * 2 / 3 };
  return [
    ...points.slice(0, longestIndex + 1),
    first,
    { ...first },
    { ...second },
    second,
    ...points.slice(longestIndex + 1),
  ];
}

function editableSegments(points: RoutePoint[]): EditableRouteSegment[] {
  return points.slice(0, -1).flatMap<EditableRouteSegment>((point, index) => {
    if (index === 0 || index === points.length - 2) return [];
    const next = points[index + 1];
    const length = segmentLength(point, next);
    return length < MIN_EDITABLE_SEGMENT_LENGTH
      ? []
      : [{
          index,
          axis: routeAxis(point, next),
          midpoint: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
          length,
        }];
  });
}

export function editableOrthogonalRoute(points: RoutePoint[]): {
  points: RoutePoint[];
  segments: EditableRouteSegment[];
} {
  let editablePoints = compactOrthogonalPoints(points);
  let segments = editableSegments(editablePoints);
  if (segments.length > 0) return { points: editablePoints, segments };
  editablePoints = scaffoldShortestRoute(editablePoints);
  segments = editableSegments(editablePoints);
  return { points: editablePoints, segments };
}

export function editableRouteBends(points: RoutePoint[]): EditableRouteBend[] {
  const compact = compactOrthogonalPoints(points);
  return compact.slice(1, -1).map((point, offset) => ({
    index: offset + 1,
    point: { ...point },
  }));
}

export function moveRouteSegment(
  points: RoutePoint[],
  segment: Pick<EditableRouteSegment, "index" | "axis">,
  coordinate: number,
): RoutePoint[] {
  const next = points.map((point) => ({ ...point }));
  if (segment.axis === "h") {
    next[segment.index].y = coordinate;
    next[segment.index + 1].y = coordinate;
  } else {
    next[segment.index].x = coordinate;
    next[segment.index + 1].x = coordinate;
  }
  return next;
}

export function moveRouteBend(
  points: RoutePoint[],
  bendIndex: number,
  position: RoutePoint,
): RoutePoint[] {
  if (bendIndex <= 0 || bendIndex >= points.length - 1) return points;
  const incomingAxis = routeAxis(points[bendIndex - 1], points[bendIndex]);
  const outgoingAxis = routeAxis(points[bendIndex], points[bendIndex + 1]);
  let next = points.map((point) => ({ ...point }));

  // Endpoint coordinates remain owned by their Ports. A bend beside an
  // endpoint can slide along the endpoint segment, but cannot pull the Port.
  if (bendIndex - 1 > 0) {
    next = moveRouteSegment(next, { index: bendIndex - 1, axis: incomingAxis },
      incomingAxis === "h" ? position.y : position.x);
  }
  if (bendIndex < points.length - 2) {
    next = moveRouteSegment(next, { index: bendIndex, axis: outgoingAxis },
      outgoingAxis === "h" ? position.y : position.x);
  }
  return next;
}

export function removeRouteBend(
  points: RoutePoint[],
  bendIndex: number,
  sourcePosition: Position,
  targetPosition: Position,
): RoutePoint[] | undefined {
  const compact = compactOrthogonalPoints(points);
  if (bendIndex <= 0 || bendIndex >= compact.length - 1 || compact.length <= 3) return undefined;
  const pairCandidates: Array<[number, number]> = [];
  if (bendIndex > 1) pairCandidates.push([bendIndex - 1, bendIndex]);
  if (bendIndex < compact.length - 2) pairCandidates.push([bendIndex, bendIndex + 1]);
  if (pairCandidates.length === 0) return undefined;
  const [first, second] = pairCandidates.reduce((best, candidate) =>
    segmentLength(compact[candidate[0]], compact[candidate[1]]) <
      segmentLength(compact[best[0]], compact[best[1]])
      ? candidate
      : best,
  );
  const reduced = compact.filter((_, index) => index !== first && index !== second);
  return orthogonalizeRoutePoints(reduced, sourcePosition, targetPosition);
}
