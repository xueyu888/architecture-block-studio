import {
  getSmartEdge,
  pathfindingJumpPointNoDiagonal,
  svgDrawStraightLinePath,
} from "@tisoap/react-flow-smart-edge";
import type { InternalNode, Node, Position } from "@xyflow/react";

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
