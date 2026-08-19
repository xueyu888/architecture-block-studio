import type { DesignFragment } from "../editor";
import { baseNodeDimensions } from "../layout";

export const DESIGN_FRAGMENT_PLACEMENT_GRID = 32;
export const DESIGN_FRAGMENT_PLACEMENT_GAP = 24;

export interface DesignFragmentPlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function fragmentBounds(fragment: DesignFragment): DesignFragmentPlacementRect {
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
  const bounds = fragmentBounds(fragment);
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
