import {
  getSmartEdge,
  pathfindingJumpPointNoDiagonal,
  svgDrawStraightLinePath,
} from "@tisoap/react-flow-smart-edge";
import { Position, type InternalNode, type Node } from "@xyflow/react";

export interface RoutePoint {
  x: number;
  y: number;
}

export interface SeparatedRoute {
  path: string;
}

const ROUTE_LANES = [-12, -8, -4, 0, 4, 8, 12] as const;

export interface RouteLaneRequest {
  connectionId: string;
  sourceEndpointKey: string;
  targetEndpointKey: string;
  channelKey: string;
}

function routeLaneIndex(connectionId: string): number {
  let hash = 5381;
  for (const character of connectionId) {
    hash = Math.imul(hash, 33) ^ (character.codePointAt(0) ?? 0);
  }
  return (hash >>> 0) % ROUTE_LANES.length;
}

export function routeLaneOffset(connectionId: string): number {
  return ROUTE_LANES[routeLaneIndex(connectionId)];
}

export function planRouteLaneOffsets(requests: RouteLaneRequest[]): ReadonlyMap<string, number> {
  const neighbors = new Map<string, Set<string>>();
  const groups = new Map<string, Set<string>>();
  requests.forEach((request) => {
    neighbors.set(request.connectionId, neighbors.get(request.connectionId) ?? new Set());
    [
      `endpoint:${request.sourceEndpointKey}`,
      `endpoint:${request.targetEndpointKey}`,
      `channel:${request.channelKey}`,
    ].forEach((groupKey) => {
      const group = groups.get(groupKey) ?? new Set<string>();
      group.add(request.connectionId);
      groups.set(groupKey, group);
    });
  });
  groups.forEach((group) => {
    const connections = [...group];
    connections.forEach((connectionId, index) => {
      connections.slice(index + 1).forEach((peerId) => {
        if (connectionId === peerId) return;
        neighbors.get(connectionId)?.add(peerId);
        neighbors.get(peerId)?.add(connectionId);
      });
    });
  });

  const assignments = new Map<string, number>();
  [...neighbors]
    .sort(([leftId, leftPeers], [rightId, rightPeers]) =>
      rightPeers.size - leftPeers.size || leftId.localeCompare(rightId),
    )
    .forEach(([connectionId, peers]) => {
      const occupied = new Set(
        [...peers].flatMap((peerId) => {
          const lane = assignments.get(peerId);
          return lane === undefined ? [] : [lane];
        }),
      );
      const start = routeLaneIndex(connectionId);
      const candidates = ROUTE_LANES.map((_, offset) => ROUTE_LANES[(start + offset) % ROUTE_LANES.length]);
      assignments.set(
        connectionId,
        candidates.find((lane) => !occupied.has(lane)) ?? routeLaneOffset(connectionId),
      );
    });
  return assignments;
}

function routeAxis(left: RoutePoint, right: RoutePoint): "h" | "v" {
  return Math.abs(right.x - left.x) >= Math.abs(right.y - left.y) ? "h" : "v";
}

export function compactOrthogonalPoints(points: RoutePoint[]): RoutePoint[] {
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

export function orthogonalRoutePoints(svgPath: string): RoutePoint[] {
  return compactOrthogonalPoints(
    [...svgPath.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),?\s*(-?\d+(?:\.\d+)?)/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]) })),
  );
}

export function drawOrthogonalRoute(points: RoutePoint[]): string {
  return compactOrthogonalPoints(points)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x}, ${point.y}`)
    .join(" ");
}

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
  waypoints: RoutePoint[];
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

export function separateOrthogonalRoute(
  svgPath: string,
  laneOffset: number,
  endpointSeparation: { separateSource?: boolean; separateTarget?: boolean } = {},
): SeparatedRoute {
  const points = orthogonalRoutePoints(svgPath);
  if (points.length < 2) return { path: svgPath };
  if (laneOffset === 0) return { path: drawOrthogonalRoute(points) };
  if (points.length < 3) return { path: svgPath };

  const lastSegmentIndex = points.length - 2;
  const segmentOffset = (segmentIndex: number): number => {
    if (segmentIndex === 0 && !endpointSeparation.separateSource) return 0;
    if (segmentIndex === lastSegmentIndex && !endpointSeparation.separateTarget) return 0;
    return laneOffset;
  };
  const shiftedInternal = points.slice(1, -1).map((point, index) => {
    const previousSegmentIndex = index;
    const nextSegmentIndex = index + 1;
    const previousAxis = routeAxis(points[index], point);
    const nextAxis = routeAxis(point, points[index + 2]);
    const previousOffset = segmentOffset(previousSegmentIndex);
    const nextOffset = segmentOffset(nextSegmentIndex);
    const shifted = { ...point };
    if (previousAxis === "h") shifted.y += previousOffset;
    else shifted.x += previousOffset;
    if (nextAxis === "h") shifted.y += nextOffset;
    else shifted.x += nextOffset;
    return shifted;
  });
  const first = points[0];
  const last = points.at(-1)!;
  const separated = [first, ...shiftedInternal, last];
  if (endpointSeparation.separateSource && laneOffset !== 0) {
    const axis = routeAxis(first, points[1]);
    const length = Math.abs(points[1].x - first.x) + Math.abs(points[1].y - first.y);
    const direction = axis === "h" ? Math.sign(points[1].x - first.x) : Math.sign(points[1].y - first.y);
    const stubLength = Math.min(16, length / 2);
    const stub = axis === "h"
      ? { x: first.x + direction * stubLength, y: first.y }
      : { x: first.x, y: first.y + direction * stubLength };
    const shiftedStub = axis === "h"
      ? { x: stub.x, y: stub.y + laneOffset }
      : { x: stub.x + laneOffset, y: stub.y };
    separated.splice(1, 0, stub, shiftedStub);
  }
  if (endpointSeparation.separateTarget && laneOffset !== 0) {
    const axis = routeAxis(points.at(-2)!, last);
    const length = Math.abs(last.x - points.at(-2)!.x) + Math.abs(last.y - points.at(-2)!.y);
    const direction = axis === "h" ? Math.sign(last.x - points.at(-2)!.x) : Math.sign(last.y - points.at(-2)!.y);
    const stubLength = Math.min(16, length / 2);
    const stub = axis === "h"
      ? { x: last.x - direction * stubLength, y: last.y }
      : { x: last.x, y: last.y - direction * stubLength };
    const shiftedStub = axis === "h"
      ? { x: stub.x, y: stub.y + laneOffset }
      : { x: stub.x + laneOffset, y: stub.y };
    separated.splice(-1, 0, shiftedStub, stub);
  }
  const compact = separated
    .filter((point, index, routePoints) => index === 0 || point.x !== routePoints[index - 1].x || point.y !== routePoints[index - 1].y);
  const sourceAxis = routeAxis(points[0], points[1]);
  const targetAxis = routeAxis(points.at(-2)!, points.at(-1)!);
  const sourcePosition = sourceAxis === "h"
    ? points[1].x >= points[0].x ? Position.Right : Position.Left
    : points[1].y >= points[0].y ? Position.Bottom : Position.Top;
  const targetPosition = targetAxis === "h"
    ? points.at(-2)!.x <= points.at(-1)!.x ? Position.Left : Position.Right
    : points.at(-2)!.y <= points.at(-1)!.y ? Position.Top : Position.Bottom;
  return {
    path: drawOrthogonalRoute(orthogonalizeRoutePoints(compact, sourcePosition, targetPosition)),
  };
}

interface ObstacleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function endpointStub(point: RoutePoint, position: Position, distance = 24): RoutePoint {
  if (position === "left") return { x: point.x - distance, y: point.y };
  if (position === "right") return { x: point.x + distance, y: point.y };
  if (position === "top") return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function endpointSideIsRespected(
  endpoint: RoutePoint,
  neighbor: RoutePoint,
  position: Position,
): boolean {
  if (position === "left") return neighbor.y === endpoint.y && neighbor.x <= endpoint.x;
  if (position === "right") return neighbor.y === endpoint.y && neighbor.x >= endpoint.x;
  if (position === "top") return neighbor.x === endpoint.x && neighbor.y <= endpoint.y;
  return neighbor.x === endpoint.x && neighbor.y >= endpoint.y;
}

function routeRespectsEndpointSides(
  svgPath: string,
  source: RoutePoint,
  target: RoutePoint,
  sourcePosition: Position,
  targetPosition: Position,
): boolean {
  const points = orthogonalRoutePoints(svgPath);
  if (points.length < 2) return false;
  return endpointSideIsRespected(source, points[1], sourcePosition) &&
    endpointSideIsRespected(target, points.at(-2)!, targetPosition);
}

export function orthogonalizeRoutePoints(
  points: RoutePoint[],
  sourcePosition: Position,
  targetPosition: Position,
): RoutePoint[] {
  if (points.length < 2) return points;
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

function segmentCrossesRect(left: RoutePoint, right: RoutePoint, rect: ObstacleRect): boolean {
  if (left.y === right.y) {
    const minX = Math.min(left.x, right.x);
    const maxX = Math.max(left.x, right.x);
    return left.y > rect.top && left.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }
  if (left.x === right.x) {
    const minY = Math.min(left.y, right.y);
    const maxY = Math.max(left.y, right.y);
    return left.x > rect.left && left.x < rect.right && maxY > rect.top && minY < rect.bottom;
  }
  return true;
}

function routeScore(points: RoutePoint[], obstacles: ObstacleRect[]): number {
  let collisions = 0;
  let length = 0;
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    length += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    obstacles.forEach((obstacle) => {
      if (segmentCrossesRect(previous, point, obstacle)) collisions += 1;
    });
  });
  return collisions * 1_000_000 + length + Math.max(0, points.length - 2) * 8;
}

export function routeFastOrthogonalInterface({
  nodes,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: {
  nodes: Node[];
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}): { path: string } {
  const padding = 18;
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceStub = endpointStub(source, sourcePosition);
  const targetStub = endpointStub(target, targetPosition);
  const obstacles = nodes.flatMap<ObstacleRect>((node) => {
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    if (width <= 0 || height <= 0) return [];
    return [{
      left: node.position.x - padding,
      right: node.position.x + width + padding,
      top: node.position.y - padding,
      bottom: node.position.y + height + padding,
    }];
  });
  const directBounds = {
    left: Math.min(sourceStub.x, targetStub.x) - 96,
    right: Math.max(sourceStub.x, targetStub.x) + 96,
    top: Math.min(sourceStub.y, targetStub.y) - 96,
    bottom: Math.max(sourceStub.y, targetStub.y) + 96,
  };
  const nearby = obstacles.filter((obstacle) =>
    obstacle.right > directBounds.left &&
    obstacle.left < directBounds.right &&
    obstacle.bottom > directBounds.top &&
    obstacle.top < directBounds.bottom
  );
  const xLanes = new Set<number>([
    (sourceStub.x + targetStub.x) / 2,
    Math.min(sourceStub.x, targetStub.x) - 32,
    Math.max(sourceStub.x, targetStub.x) + 32,
  ]);
  const yLanes = new Set<number>([
    (sourceStub.y + targetStub.y) / 2,
    Math.min(sourceStub.y, targetStub.y) - 32,
    Math.max(sourceStub.y, targetStub.y) + 32,
  ]);
  nearby.forEach((obstacle) => {
    xLanes.add(obstacle.left - 16);
    xLanes.add(obstacle.right + 16);
    yLanes.add(obstacle.top - 16);
    yLanes.add(obstacle.bottom + 16);
  });

  const candidates: RoutePoint[][] = [
    [source, sourceStub, { x: targetStub.x, y: sourceStub.y }, targetStub, target],
    [source, sourceStub, { x: sourceStub.x, y: targetStub.y }, targetStub, target],
    ...[...xLanes].map((x) => [
      source,
      sourceStub,
      { x, y: sourceStub.y },
      { x, y: targetStub.y },
      targetStub,
      target,
    ]),
    ...[...yLanes].map((y) => [
      source,
      sourceStub,
      { x: sourceStub.x, y },
      { x: targetStub.x, y },
      targetStub,
      target,
    ]),
  ].map(compactOrthogonalPoints);
  const best = candidates.reduce((current, candidate) =>
    routeScore(candidate, obstacles) < routeScore(current, obstacles) ? candidate : current
  );
  return { path: drawOrthogonalRoute(best) };
}

function collectAncestorIds(
  nodeId: string,
  nodesById: ReadonlyMap<string, { parentId?: string }>,
): Set<string> {
  const ancestors = new Set<string>();
  let parentId = nodesById.get(nodeId)?.parentId;
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = nodesById.get(parentId)?.parentId;
  }
  return ancestors;
}

export function absoluteRoutingObstacles(
  internalNodes: Iterable<InternalNode>,
  sourceNodeId: string,
  targetNodeId: string,
): Node[] {
  const nodes = [...internalNodes];
  const nodesById = new Map(
    nodes.map((node) => [node.id, { parentId: node.parentId }] as const),
  );
  const excluded = collectAncestorIds(sourceNodeId, nodesById);
  collectAncestorIds(targetNodeId, nodesById).forEach((id) => excluded.add(id));

  return nodes.flatMap<Node>((node) =>
    excluded.has(node.id) || node.id === sourceNodeId || node.id === targetNodeId
      ? []
      : [{
          id: node.id,
          data: node.data,
          position: { ...node.internals.positionAbsolute },
          measured: node.measured,
        }],
  );
}

export function routeOrthogonalInterface({
  nodes,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: {
  nodes: Node[];
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const options = {
    gridRatio: 16,
    nodePadding: 22,
    drawEdge: svgDrawStraightLinePath,
    generatePath: pathfindingJumpPointNoDiagonal,
  };
  const direct = getSmartEdge({
    nodes,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    options,
  });
  if (direct instanceof Error || routeRespectsEndpointSides(
    direct.svgPathString,
    source,
    target,
    sourcePosition,
    targetPosition,
  )) return direct;

  const sourceStub = endpointStub(source, sourcePosition, 40);
  const targetStub = endpointStub(target, targetPosition, 40);
  const routed = getSmartEdge({
    nodes,
    sourceX: sourceStub.x,
    sourceY: sourceStub.y,
    targetX: targetStub.x,
    targetY: targetStub.y,
    sourcePosition,
    targetPosition,
    options,
  });
  if (routed instanceof Error) return routed;
  const safeRoute = orthogonalizeRoutePoints(
    orthogonalRoutePoints(routed.svgPathString),
    sourcePosition,
    targetPosition,
  );
  return {
    ...routed,
    svgPathString: drawOrthogonalRoute([
      source,
      ...safeRoute,
      target,
    ]),
  };
}
