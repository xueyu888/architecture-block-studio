import {
  getSmartEdge,
  pathfindingJumpPointNoDiagonal,
  svgDrawStraightLinePath,
} from "@tisoap/react-flow-smart-edge";
import type { InternalNode, Node, Position } from "@xyflow/react";

interface RoutePoint {
  x: number;
  y: number;
}

export interface SeparatedRoute {
  path: string;
}

const ROUTE_LANES = [-12, -8, -4, 0, 4, 8, 12] as const;

export function routeLaneOffset(connectionId: string): number {
  let hash = 5381;
  for (const character of connectionId) {
    hash = Math.imul(hash, 33) ^ (character.codePointAt(0) ?? 0);
  }
  return ROUTE_LANES[(hash >>> 0) % ROUTE_LANES.length];
}

function routeAxis(left: RoutePoint, right: RoutePoint): "h" | "v" {
  return Math.abs(right.x - left.x) >= Math.abs(right.y - left.y) ? "h" : "v";
}

export function separateOrthogonalRoute(svgPath: string, laneOffset: number): SeparatedRoute {
  const parsed = [...svgPath.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),?\s*(-?\d+(?:\.\d+)?)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point, index, points) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (parsed.length < 2 || laneOffset === 0) {
    return { path: svgPath };
  }

  const points = parsed.filter((point, index) => {
    if (index === 0 || index === parsed.length - 1) return true;
    return routeAxis(parsed[index - 1], point) !== routeAxis(point, parsed[index + 1]);
  });
  if (points.length < 2) return { path: svgPath };

  const first = points[0];
  const second = points[1];
  const last = points.at(-1)!;
  const penultimate = points.at(-2)!;
  const firstAxis = routeAxis(first, second);
  const lastAxis = routeAxis(penultimate, last);
  const firstLength = Math.abs(second.x - first.x) + Math.abs(second.y - first.y);
  const lastLength = Math.abs(last.x - penultimate.x) + Math.abs(last.y - penultimate.y);
  const firstStub = Math.min(12, firstLength / 3);
  const lastStub = Math.min(12, lastLength / 3);
  const firstDirection = firstAxis === "h" ? Math.sign(second.x - first.x) : Math.sign(second.y - first.y);
  const lastDirection = lastAxis === "h" ? Math.sign(last.x - penultimate.x) : Math.sign(last.y - penultimate.y);
  const startStub = firstAxis === "h"
    ? { x: first.x + firstDirection * firstStub, y: first.y }
    : { x: first.x, y: first.y + firstDirection * firstStub };
  const shiftedStart = firstAxis === "h"
    ? { x: startStub.x, y: startStub.y + laneOffset }
    : { x: startStub.x + laneOffset, y: startStub.y };
  const endStub = lastAxis === "h"
    ? { x: last.x - lastDirection * lastStub, y: last.y }
    : { x: last.x, y: last.y - lastDirection * lastStub };
  const shiftedEnd = lastAxis === "h"
    ? { x: endStub.x, y: endStub.y + laneOffset }
    : { x: endStub.x + laneOffset, y: endStub.y };

  const shiftedInternal = points.slice(1, -1).map((point, index) => {
    const previousAxis = routeAxis(points[index], point);
    const nextAxis = routeAxis(point, points[index + 2]);
    return {
      x: point.x + (previousAxis === "v" || nextAxis === "v" ? laneOffset : 0),
      y: point.y + (previousAxis === "h" || nextAxis === "h" ? laneOffset : 0),
    };
  });
  const separated = [first, startStub, shiftedStart, ...shiftedInternal, shiftedEnd, endStub, last]
    .filter((point, index, routePoints) => index === 0 || point.x !== routePoints[index - 1].x || point.y !== routePoints[index - 1].y);
  return {
    path: separated.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x}, ${point.y}`).join(" "),
  };
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
  return getSmartEdge({
    nodes,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    options: {
      gridRatio: 16,
      nodePadding: 22,
      drawEdge: svgDrawStraightLinePath,
      generatePath: pathfindingJumpPointNoDiagonal,
    },
  });
}
