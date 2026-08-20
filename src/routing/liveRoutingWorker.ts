import { solveLiveRoutingPreview } from "./liveRoutingPreview";
import type { LiveRoutingWorkerRequest, LiveRoutingWorkerResponse } from "./liveRoutingWorkerProtocol";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<LiveRoutingWorkerRequest>) => void) | null;
  postMessage(message: LiveRoutingWorkerResponse): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  const startedAt = performance.now();
  const preview = solveLiveRoutingPreview(
    request.committedScene,
    request.liveScene,
    request.committedResult,
    request.policy,
  );
  workerScope.postMessage({
    requestId: request.requestId,
    geometrySignature: request.geometrySignature,
    preview,
    durationMs: performance.now() - startedAt,
  });
};
