import type { Edge, Node } from "@xyflow/react";
import type { LayoutBlockNodeData, LayoutInterfaceEdgeData } from "../layout";
import type { BlockPort, ConnectionRouting } from "../model";

export interface CanvasBlockNodeData extends LayoutBlockNodeData {
  toggleHierarchy: (levelId: string) => void;
  inspectPort: (nodeId: string, port: BlockPort) => void;
}

export interface CanvasInterfaceEdgeData extends LayoutInterfaceEdgeData {
  routeRevision?: number;
  largeGraph?: boolean;
  laneOffset?: number;
  separateSourceEndpoint?: boolean;
  separateTargetEndpoint?: boolean;
  updateRouting?: (routing: ConnectionRouting | undefined) => boolean;
  requestRouteHandleFocus?: (axis: "h" | "v", coordinate: number, segmentIndex: number) => void;
}

export type CanvasFlowNode = Node<CanvasBlockNodeData, "block">;
export type CanvasFlowEdge = Edge<CanvasInterfaceEdgeData, "interface">;
