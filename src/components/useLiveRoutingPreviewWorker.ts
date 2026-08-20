import { useEffect, useRef, useState } from "react";
import type {
  LiveRoutingWorkerRequest,
  LiveRoutingWorkerResponse,
} from "../routing/liveRoutingWorkerProtocol";

export type LiveRoutingWorkerInput = Omit<LiveRoutingWorkerRequest, "requestId">;

export interface LiveRoutingWorkerState {
  status: "idle" | "pending" | "ready" | "failed";
  response?: LiveRoutingWorkerResponse;
}

/**
 * Runs large disposable routing frames outside the browser UI thread.
 *
 * At most one request is in flight. Pointer updates replace one latest slot;
 * after a result returns, stale geometry is dropped and only the newest frame
 * is dispatched. The worker never writes document state or commits history.
 */
export function useLiveRoutingPreviewWorker(
  input: LiveRoutingWorkerInput | undefined,
): LiveRoutingWorkerState {
  const workerRef = useRef<Worker | undefined>(undefined);
  const latestRef = useRef<LiveRoutingWorkerRequest | undefined>(undefined);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const pumpRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState<LiveRoutingWorkerState>({ status: "idle" });

  pumpRef.current = () => {
    const worker = workerRef.current;
    const latest = latestRef.current;
    if (!worker || !latest || inFlightRef.current) return;
    inFlightRef.current = true;
    worker.postMessage(latest);
  };

  useEffect(() => {
    const worker = new Worker(
      new URL("../routing/liveRoutingWorker.ts", import.meta.url),
      { type: "module", name: "architecture-live-routing" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<LiveRoutingWorkerResponse>) => {
      inFlightRef.current = false;
      const response = event.data;
      const latest = latestRef.current;
      if (latest?.requestId === response.requestId &&
        latest.geometrySignature === response.geometrySignature) {
        setState({ status: "ready", response });
      }
      pumpRef.current();
    };
    worker.onerror = () => {
      inFlightRef.current = false;
      setState({ status: "failed" });
    };
    pumpRef.current();
    return () => {
      latestRef.current = undefined;
      inFlightRef.current = false;
      workerRef.current = undefined;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    if (!input) {
      latestRef.current = undefined;
      setState({ status: "idle" });
      return;
    }
    requestIdRef.current += 1;
    latestRef.current = { ...input, requestId: requestIdRef.current };
    setState((current) => current.response?.geometrySignature === input.geometrySignature
      ? current
      : { status: "pending" });
    pumpRef.current();
  }, [input]);

  return state;
}
