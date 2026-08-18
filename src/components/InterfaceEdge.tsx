import { BaseEdge, getSmoothStepPath, useStore, type EdgeProps } from "@xyflow/react";
import {
  absoluteRoutingObstacles,
  routeLaneOffset,
  routeOrthogonalInterface,
  separateOrthogonalRoute,
} from "../routing";
import type { StudioFlowEdge } from "../studio/types";

export function InterfaceEdgeComponent(props: EdgeProps<StudioFlowEdge>) {
  const routeNodes = useStore((state) => {
    // Smart-edge's public node input is parent-relative. Routing from React
    // Flow's internal absolute geometry keeps compound children and handles in
    // one coordinate space; clearing parentId prevents a second parent offset.
    return absoluteRoutingObstacles(state.nodeLookup.values(), props.source, props.target);
  });
  const data = props.data;
  if (!data) return null;
  const route = routeOrthogonalInterface({
    nodes: routeNodes,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  const [fallbackPath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 0,
  });
  const separatedRoute = route instanceof Error
    ? { path: fallbackPath }
    : separateOrthogonalRoute(
        route.svgPathString,
        data.laneSeparation ? routeLaneOffset(data.connection.id) : 0,
      );
  return (
    <g
      data-source-node-id={props.source}
      data-target-node-id={props.target}
      data-connection-id={data.connection.id}
      data-boundary-continuation={data.boundaryContinuation ? "true" : "false"}
      data-boundary-node-id={data.boundaryNodeId}
    >
      <path className="bd-interface-underlay" d={separatedRoute.path} aria-hidden="true" />
      <BaseEdge
        {...props}
        path={separatedRoute.path}
        interactionWidth={28}
        className="bd-interface-route"
      />
    </g>
  );
}
