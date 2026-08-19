import { compactOrthogonalPoints, type RoutePoint } from "./routeInterface";
import {
  compareRoutingObjectives,
  boundsMayInteract,
  directionVector,
  pathIsClear,
  pointKey,
  routeBends,
  routeBounds,
  routeHasReversal,
  routeHasSelfIntersection,
  routeRespectsFacingMonotonicity,
  routeLength,
  routeSegments,
  routeSignature,
  type RouteSegment,
  samePoint,
  segmentOverlapLength,
  segmentsCross,
  segmentsViolateParallelSeparation,
  shortSegmentCount,
  stableTextHash,
} from "./routingGeometry";
import { verifyRoutingResult } from "./routeVerifier";
import {
  routingObstacleCatalogFor,
  type RoutingObstacleCatalog,
} from "./obstacleCatalog";
import {
  DEFAULT_ROUTING_POLICY,
  type PlannedRoute,
  type RoutingDiagnostic,
  type RoutingDirection,
  type RoutingLeg,
  type RoutingPolicy,
  type RoutingRect,
  type RoutingResult,
  type RoutingScene,
} from "./routingScene";

interface GraphArc {
  to: number;
  points: readonly RoutePoint[];
  signature: string;
  segments: readonly RouteSegment[];
  length: number;
  bends: number;
  shortSegments: number;
}

interface VisibilityGraph {
  vertices: readonly RoutePoint[];
  arcs: ReadonlyMap<number, readonly GraphArc[]>;
}

interface PreparedLegRouting {
  obstacles: readonly RoutingRect[];
  graph?: VisibilityGraph;
  graphBuilt?: boolean;
}

interface SearchCost {
  capacity: number;
  crossings: number;
  length: number;
  bends: number;
  shortSegments: number;
  signature: string;
}

interface SearchState {
  vertex: number;
  direction: RoutingDirection;
  cost: SearchCost;
  points: readonly RoutePoint[];
}

interface OccupiedRoute {
  leg: RoutingLeg;
  route: PlannedRoute;
  segments: readonly RouteSegment[];
  bounds: RoutingRect;
}

function finitePoint(point: RoutePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validRect(rect: RoutingRect): boolean {
  return [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) &&
    rect.left < rect.right && rect.top < rect.bottom;
}

function directionFrom(left: RoutePoint, right: RoutePoint): RoutingDirection {
  if (right.x < left.x) return "left";
  if (right.x > left.x) return "right";
  if (right.y < left.y) return "top";
  return "bottom";
}

function directionAxis(direction: RoutingDirection): "h" | "v" {
  return direction === "left" || direction === "right" ? "h" : "v";
}

function reverseDirection(direction: RoutingDirection): RoutingDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

function appendCompact(points: readonly RoutePoint[], extension: readonly RoutePoint[]): RoutePoint[] {
  return compactOrthogonalPoints([
    ...points,
    ...extension.slice(samePoint(points.at(-1)!, extension[0]) ? 1 : 0),
  ]);
}

function compareSearchCost(left: SearchCost, right: SearchCost): number {
  const numeric: Array<keyof Omit<SearchCost, "signature">> = [
    "capacity",
    "crossings",
    "length",
    "bends",
    "shortSegments",
  ];
  for (const key of numeric) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return left.signature.localeCompare(right.signature);
}

class MinHeap<T> {
  private readonly values: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number { return this.values.length; }

  push(value: T): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): T | undefined {
    const first = this.values[0];
    const tail = this.values.pop();
    if (tail === undefined || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0
        ? right
        : left;
      if (this.compare(tail, this.values[child]) <= 0) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = tail;
    return first;
  }
}

function endpointStub(point: RoutePoint, direction: RoutingDirection, length: number): RoutePoint {
  const vector = directionVector(direction);
  return { x: point.x + vector.x * length, y: point.y + vector.y * length };
}

function resolvedStubLength(
  scene: RoutingScene,
  leg: RoutingLeg,
  endpoint: RoutingLeg["source"],
  policy: RoutingPolicy,
  obstacleCatalog: RoutingObstacleCatalog,
): number {
  const ignored = new Set(leg.ignoredObstacleIds);
  const point = endpoint.point;
  const terminal = endpoint.terminalObstacleId
    ? obstacleCatalog.get(endpoint.terminalObstacleId)
    : undefined;
  const terminalClearance = terminal && !ignored.has(terminal.id)
    ? terminal.bounds
    : undefined;
  const escapeDistance = !terminalClearance
    ? 0
    : endpoint.outward === "right"
      ? Math.max(0, terminalClearance.right - point.x)
      : endpoint.outward === "left"
        ? Math.max(0, point.x - terminalClearance.left)
        : endpoint.outward === "bottom"
          ? Math.max(0, terminalClearance.bottom - point.y)
          : Math.max(0, point.y - terminalClearance.top);
  const desired = Math.max(policy.stubLength, policy.minimumSegmentLength, escapeDistance);
  let available = desired;
  obstacleCatalog.entries.forEach((obstacle) => {
    if (ignored.has(obstacle.id) || obstacle.id === endpoint.terminalObstacleId) return;
    const rect = obstacle.bounds;
    let distance: number | undefined;
    if (endpoint.outward === "right" && point.y > rect.top && point.y < rect.bottom && rect.left > point.x) {
      distance = rect.left - point.x;
    } else if (endpoint.outward === "left" && point.y > rect.top && point.y < rect.bottom && rect.right < point.x) {
      distance = point.x - rect.right;
    } else if (endpoint.outward === "bottom" && point.x > rect.left && point.x < rect.right && rect.top > point.y) {
      distance = rect.top - point.y;
    } else if (endpoint.outward === "top" && point.x > rect.left && point.x < rect.right && rect.bottom < point.y) {
      distance = point.y - rect.bottom;
    }
    if (distance !== undefined) available = Math.min(available, distance - 1);
  });
  if (leg.routingBounds) {
    const boundaryDistance = endpoint.outward === "right"
      ? leg.routingBounds.right - point.x
      : endpoint.outward === "left"
        ? point.x - leg.routingBounds.left
        : endpoint.outward === "bottom"
          ? leg.routingBounds.bottom - point.y
          : point.y - leg.routingBounds.top;
    available = Math.min(available, boundaryDistance);
  }
  return Math.max(1 / policy.coordinateScale, available);
}

function activeObstacleRects(
  scene: RoutingScene,
  leg: RoutingLeg,
  policy: RoutingPolicy,
  obstacleCatalog: RoutingObstacleCatalog,
): RoutingRect[] {
  const ignored = new Set(leg.ignoredObstacleIds);
  const sourceStub = endpointStub(
    leg.source.point,
    leg.source.outward,
    resolvedStubLength(scene, leg, leg.source, policy, obstacleCatalog),
  );
  const targetStub = endpointStub(
    leg.target.point,
    leg.target.outward,
    resolvedStubLength(scene, leg, leg.target, policy, obstacleCatalog),
  );
  const directLength = Math.abs(targetStub.x - sourceStub.x) + Math.abs(targetStub.y - sourceStub.y);
  const detour = policy.maximumAbsoluteDetour + directLength * policy.maximumRelativeDetour;
  const envelope = {
    left: Math.min(sourceStub.x, targetStub.x) - detour,
    right: Math.max(sourceStub.x, targetStub.x) + detour,
    top: Math.min(sourceStub.y, targetStub.y) - detour,
    bottom: Math.max(sourceStub.y, targetStub.y) + detour,
  };
  return obstacleCatalog.query(envelope, ignored).map((obstacle) => obstacle.bounds);
}

function laneGuidePoints(point: RoutePoint, outward: RoutingDirection, policy: RoutingPolicy): RoutePoint[] {
  const perpendicular = directionAxis(outward) === "h" ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const result: RoutePoint[] = [];
  for (let lane = 1; lane <= policy.laneCandidateCount; lane += 1) {
    const distance = lane * policy.laneSpacing;
    result.push(
      { x: point.x + perpendicular.x * distance, y: point.y + perpendicular.y * distance },
      { x: point.x - perpendicular.x * distance, y: point.y - perpendicular.y * distance },
    );
  }
  return result;
}

function obstacleGuidePoints(rect: RoutingRect, policy: RoutingPolicy): RoutePoint[] {
  const distance = policy.laneSpacing;
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
    { x: rect.left - distance, y: rect.top - distance },
    { x: rect.right + distance, y: rect.top - distance },
    { x: rect.right + distance, y: rect.bottom + distance },
    { x: rect.left - distance, y: rect.bottom + distance },
  ];
}

function orthogonalVariants(left: RoutePoint, right: RoutePoint): RoutePoint[][] {
  if (left.x === right.x || left.y === right.y) return [[left, right]];
  return [
    [left, { x: right.x, y: left.y }, right],
    [left, { x: left.x, y: right.y }, right],
  ];
}

function terminalRunLength(points: readonly RoutePoint[], axis: "h" | "v", fromStart: boolean): number {
  const segments = routeSegments(fromStart ? points : [...points].reverse());
  return segments[0]?.axis === axis
    ? Math.abs(segments[0].b.x - segments[0].a.x) + Math.abs(segments[0].b.y - segments[0].a.y)
    : 0;
}

/**
 * Equal-cost routes use their deterministic tie-break to prefer a balanced
 * silhouette. This keeps small alignment jogs near the middle of two facing
 * ports instead of pinning the jog against either card.
 */
function aestheticRouteSignature(points: readonly RoutePoint[], leg: RoutingLeg, policy: RoutingPolicy): string {
  const sourceRun = terminalRunLength(points, directionAxis(leg.source.outward), true);
  const targetRun = terminalRunLength(points, directionAxis(leg.target.outward), false);
  const imbalance = Math.round(Math.abs(sourceRun - targetRun) * policy.coordinateScale)
    .toString()
    .padStart(12, "0");
  return `${imbalance}:${routeSignature(points)}`;
}

function pointWithinBounds(point: RoutePoint, bounds: RoutingRect | undefined): boolean {
  return !bounds || (
    point.x >= bounds.left && point.x <= bounds.right &&
    point.y >= bounds.top && point.y <= bounds.bottom
  );
}

function buildVisibilityGraph(
  scene: RoutingScene,
  leg: RoutingLeg,
  obstacles: readonly RoutingRect[],
  policy: RoutingPolicy,
  enhancedLanes: boolean,
  obstacleCatalog: RoutingObstacleCatalog,
): VisibilityGraph | undefined {
  const sourceStub = endpointStub(
    leg.source.point,
    leg.source.outward,
    resolvedStubLength(scene, leg, leg.source, policy, obstacleCatalog),
  );
  const targetStub = endpointStub(
    leg.target.point,
    leg.target.outward,
    resolvedStubLength(scene, leg, leg.target, policy, obstacleCatalog),
  );
  const candidates = [
    sourceStub,
    targetStub,
    ...laneGuidePoints(sourceStub, leg.source.outward, policy),
    ...laneGuidePoints(targetStub, leg.target.outward, policy),
    ...obstacles.flatMap((rect) => enhancedLanes
      ? obstacleGuidePoints(rect, policy)
      : [
          { x: rect.left, y: rect.top },
          { x: rect.right, y: rect.top },
          { x: rect.right, y: rect.bottom },
          { x: rect.left, y: rect.bottom },
        ]),
  ];
  const unique = new Map<string, RoutePoint>();
  candidates.forEach((point) => {
    if (!pointWithinBounds(point, leg.routingBounds)) return;
    if (obstacles.some((rect) => point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom)) return;
    unique.set(pointKey(point), point);
  });
  // Endpoint stubs occupy stable indices used by the search contract.
  const rest = [...unique.values()]
    .filter((point) => !samePoint(point, sourceStub) && !samePoint(point, targetStub))
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const vertices = [sourceStub, targetStub, ...rest];
  if (vertices.length > policy.maximumSearchVertices) return undefined;

  const arcs = new Map<number, GraphArc[]>();
  vertices.forEach((_, index) => arcs.set(index, []));
  for (let leftIndex = 0; leftIndex < vertices.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < vertices.length; rightIndex += 1) {
      orthogonalVariants(vertices[leftIndex], vertices[rightIndex])
        .map((points) => compactOrthogonalPoints(points))
        .filter((points) => points.every((point) => pointWithinBounds(point, leg.routingBounds)) && pathIsClear(points, obstacles))
        .sort((left, right) => routeSignature(left).localeCompare(routeSignature(right)))
        .forEach((points) => {
          const segments = routeSegments(points);
          const metrics = {
            segments,
            length: routeLength(points),
            bends: routeBends(points),
            shortSegments: shortSegmentCount(points, policy.minimumSegmentLength),
          };
          arcs.get(leftIndex)!.push({ to: rightIndex, points, signature: routeSignature(points), ...metrics });
          const reversed = [...points].reverse();
          arcs.get(rightIndex)!.push({
            to: leftIndex,
            points: reversed,
            signature: routeSignature(reversed),
            ...metrics,
            segments: [...segments].reverse().map((segment) => ({ ...segment, a: segment.b, b: segment.a })),
          });
        });
    }
  }
  arcs.forEach((list) => list.sort((left, right) => left.to - right.to || left.signature.localeCompare(right.signature)));
  return { vertices, arcs };
}

function pathConflictCost(
  segments: readonly RouteSegment[],
  occupied: readonly OccupiedRoute[],
  laneSpacing: number,
): Pick<SearchCost, "capacity" | "crossings"> {
  let capacity = 0;
  let crossings = 0;
  const candidateBounds = routeBounds(segments.flatMap((segment) => [segment.a, segment.b]));
  occupied.forEach(({ segments: occupiedSegments, bounds }) => {
    if (!boundsMayInteract(candidateBounds, bounds, laneSpacing)) return;
    segments.forEach((segment) => occupiedSegments.forEach((other) => {
      if (segmentOverlapLength(segment, other) > 0 || segmentsViolateParallelSeparation(segment, other, laneSpacing)) capacity += 1;
      if (segmentsCross(segment, other)) crossings += 1;
    }));
  });
  return { capacity, crossings };
}

/**
 * Covers the dominant editor case without constructing a quadratic graph:
 * one shared horizontal or vertical corridor between the endpoint stubs.
 * Every candidate is still checked against the same obstacles, bounds,
 * conflict metric and detour bound as graph search; complex mazes fall through
 * to the complete local candidate graph below.
 */
function bestCorridorRoute(
  scene: RoutingScene,
  leg: RoutingLeg,
  obstacles: readonly RoutingRect[],
  policy: RoutingPolicy,
  occupied: readonly OccupiedRoute[],
  maximumInternalLength: number,
  enhancedLanes: boolean,
  obstacleCatalog: RoutingObstacleCatalog,
): { points: RoutePoint[]; cost: SearchCost } | undefined {
  const sourceStub = endpointStub(
    leg.source.point,
    leg.source.outward,
    resolvedStubLength(scene, leg, leg.source, policy, obstacleCatalog),
  );
  const targetStub = endpointStub(
    leg.target.point,
    leg.target.outward,
    resolvedStubLength(scene, leg, leg.target, policy, obstacleCatalog),
  );
  const xGuides = new Set<number>([sourceStub.x, targetStub.x]);
  const yGuides = new Set<number>([sourceStub.y, targetStub.y]);
  xGuides.add(Math.round(((sourceStub.x + targetStub.x) / 2) * policy.coordinateScale) / policy.coordinateScale);
  yGuides.add(Math.round(((sourceStub.y + targetStub.y) / 2) * policy.coordinateScale) / policy.coordinateScale);
  laneGuidePoints(sourceStub, leg.source.outward, policy).forEach((point) => {
    xGuides.add(point.x);
    yGuides.add(point.y);
  });
  laneGuidePoints(targetStub, leg.target.outward, policy).forEach((point) => {
    xGuides.add(point.x);
    yGuides.add(point.y);
  });
  obstacles.forEach((obstacle) => {
    const guides = enhancedLanes
      ? obstacleGuidePoints(obstacle, policy)
      : [
          { x: obstacle.left, y: obstacle.top },
          { x: obstacle.right, y: obstacle.top },
          { x: obstacle.right, y: obstacle.bottom },
          { x: obstacle.left, y: obstacle.bottom },
        ];
    guides.forEach((point) => {
      xGuides.add(point.x);
      yGuides.add(point.y);
    });
  });

  const nearestGuides = (values: ReadonlySet<number>, coordinate: number) => [...values]
    .sort((left, right) => Math.abs(left - coordinate) - Math.abs(right - coordinate) || left - right)
    .slice(0, 10);
  const twoCorridorCandidates: RoutePoint[][] = [];
  if (enhancedLanes && (
    (leg.source.outward === "right" && leg.target.outward === "left" && sourceStub.x <= targetStub.x) ||
    (leg.source.outward === "left" && leg.target.outward === "right" && sourceStub.x >= targetStub.x)
  )) {
    const sourceLanes = nearestGuides(yGuides, sourceStub.y);
    const targetLanes = nearestGuides(yGuides, targetStub.y);
    const switches = [...xGuides].filter((x) =>
      x >= Math.min(sourceStub.x, targetStub.x) && x <= Math.max(sourceStub.x, targetStub.x)
    );
    sourceLanes.forEach((sourceY) => targetLanes.forEach((targetY) => switches.forEach((x) => {
      twoCorridorCandidates.push([
        sourceStub,
        { x: sourceStub.x, y: sourceY },
        { x, y: sourceY },
        { x, y: targetY },
        { x: targetStub.x, y: targetY },
        targetStub,
      ]);
    })));
  } else if (enhancedLanes && (
    (leg.source.outward === "bottom" && leg.target.outward === "top" && sourceStub.y <= targetStub.y) ||
    (leg.source.outward === "top" && leg.target.outward === "bottom" && sourceStub.y >= targetStub.y)
  )) {
    const sourceLanes = nearestGuides(xGuides, sourceStub.x);
    const targetLanes = nearestGuides(xGuides, targetStub.x);
    const switches = [...yGuides].filter((y) =>
      y >= Math.min(sourceStub.y, targetStub.y) && y <= Math.max(sourceStub.y, targetStub.y)
    );
    sourceLanes.forEach((sourceX) => targetLanes.forEach((targetX) => switches.forEach((y) => {
      twoCorridorCandidates.push([
        sourceStub,
        { x: sourceX, y: sourceStub.y },
        { x: sourceX, y },
        { x: targetX, y },
        { x: targetX, y: targetStub.y },
        targetStub,
      ]);
    })));
  }
  const candidates = [
    ...orthogonalVariants(sourceStub, targetStub),
    ...[...xGuides].map((x) => [
      sourceStub,
      { x, y: sourceStub.y },
      { x, y: targetStub.y },
      targetStub,
    ]),
    ...[...yGuides].map((y) => [
      sourceStub,
      { x: sourceStub.x, y },
      { x: targetStub.x, y },
      targetStub,
    ]),
    ...twoCorridorCandidates,
  ];
  let best: { points: RoutePoint[]; cost: SearchCost } | undefined;
  const seen = new Set<string>();
  candidates.forEach((candidate) => {
    const internal = compactOrthogonalPoints(candidate);
    const geometricSignature = routeSignature(internal);
    if (seen.has(geometricSignature)) return;
    seen.add(geometricSignature);
    if (routeLength(internal) > maximumInternalLength ||
      internal.some((point) => !pointWithinBounds(point, leg.routingBounds)) ||
      !pathIsClear(internal, obstacles)) return;
    const points = compactOrthogonalPoints([
      leg.source.point,
      ...internal,
      leg.target.point,
    ]);
    if (routeHasSelfIntersection(points) || routeHasReversal(points) || !routeRespectsFacingMonotonicity(
      points,
      leg.source.point,
      leg.target.point,
      leg.source.outward,
      leg.target.outward,
    )) return;
    const conflicts = pathConflictCost(routeSegments(internal), occupied, policy.laneSpacing);
    const cost: SearchCost = {
      ...conflicts,
      length: routeLength(internal),
      bends: routeBends(points),
      shortSegments: shortSegmentCount(points, policy.minimumSegmentLength),
      signature: aestheticRouteSignature(internal, leg, policy),
    };
    if (!best || compareSearchCost(cost, best.cost) < 0) best = { points, cost };
  });
  return best;
}

function arcCost(
  state: SearchState,
  arc: GraphArc,
  occupied: readonly OccupiedRoute[],
  laneSpacing: number,
  conflictCache: Map<GraphArc, Pick<SearchCost, "capacity" | "crossings">>,
): SearchCost | undefined {
  const segments = arc.segments;
  if (segments.length === 0) return undefined;
  const firstDirection = directionFrom(segments[0].a, segments[0].b);
  if (firstDirection === reverseDirection(state.direction)) return undefined;
  const lastDirection = directionFrom(segments.at(-1)!.a, segments.at(-1)!.b);
  let conflicts = conflictCache.get(arc);
  if (!conflicts) {
    conflicts = pathConflictCost(segments, occupied, laneSpacing);
    conflictCache.set(arc, conflicts);
  }
  const transitionBend = directionAxis(firstDirection) === directionAxis(state.direction) ? 0 : 1;
  return {
    capacity: state.cost.capacity + conflicts.capacity,
    crossings: state.cost.crossings + conflicts.crossings,
    length: state.cost.length + arc.length,
    bends: state.cost.bends + arc.bends + transitionBend,
    shortSegments: state.cost.shortSegments + arc.shortSegments,
    signature: `${state.cost.signature}|${lastDirection}:${arc.signature}`,
  };
}

function shortestLegRoute(
  scene: RoutingScene,
  leg: RoutingLeg,
  policy: RoutingPolicy,
  obstacleCatalog: RoutingObstacleCatalog,
  prepared: Map<string, PreparedLegRouting>,
  occupied: readonly OccupiedRoute[],
  maximumInternalLength = Number.POSITIVE_INFINITY,
  enhancedLanes = false,
): RoutePoint[] | undefined {
  const preparationKey = `${leg.id}:${enhancedLanes ? "enhanced" : "base"}`;
  let routing = prepared.get(preparationKey);
  if (!routing) {
    const obstacles = activeObstacleRects(scene, leg, policy, obstacleCatalog);
    routing = { obstacles };
    prepared.set(preparationKey, routing);
  }
  const corridor = bestCorridorRoute(
    scene,
    leg,
    routing.obstacles,
    policy,
    occupied,
    maximumInternalLength,
    enhancedLanes,
    obstacleCatalog,
  );
  if (corridor && (!enhancedLanes || corridor.cost.capacity === 0)) return corridor.points;
  if (!routing.graphBuilt) {
    routing.graph = routing.obstacles.length <= policy.maximumRelevantObstacles
      ? buildVisibilityGraph(scene, leg, routing.obstacles, policy, enhancedLanes, obstacleCatalog)
      : undefined;
    routing.graphBuilt = true;
  }
  const graph = routing.graph;
  if (!graph) return corridor?.points;
  const initial: SearchState = {
    vertex: 0,
    direction: leg.source.outward,
    cost: { capacity: 0, crossings: 0, length: 0, bends: 0, shortSegments: 0, signature: "" },
    points: [graph.vertices[0]],
  };
  const queue = new MinHeap<SearchState>((left, right) => compareSearchCost(left.cost, right.cost));
  const best = new Map<string, SearchCost>();
  const conflictCache = new Map<GraphArc, Pick<SearchCost, "capacity" | "crossings">>();
  queue.push(initial);
  best.set(`0:${initial.direction}`, initial.cost);

  while (queue.size > 0) {
    const state = queue.pop()!;
    const key = `${state.vertex}:${state.direction}`;
    if (compareSearchCost(state.cost, best.get(key) ?? state.cost) > 0) continue;
    if (state.vertex === 1 && state.direction !== leg.target.outward) {
      return compactOrthogonalPoints([
        leg.source.point,
        endpointStub(
          leg.source.point,
          leg.source.outward,
          resolvedStubLength(scene, leg, leg.source, policy, obstacleCatalog),
        ),
        ...state.points.slice(1),
        leg.target.point,
      ]);
    }
    (graph.arcs.get(state.vertex) ?? []).forEach((arc) => {
      const candidatePoints = appendCompact(state.points, arc.points);
      if (routeHasSelfIntersection(candidatePoints)) return;
      if (!routeRespectsFacingMonotonicity(
        [leg.source.point, ...candidatePoints],
        leg.source.point,
        leg.target.point,
        leg.source.outward,
        leg.target.outward,
      )) return;
      const nextCost = arcCost(state, arc, occupied, policy.laneSpacing, conflictCache);
      if (!nextCost || nextCost.length > maximumInternalLength) return;
      const segments = routeSegments(arc.points);
      const direction = directionFrom(segments.at(-1)!.a, segments.at(-1)!.b);
      const nextKey = `${arc.to}:${direction}`;
      const previousBest = best.get(nextKey);
      if (previousBest && compareSearchCost(previousBest, nextCost) <= 0) return;
      best.set(nextKey, nextCost);
      queue.push({
        vertex: arc.to,
        direction,
        cost: nextCost,
        points: candidatePoints,
      });
    });
  }
  return corridor?.points;
}

function plannedRoute(
  scene: RoutingScene,
  policy: RoutingPolicy,
  obstacleCatalog: RoutingObstacleCatalog,
  leg: RoutingLeg,
  points: readonly RoutePoint[],
  baselineLength: number,
  locked: boolean,
): PlannedRoute {
  return {
    legId: leg.id,
    commodityId: leg.commodityId,
    points: compactOrthogonalPoints([...points]),
    sourceStub: endpointStub(
      leg.source.point,
      leg.source.outward,
      resolvedStubLength(scene, leg, leg.source, policy, obstacleCatalog),
    ),
    targetStub: endpointStub(
      leg.target.point,
      leg.target.outward,
      resolvedStubLength(scene, leg, leg.target, policy, obstacleCatalog),
    ),
    locked,
    baselineLength,
    length: routeLength(points),
    bends: routeBends(points),
  };
}

function maximumInternalLength(baseline: PlannedRoute, policy: RoutingPolicy): number {
  const terminalStubLength = routeLength([
    baseline.points[0],
    baseline.sourceStub,
  ]) + routeLength([
    baseline.targetStub,
    baseline.points.at(-1)!,
  ]);
  const internalBaseline = Math.max(0, baseline.length - terminalStubLength);
  return internalBaseline + policy.maximumAbsoluteDetour + baseline.length * policy.maximumRelativeDetour;
}

function inputSignature(scene: RoutingScene, policy: RoutingPolicy): string {
  const obstacles = [...scene.obstacles]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((obstacle) => `${obstacle.id}:${obstacle.bounds.left},${obstacle.bounds.top},${obstacle.bounds.right},${obstacle.bounds.bottom}`);
  const legs = [...scene.legs]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((leg) => `${leg.id}:${leg.commodityId}:${pointKey(leg.source.point)}:${leg.source.outward}:${pointKey(leg.target.point)}:${leg.target.outward}:${leg.lockedPoints ? routeSignature(leg.lockedPoints) : "auto"}`);
  return stableTextHash(`${policy.version}|${obstacles.join("|")}|${legs.join("|")}`);
}

function validateInput(scene: RoutingScene): RoutingDiagnostic[] {
  const diagnostics: RoutingDiagnostic[] = [];
  const assertUnique = (kind: "obstacle" | "leg" | "gate", ids: readonly string[]) => {
    const seen = new Set<string>();
    ids.forEach((id) => {
      if (seen.has(id)) diagnostics.push({ code: "duplicate-id", message: `Duplicate ${kind} id ${id}.` });
      seen.add(id);
    });
  };
  assertUnique("obstacle", scene.obstacles.map((obstacle) => obstacle.id));
  assertUnique("leg", scene.legs.map((leg) => leg.id));
  assertUnique("gate", scene.gates.map((gate) => gate.id));
  scene.obstacles.forEach((obstacle) => {
    if (!validRect(obstacle.bounds)) diagnostics.push({ code: "invalid-geometry", message: `Obstacle ${obstacle.id} has invalid bounds.` });
  });
  scene.legs.forEach((leg) => {
    if (!finitePoint(leg.source.point) || !finitePoint(leg.target.point) || samePoint(leg.source.point, leg.target.point)) {
      diagnostics.push({ code: "invalid-geometry", message: "Routing leg has invalid or coincident endpoints.", legId: leg.id });
    }
    if (leg.lockedPoints && leg.lockedPoints.length < 2) {
      diagnostics.push({ code: "invalid-locked-route", message: "Locked route must contain at least two points.", legId: leg.id });
    }
  });
  return diagnostics;
}

function orderedAutoLegs(legs: readonly RoutingLeg[], baselines: ReadonlyMap<string, PlannedRoute>, iteration: number): RoutingLeg[] {
  const ordered = [...legs].sort((left, right) => {
    const leftRoute = baselines.get(left.id);
    const rightRoute = baselines.get(right.id);
    return (rightRoute?.bends ?? 0) - (leftRoute?.bends ?? 0) ||
      (rightRoute?.length ?? 0) - (leftRoute?.length ?? 0) ||
      left.source.point.y - right.source.point.y ||
      left.source.point.x - right.source.point.x ||
      left.id.localeCompare(right.id);
  });
  if (ordered.length === 0) return ordered;
  if (iteration % 2 === 1) ordered.reverse();
  const offset = Math.floor(iteration / 2) % ordered.length;
  return [...ordered.slice(offset), ...ordered.slice(0, offset)];
}

function solveOrder(
  scene: RoutingScene,
  policy: RoutingPolicy,
  obstacleCatalog: RoutingObstacleCatalog,
  baselines: ReadonlyMap<string, PlannedRoute>,
  prepared: Map<string, PreparedLegRouting>,
  iteration: number,
): Map<string, PlannedRoute> {
  const routes = new Map<string, PlannedRoute>();
  const occupiedRoutes: OccupiedRoute[] = [];
  scene.legs.filter((leg) => leg.lockedPoints).forEach((leg) => {
    const points = leg.lockedPoints!;
    const route = plannedRoute(scene, policy, obstacleCatalog, leg, points, routeLength(points), true);
    routes.set(leg.id, route);
    occupiedRoutes.push({ leg, route, segments: routeSegments(route.points), bounds: routeBounds(route.points) });
  });
  orderedAutoLegs(scene.legs.filter((leg) => !leg.lockedPoints), baselines, iteration).forEach((leg) => {
    const baseline = baselines.get(leg.id);
    if (!baseline) return;
    const points = shortestLegRoute(
      scene,
      leg,
      policy,
      obstacleCatalog,
      prepared,
      occupiedRoutes,
      maximumInternalLength(baseline, policy),
    );
    if (!points) return;
    const route = plannedRoute(scene, policy, obstacleCatalog, leg, points, baseline.length, false);
    routes.set(leg.id, route);
    occupiedRoutes.push({ leg, route, segments: routeSegments(route.points), bounds: routeBounds(route.points) });
  });
  return routes;
}

function improveConflictSweep(
  scene: RoutingScene,
  policy: RoutingPolicy,
  obstacleCatalog: RoutingObstacleCatalog,
  baselines: ReadonlyMap<string, PlannedRoute>,
  prepared: Map<string, PreparedLegRouting>,
  initial: ReadonlyMap<string, PlannedRoute>,
): Map<string, PlannedRoute> {
  let routes = new Map(initial);
  let current = verifyRoutingResult(scene, routes, policy, obstacleCatalog);
  for (let iteration = 0; iteration < policy.conflictSweepIterations; iteration += 1) {
    const conflicts = new Set(current.conflictingLegIds);
    if (conflicts.size === 0) break;
    const autoLegs = scene.legs
      .filter((leg) => !leg.lockedPoints && conflicts.has(leg.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const candidateRoutes = new Map(routes);
    for (const leg of autoLegs) {
      const baseline = baselines.get(leg.id);
      if (!baseline) continue;
      const occupied = [...candidateRoutes.values()].flatMap<OccupiedRoute>((route) => {
        if (route.legId === leg.id) return [];
        return [{
          leg: scene.legs.find((candidate) => candidate.id === route.legId)!,
          route,
          segments: routeSegments(route.points),
          bounds: routeBounds(route.points),
        }];
      });
      const points = shortestLegRoute(
        scene,
        leg,
        policy,
        obstacleCatalog,
        prepared,
        occupied,
        maximumInternalLength(baseline, policy),
        true,
      );
      if (!points) continue;
      candidateRoutes.set(
        leg.id,
        plannedRoute(scene, policy, obstacleCatalog, leg, points, baseline.length, false),
      );
    }
    const verification = verifyRoutingResult(scene, candidateRoutes, policy, obstacleCatalog);
    const hardComparison = verification.diagnostics.length - current.diagnostics.length;
    if (hardComparison > 0 || (hardComparison === 0 && compareRoutingObjectives(verification.objective, current.objective) >= 0)) break;
    routes = candidateRoutes;
    current = verification;
  }
  return routes;
}

export function solveRoutingScene(
  scene: RoutingScene,
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY,
  preparedObstacleCatalog?: RoutingObstacleCatalog,
): RoutingResult {
  const obstacleCatalog = routingObstacleCatalogFor(scene.obstacles, policy, preparedObstacleCatalog);
  const signature = inputSignature(scene, policy);
  const invalid = validateInput(scene);
  const emptyVerification = verifyRoutingResult(scene, new Map(), policy, obstacleCatalog);
  if (invalid.length > 0) {
    return {
      status: "InvalidInput",
      routes: new Map(),
      diagnostics: invalid,
      certificate: {
        policyVersion: policy.version,
        coordinateScale: policy.coordinateScale,
        deterministicInputSignature: signature,
        proof: "none",
        verified: false,
        audit: emptyVerification.audit,
        objective: emptyVerification.objective,
      },
    };
  }

  const baselines = new Map<string, PlannedRoute>();
  const prepared = new Map<string, PreparedLegRouting>();
  const diagnostics: RoutingDiagnostic[] = [];
  scene.legs.forEach((leg) => {
    if (leg.lockedPoints) {
      baselines.set(
        leg.id,
        plannedRoute(scene, policy, obstacleCatalog, leg, leg.lockedPoints, routeLength(leg.lockedPoints), true),
      );
      return;
    }
    const obstacles = activeObstacleRects(scene, leg, policy, obstacleCatalog);
    const points = shortestLegRoute(scene, leg, policy, obstacleCatalog, prepared, []);
    if (!points) {
      diagnostics.push(obstacles.length > policy.maximumRelevantObstacles
        ? { code: "search-limit", message: "Relevant obstacle set exceeds the bounded browser solver.", legId: leg.id }
        : { code: "route-not-found", message: "No legal route was found in the complete local visibility graph.", legId: leg.id });
      return;
    }
    baselines.set(
      leg.id,
      plannedRoute(scene, policy, obstacleCatalog, leg, points, routeLength(points), false),
    );
  });

  let bestRoutes = new Map<string, PlannedRoute>();
  let bestObjective = verifyRoutingResult(scene, bestRoutes, policy, obstacleCatalog).objective;
  for (let iteration = 0; iteration < Math.max(1, policy.negotiatedIterations); iteration += 1) {
    const candidate = solveOrder(scene, policy, obstacleCatalog, baselines, prepared, iteration);
    const objective = verifyRoutingResult(scene, candidate, policy, obstacleCatalog).objective;
    if (iteration === 0 || compareRoutingObjectives(objective, bestObjective) < 0) {
      bestRoutes = candidate;
      bestObjective = objective;
    }
  }
  bestRoutes = improveConflictSweep(scene, policy, obstacleCatalog, baselines, prepared, bestRoutes);
  const verification = verifyRoutingResult(scene, bestRoutes, policy, obstacleCatalog);
  const allRouted = bestRoutes.size === scene.legs.length;
  const verificationDiagnostics = verification.diagnostics;
  const lockedLegIds = new Set(scene.legs.filter((leg) => leg.lockedPoints).map((leg) => leg.id));
  const lockedInvalid = verificationDiagnostics.some((entry) =>
    entry.code === "invalid-locked-route" || (entry.legId ? lockedLegIds.has(entry.legId) : false)
  );
  const status = lockedInvalid
    ? "InvalidInput"
    : !allRouted || !verification.valid || verification.objective.capacityViolations > 0
      ? "Unresolved"
      : scene.legs.filter((leg) => !leg.lockedPoints).length <= 1
        ? "Optimal"
        : "Feasible";
  return {
    status,
    routes: bestRoutes,
    diagnostics: [...diagnostics, ...verificationDiagnostics],
    certificate: {
      policyVersion: policy.version,
      coordinateScale: policy.coordinateScale,
      deterministicInputSignature: signature,
      proof: status === "Optimal"
        ? "single-commodity-visibility-optimal"
        : status === "Feasible"
          ? "bounded-feasible"
          : "none",
      verified: verification.valid,
      audit: verification.audit,
      objective: verification.objective,
    },
  };
}
