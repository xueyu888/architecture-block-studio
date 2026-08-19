import { routeBends, routeLength } from "./routingGeometry";
import { solveRoutingScene } from "./sceneRouter";
import {
  createRoutingObstacleCatalog,
  type RoutingObstacleCatalog,
} from "./obstacleCatalog";
import type {
  PlannedRoute,
  RoutingDiagnostic,
  RoutingDirection,
  RoutingObstacle,
  RoutingPolicy,
  RoutingRect,
  RoutingScene,
} from "./routingScene";
import type { RoutePoint } from "./routeInterface";

const PREVIEW_LEG_ID = "__connection_preview_leg__";
const PREVIEW_POINTER_PHYSICAL_KEY = "__connection_preview_pointer__";
export const CONNECTION_PREVIEW_DUPLICATE_REUSE_MS = 30;

export interface RoutingPreviewNodeGeometry {
  id: string;
  parentId?: string;
  ancestorObstacleIds: readonly string[];
  parentRoutingBounds?: RoutingRect;
  endpoints: ReadonlyMap<string, RoutingPreviewEndpointGeometry>;
}

export interface RoutingPreviewEndpointGeometry {
  point: RoutePoint;
  outward: RoutingDirection;
  physicalKey: string;
}

export interface RoutingPreviewEnvironment {
  obstacles: readonly RoutingObstacle[];
  nodes: ReadonlyMap<string, RoutingPreviewNodeGeometry>;
}

export interface ConnectionPreviewAnchor {
  nodeId: string;
  handleId: string;
}

export type ConnectionPreviewTarget =
  | { kind: "attached"; nodeId: string; handleId: string }
  | { kind: "pointer"; point: RoutePoint };

export interface ConnectionPreviewRequest {
  source: ConnectionPreviewAnchor;
  target: ConnectionPreviewTarget;
}

export interface ConnectionPreviewResult {
  status: "routed" | "unresolved" | "invalid";
  points: readonly RoutePoint[];
  diagnostics: readonly RoutingDiagnostic[];
  obstacleCount: number;
  targetDirection?: RoutingDirection;
}

export interface ConnectionPreviewSessionStats {
  requestCount: number;
  solveCount: number;
  cacheHitCount: number;
  registeredObstacleCount: number;
  disposed: boolean;
}

export interface ConnectionPreviewSessionSolve {
  result: ConnectionPreviewResult;
  cacheHit: boolean;
  stats: ConnectionPreviewSessionStats;
}

export interface ConnectionPreviewSession {
  solve(request: ConnectionPreviewRequest, nowMs?: number): ConnectionPreviewSessionSolve;
  stats(): ConnectionPreviewSessionStats;
  dispose(): void;
}

function quantize(value: number, policy: RoutingPolicy): number {
  return Math.round(value * policy.coordinateScale) / policy.coordinateScale;
}

function quantizePoint(point: RoutePoint, policy: RoutingPolicy): RoutePoint {
  return { x: quantize(point.x, policy), y: quantize(point.y, policy) };
}

function pointWithinBounds(point: RoutePoint, bounds: RoutingRect): boolean {
  return point.x >= bounds.left && point.x <= bounds.right &&
    point.y >= bounds.top && point.y <= bounds.bottom;
}

function naturalTargetDirections(source: RoutePoint, target: RoutePoint): RoutingDirection[] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const horizontal: RoutingDirection = dx >= 0 ? "left" : "right";
  const vertical: RoutingDirection = dy >= 0 ? "top" : "bottom";
  const primary = Math.abs(dx) >= Math.abs(dy)
    ? [horizontal, vertical]
    : [vertical, horizontal];
  const oppositeHorizontal: RoutingDirection = horizontal === "left" ? "right" : "left";
  const oppositeVertical: RoutingDirection = vertical === "top" ? "bottom" : "top";
  return [...primary, oppositeHorizontal, oppositeVertical];
}

function previewPolicy(policy: RoutingPolicy): RoutingPolicy {
  return {
    ...policy,
    // A preview contains one disposable leg. Multi-leg negotiation cannot
    // improve it and would only spend pointermove time.
    negotiatedIterations: 1,
    conflictSweepIterations: 0,
  };
}

function routeSignature(route: PlannedRoute): string {
  return route.points.map((point) => `${point.x},${point.y}`).join(";");
}

function compareRoutes(left: PlannedRoute, right: PlannedRoute): number {
  return routeLength(left.points) - routeLength(right.points) ||
    routeBends(left.points) - routeBends(right.points) ||
    routeSignature(left).localeCompare(routeSignature(right));
}

function routingBoundsFor(
  source: RoutingPreviewNodeGeometry,
  target: RoutingPreviewNodeGeometry | undefined,
  targetPoint: RoutePoint,
): RoutingRect | undefined {
  if (!source.parentId || !source.parentRoutingBounds) return undefined;
  if (target) {
    return target.parentId === source.parentId ? source.parentRoutingBounds : undefined;
  }
  return pointWithinBounds(targetPoint, source.parentRoutingBounds)
    ? source.parentRoutingBounds
    : undefined;
}

function invalidResult(message: string, obstacleCount: number): ConnectionPreviewResult {
  return {
    status: "invalid",
    points: [],
    diagnostics: [{ code: "invalid-geometry", message, legId: PREVIEW_LEG_ID }],
    obstacleCount,
  };
}

/**
 * Solves one disposable connector against the same obstacle, clearance,
 * endpoint-normal, hierarchy-domain and verification rules as committed
 * routes. Other connectors are intentionally absent: lane negotiation remains
 * the committed scene solver's responsibility.
 */
export function solveConnectionPreview(
  environment: RoutingPreviewEnvironment,
  request: ConnectionPreviewRequest,
  policy: RoutingPolicy,
  preparedObstacleCatalog?: RoutingObstacleCatalog,
): ConnectionPreviewResult {
  const sourceNode = environment.nodes.get(request.source.nodeId);
  const sourceEndpoint = sourceNode?.endpoints.get(request.source.handleId);
  if (!sourceNode || !sourceEndpoint) {
    return invalidResult(
      `Preview source handle ${request.source.nodeId}::${request.source.handleId} is not in the routing scene.`,
      environment.obstacles.length,
    );
  }
  const targetRequest = request.target.kind === "attached" ? request.target : undefined;
  const targetNode = targetRequest ? environment.nodes.get(targetRequest.nodeId) : undefined;
  const targetEndpoint = targetNode && targetRequest
    ? targetNode.endpoints.get(targetRequest.handleId)
    : undefined;
  if (targetRequest && (!targetNode || !targetEndpoint)) {
    return invalidResult(
      `Preview target handle ${targetRequest.nodeId}::${targetRequest.handleId} is not in the routing scene.`,
      environment.obstacles.length,
    );
  }

  const sourcePoint = quantizePoint(sourceEndpoint.point, policy);
  const targetPoint = quantizePoint(
    targetEndpoint?.point ?? (request.target.kind === "pointer" ? request.target.point : sourceEndpoint.point),
    policy,
  );
  if (sourcePoint.x === targetPoint.x && sourcePoint.y === targetPoint.y) {
    return invalidResult("Preview endpoints are coincident.", environment.obstacles.length);
  }

  const ignoredObstacleIds = [...new Set([
    ...sourceNode.ancestorObstacleIds,
    ...(targetNode?.ancestorObstacleIds ?? []),
  ])].sort();
  const routingBounds = routingBoundsFor(sourceNode, targetNode, targetPoint);
  const targetObstacleId = targetRequest?.nodeId;

  const directions = targetEndpoint
    ? [targetEndpoint.outward]
    : naturalTargetDirections(sourcePoint, targetPoint);
  const candidates: Array<{ route: PlannedRoute; direction: RoutingDirection }> = [];
  const diagnostics: RoutingDiagnostic[] = [];
  directions.forEach((targetDirection) => {
    const scene: RoutingScene = {
      obstacles: environment.obstacles,
      gates: [],
      legs: [{
        id: PREVIEW_LEG_ID,
        commodityId: PREVIEW_LEG_ID,
        source: {
          point: sourcePoint,
          outward: sourceEndpoint.outward,
          terminalObstacleId: request.source.nodeId,
          physicalKey: sourceEndpoint.physicalKey,
        },
        target: {
          point: targetPoint,
          outward: targetDirection,
          terminalObstacleId: targetObstacleId,
          physicalKey: targetEndpoint?.physicalKey ?? PREVIEW_POINTER_PHYSICAL_KEY,
        },
        ignoredObstacleIds,
        routingBounds,
      }],
    };
    const result = solveRoutingScene(scene, previewPolicy(policy), preparedObstacleCatalog);
    const route = result.routes.get(PREVIEW_LEG_ID);
    if (route && result.certificate.verified) candidates.push({ route, direction: targetDirection });
    diagnostics.push(...result.diagnostics);
  });

  const best = candidates.sort((left, right) => compareRoutes(left.route, right.route))[0];
  if (!best) {
    const uniqueDiagnostics = [...new Map(diagnostics.map((diagnostic) => [
      `${diagnostic.code}\u0000${diagnostic.message}`,
      diagnostic,
    ])).values()];
    return {
      status: "unresolved",
      points: [],
      diagnostics: uniqueDiagnostics.length > 0
        ? uniqueDiagnostics
        : [{ code: "route-not-found", message: "No verified pointer preview route was found.", legId: PREVIEW_LEG_ID }],
      obstacleCount: environment.obstacles.length,
    };
  }
  return {
    status: "routed",
    points: best.route.points,
    diagnostics: [],
    obstacleCount: environment.obstacles.length,
    targetDirection: best.direction,
  };
}

function previewRequestKey(request: ConnectionPreviewRequest, policy: RoutingPolicy): string {
  const source = `${request.source.nodeId}\u0000${request.source.handleId}`;
  if (request.target.kind === "attached") {
    return `${source}\u0000attached\u0000${request.target.nodeId}\u0000${request.target.handleId}`;
  }
  const point = quantizePoint(request.target.point, policy);
  return `${source}\u0000pointer\u0000${point.x}\u0000${point.y}`;
}

/**
 * Owns only disposable routing resources for one pointer gesture. Static
 * obstacles are registered once; changed pointer intents solve immediately;
 * an exactly repeated intent may reuse the latest deterministic result for the
 * same short boundary used by draw.io's live endpoint preview.
 */
export function createConnectionPreviewSession(
  environment: RoutingPreviewEnvironment,
  policy: RoutingPolicy,
): ConnectionPreviewSession {
  let obstacleCatalog: RoutingObstacleCatalog | undefined = createRoutingObstacleCatalog(
    environment.obstacles,
    previewPolicy(policy),
  );
  let requestCount = 0;
  let solveCount = 0;
  let cacheHitCount = 0;
  let lastKey: string | undefined;
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastResult: ConnectionPreviewResult | undefined;
  let disposed = false;
  const snapshot = (): ConnectionPreviewSessionStats => ({
    requestCount,
    solveCount,
    cacheHitCount,
    registeredObstacleCount: obstacleCatalog?.obstacleCount ?? 0,
    disposed,
  });

  return {
    solve: (request, nowMs = performance.now()) => {
      if (disposed || !obstacleCatalog) throw new Error("Connection preview session has been disposed.");
      if (!Number.isFinite(nowMs)) throw new Error("Connection preview session time must be finite.");
      requestCount += 1;
      const key = previewRequestKey(request, policy);
      if (
        lastResult && key === lastKey && nowMs >= lastAt &&
        nowMs - lastAt < CONNECTION_PREVIEW_DUPLICATE_REUSE_MS
      ) {
        cacheHitCount += 1;
        return { result: lastResult, cacheHit: true, stats: snapshot() };
      }
      const result = solveConnectionPreview(environment, request, policy, obstacleCatalog);
      solveCount += 1;
      lastKey = key;
      lastAt = nowMs;
      lastResult = result;
      return { result, cacheHit: false, stats: snapshot() };
    },
    stats: snapshot,
    dispose: () => {
      disposed = true;
      obstacleCatalog = undefined;
      lastKey = undefined;
      lastResult = undefined;
    },
  };
}
