import {
  boundsMayInteract,
  routeBounds,
  routeSegments,
  samePoint,
  segmentIntersectsRectInterior,
} from "./routingGeometry";
import { createRoutingObstacleCatalog } from "./obstacleCatalog";
import { solveRoutingScene } from "./sceneRouter";
import type {
  PlannedRoute,
  RoutingLeg,
  RoutingPolicy,
  RoutingRect,
  RoutingResult,
  RoutingScene,
  RoutingStatus,
} from "./routingScene";

export type LiveRoutingPreviewMode = "retained" | "exact" | "incremental";

export interface LiveRoutingPreview {
  mode: LiveRoutingPreviewMode;
  status: RoutingStatus;
  routes: ReadonlyMap<string, PlannedRoute>;
  affectedLegIds: readonly string[];
  neighborhoodLegIds: readonly string[];
}

export interface LiveRoutingPreviewOptions {
  /** Small scenes are solved as one exact frame so pointerup cannot change topology. */
  exactLegLimit?: number;
}

export const LIVE_ROUTING_EXACT_LEG_LIMIT = 32;

function sameRect(left: RoutingRect | undefined, right: RoutingRect | undefined): boolean {
  return left === right || Boolean(left && right &&
    left.left === right.left && left.right === right.right &&
    left.top === right.top && left.bottom === right.bottom);
}

function samePoints(
  left: readonly { x: number; y: number }[] | undefined,
  right: readonly { x: number; y: number }[] | undefined,
): boolean {
  return left === right || Boolean(left && right && left.length === right.length &&
    left.every((point, index) => samePoint(point, right[index])));
}

function sameEndpoint(left: RoutingLeg["source"], right: RoutingLeg["source"]): boolean {
  return samePoint(left.point, right.point) &&
    left.outward === right.outward &&
    left.terminalObstacleId === right.terminalObstacleId &&
    left.physicalKey === right.physicalKey;
}

function sameLegGeometry(left: RoutingLeg | undefined, right: RoutingLeg): boolean {
  return Boolean(left &&
    left.commodityId === right.commodityId &&
    sameEndpoint(left.source, right.source) &&
    sameEndpoint(left.target, right.target) &&
    sameRect(left.routingBounds, right.routingBounds) &&
    left.ignoredObstacleIds.length === right.ignoredObstacleIds.length &&
    left.ignoredObstacleIds.every((id, index) => id === right.ignoredObstacleIds[index]) &&
    samePoints(left.lockedPoints, right.lockedPoints));
}

function routeLeavesBounds(route: PlannedRoute, bounds: RoutingRect | undefined): boolean {
  return Boolean(bounds && route.points.some((point) =>
    point.x < bounds.left || point.x > bounds.right ||
    point.y < bounds.top || point.y > bounds.bottom));
}

function routeCrossesObstacle(
  route: PlannedRoute,
  leg: RoutingLeg,
  obstacleId: string,
  obstacleBounds: RoutingRect,
): boolean {
  if (leg.ignoredObstacleIds.includes(obstacleId)) return false;
  const segments = routeSegments(route.points);
  return segments.some((segment, index) => {
    if (index === 0 && obstacleId === leg.source.terminalObstacleId) return false;
    if (index === segments.length - 1 && obstacleId === leg.target.terminalObstacleId) return false;
    return segmentIntersectsRectInterior(segment, obstacleBounds);
  });
}

function closeAffectedGates(scene: RoutingScene, affected: Set<string>): void {
  let changed = true;
  while (changed) {
    changed = false;
    scene.gates.forEach((gate) => {
      if (!gate.ends.some((end) => affected.has(end.legId))) return;
      gate.ends.forEach((end) => {
        if (affected.has(end.legId)) return;
        affected.add(end.legId);
        changed = true;
      });
    });
  }
}

/**
 * Solves one disposable direct-manipulation routing frame.
 *
 * A small or fully affected scene is solved exactly. Large scenes solve the
 * affected gate-closed legs first, then repeatedly absorb only committed
 * routes whose actual bounds can interact with the candidate paths. Those
 * neighbors become immutable capacity constraints. The closure stops only
 * when no outside route can interact, so distant routes remain untouched
 * without replacing geometric proof with a count threshold. No preview result
 * is persisted or used as a document fact.
 */
export function solveLiveRoutingPreview(
  committedScene: RoutingScene,
  liveScene: RoutingScene,
  committedResult: RoutingResult,
  policy: RoutingPolicy,
  options: LiveRoutingPreviewOptions = {},
): LiveRoutingPreview {
  const committedLegById = new Map(committedScene.legs.map((leg) => [leg.id, leg] as const));
  const liveLegById = new Map(liveScene.legs.map((leg) => [leg.id, leg] as const));
  const committedObstacleById = new Map(committedScene.obstacles.map((obstacle) => [obstacle.id, obstacle] as const));
  const liveCatalog = createRoutingObstacleCatalog(liveScene.obstacles, policy);
  const changedObstacles = liveScene.obstacles.filter((obstacle) => {
    const committed = committedObstacleById.get(obstacle.id);
    return !committed || committed.kind !== obstacle.kind || !sameRect(committed.bounds, obstacle.bounds);
  });
  const affected = new Set<string>();

  liveScene.legs.forEach((leg) => {
    const route = committedResult.routes.get(leg.id);
    if (!route || !sameLegGeometry(committedLegById.get(leg.id), leg) || routeLeavesBounds(route, leg.routingBounds)) {
      affected.add(leg.id);
      return;
    }
    if (changedObstacles.some((obstacle) => {
      const compiled = liveCatalog.get(obstacle.id);
      return Boolean(compiled && routeCrossesObstacle(route, leg, obstacle.id, compiled.bounds));
    })) affected.add(leg.id);
  });
  closeAffectedGates(liveScene, affected);

  const affectedLegIds = [...affected].sort();
  if (affectedLegIds.length === 0) {
    return {
      mode: "retained",
      status: committedResult.status,
      routes: committedResult.routes,
      affectedLegIds,
      neighborhoodLegIds: [],
    };
  }

  const exactLegLimit = options.exactLegLimit ?? LIVE_ROUTING_EXACT_LEG_LIMIT;
  if (liveScene.legs.length <= exactLegLimit || affected.size === liveScene.legs.length) {
    const result = solveRoutingScene(liveScene, policy, liveCatalog);
    return {
      mode: "exact",
      status: result.status,
      routes: result.routes,
      affectedLegIds,
      neighborhoodLegIds: liveScene.legs.map((leg) => leg.id).sort(),
    };
  }

  const included = new Set(affected);
  const solveIncluded = () => {
    const localLegs = liveScene.legs.flatMap((leg): RoutingLeg[] => {
      if (!included.has(leg.id)) return [];
      const committedRoute = committedResult.routes.get(leg.id);
      return [{
        ...leg,
        lockedPoints: affected.has(leg.id) ? leg.lockedPoints : committedRoute?.points,
      }];
    });
    const localLegIds = new Set(localLegs.map((leg) => leg.id));
    return solveRoutingScene({
      obstacles: liveScene.obstacles,
      legs: localLegs,
      gates: liveScene.gates.filter((gate) => gate.ends.every((end) => localLegIds.has(end.legId))),
    }, policy, liveCatalog);
  };
  let local = solveIncluded();
  while (true) {
    const affectedBounds = affectedLegIds.flatMap((id) => {
      const route = local.routes.get(id);
      return route ? [routeBounds(route.points)] : [];
    });
    const additions: string[] = [];
    committedResult.routes.forEach((route, id) => {
      if (!liveLegById.has(id) || included.has(id)) return;
      const bounds = routeBounds(route.points);
      if (affectedBounds.some((area) => boundsMayInteract(bounds, area, policy.laneSpacing))) additions.push(id);
    });
    if (additions.length === 0) break;
    additions.forEach((id) => included.add(id));
    if (included.size === liveScene.legs.length) {
      const result = solveRoutingScene(liveScene, policy, liveCatalog);
      return {
        mode: "exact",
        status: result.status,
        routes: result.routes,
        affectedLegIds,
        neighborhoodLegIds: liveScene.legs.map((leg) => leg.id).sort(),
      };
    }
    local = solveIncluded();
  }
  const neighborhoodLegIds = [...included].sort();
  const combined = new Map(
    [...committedResult.routes].filter(([id]) => liveLegById.has(id)),
  );
  affected.forEach((id) => {
    const route = local.routes.get(id);
    if (route) combined.set(id, route);
    else combined.delete(id);
  });
  return {
    mode: "incremental",
    status: local.status,
    routes: combined,
    affectedLegIds,
    neighborhoodLegIds,
  };
}
