import type {
  CommittedRoutingComputation,
  PreviousCommittedRoutingFrame,
} from "./committedRoutingFrame";
import type { RoutingLayoutProjection } from "./layoutSceneAdapter";
import type { RouteJump } from "./routeInterface";

export interface CommittedRoutingWorkerRequest {
  requestId: number;
  frameKey: string;
  layoutProjection: RoutingLayoutProjection;
  previous?: PreviousCommittedRoutingFrame;
  forceFull: boolean;
}

export interface CommittedRoutingWorkerResponse extends Omit<CommittedRoutingComputation, "layoutProjection"> {
  requestId: number;
  frameKey: string;
  durationMs: number;
  routeJumps: ReadonlyMap<string, readonly RouteJump[]>;
}
