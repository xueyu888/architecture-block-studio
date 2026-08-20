import type { DesignFragment } from "../editor";
import { baseNodeDimensions } from "../layout";
import type { BlockNode } from "../model";

export const DESIGN_FRAGMENT_PLACEMENT_GRID = 32;
export const DESIGN_FRAGMENT_PLACEMENT_GAP = 24;

export interface DesignFragmentPlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function designFragmentBounds(fragment: DesignFragment): DesignFragmentPlacementRect {
  const rects = fragment.nodes.map((node) => {
    const position = node.layout.position!;
    const dimensions = baseNodeDimensions(node);
    return { ...position, ...dimensions };
  });
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function overlapsWithGap(
  candidate: DesignFragmentPlacementRect,
  occupied: DesignFragmentPlacementRect,
): boolean {
  return candidate.x < occupied.x + occupied.width + DESIGN_FRAGMENT_PLACEMENT_GAP &&
    candidate.x + candidate.width + DESIGN_FRAGMENT_PLACEMENT_GAP > occupied.x &&
    candidate.y < occupied.y + occupied.height + DESIGN_FRAGMENT_PLACEMENT_GAP &&
    candidate.y + candidate.height + DESIGN_FRAGMENT_PLACEMENT_GAP > occupied.y;
}

function positiveCandidates(distance: number): Array<{ x: number; y: number }> {
  return Array.from({ length: distance + 1 }, (_, x) => ({ x, y: distance - x }))
    .sort((left, right) => Math.abs(left.x - left.y) - Math.abs(right.x - right.y));
}

/**
 * Finds the closest lower/right grid translation whose group bounds clear all
 * visible modules. Negative coordinates are a last resort, so paste stays in
 * the user's current reading direction and never lands on top of the source.
 */
export function findDesignFragmentPlacement(
  fragment: DesignFragment,
  occupied: readonly DesignFragmentPlacementRect[],
  insertionOrdinal: number,
): { x: number; y: number } {
  if (!Number.isInteger(insertionOrdinal) || insertionOrdinal < 1) {
    throw new Error("Fragment insertion ordinal must be a positive integer.");
  }
  const bounds = designFragmentBounds(fragment);
  const clear = (offset: { x: number; y: number }) => {
    const candidate = {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y,
    };
    return occupied.every((rect) => !overlapsWithGap(candidate, rect));
  };
  for (let distance = insertionOrdinal; distance <= 256; distance += 1) {
    for (const candidate of positiveCandidates(distance)) {
      const offset = {
        x: candidate.x * DESIGN_FRAGMENT_PLACEMENT_GRID,
        y: candidate.y * DESIGN_FRAGMENT_PLACEMENT_GRID,
      };
      if (clear(offset)) return offset;
    }
  }

  const fallbackDistance = 257 + insertionOrdinal;
  const fallbackCandidates = [
    { x: fallbackDistance * DESIGN_FRAGMENT_PLACEMENT_GRID, y: 0 },
    { x: 0, y: fallbackDistance * DESIGN_FRAGMENT_PLACEMENT_GRID },
    { x: -fallbackDistance * DESIGN_FRAGMENT_PLACEMENT_GRID, y: 0 },
    { x: 0, y: -fallbackDistance * DESIGN_FRAGMENT_PLACEMENT_GRID },
  ];
  return fallbackCandidates.find(clear) ?? fallbackCandidates[0];
}

function nearbyPointCandidates(distance: number): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = -distance; x <= distance; x += 1) {
    const y = distance - Math.abs(x);
    candidates.push({ x, y });
    if (y !== 0) candidates.push({ x, y: -y });
  }
  return candidates.sort((left, right) => {
    const leftLength = left.x * left.x + left.y * left.y;
    const rightLength = right.x * right.x + right.y * right.y;
    return leftLength - rightLength || right.y - left.y || right.x - left.x;
  });
}

function findRectPlacementAtOrigin(
  bounds: DesignFragmentPlacementRect,
  occupied: readonly DesignFragmentPlacementRect[],
  requestedOrigin: { x: number; y: number },
  subject: "Fragment" | "Module",
): { x: number; y: number } {
  if (![requestedOrigin.x, requestedOrigin.y].every(Number.isFinite)) {
    throw new Error(`${subject} insertion point must contain finite coordinates.`);
  }
  const snappedOrigin = {
    x: Math.round(requestedOrigin.x / DESIGN_FRAGMENT_PLACEMENT_GRID) * DESIGN_FRAGMENT_PLACEMENT_GRID,
    y: Math.round(requestedOrigin.y / DESIGN_FRAGMENT_PLACEMENT_GRID) * DESIGN_FRAGMENT_PLACEMENT_GRID,
  };
  const clear = (offset: { x: number; y: number }) => {
    const candidate = {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y,
    };
    return occupied.every((rect) => !overlapsWithGap(candidate, rect));
  };
  const requestedOffset = {
    x: snappedOrigin.x - bounds.x,
    y: snappedOrigin.y - bounds.y,
  };
  if (clear(requestedOffset)) return requestedOffset;

  for (let distance = 1; distance <= 256; distance += 1) {
    for (const candidate of nearbyPointCandidates(distance)) {
      const offset = {
        x: requestedOffset.x + candidate.x * DESIGN_FRAGMENT_PLACEMENT_GRID,
        y: requestedOffset.y + candidate.y * DESIGN_FRAGMENT_PLACEMENT_GRID,
      };
      if (clear(offset)) return offset;
    }
  }

  const occupiedBounds = occupied.reduce((aggregate, rect) => ({
    minX: Math.min(aggregate.minX, rect.x),
    minY: Math.min(aggregate.minY, rect.y),
    maxX: Math.max(aggregate.maxX, rect.x + rect.width),
    maxY: Math.max(aggregate.maxY, rect.y + rect.height),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  const ceilGrid = (value: number) => Math.ceil(value / DESIGN_FRAGMENT_PLACEMENT_GRID) * DESIGN_FRAGMENT_PLACEMENT_GRID;
  const floorGrid = (value: number) => Math.floor(value / DESIGN_FRAGMENT_PLACEMENT_GRID) * DESIGN_FRAGMENT_PLACEMENT_GRID;
  const outerOrigins = [
    { x: ceilGrid(occupiedBounds.maxX + DESIGN_FRAGMENT_PLACEMENT_GAP), y: snappedOrigin.y },
    { x: floorGrid(occupiedBounds.minX - bounds.width - DESIGN_FRAGMENT_PLACEMENT_GAP), y: snappedOrigin.y },
    { x: snappedOrigin.x, y: ceilGrid(occupiedBounds.maxY + DESIGN_FRAGMENT_PLACEMENT_GAP) },
    { x: snappedOrigin.x, y: floorGrid(occupiedBounds.minY - bounds.height - DESIGN_FRAGMENT_PLACEMENT_GAP) },
  ].sort((left, right) => {
    const leftDistance = (left.x - snappedOrigin.x) ** 2 + (left.y - snappedOrigin.y) ** 2;
    const rightDistance = (right.x - snappedOrigin.x) ** 2 + (right.y - snappedOrigin.y) ** 2;
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  });
  const outer = outerOrigins.map((origin) => ({
    x: origin.x - bounds.x,
    y: origin.y - bounds.y,
  })).find(clear);
  if (outer) return outer;
  throw new Error(`No collision-free ${subject.toLowerCase()} placement was found around the occupied design bounds.`);
}

/**
 * Places the fragment's bounding-box origin on the requested design point.
 * The point is snapped once to the placement grid. When that exact placement
 * is occupied, the closest deterministic grid translation is used instead.
 */
export function findDesignFragmentPlacementAtPoint(
  fragment: DesignFragment,
  occupied: readonly DesignFragmentPlacementRect[],
  point: { x: number; y: number },
): { x: number; y: number } {
  const bounds = designFragmentBounds(fragment);
  return findRectPlacementAtOrigin(bounds, occupied, point, "Fragment");
}

/**
 * Centers a new module on the requested design point, then snaps its authored
 * origin and applies the same deterministic clearance contract as Paste Here.
 */
export function findBlockPlacementAtPoint(
  block: BlockNode,
  occupied: readonly DesignFragmentPlacementRect[],
  point: { x: number; y: number },
): { x: number; y: number } {
  const dimensions = baseNodeDimensions(block);
  const bounds = { x: 0, y: 0, ...dimensions };
  const offset = findRectPlacementAtOrigin(bounds, occupied, {
    x: point.x - dimensions.width / 2,
    y: point.y - dimensions.height / 2,
  }, "Module");
  return { x: offset.x, y: offset.y };
}
