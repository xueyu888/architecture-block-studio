import { CheckCircle2, CircleAlert, MousePointer2, XCircle } from "lucide-react";
import { Panel, useConnection, type ConnectionLineComponentProps } from "@xyflow/react";
import type { ConnectablePortEndpoint } from "../model";
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

type PointerTargetStatus = "searching" | "valid" | "invalid";

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
      detail: `Release to ${verb}. The interface direction remains output → input.`,
    };
  }
  if (status === "invalid") {
    return {
      title: "That port is not compatible",
      detail: "Choose a port on the same design level with a compatible direction.",
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
  const status = useConnection<CanvasFlowNode, PointerTargetStatus>((connection) => {
    if (!connection.inProgress || !connection.toHandle) return "searching";
    return connection.isValid ? "valid" : "invalid";
  });
  const copy = statusCopy(gesture, status);
  const Icon = status === "valid" ? CheckCircle2 : status === "invalid" ? XCircle : MousePointer2;
  return (
    <Panel
      className={`bd-connection-gesture-panel nokey is-${status}`}
      position="top-right"
      data-connection-mode={gesture.kind}
      data-connection-status={status}
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
        <span>{candidateCount} compatible {candidateCount === 1 ? "port" : "ports"}</span>
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

/** Connection creation has the same geometry rule as an automatic edge: one direct segment. */
export function ConnectionGesturePreview({
  fromX,
  fromY,
  toX,
  toY,
  connectionStatus,
  fromNode,
  toNode,
}: ConnectionLineComponentProps<CanvasFlowNode>) {
  const status = connectionStatus ?? "searching";
  const path = `M ${fromX}, ${fromY} L ${toX}, ${toY}`;
  return (
    <g
      className={`bd-connection-preview is-${status}`}
      data-connection-status={status}
      data-preview-point-count="2"
      data-preview-points={JSON.stringify([{ x: fromX, y: fromY }, { x: toX, y: toY }])}
      data-preview-source-node-id={fromNode.id}
      data-preview-target-node-id={toNode?.id ?? ""}
    >
      <path className="bd-connection-preview-underlay" d={path} aria-hidden="true" />
      <path className="bd-connection-preview-path" d={path} aria-hidden="true" />
      <circle className="bd-connection-preview-pointer" cx={toX} cy={toY} r={4.5} aria-hidden="true" />
    </g>
  );
}
