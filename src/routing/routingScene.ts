import type { RoutePoint } from "./routeInterface";

export type RoutingDirection = "left" | "right" | "top" | "bottom";

export interface RoutingRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RoutingObstacle {
  id: string;
  bounds: RoutingRect;
  kind: "module" | "container";
}

export interface RoutingEndpoint {
  point: RoutePoint;
  outward: RoutingDirection;
  /** Absent only for a disposable free pointer that has no terminal shape. */
  terminalObstacleId?: string;
  physicalKey: string;
}

export interface RoutingLeg {
  id: string;
  commodityId: string;
  source: RoutingEndpoint;
  target: RoutingEndpoint;
  ignoredObstacleIds: readonly string[];
  /** Optional hierarchy routing domain. Every point must remain inside it. */
  routingBounds?: RoutingRect;
  /** A user-authored route. It is verified and rendered, but never optimized. */
  lockedPoints?: readonly RoutePoint[];
}

export interface RoutingGateEnd {
  legId: string;
  end: "source" | "target";
}

export interface RoutingGate {
  id: string;
  commodityId: string;
  point: RoutePoint;
  ends: readonly [RoutingGateEnd, RoutingGateEnd];
}

export interface RoutingScene {
  obstacles: readonly RoutingObstacle[];
  legs: readonly RoutingLeg[];
  gates: readonly RoutingGate[];
}

/**
 * Versioned policy for the standalone router. Values are design-space pixels;
 * coordinateScale is the sole conversion to the internal integer lattice.
 */
export interface RoutingPolicy {
  version: "orthogonal-scene-v1";
  coordinateScale: number;
  clearance: number;
  strokeWidth: number;
  stubLength: number;
  laneSpacing: number;
  laneCandidateCount: number;
  minimumSegmentLength: number;
  maximumAbsoluteDetour: number;
  maximumRelativeDetour: number;
  maximumRelevantObstacles: number;
  maximumSearchVertices: number;
  negotiatedIterations: number;
  conflictSweepIterations: number;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = Object.freeze({
  version: "orthogonal-scene-v1",
  coordinateScale: 8,
  clearance: 18,
  strokeWidth: 2,
  stubLength: 12,
  laneSpacing: 8,
  laneCandidateCount: 3,
  minimumSegmentLength: 8,
  maximumAbsoluteDetour: 224,
  maximumRelativeDetour: 0.8,
  maximumRelevantObstacles: 96,
  maximumSearchVertices: 420,
  negotiatedIterations: 2,
  conflictSweepIterations: 4,
});

const LARGE_SCENE_MINIMUM_LEGS = 240;
const LARGE_SCENE_MINIMUM_OBSTACLES = 120;

/**
 * Selects only the browser resource budget; every scene keeps the same
 * orthogonal-scene-v1 geometry, objective, verifier, and failure semantics.
 */
export function routingPolicyForScene(scene: RoutingScene): RoutingPolicy {
  const large = scene.legs.length >= LARGE_SCENE_MINIMUM_LEGS ||
    scene.obstacles.length >= LARGE_SCENE_MINIMUM_OBSTACLES;
  return large ? {
    ...DEFAULT_ROUTING_POLICY,
    laneCandidateCount: 2,
    maximumRelevantObstacles: 56,
    maximumSearchVertices: 260,
    negotiatedIterations: 2,
    // Large authored layouts remain responsive and report unresolved capacity
    // honestly instead of running an unbounded rip-up pass on the UI thread.
    conflictSweepIterations: 0,
  } : DEFAULT_ROUTING_POLICY;
}

export type RoutingStatus =
  | "Optimal"
  | "Feasible"
  | "Unresolved"
  | "InvalidInput"
  | "Infeasible";

export interface PlannedRoute {
  legId: string;
  commodityId: string;
  points: readonly RoutePoint[];
  sourceStub: RoutePoint;
  targetStub: RoutePoint;
  locked: boolean;
  baselineLength: number;
  length: number;
  bends: number;
}

export interface RoutingObjective {
  unrouted: number;
  capacityViolations: number;
  crossings: number;
  maximumDetour: number;
  totalDetour: number;
  bends: number;
  shortSegments: number;
  signature: string;
}

export type RoutingDiagnosticCode =
  | "duplicate-id"
  | "invalid-geometry"
  | "invalid-gate"
  | "invalid-locked-route"
  | "capacity-conflict"
  | "search-limit"
  | "route-not-found"
  | "verification-failed";

export interface RoutingDiagnostic {
  code: RoutingDiagnosticCode;
  message: string;
  legId?: string;
  gateId?: string;
}

export interface RoutingCertificate {
  policyVersion: RoutingPolicy["version"];
  coordinateScale: number;
  deterministicInputSignature: string;
  proof: "single-commodity-visibility-optimal" | "bounded-feasible" | "none";
  verified: boolean;
  audit: RoutingAuditCoverage;
  objective: RoutingObjective;
}

export interface RoutingResult {
  status: RoutingStatus;
  routes: ReadonlyMap<string, PlannedRoute>;
  diagnostics: readonly RoutingDiagnostic[];
  certificate: RoutingCertificate;
}

export interface RoutingVerification {
  valid: boolean;
  diagnostics: readonly RoutingDiagnostic[];
  conflictingLegIds: readonly string[];
  audit: RoutingAuditCoverage;
  objective: RoutingObjective;
}

/** Exact coverage proof for exhaustive per-leg and unordered pair checks. */
export interface RoutingAuditCoverage {
  auditedLegIds: readonly string[];
  auditedPairCount: number;
}
