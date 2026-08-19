import { useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BaseEdge, useReactFlow, useStoreApi, type EdgeProps } from "@xyflow/react";
import {
  absoluteRoutingObstacles,
  drawOrthogonalRoute,
  editableOrthogonalRoute,
  editableRouteBends,
  moveRouteBend,
  moveRouteSegment,
  orthogonalizeRoutePoints,
  orthogonalRoutePoints,
  removeRouteBend,
  restoreManualRoute,
  routeFastOrthogonalInterface,
  routeOrthogonalInterface,
  separateOrthogonalRoute,
  type EditableRouteBend,
  type EditableRouteSegment,
  type RoutePoint,
} from "../routing";
import type { CanvasFlowEdge } from "./canvasTypes";

type RouteDrag = {
  kind: "segment";
  pointerId: number;
  segmentIndex: number;
  axis: "h" | "v";
  points: RoutePoint[];
  group: SVGGElement;
  preview: SVGPathElement;
  initialCoordinate: number;
} | {
  kind: "bend";
  pointerId: number;
  bendIndex: number;
  points: RoutePoint[];
  group: SVGGElement;
  preview: SVGPathElement;
  initialPoint: RoutePoint;
};

const ROUTE_GRID = 8;
const ROUTE_HANDLE_TARGET_SIZE = 24;
const ROUTE_BEND_TARGET_SIZE = 20;

function snapRouteCoordinate(value: number): number {
  return Math.round(value / ROUTE_GRID) * ROUTE_GRID;
}

function endpointGripPosition(point: RoutePoint, position: EdgeProps<CanvasFlowEdge>["sourcePosition"]): RoutePoint {
  const distance = 10;
  if (position === "left") return { x: point.x - distance, y: point.y };
  if (position === "right") return { x: point.x + distance, y: point.y };
  if (position === "top") return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

export function InterfaceEdgeComponent(props: EdgeProps<CanvasFlowEdge>) {
  const store = useStoreApi();
  const { screenToFlowPosition } = useReactFlow();
  const data = props.data;
  const routingGeometry = useMemo(() => {
    const nodeLookup = store.getState().nodeLookup;
    const sourceNode = nodeLookup.get(props.source);
    return {
      // Smart-edge's public node input is parent-relative. Routing from React
      // Flow's internal absolute geometry keeps compound children and handles
      // in one coordinate space; clearing parentId prevents a second offset.
      obstacles: absoluteRoutingObstacles(nodeLookup.values(), props.source, props.target),
      origin: sourceNode
        ? {
            x: sourceNode.internals.positionAbsolute.x - sourceNode.position.x,
            y: sourceNode.internals.positionAbsolute.y - sourceNode.position.y,
          }
        : { x: 0, y: 0 },
    };
  }, [data?.connection, props.source, props.sourceX, props.sourceY, props.target, props.targetX, props.targetY, store]);
  const drag = useRef<RouteDrag | undefined>(undefined);
  const automaticBasePath = useMemo(() => {
    const fallbackPath = routeFastOrthogonalInterface({
      nodes: routingGeometry.obstacles,
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
      sourcePosition: props.sourcePosition,
      targetPosition: props.targetPosition,
    }).path;
    if (data?.largeGraph) {
      return routeFastOrthogonalInterface({
        nodes: routingGeometry.obstacles,
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
        sourcePosition: props.sourcePosition,
        targetPosition: props.targetPosition,
      }).path;
    }
    const route = routeOrthogonalInterface({
      nodes: routingGeometry.obstacles,
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
      sourcePosition: props.sourcePosition,
      targetPosition: props.targetPosition,
    });
    return route instanceof Error ? fallbackPath : route.svgPathString;
  }, [
    data?.largeGraph,
    data?.routeRevision,
    props.sourcePosition,
    props.sourceX,
    props.sourceY,
    props.targetPosition,
    props.targetX,
    props.targetY,
    routingGeometry.obstacles,
  ]);
  const automaticRoute = useMemo(() => separateOrthogonalRoute(
    automaticBasePath,
    data?.laneOffset ?? 0,
    {
      separateSource: data?.separateSourceEndpoint,
      separateTarget: data?.separateTargetEndpoint,
    },
  ), [
    automaticBasePath,
    data?.laneOffset,
    data?.separateSourceEndpoint,
    data?.separateTargetEndpoint,
  ]);
  if (!data) return null;
  const persistedPoints = data.connection.routing && !data.boundaryContinuation
    ? restoreManualRoute({
        source: { x: props.sourceX, y: props.sourceY },
        target: { x: props.targetX, y: props.targetY },
        waypoints: data.connection.routing.waypoints,
        origin: routingGeometry.origin,
        sourcePosition: props.sourcePosition,
        targetPosition: props.targetPosition,
      })
    : undefined;
  const routePoints = persistedPoints ?? orthogonalRoutePoints(automaticRoute.path);
  const routePath = persistedPoints
    ? drawOrthogonalRoute(persistedPoints)
    : automaticRoute.path;
  const editing = editableOrthogonalRoute(routePoints);
  const bends = persistedPoints ? editableRouteBends(routePoints) : [];
  const endpointGrips = [
    endpointGripPosition({ x: props.sourceX, y: props.sourceY }, props.sourcePosition),
    endpointGripPosition({ x: props.targetX, y: props.targetY }, props.targetPosition),
  ];

  const commitPoints = (points: RoutePoint[]): boolean => {
    const compact = orthogonalizeRoutePoints(
      points,
      props.sourcePosition,
      props.targetPosition,
    );
    if (!data.updateRouting) return false;
    if (compact.length < 4) return data.updateRouting(undefined);
    return data.updateRouting({
      waypoints: compact.slice(1, -1).map((point) => ({
        x: Math.round(point.x - routingGeometry.origin.x),
        y: Math.round(point.y - routingGeometry.origin.y),
      })),
    });
  };

  const dragElements = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const group = event.currentTarget.closest<SVGGElement>("[data-connection-id]");
    const preview = group?.querySelector<SVGPathElement>(".bd-route-preview");
    return group && preview ? { group, preview } : undefined;
  };

  const listenForDrag = () => {
    window.addEventListener("pointermove", continueDrag);
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
  };

  const beginSegmentDrag = (event: ReactPointerEvent<HTMLButtonElement>, segment: EditableRouteSegment) => {
    event.preventDefault();
    event.stopPropagation();
    const elements = dragElements(event);
    if (!elements) return;
    const { group, preview } = elements;
    group.classList.add("is-routing");
    preview.setAttribute("d", routePath);
    drag.current = {
      kind: "segment",
      pointerId: event.pointerId,
      segmentIndex: segment.index,
      axis: segment.axis,
      points: editing.points.map((point) => ({ ...point })),
      group,
      preview,
      initialCoordinate: segment.axis === "h"
        ? editing.points[segment.index].y
        : editing.points[segment.index].x,
    };
    listenForDrag();
  };

  const beginBendDrag = (event: ReactPointerEvent<HTMLButtonElement>, bend: EditableRouteBend) => {
    event.preventDefault();
    event.stopPropagation();
    const elements = dragElements(event);
    if (!elements) return;
    const { group, preview } = elements;
    group.classList.add("is-routing");
    preview.setAttribute("d", routePath);
    drag.current = {
      kind: "bend",
      pointerId: event.pointerId,
      bendIndex: bend.index,
      points: routePoints.map((point) => ({ ...point })),
      group,
      preview,
      initialPoint: { ...bend.point },
    };
    listenForDrag();
  };

  const continueDrag = (event: globalThis.PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const next = active.kind === "segment"
      ? moveRouteSegment(
          active.points,
          { index: active.segmentIndex, axis: active.axis },
          snapRouteCoordinate(active.axis === "h" ? position.y : position.x),
        )
      : moveRouteBend(active.points, active.bendIndex, {
          x: snapRouteCoordinate(position.x),
          y: snapRouteCoordinate(position.y),
        });
    drag.current = { ...active, points: next };
    active.preview.setAttribute("d", drawOrthogonalRoute(next));
  };

  const finishDrag = (event: globalThis.PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener("pointermove", continueDrag);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    active.group.classList.remove("is-routing");
    drag.current = undefined;
    const changed = active.kind === "segment"
      ? (active.axis === "h" ? active.points[active.segmentIndex].y : active.points[active.segmentIndex].x) !== active.initialCoordinate
      : active.points[active.bendIndex].x !== active.initialPoint.x ||
        active.points[active.bendIndex].y !== active.initialPoint.y;
    if (changed) commitPoints(active.points);
  };

  const moveSegmentWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, segment: EditableRouteSegment) => {
    const direction = segment.axis === "h"
      ? event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
      : event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = segment.axis === "h"
      ? editing.points[segment.index].y
      : editing.points[segment.index].x;
    const coordinate = current + direction * ROUTE_GRID;
    if (commitPoints(moveRouteSegment(editing.points, segment, coordinate))) {
      data.requestRouteHandleFocus?.({
        kind: "segment",
        axis: segment.axis,
        coordinate,
        index: segment.index,
      });
    }
  };

  const removeBend = (bend: EditableRouteBend): boolean => {
    const reduced = removeRouteBend(
      routePoints,
      bend.index,
      props.sourcePosition,
      props.targetPosition,
    );
    return reduced ? commitPoints(reduced) : false;
  };

  const moveBendWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, bend: EditableRouteBend) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      removeBend(bend);
      return;
    }
    const delta = event.key === "ArrowLeft" ? { x: -ROUTE_GRID, y: 0 }
      : event.key === "ArrowRight" ? { x: ROUTE_GRID, y: 0 }
        : event.key === "ArrowUp" ? { x: 0, y: -ROUTE_GRID }
          : event.key === "ArrowDown" ? { x: 0, y: ROUTE_GRID }
            : undefined;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next = moveRouteBend(routePoints, bend.index, {
      x: bend.point.x + delta.x,
      y: bend.point.y + delta.y,
    });
    if (next[bend.index].x === bend.point.x && next[bend.index].y === bend.point.y) return;
    if (commitPoints(next)) {
      data.requestRouteHandleFocus?.({ kind: "bend", index: bend.index });
    }
  };

  return (
    <g
      data-source-node-id={props.source}
      data-target-node-id={props.target}
      data-connection-id={data.connection.id}
      data-routing-mode={persistedPoints ? "manual" : "automatic"}
      data-large-graph={data.largeGraph ? "true" : "false"}
      data-boundary-continuation={data.boundaryContinuation ? "true" : "false"}
      data-boundary-node-id={data.boundaryNodeId}
    >
      {(!data.largeGraph || props.selected) && (
        <path className="bd-interface-underlay" d={routePath} aria-hidden="true" />
      )}
      <BaseEdge
        id={props.id}
        path={routePath}
        style={data.largeGraph ? { ...props.style, transition: "none" } : props.style}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={data.largeGraph ? 18 : 28}
        className="bd-interface-route"
      />
      {props.selected && data.canEditSelection?.() !== false && <path className="bd-route-preview" d={routePath} aria-hidden="true" />}
      {props.selected && data.canEditSelection?.() !== false && !data.boundaryContinuation && endpointGrips.map((point, index) => (
        <circle
          key={index === 0 ? "source-grip" : "target-grip"}
          className="bd-route-endpoint-grip"
          cx={point.x}
          cy={point.y}
          r={5}
          aria-hidden="true"
        />
      ))}
      {props.selected && data.canEditSelection?.() !== false && !data.boundaryContinuation && data.updateRouting && editing.segments.map((segment) => (
        <foreignObject
          key={`segment:${segment.index}:${segment.axis}`}
          className="bd-route-handle-object bd-route-segment-handle-object nodrag nopan"
          x={segment.midpoint.x - ROUTE_HANDLE_TARGET_SIZE / 2}
          y={segment.midpoint.y - ROUTE_HANDLE_TARGET_SIZE / 2}
          width={ROUTE_HANDLE_TARGET_SIZE}
          height={ROUTE_HANDLE_TARGET_SIZE}
        >
          <button
            type="button"
            className={`bd-route-handle bd-route-segment-handle bd-route-handle-${segment.axis} nodrag nopan`}
            role="spinbutton"
            data-route-handle-index={segment.index}
            data-route-axis={segment.axis}
            aria-label={`Move ${segment.axis === "h" ? "horizontal route segment vertically" : "vertical route segment horizontally"}`}
            aria-valuenow={Math.round(segment.axis === "h" ? segment.midpoint.y : segment.midpoint.x)}
            aria-valuetext={`${Math.round(segment.axis === "h" ? segment.midpoint.y : segment.midpoint.x)} design pixels`}
            onPointerDown={(event) => beginSegmentDrag(event, segment)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragStart={(event) => event.preventDefault()}
            onKeyDown={(event) => moveSegmentWithKeyboard(event, segment)}
          />
        </foreignObject>
      ))}
      {props.selected && data.canEditSelection?.() !== false && !data.boundaryContinuation && data.updateRouting && bends.map((bend) => (
        <foreignObject
          key={`bend:${bend.index}`}
          className="bd-route-handle-object bd-route-bend-handle-object nodrag nopan"
          x={bend.point.x - ROUTE_BEND_TARGET_SIZE / 2}
          y={bend.point.y - ROUTE_BEND_TARGET_SIZE / 2}
          width={ROUTE_BEND_TARGET_SIZE}
          height={ROUTE_BEND_TARGET_SIZE}
        >
          <button
            type="button"
            className="bd-route-handle bd-route-bend-handle nodrag nopan"
            data-route-handle-index={bend.index}
            aria-label={`Move route bend ${bend.index}. Use Arrow keys to move; Delete or double click to remove.`}
            onPointerDown={(event) => beginBendDrag(event, bend)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              removeBend(bend);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragStart={(event) => event.preventDefault()}
            onKeyDown={(event) => moveBendWithKeyboard(event, bend)}
          />
        </foreignObject>
      ))}
    </g>
  );
}
