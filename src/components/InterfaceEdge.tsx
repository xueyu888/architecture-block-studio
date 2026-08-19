import { useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BaseEdge, useReactFlow, useStoreApi, type EdgeProps } from "@xyflow/react";
import {
  adaptRouteEndpoints,
  drawOrthogonalRoute,
  editableOrthogonalRoute,
  editableRouteBends,
  moveRouteBend,
  moveRouteSegment,
  orthogonalizeRoutePoints,
  removeRouteBend,
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
      origin: sourceNode
        ? {
            x: sourceNode.internals.positionAbsolute.x - sourceNode.position.x,
            y: sourceNode.internals.positionAbsolute.y - sourceNode.position.y,
          }
        : { x: 0, y: 0 },
    };
  }, [data?.connection, props.source, props.sourceX, props.sourceY, props.target, props.targetX, props.targetY, store]);
  const drag = useRef<RouteDrag | undefined>(undefined);
  if (!data) return null;
  const routePoints = data.plannedRoute ? adaptRouteEndpoints(
    data.plannedRoute,
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
    props.sourcePosition,
    props.targetPosition,
  ) : undefined;
  if (!routePoints || routePoints.length < 2) return null;
  const routeMatchesPlan = data.plannedRoute?.length === routePoints.length && data.plannedRoute.every(
    (point, index) => point.x === routePoints[index].x && point.y === routePoints[index].y,
  );
  // Bridges belong to committed route geometry. During a live node gesture the
  // endpoint legs are adapted locally, so stale bridge coordinates are hidden
  // until the scene is solved again instead of creating a diagonal preview.
  const renderedJumps = routeMatchesPlan ? data.routeJumps : undefined;
  const routePath = drawOrthogonalRoute(routePoints, renderedJumps);
  const plainRoutePath = drawOrthogonalRoute(routePoints);
  const persistedPoints = data.connection.routing && !data.boundaryContinuation
    ? routePoints
    : undefined;
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
    preview.setAttribute("d", plainRoutePath);
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
    preview.setAttribute("d", plainRoutePath);
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
      data.requestRouteHandleFocus?.({ kind: "bend", index: bend.index, point: next[bend.index] });
    }
  };

  return (
    <g
      data-source-node-id={props.source}
      data-target-node-id={props.target}
      data-connection-id={data.connection.id}
      data-routing-mode={persistedPoints ? "manual" : "automatic"}
      data-routing-status={data.routingStatus}
      data-simplified-interaction={data.simplifiedInteraction ? "true" : "false"}
      data-boundary-continuation={data.boundaryContinuation ? "true" : "false"}
      data-boundary-node-id={data.boundaryNodeId}
      data-route-points={JSON.stringify(routePoints)}
      data-route-jumps={JSON.stringify(renderedJumps ?? [])}
      data-route-jump-count={renderedJumps?.length ?? 0}
    >
      {(!data.simplifiedInteraction || props.selected) && (
        <path className="bd-interface-underlay" d={routePath} aria-hidden="true" />
      )}
      <BaseEdge
        id={props.id}
        path={routePath}
        style={props.style}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={28}
        className="bd-interface-route"
      />
      {props.selected && data.canEditSelection?.() !== false && <path className="bd-route-preview" d={plainRoutePath} aria-hidden="true" />}
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
            tabIndex={-1}
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
            tabIndex={-1}
            className="bd-route-handle bd-route-bend-handle nodrag nopan"
            data-route-handle-index={bend.index}
            data-route-x={bend.point.x}
            data-route-y={bend.point.y}
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
