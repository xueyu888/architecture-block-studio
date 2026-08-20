import type { BlockDesignDocument } from "../model";
import { baseNodeDimensions } from "./nodeGeometry";
import type { LayoutResult } from "./types";

export interface AuthoredNodeGeometryChange {
  levelId: string;
  nodeId: string;
}

/**
 * Projects a flat authored geometry commit onto an already-derived layout.
 *
 * This is deliberately narrow: hierarchy expansion and automatic placement
 * can move geometry outside the edited nodes and therefore fall back to the
 * complete layout composer. A flat move/resize has no such downstream
 * dependency, so unchanged nodes and every edge remain valid projections.
 */
export function projectAuthoredNodeGeometry(
  document: BlockDesignDocument,
  current: LayoutResult,
  rootLevelId: string,
  expandedLevelIds: ReadonlySet<string>,
  placementMode: "authored" | "automatic",
  changes: readonly AuthoredNodeGeometryChange[],
): LayoutResult | undefined {
  if (placementMode !== "authored" || expandedLevelIds.size > 0 || changes.length === 0 ||
    changes.some((change) => change.levelId !== rootLevelId)) return undefined;
  const level = document.levels.find((candidate) => candidate.id === rootLevelId);
  if (!level || current.nodes.length !== level.nodes.length ||
    current.nodes.some((node) => node.parentId || node.data.levelId !== rootLevelId || node.data.expanded)) {
    return undefined;
  }

  const changedNodeIds = new Set(changes.map((change) => change.nodeId));
  if (changedNodeIds.size !== changes.length) return undefined;
  const blocksById = new Map(level.nodes.map((node) => [node.id, node] as const));
  if ([...changedNodeIds].some((nodeId) => !blocksById.has(nodeId))) return undefined;

  let projectedCount = 0;
  const nodes = current.nodes.map((node) => {
    const block = blocksById.get(node.data.block.id);
    if (!block || !changedNodeIds.has(block.id) || !block.layout.position) return node;
    projectedCount += 1;
    const dimensions = baseNodeDimensions(block);
    const position = { ...block.layout.position };
    return {
      ...node,
      position,
      width: dimensions.width,
      height: dimensions.height,
      style: { width: dimensions.width, height: dimensions.height },
      data: {
        ...node.data,
        block,
        designPosition: { ...position },
        projectedPosition: { ...position },
      },
    };
  });
  return projectedCount === changes.length ? { nodes, edges: current.edges } : undefined;
}
