import type { Edge, Node } from "@xyflow/react";
import type {
  BlockConnection,
  BlockNode,
  InterfaceDefinition,
  InterfaceKind,
} from "../model";

export interface LayoutBlockNodeData extends Record<string, unknown> {
  block: BlockNode;
  levelId: string;
  expanded: boolean;
  hierarchyDepth: number;
  designPosition: { x: number; y: number };
  positionEditable: boolean;
}

export interface LayoutInterfaceEdgeData extends Record<string, unknown> {
  connection: BlockConnection;
  levelId: string;
  definition: InterfaceDefinition;
  kind: InterfaceKind;
  boundaryContinuation: boolean;
  boundaryNodeId?: string;
}

export type LayoutFlowNode = Node<LayoutBlockNodeData, "block">;
export type LayoutFlowEdge = Edge<LayoutInterfaceEdgeData, "interface">;

export interface LayoutResult {
  nodes: LayoutFlowNode[];
  edges: LayoutFlowEdge[];
}
