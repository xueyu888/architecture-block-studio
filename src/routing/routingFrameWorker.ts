import { computeCommittedRoutingProjectionFrame } from "./committedRoutingFrame";
import { solveLiveRoutingPreview } from "./liveRoutingPreview";
import { planRouteJumps } from "./routeJumps";
import type {
  RoutingFrameWorkerRequest,
  RoutingFrameWorkerResponse,
} from "./routingFrameWorkerProtocol";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RoutingFrameWorkerRequest>) => void) | null;
  postMessage(message: RoutingFrameWorkerResponse): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  const startedAt = performance.now();
  if (request.kind === "live") {
    const preview = solveLiveRoutingPreview(
      request.committedScene,
      request.liveScene,
      request.committedResult,
      request.policy,
    );
    const routeJumps = planRouteJumps(preview.routes);
    workerScope.postMessage({
      kind: "live",
      requestId: request.requestId,
      geometrySignature: request.geometrySignature,
      preview,
      routeJumps,
      durationMs: performance.now() - startedAt,
    });
    return;
  }

  const computation = computeCommittedRoutingProjectionFrame(
    request.layoutProjection,
    request.previous,
    request.forceFull,
  );
  const routeJumps = planRouteJumps(computation.result.routes);
  const { layoutProjection: _layoutProjection, ...responseComputation } = computation;
  workerScope.postMessage({
    kind: "committed",
    requestId: request.requestId,
    frameKey: request.frameKey,
    durationMs: performance.now() - startedAt,
    routeJumps,
    ...responseComputation,
  });
};
