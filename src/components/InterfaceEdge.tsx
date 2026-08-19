import { useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BaseEdge, useStoreApi, type EdgeProps } from "@xyflow/react";
import {
  absoluteRoutingObstacles,
  compactOrthogonalPoints,
  drawOrthogonalRoute,
  orthogonalizeRoutePoints,
  orthogonalRoutePoints,
  restoreManualRoute,
  routeFastOrthogonalInterface,
  routeOrthogonalInterface,
  separateOrthogonalRoute,
  type RoutePoint,
} from "../routing";
import type { CanvasFlowEdge } from "./canvasTypes";

interface EditableSegment {
  index: number;
  axis: "h" | "v";
  midpoint: RoutePoint;
}

interface RouteDrag {
  pointerId: number;
  segmentIndex: number;
  axis: "h" | "v";
  points: RoutePoint[];
  screenToFlow: DOMMatrix;
  group: SVGGElement;
  preview: SVGPathElement;
  initialCoordinate: number;
}

const ROUTE_GRID = 8;
const ROUTE_HANDLE_TARGET_SIZE = 24;

function routeAxis(left: RoutePoint, right: RoutePoint): "h" | "v" {
  return Math.abs(right.x - left.x) >= Math.abs(right.y - left.y) ? "h" : "v";
}

function scaffoldShortestRoute(points: RoutePoint[]): RoutePoint[] {
  if (points.length < 2) return points;
  let longestIndex = 0;
  let longestLength = -1;
  points.slice(0, -1).forEach((point, index) => {
    const next = points[index + 1];
    const length = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    if (length > longestLength) {
      longestLength = length;
      longestIndex = index;
    }
  });
  const start = points[longestIndex];
  const end = points[longestIndex + 1];
  const first = { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 };
  const second = { x: start.x + (end.x - start.x) * 2 / 3, y: start.y + (end.y - start.y) * 2 / 3 };
  return [
    ...points.slice(0, longestIndex + 1),
    first,
    { ...first },
    { ...second },
    second,
    ...points.slice(longestIndex + 1),
  ];
}

function editableRoute(points: RoutePoint[]): { points: RoutePoint[]; segments: EditableSegment[] } {
  let editablePoints = compactOrthogonalPoints(points);
  let segments = editablePoints.slice(0, -1).flatMap<EditableSegment>((point, index) => {
    if (index === 0 || index === editablePoints.length - 2) return [];
    const next = editablePoints[index + 1];
    const length = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    return length < 20
      ? []
      : [{
          index,
          axis: routeAxis(point, next),
          midpoint: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
        }];
  });
  if (segments.length > 0) return { points: editablePoints, segments };

  editablePoints = scaffoldShortestRoute(editablePoints);
  segments = editablePoints.slice(0, -1).flatMap<EditableSegment>((point, index) => {
    if (index === 0 || index === editablePoints.length - 2) return [];
    const next = editablePoints[index + 1];
    const length = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    return length < 20
      ? []
      : [{
          index,
          axis: routeAxis(point, next),
          midpoint: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
        }];
  });
  return { points: editablePoints, segments };
}

function moveSegment(points: RoutePoint[], segment: EditableSegment, coordinate: number): RoutePoint[] {
  const next = points.map((point) => ({ ...point }));
  if (segment.axis === "h") {
    next[segment.index].y = coordinate;
    next[segment.index + 1].y = coordinate;
  } else {
    next[segment.index].x = coordinate;
    next[segment.index + 1].x = coordinate;
  }
  return next;
}

export function InterfaceEdgeComponent(props: EdgeProps<CanvasFlowEdge>) {
  const store = useStoreApi();
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
  const editing = editableRoute(routePoints);

  const commitPoints = (points: RoutePoint[]): boolean => {
    const compact = orthogonalizeRoutePoints(
      points,
      props.sourcePosition,
      props.targetPosition,
    );
    if (compact.length < 4 || !data.updateRouting) return false;
    return data.updateRouting({
      waypoints: compact.slice(1, -1).map((point) => ({
        x: Math.round(point.x - routingGeometry.origin.x),
        y: Math.round(point.y - routingGeometry.origin.y),
      })),
    });
  };

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, segment: EditableSegment) => {
    event.preventDefault();
    event.stopPropagation();
    const matrix = event.currentTarget.closest<SVGForeignObjectElement>(".bd-route-handle-object")?.getScreenCTM();
    const group = event.currentTarget.closest<SVGGElement>("[data-connection-id]");
    const preview = group?.querySelector<SVGPathElement>(".bd-route-preview");
    if (!matrix || !group || !preview) return;
    group.classList.add("is-routing");
    preview.setAttribute("d", routePath);
    drag.current = {
      pointerId: event.pointerId,
      segmentIndex: segment.index,
      axis: segment.axis,
      points: editing.points.map((point) => ({ ...point })),
      screenToFlow: matrix.inverse(),
      group,
      preview,
      initialCoordinate: segment.axis === "h"
        ? editing.points[segment.index].y
        : editing.points[segment.index].x,
    };
    window.addEventListener("pointermove", continueDrag);
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
  };

  const continueDrag = (event: globalThis.PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(active.screenToFlow);
    const segment: EditableSegment = {
      index: active.segmentIndex,
      axis: active.axis,
      midpoint: { x: 0, y: 0 },
    };
    const coordinate = Math.round((active.axis === "h" ? point.y : point.x) / ROUTE_GRID) * ROUTE_GRID;
    const next = moveSegment(active.points, segment, coordinate);
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
    const finalCoordinate = active.axis === "h"
      ? active.points[active.segmentIndex].y
      : active.points[active.segmentIndex].x;
    if (finalCoordinate !== active.initialCoordinate) commitPoints(active.points);
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, segment: EditableSegment) => {
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
    if (commitPoints(moveSegment(editing.points, segment, coordinate))) {
      data.requestRouteHandleFocus?.(segment.axis, coordinate, segment.index);
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
      {props.selected && <path className="bd-route-preview" d={routePath} aria-hidden="true" />}
      {props.selected && !data.boundaryContinuation && data.updateRouting && editing.segments.map((segment) => (
        <foreignObject
          key={`${segment.index}:${segment.axis}`}
          className="bd-route-handle-object nodrag nopan"
          x={segment.midpoint.x - ROUTE_HANDLE_TARGET_SIZE / 2}
          y={segment.midpoint.y - ROUTE_HANDLE_TARGET_SIZE / 2}
          width={ROUTE_HANDLE_TARGET_SIZE}
          height={ROUTE_HANDLE_TARGET_SIZE}
        >
          <button
            type="button"
            className={`bd-route-handle bd-route-handle-${segment.axis} nodrag nopan`}
            role="spinbutton"
            data-route-segment-index={segment.index}
            data-route-axis={segment.axis}
            aria-label={`Move ${segment.axis === "h" ? "horizontal route segment vertically" : "vertical route segment horizontally"}`}
            aria-valuenow={Math.round(segment.axis === "h" ? segment.midpoint.y : segment.midpoint.x)}
            aria-valuetext={`${Math.round(segment.axis === "h" ? segment.midpoint.y : segment.midpoint.x)} design pixels`}
            onPointerDown={(event) => beginDrag(event, segment)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragStart={(event) => event.preventDefault()}
            onKeyDown={(event) => moveWithKeyboard(event, segment)}
          />
        </foreignObject>
      ))}
    </g>
  );
}
