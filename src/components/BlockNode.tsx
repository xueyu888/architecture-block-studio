import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Box, Minus, Pin, Plus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  BLOCK_NODE_GEOMETRY,
  bindingPortId,
  innerPortId,
  minimumNodeDimensions,
  portLabelWidth,
  portsForSide,
  preserveNodeAspectRatio,
  resolvePortPlacement,
  type NodeResizeDirection,
  type NodeResizeRect,
  type PortPlacement,
} from "../layout";
import type { BlockPort, PortSide } from "../model";
import { useStudioLocale } from "../i18n/StudioLocale";
import type { CanvasFlowNode } from "./canvasTypes";
import { useViewportAutoPan } from "./ViewportAutoPanContext";
import type { ViewportAutoPanGesture, ViewportAutoPanPoint } from "./viewportAutoPan";

type GeometryStyle = CSSProperties & Record<`--${string}`, string>;

function resizeAltKey(event: { sourceEvent?: Event }): boolean {
  return event.sourceEvent instanceof MouseEvent || event.sourceEvent instanceof PointerEvent
    ? event.sourceEvent.altKey
    : false;
}

function resizeShiftKey(event: { sourceEvent?: Event }): boolean {
  return event.sourceEvent instanceof MouseEvent || event.sourceEvent instanceof PointerEvent
    ? event.sourceEvent.shiftKey
    : false;
}

function resizePointer(event: { sourceEvent?: Event }): ViewportAutoPanPoint | undefined {
  const source = event.sourceEvent;
  if (source instanceof MouseEvent || source instanceof PointerEvent) {
    return { clientX: source.clientX, clientY: source.clientY };
  }
  if (source instanceof TouchEvent && source.touches.length > 0) {
    return { clientX: source.touches[0].clientX, clientY: source.touches[0].clientY };
  }
  return undefined;
}

function replayResizePointer(event: { sourceEvent?: Event }, pointer: ViewportAutoPanPoint): void {
  const source = event.sourceEvent;
  if (!(source instanceof MouseEvent || source instanceof PointerEvent)) return;
  window.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    buttons: 1,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    altKey: source.altKey,
    ctrlKey: source.ctrlKey,
    metaKey: source.metaKey,
    shiftKey: source.shiftKey,
    view: window,
  }));
}

const positionBySide: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
};

const inwardPositionBySide: Record<PortSide, Position> = {
  left: Position.Right,
  right: Position.Left,
};

function handleType(port: BlockPort): "source" | "target" {
  return port.direction === "input" ? "target" : "source";
}

function Port({
  port,
  levelId,
  nodeId,
  inspect,
  expanded,
}: {
  port: BlockPort;
  levelId: string;
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
  expanded: boolean;
}) {
  const { t } = useStudioLocale();
  const offset = port.offset * 100;
  return (
    <div
      className={`bd-port bd-port-${port.side}`}
      data-level-id={levelId}
      data-node-id={nodeId}
      data-port-id={port.id}
      data-port-direction={port.direction}
      style={{ top: `${offset}%` }}
      title={`${port.label} · ${port.direction}${port.dataType ? ` · ${port.dataType}` : ""}`}
    >
      <Handle
        id={port.id}
        type={handleType(port)}
        position={positionBySide[port.side]}
        className={`bd-port-handle bd-port-handle-outer bd-port-handle-${port.direction}`}
        title={t("port.connect", { label: port.label })}
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
  nodeId,
  inspect,
  move,
  dragging,
}: {
  port: BlockPort;
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
  move?: (event: ReactPointerEvent<HTMLButtonElement>, port: BlockPort) => void;
  dragging: boolean;
}) {
  const { t } = useStudioLocale();
  const offset = port.offset * 100;
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`bd-port-label bd-port-label-${port.side} nodrag nopan${dragging ? " is-dragging" : ""}`}
      style={{
        top: `${offset}%`,
        "--port-label-width": `${portLabelWidth(port.label)}px`,
      } as GeometryStyle}
      title={`${port.label} · ${port.direction}${port.dataType ? ` · ${port.dataType}` : ""} · ${t("port.moveHint")}`}
      aria-label={t("port.move", { label: port.label })}
      onPointerDown={(event) => move?.(event, port)}
      onClick={(event) => {
        event.stopPropagation();
        inspect?.(nodeId, port);
      }}
    >
      <strong className="bd-port-direction" aria-hidden="true">{port.direction === "input" ? "IN" : "OUT"}</strong>
      <span className="bd-port-name">{port.label}</span>
      {port.dataType && <small>{port.dataType}</small>}
    </button>
  );
}

function PortRail({
  side,
  ports,
  levelId,
  nodeId,
  inspect,
  move,
  draggingPortId,
  expanded,
}: {
  side: PortSide;
  ports: readonly BlockPort[];
  levelId: string;
  nodeId: string;
  inspect?: (nodeId: string, port: BlockPort) => void;
  move?: (event: ReactPointerEvent<HTMLButtonElement>, port: BlockPort) => void;
  draggingPortId?: string;
  expanded: boolean;
}) {
  if (ports.length === 0) return null;
  return (
    <div className={`bd-port-rail bd-port-rail-${side}`} data-port-side={side}>
      {ports.map((port) => (
        <Port
          key={port.id}
          port={port}
          levelId={levelId}
          nodeId={nodeId}
          inspect={inspect}
          expanded={expanded}
        />
      ))}
      {ports.map((port) => (
        <PortLabel
          key={`label:${port.id}`}
          port={port}
          nodeId={nodeId}
          inspect={inspect}
          move={move}
          dragging={draggingPortId === port.id}
        />
      ))}
    </div>
  );
}

export function BlockNodeComponent({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { t } = useStudioLocale();
  const articleRef = useRef<HTMLElement>(null);
  const resizeGestureRef = useRef<{ original: NodeResizeRect; direction: NodeResizeDirection } | undefined>(undefined);
  const resizeAutoPanRef = useRef<ViewportAutoPanGesture | undefined>(undefined);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const handledTitleEditRequestRef = useRef<number | undefined>(undefined);
  const suppressTitleBlurCommitRef = useRef(false);
  const [titleDraft, setTitleDraft] = useState<string>();
  const [draggingPortId, setDraggingPortId] = useState<string>();
  const portGestureRef = useRef<{
    pointerId: number;
    portId: string;
    start: { x: number; y: number };
    latest: { x: number; y: number; altKey: boolean };
    moved: boolean;
    placement?: PortPlacement;
    autoPan?: ViewportAutoPanGesture;
  } | undefined>(undefined);
  const dataRef = useRef(data);
  const portGestureCleanupRef = useRef<() => void>(() => undefined);
  const suppressPortInspectRef = useRef<string | undefined>(undefined);
  dataRef.current = data;
  const viewportAutoPan = useViewportAutoPan();
  useEffect(() => () => resizeAutoPanRef.current?.stop(), []);
  const { block } = data;
  const hierarchy = block.hierarchy;
  const portsBySide = Object.fromEntries(
    (["left", "right"] as PortSide[])
      .map((side) => [side, portsForSide(block.ports, side)] as const),
  ) as Record<PortSide, BlockPort[]>;
  const widestLabel = (side: PortSide) => portsBySide[side]
    .reduce((width, port) => Math.max(width, portLabelWidth(port.label)), 0);
  const geometryStyle = {
    "--block-header-height": `${BLOCK_NODE_GEOMETRY.headerHeight}px`,
    "--block-owner-band-height": `${BLOCK_NODE_GEOMETRY.ownerBandHeight}px`,
    "--port-left-label-width": `${widestLabel("left")}px`,
    "--port-right-label-width": `${widestLabel("right")}px`,
    "--block-border-width": `${data.expanded
      ? BLOCK_NODE_GEOMETRY.expandedBorderWidth
      : BLOCK_NODE_GEOMETRY.borderWidth}px`,
    "--port-handle-size": `${BLOCK_NODE_GEOMETRY.portHandleSize}px`,
    "--port-side-label-height": `${BLOCK_NODE_GEOMETRY.sidePortLabelHeight}px`,
    "--port-side-label-inset": `${BLOCK_NODE_GEOMETRY.sidePortLabelInset}px`,
  } as GeometryStyle;
  const minimumSize = minimumNodeDimensions(block);
  const resizeVisible = selected && !data.expanded && Boolean(data.resizeNode) && data.canEditSelection?.() !== false;
  const beginTitleEdit = () => {
    if (!selected || !data.renameNode || data.canEditSelection?.() === false) return;
    suppressTitleBlurCommitRef.current = false;
    setTitleDraft(block.title);
  };
  const finishTitleEdit = (commit: boolean): boolean => {
    if (titleDraft === undefined) return false;
    const nextTitle = titleDraft.trim();
    if (commit && nextTitle.length === 0) {
      titleInputRef.current?.setCustomValidity("Module title is required.");
      titleInputRef.current?.reportValidity();
      titleInputRef.current?.focus();
      return false;
    }
    if (commit && nextTitle !== block.title && data.renameNode?.(nextTitle) === false) {
      titleInputRef.current?.focus();
      return false;
    }
    setTitleDraft(undefined);
    return true;
  };
  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (finishTitleEdit(event.key === "Enter")) suppressTitleBlurCommitRef.current = true;
  };
  useEffect(() => {
    if (titleDraft === undefined) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleDraft]);
  useEffect(() => {
    if (
      data.titleEditRequest === undefined ||
      data.titleEditRequest === handledTitleEditRequestRef.current
    ) return;
    handledTitleEditRequestRef.current = data.titleEditRequest;
    beginTitleEdit();
    data.acknowledgeTitleEditRequest?.(data.titleEditRequest);
  }, [data.titleEditRequest]);

  const updatePortPointer = (clientX: number, clientY: number, altKey: boolean) => {
    const gesture = portGestureRef.current;
    const article = articleRef.current;
    if (!gesture || !article) return;
    gesture.latest = { x: clientX, y: clientY, altKey };
    if (!gesture.moved && Math.hypot(clientX - gesture.start.x, clientY - gesture.start.y) < 3) return;
    if (!gesture.moved) {
      gesture.moved = true;
      setDraggingPortId(gesture.portId);
      gesture.autoPan = viewportAutoPan.start(
        { clientX, clientY },
        (pointer) => updatePortPointer(pointer.clientX, pointer.clientY, gesture.latest.altKey),
      );
    } else {
      gesture.autoPan?.update({ clientX, clientY });
    }
    const bounds = article.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const dimensions = { width: article.offsetWidth, height: article.offsetHeight };
    const placement = resolvePortPlacement(
      dimensions,
      dataRef.current.block.ports,
      gesture.portId,
      {
        x: ((clientX - bounds.left) / bounds.width) * dimensions.width,
        y: ((clientY - bounds.top) / bounds.height) * dimensions.height,
      },
      altKey,
    );
    gesture.placement = placement;
    dataRef.current.previewPortMove?.(gesture.portId, placement);
  };
  const finishPortMove = (event?: PointerEvent, commit = true) => {
    const gesture = portGestureRef.current;
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    portGestureCleanupRef.current();
    gesture.autoPan?.stop();
    portGestureRef.current = undefined;
    setDraggingPortId(undefined);
    if (commit && gesture.moved && gesture.placement) {
      suppressPortInspectRef.current = gesture.portId;
      window.setTimeout(() => {
        if (suppressPortInspectRef.current === gesture.portId) suppressPortInspectRef.current = undefined;
      }, 0);
      dataRef.current.movePort?.(gesture.portId, gesture.placement);
    } else {
      dataRef.current.cancelPortMove?.();
    }
  };
  const installPortGestureListeners = () => {
    const onPointerMove = (event: PointerEvent) => {
      if (portGestureRef.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      updatePortPointer(event.clientX, event.clientY, event.altKey);
    };
    const onPointerUp = (event: PointerEvent) => finishPortMove(event, true);
    const onPointerCancel = (event: PointerEvent) => finishPortMove(event, false);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !portGestureRef.current) return;
      event.preventDefault();
      finishPortMove(undefined, false);
    };
    const onBlur = () => finishPortMove(undefined, false);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    portGestureCleanupRef.current = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      portGestureCleanupRef.current = () => undefined;
    };
  };
  useEffect(() => () => {
    portGestureCleanupRef.current();
    portGestureRef.current?.autoPan?.stop();
  }, []);

  const beginPortMove = (event: ReactPointerEvent<HTMLButtonElement>, port: BlockPort) => {
    if (event.button !== 0 || !event.isPrimary || !data.movePort || data.canEditSelection?.() === false) return;
    event.preventDefault();
    event.stopPropagation();
    if (data.beginPortMove?.(port.id) === false) return;
    portGestureRef.current?.autoPan?.stop();
    portGestureRef.current = {
      pointerId: event.pointerId,
      portId: port.id,
      start: { x: event.clientX, y: event.clientY },
      latest: { x: event.clientX, y: event.clientY, altKey: event.altKey },
      moved: false,
    };
    installPortGestureListeners();
  };

  return (
    <article
      ref={articleRef}
      className={`bd-block${selected ? " is-selected" : ""}${hierarchy ? " is-hierarchical" : ""}${data.expanded ? " is-expanded" : ""}`}
      data-level-id={data.levelId}
      data-block-id={block.id}
      data-hierarchy-depth={data.hierarchyDepth}
      data-design-x={data.designPosition.x}
      data-design-y={data.designPosition.y}
      data-projected-x={data.projectedPosition.x}
      data-projected-y={data.projectedPosition.y}
      data-expanded={data.expanded ? "true" : "false"}
      data-resize-editable={data.resizeNode ? "true" : "false"}
      data-port-move-active={draggingPortId ? "true" : "false"}
      data-tone={block.tone}
      style={geometryStyle}
    >
      <NodeResizer
        nodeId={id}
        isVisible={resizeVisible}
        minWidth={minimumSize.width}
        minHeight={minimumSize.height}
        maxWidth={BLOCK_NODE_GEOMETRY.maximumWidth}
        maxHeight={BLOCK_NODE_GEOMETRY.maximumHeight}
        autoScale
        handleClassName="bd-node-resize-handle"
        lineClassName="bd-node-resize-line"
        onResizeStart={(event, geometry) => {
          resizeGestureRef.current = {
            original: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
            direction: { x: 0, y: 0 },
          };
          data.beginResize?.();
          const pointer = resizePointer(event);
          if (pointer) {
            resizeAutoPanRef.current?.stop();
            resizeAutoPanRef.current = viewportAutoPan.start(
              pointer,
              (latestPointer) => replayResizePointer(event, latestPointer),
            );
          }
        }}
        onResize={(event, geometry) => {
          const pointer = resizePointer(event);
          if (pointer) resizeAutoPanRef.current?.update(pointer);
          const gesture = resizeGestureRef.current;
          const direction = {
            x: Math.sign(geometry.direction[0]) as -1 | 0 | 1,
            y: Math.sign(geometry.direction[1]) as -1 | 0 | 1,
          };
          if (gesture) gesture.direction = direction;
          const requested = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
          const resolved = resizeShiftKey(event) && gesture
            ? preserveNodeAspectRatio(gesture.original, requested, direction, {
                minWidth: minimumSize.width,
                minHeight: minimumSize.height,
                maxWidth: BLOCK_NODE_GEOMETRY.maximumWidth,
                maxHeight: BLOCK_NODE_GEOMETRY.maximumHeight,
              })
            : requested;
          data.previewResize?.({
            position: { x: resolved.x, y: resolved.y },
            size: { width: resolved.width, height: resolved.height },
          }, resizeAltKey(event) || resizeShiftKey(event));
        }}
        onResizeEnd={(event, geometry) => {
          resizeAutoPanRef.current?.stop();
          resizeAutoPanRef.current = undefined;
          const gesture = resizeGestureRef.current;
          const requested = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
          const resolved = resizeShiftKey(event) && gesture
            ? preserveNodeAspectRatio(gesture.original, requested, gesture.direction, {
                minWidth: minimumSize.width,
                minHeight: minimumSize.height,
                maxWidth: BLOCK_NODE_GEOMETRY.maximumWidth,
                maxHeight: BLOCK_NODE_GEOMETRY.maximumHeight,
              })
            : requested;
          resizeGestureRef.current = undefined;
          data.resizeNode?.({
            position: { x: resolved.x, y: resolved.y },
            size: { width: resolved.width, height: resolved.height },
          }, resizeAltKey(event) || resizeShiftKey(event));
        }}
      />
      <div className="bd-block-content">
        <header className="bd-block-identity">
          {hierarchy ? (
            <button
              type="button"
              tabIndex={-1}
              className="bd-hierarchy-button nodrag nopan"
              title={data.expanded ? t("block.collapseHint") : t("block.expandHint")}
              aria-label={t(data.expanded ? "block.collapse" : "block.expand", { title: block.title })}
              onClick={(event) => {
                event.stopPropagation();
                data.toggleHierarchy?.(hierarchy.childLevelId);
              }}
            >
              {data.expanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
            </button>
          ) : <Box className="bd-block-symbol" size={13} aria-hidden="true" />}
          <div
            className="bd-block-heading"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              beginTitleEdit();
            }}
          >
            {titleDraft === undefined ? <h3>{block.title}</h3> : (
              <input
                ref={titleInputRef}
                className="bd-block-title-editor nodrag nopan"
                aria-label={t("block.rename", { title: block.title })}
                value={titleDraft}
                required
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setTitleDraft(event.target.value);
                }}
                onKeyDown={onTitleKeyDown}
                onBlur={() => {
                  if (suppressTitleBlurCommitRef.current) {
                    suppressTitleBlurCommitRef.current = false;
                    return;
                  }
                  finishTitleEdit(true);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              />
            )}
            <span>{block.process ?? block.kind}</span>
          </div>
          <span className="bd-block-identity-end">
            {block.layout.pinned && <Pin className="bd-pin-indicator" size={11} aria-label={t("block.authored")} />}
          </span>
        </header>
        {!data.expanded && (
          <>
          <div className="bd-block-body">
            {block.summary && <p>{block.summary}</p>}
          </div>
          <footer className="bd-block-owner">{block.owner ?? t("block.unassigned")}</footer>
          </>
        )}
        {data.expanded && (
          <div className="bd-hierarchy-watermark" aria-hidden="true">
            <strong>{hierarchy?.childLevelId}</strong>
            <span>{t("block.expanded")}</span>
          </div>
        )}
      </div>

      {(["left", "right"] as PortSide[]).map((side) => (
        <PortRail
          key={side}
          side={side}
          ports={portsBySide[side]}
          levelId={data.levelId}
          nodeId={block.id}
          inspect={(nodeId, port) => {
            if (suppressPortInspectRef.current === port.id) {
              suppressPortInspectRef.current = undefined;
              return;
            }
            data.inspectPort(nodeId, port);
          }}
          move={beginPortMove}
          draggingPortId={draggingPortId}
          expanded={data.expanded}
        />
      ))}
    </article>
  );
}
