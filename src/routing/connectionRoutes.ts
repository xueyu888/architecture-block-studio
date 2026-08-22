import { Position } from "@xyflow/react";
import { layoutNodeRenderDimensions, portAnchorOffset, type LayoutFlowEdge, type LayoutFlowNode } from "../layout";
import type { BlockPort, PortSide } from "../model";
import { restoreManualRoute, type RoutePoint } from "./routeInterface";

interface AbsoluteNodeFrame {
  node: LayoutFlowNode;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type HandleKind = "outer" | "binding" | "inner";

function absoluteNodeFrames(nodes: readonly LayoutFlowNode[]): ReadonlyMap<string, AbsoluteNodeFrame> {
  const source = new Map(nodes.map((node) => [node.id, node] as const));
  const frames = new Map<string, AbsoluteNodeFrame>();
  const resolving = new Set<string>();
  const resolve = (node: LayoutFlowNode): AbsoluteNodeFrame => {
    const existing = frames.get(node.id);
    if (existing) return existing;
    if (resolving.has(node.id)) throw new Error(`Connection geometry contains a parent cycle at ${node.id}.`);
    resolving.add(node.id);
    const parent = node.parentId ? source.get(node.parentId) : undefined;
    const parentFrame = parent ? resolve(parent) : undefined;
    const dimensions = layoutNodeRenderDimensions(node);
    const frame = {
      node,
      parentId: node.parentId,
      x: (parentFrame?.x ?? 0) + node.position.x,
      y: (parentFrame?.y ?? 0) + node.position.y,
      width: dimensions.width,
      height: dimensions.height,
    };
    resolving.delete(node.id);
    frames.set(node.id, frame);
    return frame;
  };
  nodes.forEach(resolve);
  return frames;
}

function parseHandle(handleId: string | null | undefined): { portId: string; kind: HandleKind } {
  const id = handleId ?? "";
  if (id.startsWith("__inner__")) return { portId: id.slice("__inner__".length), kind: "inner" };
  if (id.startsWith("__binding__")) return { portId: id.slice("__binding__".length), kind: "binding" };
  return { portId: id, kind: "outer" };
}

function portPoint(frame: AbsoluteNodeFrame, port: BlockPort): RoutePoint {
  const offset = portAnchorOffset(
    { width: frame.width, height: frame.height },
    frame.node.data.block.ports,
    port,
    frame.node.data.expanded,
  );
  return { x: frame.x + offset.x, y: frame.y + offset.y };
}

function endpoint(frame: AbsoluteNodeFrame, handleId: string | null | undefined): {
  point: RoutePoint;
  position: Position;
} {
  const handle = parseHandle(handleId);
  const port = frame.node.data.block.ports.find((candidate) => candidate.id === handle.portId);
  if (!port) throw new Error(`Connection handle ${handleId ?? "<none>"} has no declared port on ${frame.node.id}.`);
  return {
    point: portPoint(frame, port),
    position: positionForSide(port.side, handle.kind === "inner"),
  };
}

function positionForSide(side: PortSide, reversed: boolean): Position {
  const effective = reversed ? side === "left" ? "right" : "left" : side;
  return effective === "left" ? Position.Left : Position.Right;
}

function parentOrigin(frame: AbsoluteNodeFrame, frames: ReadonlyMap<string, AbsoluteNodeFrame>): RoutePoint {
  const parent = frame.parentId ? frames.get(frame.parentId) : undefined;
  return { x: parent?.x ?? 0, y: parent?.y ?? 0 };
}

/**
 * Single projection owner for connection geometry.
 *
 * Automatic geometry is always the direct source-target segment. Only explicit
 * document waypoints can create bends; crossings and module intersections are
 * deliberately presentation concerns, not hidden routing state.
 */
export function projectConnectionRoutes(
  nodes: readonly LayoutFlowNode[],
  edges: readonly LayoutFlowEdge[],
  previous: ReadonlyMap<string, readonly RoutePoint[]> = new Map(),
): ReadonlyMap<string, readonly RoutePoint[]> {
  const frames = absoluteNodeFrames(nodes);
  return new Map(edges.flatMap((edge) => {
    const sourceFrame = frames.get(edge.source);
    const targetFrame = frames.get(edge.target);
    const data = edge.data;
    // Layout is installed node-first. An edge whose visible endpoint frame has
    // not arrived yet is transient and must not crash the whole canvas or
    // invent substitute coordinates; it becomes projectable on the next frame.
    if (!sourceFrame || !targetFrame) return [];
    if (!data) throw new Error(`Connection edge ${edge.id} has no connection data.`);
    const source = endpoint(sourceFrame, edge.sourceHandle);
    const target = endpoint(targetFrame, edge.targetHandle);
    const points = data.connection.routing && !data.boundaryContinuation
      ? restoreManualRoute({
          source: source.point,
          target: target.point,
          waypoints: data.connection.routing.waypoints,
          origin: parentOrigin(sourceFrame, frames),
          sourcePosition: source.position,
          targetPosition: target.position,
        })
      : [source.point, target.point];
    const previousPoints = previous.get(edge.id);
    const stablePoints = previousPoints?.length === points.length && points.every(
      (point, index) => point.x === previousPoints[index].x && point.y === previousPoints[index].y,
    ) ? previousPoints : points;
    return [[edge.id, stablePoints] as const];
  }));
}
