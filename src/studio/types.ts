import type { Edge, Node } from "@xyflow/react";
import type {
  BlockConnection,
  BlockNode,
  BlockPort,
  InterfaceDefinition,
  InterfaceKind,
} from "../model";

export type SelectionRef =
  | { kind: "document" }
  | { kind: "level"; levelId: string }
  | { kind: "node"; levelId: string; nodeId: string }
  | { kind: "port"; levelId: string; nodeId: string; portId: string }
  | { kind: "connection"; levelId: string; connectionId: string };

export interface BlockNodeData extends Record<string, unknown> {
  block: BlockNode;
  levelId: string;
  expanded: boolean;
  hierarchyDepth: number;
  toggleHierarchy?: (levelId: string) => void;
  inspectPort?: (nodeId: string, port: BlockPort) => void;
}

export interface InterfaceEdgeData extends Record<string, unknown> {
  connection: BlockConnection;
  levelId: string;
  definition: InterfaceDefinition;
  kind: InterfaceKind;
  label: string;
  showLabel: boolean;
  boundaryContinuation: boolean;
  inspect: () => void;
}

export type StudioFlowNode = Node<BlockNodeData, "block">;
export type StudioFlowEdge = Edge<InterfaceEdgeData, "interface">;

export interface LayoutResult {
  nodes: StudioFlowNode[];
  edges: StudioFlowEdge[];
}
