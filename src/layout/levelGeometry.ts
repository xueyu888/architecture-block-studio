import type { NodeResizeRect } from "./nodeGeometry";
import type { LayoutFlowNode } from "./types";

export interface CoordinateDelta {
  x: number;
  y: number;
}

export interface CoordinateDeltaLimits {
  minimum: CoordinateDelta;
  maximum?: CoordinateDelta;
}

export interface ConstrainedCoordinateDelta {
  delta: CoordinateDelta;
  clampedX: boolean;
  clampedY: boolean;
}

export interface CoordinateStartLimits {
  minimum: CoordinateDelta;
  /** Present only when a legacy negative coordinate currently owns the origin. */
  maximum?: CoordinateDelta;
}

function finitePoint(point: CoordinateDelta): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function inlineCoordinateOwner(
  node: LayoutFlowNode,
  nodesById: ReadonlyMap<string, LayoutFlowNode>,
) {
  const projection = node.parentId ? nodesById.get(node.parentId)?.data.childLevelProjection : undefined;
  return projection?.levelId === node.data.levelId ? projection : undefined;
}

/**
 * Converts stable Level-coordinate boundaries into one common edit delta.
 * A negative legacy origin is locked when every node that owns that origin is
 * moving, otherwise the origin itself would silently drift to the right/down.
 */
export function levelMovementLimits(
  nodes: readonly LayoutFlowNode[],
  movingNodeIds: ReadonlySet<string>,
): CoordinateDeltaLimits | undefined {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const moving = nodes.filter((node) => movingNodeIds.has(node.id));
  let minimumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.NEGATIVE_INFINITY;
  let maximumX = Number.POSITIVE_INFINITY;
  let maximumY = Number.POSITIVE_INFINITY;
  let constrained = false;
  for (const node of moving) {
    const projection = inlineCoordinateOwner(node, nodesById);
    if (!projection) continue;
    constrained = true;
    minimumX = Math.max(minimumX, projection.coordinateOrigin.x - node.data.designPosition.x);
    minimumY = Math.max(minimumY, projection.coordinateOrigin.y - node.data.designPosition.y);
    const siblings = nodes.filter((candidate) => (
      candidate.parentId === node.parentId && candidate.data.levelId === node.data.levelId
    ));
    if (projection.coordinateOrigin.x < 0) {
      const originOwners = siblings.filter(
        (candidate) => candidate.data.designPosition.x === projection.coordinateOrigin.x,
      );
      if (originOwners.length > 0 && originOwners.every((candidate) => movingNodeIds.has(candidate.id))) {
        maximumX = Math.min(maximumX, 0);
      }
    }
    if (projection.coordinateOrigin.y < 0) {
      const originOwners = siblings.filter(
        (candidate) => candidate.data.designPosition.y === projection.coordinateOrigin.y,
      );
      if (originOwners.length > 0 && originOwners.every((candidate) => movingNodeIds.has(candidate.id))) {
        maximumY = Math.min(maximumY, 0);
      }
    }
  }
  if (!constrained) return undefined;
  return {
    minimum: { x: minimumX, y: minimumY },
    maximum: {
      x: Number.isFinite(maximumX) ? maximumX : Number.MAX_SAFE_INTEGER,
      y: Number.isFinite(maximumY) ? maximumY : Number.MAX_SAFE_INTEGER,
    },
  };
}

export function nodeResizeStartLimits(
  node: LayoutFlowNode,
  nodes: readonly LayoutFlowNode[],
  editedNodeIds: ReadonlySet<string>,
): CoordinateStartLimits | undefined {
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const projection = inlineCoordinateOwner(node, nodesById);
  if (!projection) return undefined;
  const minimum = {
    x: node.position.x + projection.coordinateOrigin.x - node.data.designPosition.x,
    y: node.position.y + projection.coordinateOrigin.y - node.data.designPosition.y,
  };
  const siblings = nodes.filter((candidate) => (
    candidate.parentId === node.parentId && candidate.data.levelId === node.data.levelId
  ));
  const locksX = projection.coordinateOrigin.x < 0 && siblings
    .filter((candidate) => candidate.data.designPosition.x === projection.coordinateOrigin.x)
    .every((candidate) => editedNodeIds.has(candidate.id));
  const locksY = projection.coordinateOrigin.y < 0 && siblings
    .filter((candidate) => candidate.data.designPosition.y === projection.coordinateOrigin.y)
    .every((candidate) => editedNodeIds.has(candidate.id));
  return {
    minimum,
    maximum: locksX || locksY
      ? {
          x: locksX ? node.position.x : Number.MAX_SAFE_INTEGER,
          y: locksY ? node.position.y : Number.MAX_SAFE_INTEGER,
        }
      : undefined,
  };
}

/**
 * Constrains one common movement delta without changing relative geometry.
 * Missing maximum limits mean that the Level may grow to the right or bottom.
 */
export function constrainCoordinateDelta(
  requested: CoordinateDelta,
  limits: CoordinateDeltaLimits,
): ConstrainedCoordinateDelta {
  if (!finitePoint(requested) || !finitePoint(limits.minimum) ||
    (limits.maximum && !finitePoint(limits.maximum))) {
    throw new RangeError("Coordinate movement limits and requested delta must be finite.");
  }
  if (limits.maximum && (
    limits.minimum.x > limits.maximum.x || limits.minimum.y > limits.maximum.y
  )) {
    throw new RangeError("Coordinate movement limits are contradictory.");
  }
  const delta = {
    x: Math.max(limits.minimum.x, Math.min(limits.maximum?.x ?? Number.POSITIVE_INFINITY, requested.x)),
    y: Math.max(limits.minimum.y, Math.min(limits.maximum?.y ?? Number.POSITIVE_INFINITY, requested.y)),
  };
  return {
    delta,
    clampedX: delta.x !== requested.x,
    clampedY: delta.y !== requested.y,
  };
}

/**
 * Keeps a resize start edge inside a Level origin while preserving the
 * opposite edge. Node/group size limits are applied by the caller first.
 */
export function constrainResizeRectToOrigin(
  requested: NodeResizeRect,
  limits: CoordinateStartLimits,
): NodeResizeRect {
  if (![requested.x, requested.y, requested.width, requested.height].every(Number.isFinite) ||
    requested.width <= 0 || requested.height <= 0 || !finitePoint(limits.minimum) ||
    (limits.maximum && !finitePoint(limits.maximum))) {
    throw new RangeError("Resize rectangle and Level origin must contain finite valid geometry.");
  }
  if (limits.maximum && (
    limits.minimum.x > limits.maximum.x || limits.minimum.y > limits.maximum.y
  )) {
    throw new RangeError("Resize start limits are contradictory.");
  }
  const right = requested.x + requested.width;
  const bottom = requested.y + requested.height;
  const x = Math.max(
    limits.minimum.x,
    Math.min(limits.maximum?.x ?? Number.POSITIVE_INFINITY, requested.x),
  );
  const y = Math.max(
    limits.minimum.y,
    Math.min(limits.maximum?.y ?? Number.POSITIVE_INFINITY, requested.y),
  );
  if (right <= x || bottom <= y) {
    throw new RangeError("Level origin leaves no positive resize extent.");
  }
  return { x, y, width: right - x, height: bottom - y };
}
