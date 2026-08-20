import type { LiveRoutingPreview } from "./liveRoutingPreview";
import type { RouteJump } from "./routeInterface";
import type { RoutingPolicy, RoutingResult, RoutingScene } from "./routingScene";

export interface LiveRoutingWorkerRequest {
  requestId: number;
  geometrySignature: string;
  committedScene: RoutingScene;
  liveScene: RoutingScene;
  committedResult: RoutingResult;
  policy: RoutingPolicy;
}

export interface LiveRoutingWorkerResponse {
  requestId: number;
  geometrySignature: string;
  preview: LiveRoutingPreview;
  routeJumps: ReadonlyMap<string, readonly RouteJump[]>;
  durationMs: number;
}
