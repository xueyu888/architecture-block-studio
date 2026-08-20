import {
  computeCommittedRoutingSceneFrame,
  type CommittedRoutingSceneComputation,
  type PreviousCommittedRoutingFrame,
} from "./committedRoutingFrame";
import { planRouteJumps, reconcileRouteJumpReferences } from "./routeJumps";
import type { RouteJump } from "./routeInterface";
import type { RoutingScene } from "./routingScene";

export interface CommittedRoutingFrameStoreRequest {
  frameKey: string;
  scene: RoutingScene;
  previousFrameKey?: string;
  forceFull: boolean;
}

interface StoredCommittedRoutingFrame extends PreviousCommittedRoutingFrame {
  routeJumps: ReadonlyMap<string, readonly RouteJump[]>;
}

export interface StoredCommittedRoutingComputation extends CommittedRoutingSceneComputation {
  baseFrameKey?: string;
  previousRoutes?: PreviousCommittedRoutingFrame["result"]["routes"];
  previousRouteJumps?: ReadonlyMap<string, readonly RouteJump[]>;
  routeJumps: ReadonlyMap<string, readonly RouteJump[]>;
}

/**
 * Owns the Worker's bounded committed-frame history.
 *
 * The browser sends one current scene plus an opaque prior key. A missing or
 * evicted prior key safely falls back to a complete solve; cached routing
 * facts never cross into document ownership or weaken whole-scene
 * certification.
 */
export class CommittedRoutingFrameStore {
  private readonly frames = new Map<string, StoredCommittedRoutingFrame>();

  constructor(private readonly capacity = 4) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Committed routing frame capacity must be a positive integer.");
    }
  }

  compute(request: CommittedRoutingFrameStoreRequest): StoredCommittedRoutingComputation {
    const previous = request.previousFrameKey
      ? this.frames.get(request.previousFrameKey)
      : undefined;
    const computation = computeCommittedRoutingSceneFrame(
      request.scene,
      previous,
      request.forceFull,
    );
    const routeJumps = reconcileRouteJumpReferences(
      previous?.routeJumps ?? new Map(),
      planRouteJumps(computation.result.routes),
    );
    this.frames.delete(request.frameKey);
    this.frames.set(request.frameKey, {
      scene: request.scene,
      policy: computation.policy,
      result: computation.result,
      routeJumps,
    });
    while (this.frames.size > this.capacity) {
      const oldestKey = this.frames.keys().next().value;
      if (oldestKey === undefined) break;
      this.frames.delete(oldestKey);
    }
    return {
      ...computation,
      baseFrameKey: previous ? request.previousFrameKey : undefined,
      previousRoutes: previous?.result.routes,
      previousRouteJumps: previous?.routeJumps,
      routeJumps,
    };
  }
}
