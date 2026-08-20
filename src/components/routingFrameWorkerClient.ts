import type {
  RoutingFrameWorkerRequest,
  RoutingFrameWorkerResponse,
} from "../routing/routingFrameWorkerProtocol";
import RoutingFrameWorker from "../routing/routingFrameWorker?worker&inline";

export interface RoutingFrameWorkerListener {
  onMessage(response: RoutingFrameWorkerResponse): void;
  onError(): void;
}

export interface RoutingFrameWorkerLease {
  post(request: RoutingFrameWorkerRequest): void;
  release(): void;
}

const listeners = new Map<symbol, RoutingFrameWorkerListener>();
let sharedWorker: Worker | undefined;
let pendingTermination: ReturnType<typeof setTimeout> | undefined;

function ensureWorker(): Worker {
  if (pendingTermination !== undefined) {
    clearTimeout(pendingTermination);
    pendingTermination = undefined;
  }
  if (sharedWorker) return sharedWorker;
  const worker = new RoutingFrameWorker({ name: "architecture-routing-frames" });
  sharedWorker = worker;
  worker.onmessage = (event: MessageEvent<RoutingFrameWorkerResponse>) => {
    listeners.forEach((listener) => listener.onMessage(event.data));
  };
  worker.onerror = () => {
    worker.terminate();
    if (sharedWorker === worker) sharedWorker = undefined;
    listeners.forEach((listener) => listener.onError());
  };
  return worker;
}

/** One Worker process is shared by the live and committed routing channels. */
export function acquireRoutingFrameWorker(listener: RoutingFrameWorkerListener): RoutingFrameWorkerLease {
  const token = Symbol("routing-frame-worker-listener");
  listeners.set(token, listener);
  ensureWorker();
  let released = false;
  return {
    post: (request) => {
      if (released) return;
      ensureWorker().postMessage(request);
    },
    release: () => {
      if (released) return;
      released = true;
      listeners.delete(token);
      if (listeners.size !== 0 || pendingTermination !== undefined) return;
      pendingTermination = setTimeout(() => {
        pendingTermination = undefined;
        if (listeners.size !== 0) return;
        sharedWorker?.terminate();
        sharedWorker = undefined;
      }, 0);
    },
  };
}
