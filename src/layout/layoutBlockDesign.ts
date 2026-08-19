import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk.bundled.js";
import type {
  BlockConnection,
  BlockDesignDocument,
  BlockNode,
  BlockPort,
  DesignLevel,
  PortSide,
} from "../model";
import { baseNodeDimensions, type NodeDimensions } from "./nodeGeometry";
import type { LayoutFlowEdge, LayoutFlowNode, LayoutResult } from "./types";

let elkPromise: Promise<ELK> | undefined;

function getElk(): Promise<ELK> {
  elkPromise ??= import("elkjs/lib/elk.bundled.js").then(
    ({ default: ElkConstructor }) => new ElkConstructor(),
  );
  return elkPromise;
}

const CONTAINER_PADDING_X = 72;
const CONTAINER_PADDING_TOP = 68;
const CONTAINER_PADDING_BOTTOM = 54;

type Dimensions = NodeDimensions;

interface Bounds extends Dimensions {
  minX: number;
  minY: number;
}

interface PositionedNode extends Dimensions {
  node: BlockNode;
  x: number;
  y: number;
  expanded: boolean;
  child?: ComposedLevel;
}

interface ComposedLevel {
  nodes: LayoutFlowNode[];
  edges: LayoutFlowEdge[];
  bounds: Bounds;
  directNodeIds: Map<string, string>;
}

export type PlacementMode = "authored" | "automatic";

export interface LayoutBlockDesignOptions {
  expandedLevelIds: ReadonlySet<string>;
  placementMode: PlacementMode;
}

export function innerPortId(portId: string): string {
  return `__inner__${portId}`;
}

export function bindingPortId(portId: string): string {
  return `__binding__${portId}`;
}

function flowNodeId(instancePath: string, nodeId: string): string {
  return `${instancePath}::${nodeId}`;
}

function flowEdgeId(instancePath: string, connectionId: string): string {
  return `${instancePath}::${connectionId}`;
}

function bindingEdgeId(instancePath: string, nodeId: string, connectionId: string): string {
  return `${instancePath}::${nodeId}::binding::${connectionId}`;
}

function elkPortId(nodeId: string, portId: string): string {
  return `${nodeId}::${portId}`;
}

function elkSide(side: PortSide): "WEST" | "EAST" | "NORTH" | "SOUTH" {
  return {
    left: "WEST",
    right: "EAST",
    top: "NORTH",
    bottom: "SOUTH",
  }[side] as "WEST" | "EAST" | "NORTH" | "SOUTH";
}

function sortedPorts(ports: BlockPort[]): BlockPort[] {
  return [...ports].sort((left, right) => {
    if (left.side !== right.side) return left.side.localeCompare(right.side);
    return (left.order ?? 999) - (right.order ?? 999) || left.label.localeCompare(right.label);
  });
}

function validConnection(level: DesignLevel, connection: BlockConnection): boolean {
  const source = level.nodes.find((node) => node.id === connection.source.nodeId);
  const target = level.nodes.find((node) => node.id === connection.target.nodeId);
  return Boolean(
    source?.ports.some((port) => port.id === connection.source.portId) &&
      target?.ports.some((port) => port.id === connection.target.portId),
  );
}

function boundsOf(nodes: PositionedNode[]): Bounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function fallbackNodeOrder(level: DesignLevel): BlockNode[] {
  const originalOrder = new Map(level.nodes.map((node, index) => [node.id, index] as const));
  const nodesById = new Map(level.nodes.map((node) => [node.id, node] as const));
  const incoming = new Map<string, number>(level.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(level.nodes.map((node) => [node.id, [] as string[]] as const));
  level.connections.forEach((connection) => {
    if (!validConnection(level, connection) || connection.source.nodeId === connection.target.nodeId) return;
    outgoing.get(connection.source.nodeId)?.push(connection.target.nodeId);
    incoming.set(connection.target.nodeId, (incoming.get(connection.target.nodeId) ?? 0) + 1);
  });
  const queue = level.nodes
    .filter((node) => incoming.get(node.id) === 0)
    .sort((left, right) => (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0));
  const ordered: BlockNode[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    ordered.push(node);
    outgoing.get(node.id)?.forEach((targetId) => {
      incoming.set(targetId, (incoming.get(targetId) ?? 1) - 1);
      if (incoming.get(targetId) === 0) {
        const target = nodesById.get(targetId);
        if (target) queue.push(target);
      }
    });
    queue.sort((left, right) => (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0));
  }
  level.nodes.forEach((node) => {
    if (!visited.has(node.id)) ordered.push(node);
  });
  return level.layout.direction === "LEFT" || level.layout.direction === "UP"
    ? ordered.reverse()
    : ordered;
}

function authoredPositions(level: DesignLevel, dimensions: Map<string, Dimensions>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let fallbackIndex = 0;
  fallbackNodeOrder(level).forEach((node) => {
    if (node.layout.position) {
      positions.set(node.id, node.layout.position);
      return;
    }
    const dimension = dimensions.get(node.id) ?? baseNodeDimensions(node);
    const horizontalStep = dimension.width + (
      level.layout.direction === "RIGHT" || level.layout.direction === "LEFT"
        ? level.layout.layerSpacing
        : level.layout.spacing
    );
    const verticalStep = dimension.height + (
      level.layout.direction === "DOWN" || level.layout.direction === "UP"
        ? level.layout.layerSpacing
        : level.layout.spacing
    );
    positions.set(node.id, {
      x: (fallbackIndex % 4) * horizontalStep,
      y: Math.floor(fallbackIndex / 4) * verticalStep,
    });
    fallbackIndex += 1;
  });
  return positions;
}

async function automaticPositions(
  level: DesignLevel,
  dimensions: Map<string, Dimensions>,
): Promise<Map<string, { x: number; y: number }>> {
  const elk = await getElk();
  const children: ElkNode[] = level.nodes.map((node) => {
    const dimension = dimensions.get(node.id) ?? baseNodeDimensions(node);
    return {
      id: node.id,
      width: dimension.width,
      height: dimension.height,
      ports: sortedPorts(node.ports).map((port, index) => ({
        id: elkPortId(node.id, port.id),
        width: 12,
        height: 12,
        layoutOptions: {
          "org.eclipse.elk.port.side": elkSide(port.side),
          "org.eclipse.elk.port.index": String(port.order ?? index),
        },
      })),
      layoutOptions: { "org.eclipse.elk.portConstraints": "FIXED_ORDER" },
    };
  });
  const edges: ElkExtendedEdge[] = level.connections.flatMap((connection) =>
    validConnection(level, connection)
      ? [{
          id: connection.id,
          sources: [elkPortId(connection.source.nodeId, connection.source.portId)],
          targets: [elkPortId(connection.target.nodeId, connection.target.portId)],
        }]
      : [],
  );
  const graph = await elk.layout({
    id: level.id,
    children,
    edges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": level.layout.direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(level.layout.layerSpacing),
      "elk.spacing.nodeNode": String(level.layout.spacing),
      "elk.spacing.edgeNode": "48",
      "elk.spacing.portPort": "18",
      "elk.padding": "[top=48,left=48,bottom=48,right=48]",
    },
  });
  return new Map(
    graph.children?.map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]) ?? [],
  );
}

function actualEdge(
  document: BlockDesignDocument,
  level: DesignLevel,
  instancePath: string,
  connection: BlockConnection,
  directNodeIds: Map<string, string>,
): LayoutFlowEdge | undefined {
  const definition = document.interfaceDefinitions[connection.interfaceId];
  const source = directNodeIds.get(connection.source.nodeId);
  const target = directNodeIds.get(connection.target.nodeId);
  if (!definition || !source || !target) return undefined;
  return {
    id: flowEdgeId(instancePath, connection.id),
    type: "interface",
    className: `bd-interface bd-interface-${definition.kind}`,
    source,
    sourceHandle: connection.source.portId,
    target,
    targetHandle: connection.target.portId,
    data: {
      connection,
      commodityId: flowEdgeId(instancePath, connection.id),
      levelId: level.id,
      definition,
      kind: definition.kind,
      boundaryContinuation: false,
    },
    selectable: true,
  };
}

function bindingEdges(
  document: BlockDesignDocument,
  level: DesignLevel,
  instancePath: string,
  positioned: PositionedNode,
  parentFlowId: string,
): LayoutFlowEdge[] {
  const hierarchy = positioned.node.hierarchy;
  const child = positioned.child;
  if (!hierarchy || !child) return [];
  const childLevel = document.levels.find((candidate) => candidate.id === hierarchy.childLevelId);

  return hierarchy.portBindings.flatMap((binding) => {
    const parentPort = positioned.node.ports.find((port) => port.id === binding.parentPortId);
    const childFlowId = child.directNodeIds.get(binding.childEndpoint.nodeId);
    const childPort = childLevel?.nodes
      .find((node) => node.id === binding.childEndpoint.nodeId)
      ?.ports.find((port) => port.id === binding.childEndpoint.portId);
    const attached = level.connections.filter(
      (connection) =>
        (connection.source.nodeId === positioned.node.id && connection.source.portId === binding.parentPortId) ||
        (connection.target.nodeId === positioned.node.id && connection.target.portId === binding.parentPortId),
    );
    if (!parentPort || !childFlowId || !childPort) return [];

    return attached.flatMap((connection) => {
      const definition = document.interfaceDefinitions[connection.interfaceId];
      if (!definition) return [];
      const parentIsSource = parentPort.direction === "output";
      const childHandle = parentIsSource
        ? childPort.direction === "input"
          ? bindingPortId(childPort.id)
          : childPort.id
        : childPort.direction === "input"
          ? childPort.id
          : bindingPortId(childPort.id);
      return [{
        id: bindingEdgeId(instancePath, positioned.node.id, connection.id),
        type: "interface" as const,
        className: `bd-interface bd-interface-${definition.kind} bd-interface-continuation`,
        source: parentIsSource ? childFlowId : parentFlowId,
        sourceHandle: parentIsSource ? childHandle : innerPortId(parentPort.id),
        target: parentIsSource ? parentFlowId : childFlowId,
        targetHandle: parentIsSource ? innerPortId(parentPort.id) : childHandle,
        data: {
          connection,
          commodityId: flowEdgeId(instancePath, connection.id),
          levelId: level.id,
          definition,
          kind: definition.kind,
          boundaryContinuation: true,
          boundaryNodeId: parentFlowId,
        },
        selectable: true,
      }];
    });
  });
}

async function composeLevel(
  document: BlockDesignDocument,
  levelId: string,
  instancePath: string,
  parentFlowId: string | undefined,
  hierarchyDepth: number,
  options: LayoutBlockDesignOptions,
  ancestry: ReadonlySet<string>,
): Promise<ComposedLevel> {
  if (ancestry.has(levelId)) throw new Error(`Hierarchy cycle detected at level ${levelId}.`);
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level) throw new Error(`Cannot lay out missing level ${levelId}.`);
  const nextAncestry = new Set(ancestry).add(levelId);

  const children = new Map<string, ComposedLevel>();
  for (const node of level.nodes) {
    const childLevelId = node.hierarchy?.childLevelId;
    if (!childLevelId || !options.expandedLevelIds.has(childLevelId)) continue;
    const childPath = `${instancePath}/${node.id}:${childLevelId}`;
    children.set(
      node.id,
      await composeLevel(
        document,
        childLevelId,
        childPath,
        flowNodeId(instancePath, node.id),
        hierarchyDepth + 1,
        options,
        nextAncestry,
      ),
    );
  }

  const dimensions = new Map<string, Dimensions>();
  level.nodes.forEach((node) => {
    const child = children.get(node.id);
    dimensions.set(
      node.id,
      child
        ? {
            width: child.bounds.width + CONTAINER_PADDING_X * 2,
            height: child.bounds.height + CONTAINER_PADDING_TOP + CONTAINER_PADDING_BOTTOM,
          }
        : baseNodeDimensions(node),
    );
  });

  const useAutomaticPlacement =
    options.placementMode === "automatic" || children.size > 0;
  const positions = useAutomaticPlacement
    ? await automaticPositions(level, dimensions)
    : authoredPositions(level, dimensions);
  const positioned: PositionedNode[] = level.nodes.map((node) => {
    const dimension = dimensions.get(node.id) ?? baseNodeDimensions(node);
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      node,
      ...dimension,
      ...position,
      expanded: children.has(node.id),
      child: children.get(node.id),
    };
  });
  const bounds = boundsOf(positioned);
  const directNodeIds = new Map(
    positioned.map(({ node }) => [node.id, flowNodeId(instancePath, node.id)] as const),
  );

  const nodes: LayoutFlowNode[] = [];
  const edges: LayoutFlowEdge[] = [];
  positioned.forEach((item) => {
    const id = directNodeIds.get(item.node.id)!;
    nodes.push({
      id,
      type: "block",
      position: { x: item.x, y: item.y },
      width: item.width,
      height: item.height,
      style: { width: item.width, height: item.height },
      parentId: parentFlowId,
      extent: parentFlowId ? "parent" : undefined,
      expandParent: false,
      zIndex: item.expanded ? hierarchyDepth : hierarchyDepth + 2,
      data: {
        block: item.node,
        levelId: level.id,
        expanded: item.expanded,
        hierarchyDepth,
        designPosition: { x: item.x, y: item.y },
        positionEditable: !useAutomaticPlacement,
      },
      selectable: true,
      draggable: !useAutomaticPlacement,
    });

    if (!item.child) return;
    item.child.nodes.forEach((childNode) => {
      if (childNode.parentId === id) {
        childNode.position = {
          x: childNode.position.x - item.child!.bounds.minX + CONTAINER_PADDING_X,
          y: childNode.position.y - item.child!.bounds.minY + CONTAINER_PADDING_TOP,
        };
      }
      nodes.push(childNode);
    });
    edges.push(...item.child.edges);
    edges.push(...bindingEdges(document, level, instancePath, item, id));
  });

  level.connections.forEach((connection) => {
    if (!validConnection(level, connection)) return;
    const edge = actualEdge(
      document,
      level,
      instancePath,
      connection,
      directNodeIds,
    );
    if (edge) edges.push(edge);
  });

  return { nodes, edges, bounds, directNodeIds };
}

export async function layoutBlockDesign(
  document: BlockDesignDocument,
  options: LayoutBlockDesignOptions,
): Promise<LayoutResult> {
  const composed = await composeLevel(
    document,
    document.entryLevelId,
    document.entryLevelId,
    undefined,
    0,
    options,
    new Set(),
  );
  return { nodes: composed.nodes, edges: composed.edges };
}
