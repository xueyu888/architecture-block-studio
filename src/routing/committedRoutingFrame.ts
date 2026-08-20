import type { LayoutResult } from "../layout";
import { createRoutingLayoutProjectionFromLayout, type RoutingLayoutProjection } from "./layoutSceneAdapter";
import { solveLiveRoutingPreview } from "./liveRoutingPreview";
import { certifyRoutingSceneRoutes, solveRoutingScene } from "./sceneRouter";
import {
  routingPolicyForScene,
  type PlannedRoute,
  type RoutingPolicy,
  type RoutingResult,
  type RoutingScene,
} from "./routingScene";

export type CommittedRoutingComputationMode = "full" | "rebased" | "retained";

export interface PreviousCommittedRoutingFrame {
  scene: RoutingScene;
  policy: RoutingPolicy;
  result: RoutingResult;
}

export interface CommittedRoutingComputation {
  mode: CommittedRoutingComputationMode;
  layoutProjection: RoutingLayoutProjection;
  policy: RoutingPolicy;
  result: RoutingResult;
  affectedLegIds: readonly string[];
  neighborhoodLegIds: readonly string[];
}

export type CommittedRoutingSceneComputation = Omit<
  CommittedRoutingComputation,
  "layoutProjection"
>;

let nextLayoutIdentity = 1;
const layoutIdentities = new WeakMap<LayoutResult, number>();

/** A process-local token for pairing one disposable layout with one route revision. */
export function committedRoutingFrameKey(layout: LayoutResult, routeRevision: number): string {
  let identity = layoutIdentities.get(layout);
  if (identity === undefined) {
    identity = nextLayoutIdentity;
    nextLayoutIdentity += 1;
    layoutIdentities.set(layout, identity);
  }
  return `${identity}:${routeRevision}`;
}

function samePolicy(left: RoutingPolicy, right: RoutingPolicy): boolean {
  return Object.keys(left).every((key) => (
    left[key as keyof RoutingPolicy] === right[key as keyof RoutingPolicy]
  ));
}

function sameScene(left: RoutingScene, right: RoutingScene): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameRoute(left: PlannedRoute | undefined, right: PlannedRoute): boolean {
  return Boolean(left &&
    left.legId === right.legId && left.commodityId === right.commodityId &&
    left.locked === right.locked && left.baselineLength === right.baselineLength &&
    left.length === right.length && left.bends === right.bends &&
    left.sourceStub.x === right.sourceStub.x && left.sourceStub.y === right.sourceStub.y &&
    left.targetStub.x === right.targetStub.x && left.targetStub.y === right.targetStub.y &&
    left.points.length === right.points.length && left.points.every((point, index) =>
      point.x === right.points[index].x && point.y === right.points[index].y
    ));
}

/** Preserves route and map identities for every geometrically unchanged leg. */
export function reconcileRoutingRouteReferences(
  previous: ReadonlyMap<string, PlannedRoute>,
  next: ReadonlyMap<string, PlannedRoute>,
): ReadonlyMap<string, PlannedRoute> {
  let changed = previous.size !== next.size;
  const routes = new Map([...next].map(([id, route]) => {
    const prior = previous.get(id);
    const resolved = sameRoute(prior, route) ? prior! : route;
    if (resolved !== prior) changed = true;
    return [id, resolved] as const;
  }));
  return changed ? routes : previous;
}

/** Preserves the complete result contract while reconciling disposable route references. */
export function reconcileRoutingResultReferences(
  previous: RoutingResult | undefined,
  next: RoutingResult,
): RoutingResult {
  if (!previous) return next;
  return {
    ...next,
    routes: reconcileRoutingRouteReferences(previous.routes, next.routes),
  };
}

/**
 * Computes one complete committed route frame.
 *
 * Normal edits rebase only the affected routing neighborhood on the previous
 * certified scene, then independently certify the complete candidate set.
 * Explicit route optimization and policy transitions run the full solver.
 */
export function computeCommittedRoutingFrame(
  layout: LayoutResult,
  previous?: PreviousCommittedRoutingFrame,
  forceFull = false,
): CommittedRoutingComputation {
  const layoutProjection = createRoutingLayoutProjectionFromLayout(layout.nodes, layout.edges);
  return computeCommittedRoutingProjectionFrame(layoutProjection, previous, forceFull);
}

/** Computes a committed frame from the already-derived routing projection. */
export function computeCommittedRoutingProjectionFrame(
  layoutProjection: RoutingLayoutProjection,
  previous?: PreviousCommittedRoutingFrame,
  forceFull = false,
): CommittedRoutingComputation {
  return {
    layoutProjection,
    ...computeCommittedRoutingSceneFrame(layoutProjection.scene, previous, forceFull),
  };
}

/** Computes the certifiable routing facts without transporting Canvas-only projection data. */
export function computeCommittedRoutingSceneFrame(
  scene: RoutingScene,
  previous?: PreviousCommittedRoutingFrame,
  forceFull = false,
): CommittedRoutingSceneComputation {
  const policy = routingPolicyForScene(scene);
  if (!previous || forceFull || !samePolicy(previous.policy, policy)) {
    return {
      mode: "full",
      policy,
      result: solveRoutingScene(scene, policy),
      affectedLegIds: scene.legs.map((leg) => leg.id).sort(),
      neighborhoodLegIds: scene.legs.map((leg) => leg.id).sort(),
    };
  }

  if (sameScene(previous.scene, scene)) {
    return {
      mode: "retained",
      policy,
      result: previous.result,
      affectedLegIds: [],
      neighborhoodLegIds: [],
    };
  }

  const preview = solveLiveRoutingPreview(
    previous.scene,
    scene,
    previous.result,
    policy,
  );
  return {
    mode: "rebased",
    policy,
    result: certifyRoutingSceneRoutes(scene, preview.routes, policy),
    affectedLegIds: preview.affectedLegIds,
    neighborhoodLegIds: preview.neighborhoodLegIds,
  };
}
