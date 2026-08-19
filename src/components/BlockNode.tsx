import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Minus, Pin, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import {
  BLOCK_NODE_GEOMETRY,
  bindingPortId,
  innerPortId,
  portLabelWidth,
  portRailOffset,
  portsForSide,
} from "../layout";
import type { BlockPort, PortSide } from "../model";
import type { CanvasFlowNode } from "./canvasTypes";

type GeometryStyle = CSSProperties & Record<`--${string}`, string>;

const positionBySide: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const inwardPositionBySide: Record<PortSide, Position> = {
  left: Position.Right,
  right: Position.Left,
  top: Position.Bottom,
  bottom: Position.Top,
};

function handleType(port: BlockPort): "source" | "target" {
  return port.direction === "input" ? "target" : "source";
}

function Port({
  port,
  index,
  sidePorts,
  nodeId,
  inspect,
  expanded,
}: {
  port: BlockPort;
  index: number;
  sidePorts: readonly BlockPort[];
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
  expanded: boolean;
}) {
  const vertical = port.side === "left" || port.side === "right";
  const offset = ((index + 1) / (sidePorts.length + 1)) * 100;
  return (
    <div
      className={`bd-port bd-port-${port.side}`}
      style={vertical ? { top: `${offset}%` } : { left: `${offset}%` }}
      title={`${port.label} · ${port.direction}${port.dataType ? ` · ${port.dataType}` : ""}`}
    >
      <Handle
        id={port.id}
        type={handleType(port)}
        position={positionBySide[port.side]}
        className={`bd-port-handle bd-port-handle-outer bd-port-handle-${port.direction}`}
        onClick={(event) => {
          event.stopPropagation();
          inspect?.(nodeId, port);
        }}
      />
      <Handle
        id={bindingPortId(port.id)}
        type={handleType(port) === "source" ? "target" : "source"}
        position={positionBySide[port.side]}
        className={`bd-port-handle bd-port-handle-binding bd-port-handle-${port.direction}`}
      />
      {expanded && (
        <Handle
          id={innerPortId(port.id)}
          type={handleType(port) === "source" ? "target" : "source"}
          position={inwardPositionBySide[port.side]}
          className={`bd-port-handle bd-port-handle-inner bd-port-handle-anchor-${port.side} bd-port-handle-${port.direction}`}
        />
      )}
    </div>
  );
}

function PortLabel({
  port,
  index,
  sidePorts,
  nodeId,
  inspect,
}: {
  port: BlockPort;
  index: number;
  sidePorts: readonly BlockPort[];
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
}) {
  const vertical = port.side === "left" || port.side === "right";
  const offset = vertical
    ? ((index + 1) / (sidePorts.length + 1)) * 100
    : portRailOffset(sidePorts, index);
  return (
    <button
      type="button"
      className={`bd-port-label bd-port-label-${port.side} nodrag nopan`}
      style={{
        ...(vertical ? { top: `${offset}%` } : { left: `${offset}%` }),
        "--port-label-width": `${portLabelWidth(port.label)}px`,
      } as GeometryStyle}
      title={`${port.label} · ${port.direction}${port.dataType ? ` · ${port.dataType}` : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        inspect?.(nodeId, port);
      }}
    >
      <span>{port.label}</span>
      {port.dataType && <small>{port.dataType}</small>}
    </button>
  );
}

function PortRail({
  side,
  ports,
  nodeId,
  inspect,
  expanded,
}: {
  side: PortSide;
  ports: readonly BlockPort[];
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
  expanded: boolean;
}) {
  if (ports.length === 0) return null;
  return (
    <div className={`bd-port-rail bd-port-rail-${side}`} data-port-side={side}>
      {ports.map((port, index) => (
        <Port
          key={port.id}
          port={port}
          index={index}
          sidePorts={ports}
          nodeId={nodeId}
          inspect={inspect}
          expanded={expanded}
        />
      ))}
      {ports.map((port, index) => (
        <PortLabel
          key={`label:${port.id}`}
          port={port}
          index={index}
          sidePorts={ports}
          nodeId={nodeId}
          inspect={inspect}
        />
      ))}
    </div>
  );
}

export function BlockNodeComponent({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { block } = data;
  const hierarchy = block.hierarchy;
  const portsBySide = Object.fromEntries(
    (["left", "right", "top", "bottom"] as PortSide[])
      .map((side) => [side, portsForSide(block.ports, side)] as const),
  ) as Record<PortSide, BlockPort[]>;
  const widestLabel = (side: PortSide) => portsBySide[side]
    .reduce((width, port) => Math.max(width, portLabelWidth(port.label)), 0);
  const geometryStyle = {
    "--block-header-height": `${BLOCK_NODE_GEOMETRY.headerHeight}px`,
    "--block-owner-band-height": `${BLOCK_NODE_GEOMETRY.ownerBandHeight}px`,
    "--port-top-rail-height": `${portsBySide.top.length > 0 ? BLOCK_NODE_GEOMETRY.horizontalRailHeight : 0}px`,
    "--port-bottom-rail-height": `${portsBySide.bottom.length > 0 ? BLOCK_NODE_GEOMETRY.horizontalRailHeight : 0}px`,
    "--port-left-label-width": `${widestLabel("left")}px`,
    "--port-right-label-width": `${widestLabel("right")}px`,
  } as GeometryStyle;

  return (
    <article
      className={`bd-block${selected ? " is-selected" : ""}${hierarchy ? " is-hierarchical" : ""}${data.expanded ? " is-expanded" : ""}`}
      data-level-id={data.levelId}
      data-block-id={block.id}
      data-hierarchy-depth={data.hierarchyDepth}
      data-expanded={data.expanded ? "true" : "false"}
      data-tone={block.tone}
      style={geometryStyle}
    >
      <header className="bd-block-header">
        {hierarchy ? (
          <button
            type="button"
            className="bd-hierarchy-button nodrag nopan"
            title={data.expanded ? "折叠内部 Block Design" : "展开内部 Block Design"}
            aria-label={`${data.expanded ? "折叠" : "展开"} ${block.title} 内部 Block Design`}
            onClick={(event) => {
              event.stopPropagation();
              data.toggleHierarchy?.(hierarchy.childLevelId);
            }}
          >
            {data.expanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
          </button>
        ) : <Box className="bd-block-symbol" size={13} aria-hidden="true" />}
        <div className="bd-block-heading">
          <h3>{block.title}</h3>
          <span>{block.process ?? block.kind}</span>
        </div>
        {block.layout.pinned && <Pin className="bd-pin-indicator" size={11} aria-label="Authored position" />}
      </header>
      {!data.expanded && (
        <>
          <div className="bd-block-body">
            {block.summary && <p>{block.summary}</p>}
          </div>
          <footer className="bd-block-owner">{block.owner ?? "Unassigned owner"}</footer>
        </>
      )}
      {data.expanded && (
        <div className="bd-hierarchy-watermark" aria-hidden="true">
          <strong>{hierarchy?.childLevelId}</strong>
          <span>expanded hierarchy</span>
        </div>
      )}

      {(["left", "right", "top", "bottom"] as PortSide[]).map((side) => (
        <PortRail
          key={side}
          side={side}
          ports={portsBySide[side]}
          nodeId={block.id}
          inspect={data.inspectPort}
          expanded={data.expanded}
        />
      ))}
    </article>
  );
}
