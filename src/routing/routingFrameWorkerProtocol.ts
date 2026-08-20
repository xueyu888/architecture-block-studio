import type {
  CommittedRoutingWorkerRequest,
  CommittedRoutingWorkerResponse,
} from "./committedRoutingWorkerProtocol";
import type {
  LiveRoutingWorkerRequest,
  LiveRoutingWorkerResponse,
} from "./liveRoutingWorkerProtocol";

export type RoutingFrameWorkerRequest =
  | ({ kind: "committed" } & CommittedRoutingWorkerRequest)
  | ({ kind: "live" } & LiveRoutingWorkerRequest);

export type RoutingFrameWorkerResponse =
  | ({ kind: "committed" } & CommittedRoutingWorkerResponse)
  | ({ kind: "live" } & LiveRoutingWorkerResponse);
