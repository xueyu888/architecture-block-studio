import { BaseEdge, StepEdge, useStore, type EdgeProps } from "@xyflow/react";
import { absoluteRoutingObstacles, routeOrthogonalInterface } from "../routing";
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
  const label = data.showLabel || props.selected
    ? `${data.kind.toUpperCase()}  ${data.label}`
    : undefined;
  const route = routeOrthogonalInterface({
    nodes: routeNodes,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  const edge = route instanceof Error ? (
    <StepEdge {...props} label={label} />
  ) : (
    <BaseEdge
      path={route.svgPathString}
      labelX={route.edgeCenterX}
      labelY={route.edgeCenterY}
      label={label}
      interactionWidth={28}
      labelShowBg
      labelBgPadding={[5, 3]}
      labelBgBorderRadius={1}
      labelBgStyle={{ fill: "#fbfcfa", fillOpacity: 0.96 }}
      labelStyle={{ fontSize: 9, fontFamily: "SFMono-Regular, Consolas, monospace" }}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      style={props.style}
    />
  );
  return (
    <g
      data-source-node-id={props.source}
      data-target-node-id={props.target}
      data-boundary-continuation={data.boundaryContinuation ? "true" : "false"}
    >
      {edge}
    </g>
  );
}
