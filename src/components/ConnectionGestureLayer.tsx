import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, CircleAlert, MousePointer2, XCircle } from "lucide-react";
import {
  Panel,
  useConnection,
  type ConnectionLineComponentProps,
} from "@xyflow/react";
import type { ConnectablePortEndpoint } from "../model";
import {
  drawOrthogonalRoute,
  solveConnectionPreview,
  type ConnectionPreviewResult,
  type RoutingPolicy,
  type RoutingPreviewEnvironment,
} from "../routing";
import type { CanvasFlowNode } from "./canvasTypes";

export interface ActiveConnectionGesture {
  kind: "create" | "reconnect";
  origin: ConnectablePortEndpoint;
}

export interface ConnectionGestureFeedback {
  revision: number;
  tone: "success" | "warning" | "error";
  title: string;
  detail: string;
}

interface PreviewRuntimeReport {
  requestKey: string;
  status: ConnectionPreviewResult["status"];
  durationMs: number;
  obstacleCount: number;
  pointCount: number;
}

interface PreviewRuntimeState extends PreviewRuntimeReport {
  environment: RoutingPreviewEnvironment;
  gesture?: ActiveConnectionGesture;
  peakDurationMs: number;
  solveCount: number;
}

interface ConnectionPreviewRuntime {
  environment: RoutingPreviewEnvironment;
  policy: RoutingPolicy;
  state?: PreviewRuntimeState;
  report: (report: PreviewRuntimeReport) => void;
}

const ConnectionPreviewContext = createContext<ConnectionPreviewRuntime | undefined>(undefined);

export function ConnectionGesturePreviewProvider({
  environment,
  policy,
  gesture,
  children,
}: {
  environment: RoutingPreviewEnvironment;
  policy: RoutingPolicy;
  gesture?: ActiveConnectionGesture;
  children: ReactNode;
}) {
  const [state, setState] = useState<PreviewRuntimeState>();
  const report = useCallback((next: PreviewRuntimeReport) => {
    setState((current) => {
      const sameGesture = current?.environment === environment && current.gesture === gesture;
      return {
        ...next,
        environment,
        gesture,
        peakDurationMs: Math.max(sameGesture ? current.peakDurationMs : 0, next.durationMs),
        solveCount: (sameGesture ? current.solveCount : 0) + 1,
      };
    });
  }, [environment, gesture]);
  const currentState = state?.environment === environment && state.gesture === gesture
    ? state
    : undefined;
  const value = useMemo<ConnectionPreviewRuntime>(() => ({
    environment,
    policy,
    state: currentState,
    report,
  }), [currentState, environment, policy, report]);
  return <ConnectionPreviewContext.Provider value={value}>{children}</ConnectionPreviewContext.Provider>;
}

type PointerTargetStatus = "searching" | "valid" | "invalid" | "blocked";

function requiredPortDescription(direction: ConnectablePortEndpoint["direction"]): string {
  if (direction === "input") return "an output or bidirectional port";
  if (direction === "output") return "an input or bidirectional port";
  return "another compatible port";
}

function statusCopy(
  gesture: ActiveConnectionGesture,
  status: PointerTargetStatus,
): { title: string; detail: string } {
  const verb = gesture.kind === "reconnect" ? "reconnect" : "connect";
  if (status === "valid") {
    return {
      title: `Ready to ${verb}`,
      detail: `Release to ${verb}. The committed interface direction remains output → input.`,
    };
  }
  if (status === "invalid") {
    return {
      title: "That port is not compatible",
      detail: "Choose a different port on the same design level with a compatible direction.",
    };
  }
  if (status === "blocked") {
    return {
      title: "No clear preview route",
      detail: "Move the pointer or modules. Release still uses the full routing check.",
    };
  }
  return {
    title: `Choose ${requiredPortDescription(gesture.origin.direction)}`,
    detail: "Green ports are compatible. The preview is temporary until you release.",
  };
}

export function ConnectionGesturePanel({
  gesture,
  candidateCount,
}: {
  gesture: ActiveConnectionGesture;
  candidateCount: number;
}) {
  const preview = useContext(ConnectionPreviewContext)?.state;
  const status = useConnection<CanvasFlowNode, PointerTargetStatus>((connection) => {
    if (!connection.inProgress || !connection.toHandle) return "searching";
    return connection.isValid ? "valid" : "invalid";
  });
  const effectiveStatus: PointerTargetStatus = status !== "invalid" && preview && preview.status !== "routed"
    ? "blocked"
    : status;
  const copy = statusCopy(gesture, effectiveStatus);
  const Icon = effectiveStatus === "valid" ? CheckCircle2
    : effectiveStatus === "invalid" ? XCircle
      : effectiveStatus === "blocked" ? CircleAlert
        : MousePointer2;
  return (
    <Panel
      className={`bd-connection-gesture-panel nokey is-${effectiveStatus}`}
      position="top-right"
      data-connection-mode={gesture.kind}
      data-connection-status={effectiveStatus}
      data-preview-routing-status={preview?.status ?? "pending"}
      data-preview-obstacle-count={preview?.obstacleCount ?? 0}
      data-preview-duration-ms={preview?.durationMs.toFixed(2) ?? "0"}
      data-preview-peak-duration-ms={preview?.peakDurationMs.toFixed(2) ?? "0"}
      data-preview-solve-count={preview?.solveCount ?? 0}
      data-preview-route-point-count={preview?.pointCount ?? 0}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="bd-connection-gesture-icon"><Icon size={15} aria-hidden="true" /></span>
      <span className="bd-connection-gesture-copy">
        <small>{gesture.kind === "reconnect" ? "RECONNECT ENDPOINT" : "CONNECT PORTS"}</small>
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </span>
      <span className="bd-connection-gesture-meta">
        <span>
          {candidateCount} compatible {candidateCount === 1 ? "port" : "ports"}
          {preview ? ` · ${preview.obstacleCount} obstacles` : ""}
        </span>
        <kbd>Esc</kbd><span>cancel</span>
      </span>
    </Panel>
  );
}

export function ConnectionGestureFeedbackPanel({ feedback }: { feedback: ConnectionGestureFeedback }) {
  const Icon = feedback.tone === "success" ? CheckCircle2
    : feedback.tone === "error" ? XCircle
      : CircleAlert;
  return (
    <Panel
      className={`bd-connection-feedback nokey is-${feedback.tone}`}
      position="top-right"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon size={14} aria-hidden="true" />
      <span><strong>{feedback.title}</strong><small>{feedback.detail}</small></span>
    </Panel>
  );
}

export function ConnectionGesturePreview({
  toX,
  toY,
  connectionStatus,
  fromNode,
  fromHandle,
  toNode,
  toHandle,
}: ConnectionLineComponentProps<CanvasFlowNode>) {
  const runtime = useContext(ConnectionPreviewContext);
  if (!runtime) throw new Error("ConnectionGesturePreview requires ConnectionGesturePreviewProvider.");
  const targetAttached = Boolean(toHandle && toNode);
  const fromNodeId = fromNode.id;
  const fromHandleId = fromHandle.id ?? "";
  const toNodeId = toNode?.id;
  const toHandleId = toHandle?.id;
  const requestKey = [
    fromNodeId,
    fromHandleId,
    toNodeId ?? "pointer",
    toHandleId ?? "",
    toX,
    toY,
  ].join(":");
  const calculation = useMemo(() => {
    const startedAt = performance.now();
    const result = solveConnectionPreview(runtime.environment, {
      source: {
        nodeId: fromNodeId,
        handleId: fromHandleId,
      },
      target: targetAttached
        ? {
            kind: "attached",
            nodeId: toNodeId!,
            handleId: toHandleId ?? "",
          }
        : { kind: "pointer", point: { x: toX, y: toY } },
    }, runtime.policy);
    return { result, durationMs: performance.now() - startedAt };
  }, [
    fromHandleId,
    fromNodeId,
    runtime.environment,
    runtime.policy,
    targetAttached,
    toHandleId,
    toNodeId,
    toX,
    toY,
  ]);
  useLayoutEffect(() => {
    runtime.report({
      requestKey,
      status: calculation.result.status,
      durationMs: calculation.durationMs,
      obstacleCount: calculation.result.obstacleCount,
      pointCount: calculation.result.points.length,
    });
  }, [calculation, requestKey, runtime.report]);
  const points = calculation.result.points;
  const path = drawOrthogonalRoute(points);
  const status = connectionStatus ?? "searching";
  const pointer = targetAttached && points.length > 0 ? points.at(-1)! : { x: toX, y: toY };
  return (
    <g
      className={`bd-connection-preview is-${status} is-routing-${calculation.result.status}`}
      data-connection-status={status}
      data-preview-routing-status={calculation.result.status}
      data-preview-point-count={points.length}
      data-preview-points={JSON.stringify(points)}
      data-preview-source-node-id={fromNodeId}
      data-preview-target-node-id={toNodeId ?? ""}
      data-preview-obstacle-count={calculation.result.obstacleCount}
      data-preview-duration-ms={calculation.durationMs.toFixed(2)}
    >
      <path className="bd-connection-preview-underlay" d={path} aria-hidden="true" />
      <path className="bd-connection-preview-path" d={path} aria-hidden="true" />
      <circle className="bd-connection-preview-pointer" cx={pointer.x} cy={pointer.y} r={4.5} aria-hidden="true" />
    </g>
  );
}
