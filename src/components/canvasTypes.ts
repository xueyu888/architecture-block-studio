import type { Edge, Node } from "@xyflow/react";
import type { LayoutBlockNodeData, LayoutInterfaceEdgeData } from "../layout";
import type { BlockPort, ConnectionRouting } from "../model";

export interface CanvasBlockNodeData extends LayoutBlockNodeData {
  toggleHierarchy: (levelId: string) => void;
  inspectPort: (nodeId: string, port: BlockPort) => void;
  beginResize?: () => void;
  previewResize?: (geometry: NodeResizeGeometry, disableSnap: boolean) => void;
  resizeNode?: (geometry: NodeResizeGeometry, disableSnap: boolean) => boolean;
  canEditSelection?: () => boolean;
}

export interface NodeResizeGeometry {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface CanvasInterfaceEdgeData extends LayoutInterfaceEdgeData {
  routeRevision?: number;
  largeGraph?: boolean;
  laneOffset?: number;
  separateSourceEndpoint?: boolean;
  separateTargetEndpoint?: boolean;
  canEditSelection?: () => boolean;
  updateRouting?: (routing: ConnectionRouting | undefined) => boolean;
  requestRouteHandleFocus?: (handle: RouteHandleFocusTarget) => void;
}

export type RouteHandleFocusTarget =
  | { kind: "segment"; axis: "h" | "v"; coordinate: number; index: number }
  | { kind: "bend"; index: number };

export type CanvasFlowNode = Node<CanvasBlockNodeData, "block">;
export type CanvasFlowEdge = Edge<CanvasInterfaceEdgeData, "interface">;
