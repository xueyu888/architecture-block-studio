import { useEffect, useRef, useState } from "react";
import type {
  CommittedRoutingWorkerRequest,
  CommittedRoutingWorkerResponse,
} from "../routing/committedRoutingWorkerProtocol";
import { LatestWorkerRequestQueue } from "./latestWorkerRequestQueue";
import {
  acquireRoutingFrameWorker,
  type RoutingFrameWorkerLease,
} from "./routingFrameWorkerClient";

export type CommittedRoutingWorkerInput = Omit<CommittedRoutingWorkerRequest, "requestId">;

export interface CommittedRoutingWorkerState {
  status: "idle" | "pending" | "ready" | "failed";
  response?: CommittedRoutingWorkerResponse;
}

/**
 * Serializes committed route-frame work through one latest-only Worker.
 *
 * One request may be executing while newer document projections replace a
 * single waiting slot. Only the response paired with the current frame key is
 * published; stale results never become visible or mutate editor state.
 */
export function useCommittedRoutingWorker(
  input: CommittedRoutingWorkerInput | undefined,
): CommittedRoutingWorkerState {
  const workerLeaseRef = useRef<RoutingFrameWorkerLease | undefined>(undefined);
  const queueRef = useRef(new LatestWorkerRequestQueue<CommittedRoutingWorkerRequest>());
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const pumpRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState<CommittedRoutingWorkerState>({ status: "idle" });

  useEffect(() => {
    workerLeaseRef.current = acquireRoutingFrameWorker({
      onMessage: (response) => {
        if (response.kind !== "committed") return;
        inFlightRef.current = false;
        if (queueRef.current.accepts(response.requestId)) {
          setState({ status: "ready", response });
        }
        pumpRef.current();
      },
      onError: () => {
        inFlightRef.current = false;
        setState({ status: "failed" });
      },
    });
    pumpRef.current();
    return () => {
      queueRef.current.clear();
      inFlightRef.current = false;
      workerLeaseRef.current?.release();
      workerLeaseRef.current = undefined;
    };
  }, []);

  pumpRef.current = () => {
    if (inFlightRef.current) return;
    const workerLease = workerLeaseRef.current;
    if (!workerLease) return;
    const queued = queueRef.current.takeQueued();
    if (!queued) return;
    inFlightRef.current = true;
    workerLease.post({ kind: "committed", ...queued });
  };

  useEffect(() => {
    if (!input) {
      queueRef.current.clear();
      setState({ status: "idle" });
      return;
    }
    requestIdRef.current += 1;
    const request = { ...input, requestId: requestIdRef.current };
    queueRef.current.replace(request);
    setState({ status: "pending" });
    pumpRef.current();
  }, [input]);

  return state;
}
