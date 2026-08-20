import type {
  CommittedRoutingComputationMode,
} from "./committedRoutingFrame";
import type { CommittedRoutingFrameMapPatch } from "./committedRoutingFramePatch";
import type { RouteJump } from "./routeInterface";
import type {
  PlannedRoute,
  RoutingPolicy,
  RoutingResult,
  RoutingScene,
} from "./routingScene";

export interface CommittedRoutingWorkerRequest {
  requestId: number;
  frameKey: string;
  scene: RoutingScene;
  previousFrameKey?: string;
  forceFull: boolean;
}

export interface CommittedRoutingWorkerResponse {
  requestId: number;
  frameKey: string;
  durationMs: number;
  mode: CommittedRoutingComputationMode;
  policy: RoutingPolicy;
  result: Omit<RoutingResult, "routes">;
  routePatch: CommittedRoutingFrameMapPatch<PlannedRoute>;
  routeJumpPatch: CommittedRoutingFrameMapPatch<readonly RouteJump[]>;
  affectedLegIds: readonly string[];
  neighborhoodLegIds: readonly string[];
}
