import type { RoutePoint } from "./routeInterface";
import {
  boundsMayInteract,
  endpointSideIsRespected,
  oppositeDirection,
  routeBends,
  routeBounds,
  routeHasSelfIntersection,
  routeHasReversal,
  routeRespectsFacingMonotonicity,
  routeLength,
  routeSegments,
  routeSignature,
  samePoint,
  segmentIntersectsRectInterior,
  segmentOverlapLength,
  segmentsCross,
  segmentsViolateParallelSeparation,
  shortSegmentCount,
  stableTextHash,
} from "./routingGeometry";
import {
  routingObstacleCatalogFor,
  type RoutingObstacleCatalog,
} from "./obstacleCatalog";
import type {
  PlannedRoute,
  RoutingDiagnostic,
  RoutingLeg,
  RoutingObjective,
  RoutingPolicy,
  RoutingScene,
  RoutingVerification,
} from "./routingScene";

function emptyObjective(): RoutingObjective {
  return {
    unrouted: 0,
    capacityViolations: 0,
    crossings: 0,
    maximumDetour: 0,
    totalDetour: 0,
    bends: 0,
    shortSegments: 0,
    signature: "",
  };
}

function diagnostic(message: string, legId?: string): RoutingDiagnostic {
  return { code: "verification-failed", message, legId };
}

function pointListEqual(left: readonly RoutePoint[], right: readonly RoutePoint[]): boolean {
  return left.length === right.length && left.every((point, index) => samePoint(point, right[index]));
}

function fixedStubForKey(route: PlannedRoute, leg: RoutingLeg, physicalKey: string) {
  if (leg.source.physicalKey === physicalKey) return routeSegments([leg.source.point, route.sourceStub])[0];
  if (leg.target.physicalKey === physicalKey) return routeSegments([route.targetStub, leg.target.point])[0];
  return undefined;
}

function range(segment: ReturnType<typeof routeSegments>[number]): [number, number] {
  const left = segment.axis === "h" ? segment.a.x : segment.a.y;
  const right = segment.axis === "h" ? segment.b.x : segment.b.y;
  return left <= right ? [left, right] : [right, left];
}

function sharedStubCoversOverlap(
  leftRoute: PlannedRoute,
  leftLeg: RoutingLeg,
  leftSegment: ReturnType<typeof routeSegments>[number],
  rightRoute: PlannedRoute,
  rightLeg: RoutingLeg,
  rightSegment: ReturnType<typeof routeSegments>[number],
): boolean {
  const leftKeys = [leftLeg.source.physicalKey, leftLeg.target.physicalKey];
  return leftKeys.some((physicalKey) => {
    const leftStub = fixedStubForKey(leftRoute, leftLeg, physicalKey);
    const rightStub = fixedStubForKey(rightRoute, rightLeg, physicalKey);
    if (!leftStub || !rightStub || leftStub.axis !== leftSegment.axis || rightStub.axis !== rightSegment.axis) return false;
    const [overlapStart, overlapEnd] = (() => {
      const [leftStart, leftEnd] = range(leftSegment);
      const [rightStart, rightEnd] = range(rightSegment);
      return [Math.max(leftStart, rightStart), Math.min(leftEnd, rightEnd)] as const;
    })();
    const [leftStart, leftEnd] = range(leftStub);
    const [rightStart, rightEnd] = range(rightStub);
    return overlapEnd > overlapStart &&
      overlapStart >= leftStart && overlapEnd <= leftEnd &&
      overlapStart >= rightStart && overlapEnd <= rightEnd;
  });
}

export function verifyRoutingResult(
  scene: RoutingScene,
  routes: ReadonlyMap<string, PlannedRoute>,
  policy: RoutingPolicy,
  preparedObstacleCatalog?: RoutingObstacleCatalog,
): RoutingVerification {
  const obstacleCatalog = routingObstacleCatalogFor(scene.obstacles, policy, preparedObstacleCatalog);
  const diagnostics: RoutingDiagnostic[] = [];
  const conflictingLegIds = new Set<string>();
  const capacityPairs = new Set<string>();
  const objective = emptyObjective();
  const auditedLegIds = scene.legs.map((leg) => leg.id).sort();
  let auditedPairCount = 0;
  const legsById = new Map(scene.legs.map((leg) => [leg.id, leg] as const));

  scene.legs.forEach((leg) => {
    const route = routes.get(leg.id);
    if (!route) {
      objective.unrouted += 1;
      return;
    }
    const points = route.points;
    const segments = routeSegments(points);
    if (points.length < 2 || segments.length !== points.length - 1) {
      diagnostics.push(diagnostic("Route must contain only non-zero orthogonal segments.", leg.id));
      return;
    }
    if (!samePoint(points[0], leg.source.point) || !samePoint(points.at(-1)!, leg.target.point)) {
      diagnostics.push(diagnostic("Route endpoints do not match the declared leg endpoints.", leg.id));
    }
    if (!endpointSideIsRespected(points[0], points[1], leg.source.outward) ||
      !endpointSideIsRespected(points.at(-1)!, points.at(-2)!, leg.target.outward)) {
      diagnostics.push(diagnostic("Route violates a source or target port normal.", leg.id));
    }
    if (routeHasSelfIntersection(points)) {
      diagnostics.push(diagnostic("Route intersects or retraces itself.", leg.id));
      conflictingLegIds.add(leg.id);
    }
    if (routeHasReversal(points)) {
      diagnostics.push(diagnostic("Route contains an immediate orthogonal reversal.", leg.id));
      conflictingLegIds.add(leg.id);
    }
    if (!routeRespectsFacingMonotonicity(
      points,
      leg.source.point,
      leg.target.point,
      leg.source.outward,
      leg.target.outward,
    )) {
      diagnostics.push(diagnostic("Route backtracks inside a clear facing-port corridor.", leg.id));
      conflictingLegIds.add(leg.id);
    }
    if (leg.routingBounds && points.some((point) =>
      point.x < leg.routingBounds!.left || point.x > leg.routingBounds!.right ||
      point.y < leg.routingBounds!.top || point.y > leg.routingBounds!.bottom
    )) {
      diagnostics.push(diagnostic("Route leaves its hierarchy routing domain.", leg.id));
    }
    if (leg.lockedPoints && !pointListEqual(points, leg.lockedPoints)) {
      diagnostics.push({
        code: "invalid-locked-route",
        message: "The solver changed a user-authored locked route.",
        legId: leg.id,
      });
    }

    const ignored = new Set(leg.ignoredObstacleIds);
    segments.forEach((segment, segmentIndex) => {
      obstacleCatalog.entries.forEach((obstacle) => {
        if (ignored.has(obstacle.id)) return;
        if (segmentIndex === 0 && obstacle.id === leg.source.terminalObstacleId) return;
        if (segmentIndex === segments.length - 1 && obstacle.id === leg.target.terminalObstacleId) return;
        if (segmentIntersectsRectInterior(segment, obstacle.bounds)) {
          diagnostics.push(diagnostic(`Route crosses obstacle ${obstacle.id}.`, leg.id));
        }
      });
    });

    const length = routeLength(points);
    const detour = Math.max(0, length - route.baselineLength);
    const allowedDetour = policy.maximumAbsoluteDetour + policy.maximumRelativeDetour * route.baselineLength;
    if (!route.locked && detour > allowedDetour) {
      diagnostics.push(diagnostic("Route exceeds the configured detour bound.", leg.id));
    }
    objective.maximumDetour = Math.max(objective.maximumDetour, detour);
    objective.totalDetour += detour;
    objective.bends += routeBends(points);
    objective.shortSegments += shortSegmentCount(points, policy.minimumSegmentLength);
  });

  scene.gates.forEach((gate) => {
    const [leftEnd, rightEnd] = gate.ends;
    const leftLeg = legsById.get(leftEnd.legId);
    const rightLeg = legsById.get(rightEnd.legId);
    if (!leftLeg || !rightLeg || leftLeg.commodityId !== gate.commodityId || rightLeg.commodityId !== gate.commodityId) {
      diagnostics.push({ code: "invalid-gate", message: "Gate references a missing or foreign routing leg.", gateId: gate.id });
      return;
    }
    const leftEndpoint = leftLeg[leftEnd.end];
    const rightEndpoint = rightLeg[rightEnd.end];
    if (!samePoint(leftEndpoint.point, gate.point) || !samePoint(rightEndpoint.point, gate.point) ||
      oppositeDirection(leftEndpoint.outward) !== rightEndpoint.outward) {
      diagnostics.push({ code: "invalid-gate", message: "Gate endpoints must be coincident with opposite normals.", gateId: gate.id });
    }
  });

  const routed = [...routes.values()].filter((route) => legsById.has(route.legId));
  const routedBounds = new Map(routed.map((route) => [route.legId, routeBounds(route.points)] as const));
  routed.forEach((leftRoute, leftIndex) => {
    const leftLeg = legsById.get(leftRoute.legId)!;
    const leftSegments = routeSegments(leftRoute.points);
    routed.slice(leftIndex + 1).forEach((rightRoute) => {
      auditedPairCount += 1;
      if (!boundsMayInteract(
        routedBounds.get(leftRoute.legId)!,
        routedBounds.get(rightRoute.legId)!,
        policy.laneSpacing,
      )) return;
      const rightLeg = legsById.get(rightRoute.legId)!;
      const rightSegments = routeSegments(rightRoute.points);
      leftSegments.forEach((leftSegment) => {
        rightSegments.forEach((rightSegment) => {
          const exactOverlap = segmentOverlapLength(leftSegment, rightSegment) > 0;
          const underSeparated = segmentsViolateParallelSeparation(leftSegment, rightSegment, policy.laneSpacing);
          if ((underSeparated || exactOverlap) && !(exactOverlap && sharedStubCoversOverlap(
            leftRoute,
            leftLeg,
            leftSegment,
            rightRoute,
            rightLeg,
            rightSegment,
          ))) {
            objective.capacityViolations += 1;
            conflictingLegIds.add(leftLeg.id);
            conflictingLegIds.add(rightLeg.id);
            const pair = `${leftLeg.id}\u0000${rightLeg.id}`;
            if (!capacityPairs.has(pair)) {
              capacityPairs.add(pair);
              diagnostics.push({
                code: "capacity-conflict",
                message: `Route is closer than the configured lane spacing to ${rightLeg.id}.`,
                legId: leftLeg.id,
              });
            }
          }
          if (segmentsCross(leftSegment, rightSegment)) {
            objective.crossings += 1;
          }
        });
      });
    });
  });

  objective.signature = [...routes.values()]
    .sort((left, right) => left.legId.localeCompare(right.legId))
    .map((route) => `${route.legId}:${routeSignature(route.points)}`)
    .join("|");
  // Keep certificates compact while preserving a stable total-order tie-break.
  objective.signature = stableTextHash(objective.signature);

  // A declared terminal obstacle must exist. A disposable free pointer leaves
  // the id absent and therefore receives no terminal-clearance exemption.
  scene.legs.forEach((leg) => {
    [leg.source.terminalObstacleId, leg.target.terminalObstacleId].forEach((id) => {
      if (id && !obstacleCatalog.get(id)) diagnostics.push(diagnostic(`Missing terminal obstacle ${id}.`, leg.id));
    });
  });

  return {
    valid: diagnostics.length === 0 && objective.unrouted === 0,
    diagnostics,
    conflictingLegIds: [...conflictingLegIds].sort(),
    audit: { auditedLegIds, auditedPairCount },
    objective,
  };
}
