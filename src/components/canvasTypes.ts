import type { Edge, Node } from "@xyflow/react";
import type { LayoutBlockNodeData, LayoutInterfaceEdgeData } from "../layout";
import type { BlockPort, ConnectionRouting } from "../model";
import type { PortPlacement } from "../layout";
import type { RoutePoint } from "../routing";

export interface CanvasBlockNodeData extends LayoutBlockNodeData {
  toggleHierarchy: (levelId: string) => void;
  inspectPort: (nodeId: string, port: BlockPort) => void;
  renameNode?: (title: string) => boolean;
  titleEditRequest?: number;
  acknowledgeTitleEditRequest?: (revision: number) => void;
  beginResize?: () => void;
  previewResize?: (geometry: NodeResizeGeometry, disableSnap: boolean) => void;
  resizeNode?: (geometry: NodeResizeGeometry, disableSnap: boolean) => boolean;
  canEditSelection?: () => boolean;
  beginPortMove?: (portId: string) => boolean;
  previewPortMove?: (portId: string, placement: PortPlacement) => void;
  movePort?: (portId: string, placement: PortPlacement) => boolean;
  cancelPortMove?: () => void;
}

export interface NodeResizeGeometry {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface CanvasInterfaceEdgeData extends LayoutInterfaceEdgeData {
  plannedRoute?: readonly RoutePoint[];
  simplifiedInteraction?: boolean;
  canEditSelection?: () => boolean;
  updateRouting?: (routing: ConnectionRouting | undefined) => boolean;
  requestRouteHandleFocus?: (handle: RouteHandleFocusTarget) => void;
}

export type RouteHandleFocusTarget =
  | { kind: "segment"; axis: "h" | "v"; coordinate: number; index: number }
  | { kind: "bend"; index: number; point: RoutePoint };

export type CanvasFlowNode = Node<CanvasBlockNodeData, "block">;
export type CanvasFlowEdge = Edge<CanvasInterfaceEdgeData, "interface">;
