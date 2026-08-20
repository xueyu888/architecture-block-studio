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
  /** Authored position from the document or deterministic unplaced fallback. */
  designPosition: { x: number; y: number };
  /** Collision-free top-left projected in the owning Level coordinate system. */
  projectedPosition: { x: number; y: number };
  positionEditable: boolean;
  childLevelProjection?: LayoutChildLevelProjection;
}

export interface LayoutChildLevelProjection {
  levelId: string;
  title: string;
  hierarchyDepth: number;
  /** Child design origin in the expanded owner node's local flow coordinates. */
  designOrigin: { x: number; y: number };
  /** Stable minimum authored coordinate for direct manipulation in this projection. */
  coordinateOrigin: { x: number; y: number };
  /** Visible child-design drop surface in the owner node's local flow coordinates. */
  dropBounds: { x: number; y: number; width: number; height: number };
}

export interface LayoutInterfaceEdgeData extends Record<string, unknown> {
  connection: BlockConnection;
  /** Stable identity shared by every visible leg of one logical connection. */
  commodityId: string;
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
