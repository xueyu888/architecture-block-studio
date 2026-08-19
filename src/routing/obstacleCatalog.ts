import { inflateRect } from "./routingGeometry";
import type { RoutingObstacle, RoutingPolicy, RoutingRect } from "./routingScene";

export interface RoutingObstacleCatalogEntry {
  id: string;
  order: number;
  bounds: RoutingRect;
}

/**
 * Immutable, scene-scoped registration of inflated routing obstacles.
 *
 * Geometry is compiled once, while every query remains deterministic in the
 * source scene's obstacle order. The two one-dimensional indexes avoid
 * rescanning distant obstacles in wide diagrams without imposing a grid whose
 * memory would depend on the size of large containers.
 */
export interface RoutingObstacleCatalog {
  readonly obstacleCount: number;
  readonly entries: readonly RoutingObstacleCatalogEntry[];
  matches(obstacles: readonly RoutingObstacle[], policy: RoutingPolicy): boolean;
  get(id: string): RoutingObstacleCatalogEntry | undefined;
  query(bounds: RoutingRect, ignoredIds?: ReadonlySet<string>): readonly RoutingObstacleCatalogEntry[];
}

function upperBoundByLeft(entries: readonly RoutingObstacleCatalogEntry[], coordinate: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].bounds.left <= coordinate) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBoundByRight(entries: readonly RoutingObstacleCatalogEntry[], coordinate: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].bounds.right < coordinate) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function createRoutingObstacleCatalog(
  obstacles: readonly RoutingObstacle[],
  policy: RoutingPolicy,
): RoutingObstacleCatalog {
  const clearance = policy.clearance + policy.strokeWidth / 2;
  const entries = Object.freeze(obstacles.map<RoutingObstacleCatalogEntry>((obstacle, order) => Object.freeze({
    id: obstacle.id,
    order,
    bounds: Object.freeze(inflateRect(obstacle.bounds, clearance)),
  })));
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const byLeft = [...entries].sort((left, right) =>
    left.bounds.left - right.bounds.left || left.order - right.order);
  const byRight = [...entries].sort((left, right) =>
    left.bounds.right - right.bounds.right || left.order - right.order);

  return {
    obstacleCount: entries.length,
    entries,
    matches: (candidateObstacles, candidatePolicy) =>
      candidateObstacles === obstacles &&
      candidatePolicy.clearance + candidatePolicy.strokeWidth / 2 === clearance,
    get: (id) => byId.get(id),
    query: (bounds, ignoredIds = new Set()) => {
      const leftEnd = upperBoundByLeft(byLeft, bounds.right);
      const rightStart = lowerBoundByRight(byRight, bounds.left);
      const candidates = leftEnd <= byRight.length - rightStart
        ? byLeft.slice(0, leftEnd)
        : byRight.slice(rightStart);
      return candidates
        .filter((entry) =>
          !ignoredIds.has(entry.id) &&
          entry.bounds.right >= bounds.left && entry.bounds.left <= bounds.right &&
          entry.bounds.bottom >= bounds.top && entry.bounds.top <= bounds.bottom)
        .sort((left, right) => left.order - right.order);
    },
  };
}

export function routingObstacleCatalogFor(
  obstacles: readonly RoutingObstacle[],
  policy: RoutingPolicy,
  catalog?: RoutingObstacleCatalog,
): RoutingObstacleCatalog {
  if (!catalog) return createRoutingObstacleCatalog(obstacles, policy);
  if (!catalog.matches(obstacles, policy)) {
    throw new Error("Routing obstacle catalog does not match the scene or clearance policy.");
  }
  return catalog;
}
