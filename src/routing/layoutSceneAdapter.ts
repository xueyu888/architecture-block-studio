import { Position } from "@xyflow/react";
import {
  BLOCK_NODE_GEOMETRY,
  portAnchorOffset,
  type LayoutFlowEdge,
  type LayoutFlowNode,
} from "../layout";
import type { BlockPort, PortSide } from "../model";
import { compactOrthogonalPoints, restoreManualRoute, type RoutePoint } from "./routeInterface";
import { oppositeDirection } from "./routingGeometry";
import {
  DEFAULT_ROUTING_POLICY,
  type RoutingDirection,
  type RoutingEndpoint,
  type RoutingGateEnd,
  type RoutingLeg,
  type RoutingPolicy,
  type RoutingRect,
  type RoutingScene,
} from "./routingScene";

interface AbsoluteNodeFrame {
  id: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  node: LayoutFlowNode;
}

type HandleKind = "outer" | "binding" | "inner";

function numericStyle(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nodeDimensions(node: LayoutFlowNode): { width: number; height: number } {
  const style = node.style && !Array.isArray(node.style) ? node.style : undefined;
  const width = node.measured?.width ?? node.width ?? numericStyle(style?.width);
  const height = node.measured?.height ?? node.height ?? numericStyle(style?.height);
  if (!(width && height)) throw new Error(`Routing geometry is unavailable for node ${node.id}.`);
  return { width, height };
}

function absoluteNodeFrames(nodes: readonly LayoutFlowNode[]): Map<string, AbsoluteNodeFrame> {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const result = new Map<string, AbsoluteNodeFrame>();
  const resolving = new Set<string>();
  const resolve = (node: LayoutFlowNode): AbsoluteNodeFrame => {
    const existing = result.get(node.id);
    if (existing) return existing;
    if (resolving.has(node.id)) throw new Error(`Routing geometry contains a parent cycle at ${node.id}.`);
    resolving.add(node.id);
    const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
    const parentFrame = parent ? resolve(parent) : undefined;
    const dimensions = nodeDimensions(node);
    const frame: AbsoluteNodeFrame = {
      id: node.id,
      parentId: node.parentId,
      x: (parentFrame?.x ?? 0) + node.position.x,
      y: (parentFrame?.y ?? 0) + node.position.y,
      ...dimensions,
      node,
    };
    resolving.delete(node.id);
    result.set(node.id, frame);
    return frame;
  };
  nodes.forEach(resolve);
  return result;
}

function parseHandleId(handleId: string | null | undefined): { portId: string; kind: HandleKind } {
  const id = handleId ?? "";
  if (id.startsWith("__inner__")) return { portId: id.slice("__inner__".length), kind: "inner" };
  if (id.startsWith("__binding__")) return { portId: id.slice("__binding__".length), kind: "binding" };
  return { portId: id, kind: "outer" };
}

function quantize(value: number, policy: RoutingPolicy): number {
  return Math.round(value * policy.coordinateScale) / policy.coordinateScale;
}

function quantizePoint(point: RoutePoint, policy: RoutingPolicy): RoutePoint {
  return { x: quantize(point.x, policy), y: quantize(point.y, policy) };
}

/** Ports use the visual pixel lattice; obstacle and authored geometry retain 1/8 px precision. */
function quantizeEndpointPoint(point: RoutePoint): RoutePoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function quantizeRect(rect: RoutingRect, policy: RoutingPolicy): RoutingRect {
  return {
    left: quantize(rect.left, policy),
    right: quantize(rect.right, policy),
    top: quantize(rect.top, policy),
    bottom: quantize(rect.bottom, policy),
  };
}

function directionForHandle(side: PortSide, kind: HandleKind): RoutingDirection {
  return kind === "inner"
    ? oppositeDirection(side as RoutingDirection)
    : side as RoutingDirection;
}

function portCoordinate(frame: AbsoluteNodeFrame, port: BlockPort): RoutePoint {
  const offset = portAnchorOffset(
    { width: frame.width, height: frame.height },
    frame.node.data.block.ports,
    port,
    frame.node.data.expanded,
  );
  return { x: frame.x + offset.x, y: frame.y + offset.y };
}

function routingEndpoint(
  frame: AbsoluteNodeFrame,
  handleId: string | null | undefined,
): RoutingEndpoint {
  const handle = parseHandleId(handleId);
  const port = frame.node.data.block.ports.find((candidate) => candidate.id === handle.portId);
  if (!port) throw new Error(`Routing handle ${handleId ?? "<none>"} has no declared port on ${frame.id}.`);
  return {
    point: quantizeEndpointPoint(portCoordinate(frame, port)),
    outward: directionForHandle(port.side, handle.kind),
    terminalObstacleId: frame.id,
    physicalKey: `${frame.id}::${port.id}`,
  };
}

function ancestorIds(frame: AbsoluteNodeFrame, frames: ReadonlyMap<string, AbsoluteNodeFrame>): string[] {
  const ancestors: string[] = [];
  let parentId = frame.parentId;
  while (parentId) {
    if (ancestors.includes(parentId)) throw new Error(`Routing geometry contains a parent cycle at ${parentId}.`);
    ancestors.push(parentId);
    parentId = frames.get(parentId)?.parentId;
  }
  return ancestors;
}

function originFor(frame: AbsoluteNodeFrame, frames: ReadonlyMap<string, AbsoluteNodeFrame>): RoutePoint {
  const parent = frame.parentId ? frames.get(frame.parentId) : undefined;
  return { x: parent?.x ?? 0, y: parent?.y ?? 0 };
}

function asPosition(direction: RoutingDirection): Position {
  if (direction === "left") return Position.Left;
  if (direction === "right") return Position.Right;
  if (direction === "top") return Position.Top;
  return Position.Bottom;
}

function frameBounds(frame: AbsoluteNodeFrame, policy: RoutingPolicy): RoutingRect {
  return quantizeRect({
    left: frame.x,
    right: frame.x + frame.width,
    top: frame.y,
    bottom: frame.y + frame.height,
  }, policy);
}

function routingDomain(
  edge: LayoutFlowEdge,
  source: AbsoluteNodeFrame,
  target: AbsoluteNodeFrame,
  frames: ReadonlyMap<string, AbsoluteNodeFrame>,
  policy: RoutingPolicy,
): RoutingRect | undefined {
  const domainBounds = (frame: AbsoluteNodeFrame): RoutingRect => {
    const bounds = frameBounds(frame, policy);
    const handleRadius = BLOCK_NODE_GEOMETRY.portHandleSize / 2;
    return {
      left: bounds.left - handleRadius,
      right: bounds.right + handleRadius,
      top: bounds.top - handleRadius,
      bottom: bounds.bottom + handleRadius,
    };
  };
  const boundaryId = edge.data?.boundaryNodeId;
  if (boundaryId) {
    const boundary = frames.get(boundaryId);
    return boundary ? domainBounds(boundary) : undefined;
  }
  if (source.parentId && source.parentId === target.parentId) {
    const parent = frames.get(source.parentId);
    return parent ? domainBounds(parent) : undefined;
  }
  return undefined;
}

export function createRoutingSceneFromLayout(
  nodes: readonly LayoutFlowNode[],
  edges: readonly LayoutFlowEdge[],
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY,
): RoutingScene {
  const frames = absoluteNodeFrames(nodes);
  const obstacles = [...frames.values()].map((frame) => ({
    id: frame.id,
    bounds: frameBounds(frame, policy),
    kind: frame.node.data.expanded ? "container" as const : "module" as const,
  }));
  const legs: RoutingLeg[] = edges.map((edge) => {
    const data = edge.data;
    const sourceFrame = frames.get(edge.source);
    const targetFrame = frames.get(edge.target);
    if (!data || !sourceFrame || !targetFrame) throw new Error(`Routing edge ${edge.id} has incomplete layout geometry.`);
    const source = routingEndpoint(sourceFrame, edge.sourceHandle);
    const target = routingEndpoint(targetFrame, edge.targetHandle);
    const ignoredObstacleIds = [...new Set([
      ...ancestorIds(sourceFrame, frames),
      ...ancestorIds(targetFrame, frames),
    ])].sort();
    const lockedPoints = data.connection.routing && !data.boundaryContinuation
      ? compactOrthogonalPoints(restoreManualRoute({
          source: source.point,
          target: target.point,
          waypoints: data.connection.routing.waypoints,
          origin: originFor(sourceFrame, frames),
          sourcePosition: asPosition(source.outward),
          targetPosition: asPosition(target.outward),
        }).map((point) => quantizePoint(point, policy)))
      : undefined;
    return {
      id: edge.id,
      commodityId: data.commodityId,
      source,
      target,
      ignoredObstacleIds,
      routingBounds: routingDomain(edge, sourceFrame, targetFrame, frames, policy),
      lockedPoints,
    };
  });

  const gateEnds = new Map<string, Array<{ endpoint: RoutingEndpoint; end: RoutingGateEnd }>>();
  legs.forEach((leg) => {
    (["source", "target"] as const).forEach((end) => {
      const endpoint = leg[end];
      const key = `${leg.commodityId}\u0000${endpoint.physicalKey}`;
      gateEnds.set(key, [...(gateEnds.get(key) ?? []), { endpoint, end: { legId: leg.id, end } }]);
    });
  });
  const gates = [...gateEnds.entries()].flatMap(([key, ends]) => {
    if (ends.length !== 2 || ends[0].end.legId === ends[1].end.legId) return [];
    const [commodityId, physicalKey] = key.split("\u0000");
    return [{
      id: `${commodityId}::gate::${physicalKey}`,
      commodityId,
      point: ends[0].endpoint.point,
      ends: [ends[0].end, ends[1].end] as const,
    }];
  });
  return { obstacles, legs, gates };
}
