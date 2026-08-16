import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Minus, Pin, Plus } from "lucide-react";
import { bindingPortId, innerPortId } from "../layout";
import type { BlockPort, PortSide } from "../model";
import type { StudioFlowNode } from "../studio/types";

const positionBySide: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

function handleType(port: BlockPort): "source" | "target" {
  return port.direction === "input" ? "target" : "source";
}

function Port({
  port,
  index,
  count,
  nodeId,
  inspect,
  expanded,
}: {
  port: BlockPort;
  index: number;
  count: number;
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
  expanded: boolean;
}) {
  const offset = `${((index + 1) / (count + 1)) * 100}%`;
  const vertical = port.side === "left" || port.side === "right";
  const style = vertical ? { top: offset } : { left: offset };
  return (
    <div
      className={`bd-port bd-port-${port.side}`}
      style={style}
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
          position={positionBySide[port.side]}
          className={`bd-port-handle bd-port-handle-inner bd-port-handle-${port.direction}`}
        />
      )}
      <button
        type="button"
        className="bd-port-label nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          inspect?.(nodeId, port);
        }}
      >
        <span>{port.label}</span>
        {port.dataType && <small>{port.dataType}</small>}
      </button>
    </div>
  );
}

function portsForSide(ports: BlockPort[], side: PortSide): BlockPort[] {
  return ports
    .filter((port) => port.side === side)
    .sort((left, right) => (left.order ?? 999) - (right.order ?? 999) || left.label.localeCompare(right.label));
}

export function BlockNodeComponent({ id, data, selected }: NodeProps<StudioFlowNode>) {
  const { block } = data;
  const hierarchy = block.hierarchy;

  return (
    <article
      className={`bd-block${selected ? " is-selected" : ""}${hierarchy ? " is-hierarchical" : ""}${data.expanded ? " is-expanded" : ""}`}
      data-level-id={data.levelId}
      data-block-id={block.id}
      data-hierarchy-depth={data.hierarchyDepth}
      data-expanded={data.expanded ? "true" : "false"}
      data-tone={block.tone}
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

      {(["left", "right", "top", "bottom"] as PortSide[]).flatMap((side) => {
        const ports = portsForSide(block.ports, side);
        return ports.map((port, index) => (
          <Port
            key={port.id}
            port={port}
            index={index}
            count={ports.length}
            nodeId={block.id}
            inspect={data.inspectPort}
            expanded={data.expanded}
          />
        ));
      })}
    </article>
  );
}
