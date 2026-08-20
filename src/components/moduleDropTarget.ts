export interface ModuleDropPoint {
  x: number;
  y: number;
}

export interface ModuleDropRect extends ModuleDropPoint {
  width: number;
  height: number;
}

export interface ModuleDropTargetCandidate {
  levelId: string;
  title: string;
  hierarchyDepth: number;
  bounds: ModuleDropRect;
  designOrigin: ModuleDropPoint;
  ownerFlowNodeId?: string;
}

function containsPoint(rect: ModuleDropRect, point: ModuleDropPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * Chooses the deepest visible Level surface under the pointer. Area and stable
 * identity only break impossible same-depth visual ties; they never infer a
 * hierarchy that the layout did not project.
 */
export function selectModuleDropTarget(
  point: ModuleDropPoint,
  candidates: readonly ModuleDropTargetCandidate[],
): ModuleDropTargetCandidate | undefined {
  return candidates
    .filter((candidate) => containsPoint(candidate.bounds, point))
    .sort((left, right) =>
      right.hierarchyDepth - left.hierarchyDepth ||
      left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height ||
      left.levelId.localeCompare(right.levelId)
    )[0];
}
