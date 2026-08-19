import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Box, Map as MapIcon, Minus, Plus, Scan } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
  useStoreApi,
  type EdgeMouseHandler,
  type EdgeMarker,
  type Connection,
  type FitViewOptions,
  type MiniMapProps,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import { normalizeConnectionEndpoints } from "../model";
import type { BlockDesignDocument, BlockPort, ConnectionRouting } from "../model";
import type { LayoutResult } from "../layout";
import { planRouteLaneOffsets } from "../routing";
import type { SelectionRef } from "../studio/selection";
import { BlockNodeComponent } from "./BlockNode";
import { canvasDetailLevel, type CanvasDetailLevel } from "./canvasDetail";
import { reconcileCanvasSelection } from "./canvasSelection";
import type { CanvasFlowEdge, CanvasFlowNode, RouteHandleFocusTarget } from "./canvasTypes";
import { InterfaceEdgeComponent } from "./InterfaceEdge";
import { Tooltip } from "./Tooltip";

const nodeTypes = { block: BlockNodeComponent };
const edgeTypes = { interface: InterfaceEdgeComponent };
const FIT_PADDING = 0.28;
const NO_SELECTED_IDS: readonly string[] = [];
const SNAP_GRID: [number, number] = [16, 16];
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.4;
const NODE_KEYBOARD_DELTAS: Readonly<Record<string, { x: number; y: number; direction: string }>> = {
  ArrowLeft: { x: -SNAP_GRID[0], y: 0, direction: "left" },
  ArrowRight: { x: SNAP_GRID[0], y: 0, direction: "right" },
  ArrowUp: { x: 0, y: -SNAP_GRID[1], direction: "up" },
  ArrowDown: { x: 0, y: SNAP_GRID[1], direction: "down" },
};
const FIT_VIEW_OPTIONS = { padding: FIT_PADDING };
const REACT_FLOW_OPTIONS = { hideAttribution: true };
const LARGE_GRAPH_NODE_COUNT = 120;
const LARGE_GRAPH_EDGE_COUNT = 240;
const VIEWPORT_CULL_NODE_COUNT = 500;
const VIEWPORT_CULL_EDGE_COUNT = 1000;
const CONNECTION_TARGET_MARKER: EdgeMarker = {
  type: MarkerType.ArrowClosed,
  color: "context-stroke",
  width: 44,
  height: 32,
  markerUnits: "userSpaceOnUse",
  strokeWidth: 1,
};

const toneColors: Record<string, string> = {
  ui: "#2878a9",
  core: "#b34a3b",
  tool: "#3f7e47",
  platform: "#a76b1d",
  plugin: "#7457a6",
  neutral: "#65716a",
};

const CANVAS_BACKGROUND = (
  <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--canvas-grid)" />
);

function CanvasViewportControls({
  onZoomIn,
  onZoomOut,
  onFit,
  overviewMapOpen,
  onToggleOverviewMap,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  overviewMapOpen: boolean;
  onToggleOverviewMap: () => void;
}) {
  const zoom = useStore((state) => state.transform[2]);
  return (
    <Controls
      className="bd-canvas-controls"
      position="bottom-left"
      showZoom={false}
      showFitView={false}
      showInteractive={false}
      aria-label="Canvas viewport controls"
    >
      <Tooltip label="Zoom in" side="right">
        <ControlButton
          type="button"
          className="react-flow__controls-zoomin"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM - 0.001}
          onClick={onZoomIn}
        >
          <Plus aria-hidden="true" size={13} />
        </ControlButton>
      </Tooltip>
      <Tooltip label="Zoom out" side="right">
        <ControlButton
          type="button"
          className="react-flow__controls-zoomout"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM + 0.001}
          onClick={onZoomOut}
        >
          <Minus aria-hidden="true" size={13} />
        </ControlButton>
      </Tooltip>
      <Tooltip label="Fit design" side="right">
        <ControlButton
          type="button"
          className="react-flow__controls-fitview"
          aria-label="Fit design"
          onClick={onFit}
        >
          <Scan aria-hidden="true" size={13} />
        </ControlButton>
      </Tooltip>
      <Tooltip label={overviewMapOpen ? "Hide overview map" : "Show overview map"} side="right">
        <ControlButton
          type="button"
          className="bd-minimap-toggle"
          aria-label={overviewMapOpen ? "Hide overview map" : "Show overview map"}
          aria-pressed={overviewMapOpen}
          onClick={onToggleOverviewMap}
        >
          <MapIcon aria-hidden="true" size={13} />
        </ControlButton>
      </Tooltip>
    </Controls>
  );
}

function miniMapNodeColor(node: CanvasFlowNode): string {
  return toneColors[node.data.block.tone] ?? toneColors.neutral;
}

function fitDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;
}

function physicalEndpointKey(nodeId: string, handleId: string | null | undefined): string {
  return `${nodeId}::${(handleId ?? "").replace(/^__(?:inner|binding)__/, "")}`;
}

function warnReactFlowError(code: string, message: string): void {
  console.warn(`[React Flow ${code}] ${message}`);
}

interface CanvasInnerProps {
  entryLevelId: string;
  layout: LayoutResult;
  selection: SelectionRef;
  fitRequest: number;
  revealSelectionRequest: number;
  routeRevision: number;
  onSelect: (selection: SelectionRef) => boolean;
  onToggleHierarchy: (levelId: string) => void;
  onMoveNode: (levelId: string, nodeId: string, position: { x: number; y: number }) => boolean;
  onCreateConnection: (connection: {
    levelId: string;
    source: { nodeId: string; portId: string; label: string };
    target: { nodeId: string; portId: string; label: string };
  }) => void;
  onRouteConnection: (levelId: string, connectionId: string, routing: ConnectionRouting | undefined) => boolean;
  onReconnectConnection: (
    levelId: string,
    connectionId: string,
    source: { nodeId: string; portId: string },
    target: { nodeId: string; portId: string },
  ) => boolean;
}

type RouteHandleFocusRequest = RouteHandleFocusTarget & {
  edgeId: string;
};

interface NodeFocusRequest {
  flowNodeId: string;
  designPosition: { x: number; y: number };
}

export interface BlockDesignCanvasProps extends Omit<CanvasInnerProps, "entryLevelId"> {
  document: BlockDesignDocument;
  onAddModule: () => void;
}

const CanvasInner = memo(function CanvasInner({
  entryLevelId,
  layout,
  selection,
  fitRequest,
  revealSelectionRequest,
  routeRevision,
  onSelect,
  onToggleHierarchy,
  onMoveNode,
  onCreateConnection,
  onRouteConnection,
  onReconnectConnection,
}: CanvasInnerProps) {
  const { fitView, getViewport, setViewport, zoomIn, zoomOut } = useReactFlow();
  const store = useStoreApi();
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [nodeFocusRequest, setNodeFocusRequest] = useState<NodeFocusRequest>();
  const [routeHandleFocusRequest, setRouteHandleFocusRequest] = useState<RouteHandleFocusRequest>();
  const [canvasAnnouncement, setCanvasAnnouncement] = useState("");
  const [compactOverviewMapOpen, setCompactOverviewMapOpen] = useState(false);
  const largeGraph = layout.nodes.length >= LARGE_GRAPH_NODE_COUNT
    || layout.edges.length >= LARGE_GRAPH_EDGE_COUNT;
  const cullViewportElements = layout.nodes.length >= VIEWPORT_CULL_NODE_COUNT
    || layout.edges.length >= VIEWPORT_CULL_EDGE_COUNT;
  const navigationInterpolation: "linear" | "smooth" = cullViewportElements ? "linear" : "smooth";
  const navigationDuration = cullViewportElements ? 0 : fitDuration();
  const navigationOptionsRef = useRef({
    duration: navigationDuration,
    interpolate: navigationInterpolation,
  });
  const viewportNavigationGeneration = useRef(0);
  const animatedViewportNavigationActive = useRef(false);
  navigationOptionsRef.current = {
    duration: navigationDuration,
    interpolate: navigationInterpolation,
  };
  const runViewportNavigation = useCallback((duration: number, navigate: () => Promise<boolean>) => {
    const generation = viewportNavigationGeneration.current + 1;
    viewportNavigationGeneration.current = generation;
    animatedViewportNavigationActive.current = duration > 0;
    void navigate().finally(() => {
      if (viewportNavigationGeneration.current === generation) {
        animatedViewportNavigationActive.current = false;
      }
    });
  }, []);
  const navigateViewport = useCallback((options: FitViewOptions<CanvasFlowNode>) => {
    runViewportNavigation(options.duration ?? 0, () => fitView(options));
  }, [fitView, runViewportNavigation]);
  const zoomViewport = useCallback((direction: "in" | "out") => {
    const duration = fitDuration();
    runViewportNavigation(
      duration,
      () => direction === "in" ? zoomIn({ duration }) : zoomOut({ duration }),
    );
  }, [runViewportNavigation, zoomIn, zoomOut]);
  const zoomInViewport = useCallback(() => zoomViewport("in"), [zoomViewport]);
  const zoomOutViewport = useCallback(() => zoomViewport("out"), [zoomViewport]);
  const fitCanvasViewport = useCallback(() => {
    navigateViewport({ ...FIT_VIEW_OPTIONS, duration: fitDuration() });
  }, [navigateViewport]);
  const interruptViewportNavigation = useCallback(() => {
    if (!animatedViewportNavigationActive.current) return;
    animatedViewportNavigationActive.current = false;
    viewportNavigationGeneration.current += 1;
    void setViewport(getViewport(), { duration: 0 });
  }, [getViewport, setViewport]);
  const baseNodes = useMemo<CanvasFlowNode[]>(
    () =>
      layout.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          toggleHierarchy: onToggleHierarchy,
          inspectPort: (nodeId: string, port: BlockPort) =>
            selectRef.current({ kind: "port", levelId: node.data.levelId, nodeId, portId: port.id }),
        },
      })),
    [layout.nodes, onToggleHierarchy],
  );
  const baseEdges = useMemo<CanvasFlowEdge[]>(
    () => {
      const endpointUse = new Map<string, Set<string>>();
      layout.edges.forEach((edge) => {
        const sourceKey = physicalEndpointKey(edge.source, edge.sourceHandle);
        const targetKey = physicalEndpointKey(edge.target, edge.targetHandle);
        endpointUse.set(sourceKey, new Set(endpointUse.get(sourceKey)).add(edge.data?.connection.id ?? edge.id));
        endpointUse.set(targetKey, new Set(endpointUse.get(targetKey)).add(edge.data?.connection.id ?? edge.id));
      });
      const laneOffsets = planRouteLaneOffsets(layout.edges.map((edge) => ({
        connectionId: edge.data?.connection.id ?? edge.id,
        sourceEndpointKey: physicalEndpointKey(edge.source, edge.sourceHandle),
        targetEndpointKey: physicalEndpointKey(edge.target, edge.targetHandle),
        channelKey: [edge.source, edge.target].sort().join("::pair::"),
      })));
      return layout.edges.map<CanvasFlowEdge>((edge) => {
        const data = edge.data;
        if (!data) throw new Error(`Layout edge ${edge.id} is missing interface data.`);
        const sourceKey = physicalEndpointKey(edge.source, edge.sourceHandle);
        const targetKey = physicalEndpointKey(edge.target, edge.targetHandle);
        const separateSourceEndpoint = (endpointUse.get(sourceKey)?.size ?? 0) > 1;
        const separateTargetEndpoint = (endpointUse.get(targetKey)?.size ?? 0) > 1;
        return {
          ...edge,
          reconnectable: !data.boundaryContinuation,
          markerEnd: data.boundaryContinuation ? undefined : CONNECTION_TARGET_MARKER,
          data: {
            ...data,
            largeGraph,
            laneOffset: laneOffsets.get(data.connection.id) ?? 0,
            separateSourceEndpoint,
            separateTargetEndpoint,
            updateRouting: data.boundaryContinuation
              ? undefined
              : (routing) => onRouteConnection(data.levelId, data.connection.id, routing),
            requestRouteHandleFocus: data.boundaryContinuation
              ? undefined
              : (handle) => setRouteHandleFocusRequest({ edgeId: edge.id, ...handle }),
          },
        };
      });
    },
    [largeGraph, layout.edges, onRouteConnection],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(baseNodes);
  const flowNodeIdsBySelection = useMemo(() => {
    const result = new Map<string, string[]>();
    baseNodes.forEach((node) => {
      const key = `${node.data.levelId}\u0000${node.data.block.id}`;
      result.set(key, [...(result.get(key) ?? []), node.id]);
    });
    return result;
  }, [baseNodes]);
  const selectedNodeIds = selection.kind === "node"
    ? flowNodeIdsBySelection.get(`${selection.levelId}\u0000${selection.nodeId}`) ?? NO_SELECTED_IDS
    : NO_SELECTED_IDS;
  const selectedNodeIdsKey = selectedNodeIds.join("\u0000");
  const selectedNodeIdsRef = useRef<ReadonlySet<string>>(new Set(selectedNodeIds));
  selectedNodeIdsRef.current = new Set(selectedNodeIds);
  const routedEdges = useMemo<CanvasFlowEdge[]>(
    () => baseEdges.map((edge) => ({
      ...edge,
      data: edge.data ? { ...edge.data, routeRevision } : edge.data,
    })),
    [baseEdges, routeRevision],
  );
  const flowEdgeIdsBySelection = useMemo(() => {
    const result = new Map<string, string[]>();
    routedEdges.forEach((edge) => {
      const data = edge.data;
      if (!data) return;
      const key = `${data.levelId}\u0000${data.connection.id}`;
      result.set(key, [...(result.get(key) ?? []), edge.id]);
    });
    return result;
  }, [routedEdges]);
  const selectedEdgeIds = selection.kind === "connection"
    ? flowEdgeIdsBySelection.get(`${selection.levelId}\u0000${selection.connectionId}`) ?? NO_SELECTED_IDS
    : NO_SELECTED_IDS;
  const selectedEdgeIdsKey = selectedEdgeIds.join("\u0000");
  const selectedEdgeIdsRef = useRef<ReadonlySet<string>>(new Set(selectedEdgeIds));
  selectedEdgeIdsRef.current = new Set(selectedEdgeIds);
  const handledRevealSelectionRequest = useRef(0);
  const [edges, setEdges] = useState<CanvasFlowEdge[]>(() =>
    reconcileCanvasSelection(routedEdges, selectedEdgeIdsRef.current),
  );

  useEffect(() => {
    let appliedDetailLevel: CanvasDetailLevel | undefined;
    let appliedZoom: number | undefined;
    const syncViewportPresentation = () => {
      const state = store.getState();
      const root = state.domNode;
      if (!root) return;
      const zoom = state.transform[2];
      if (zoom !== appliedZoom) {
        root.style.setProperty("--canvas-inverse-zoom", String(1 / zoom));
        appliedZoom = zoom;
      }
      const nextDetailLevel = canvasDetailLevel(zoom);
      if (nextDetailLevel === appliedDetailLevel) return;
      root.dataset.detailLevel = nextDetailLevel;
      appliedDetailLevel = nextDetailLevel;
    };

    syncViewportPresentation();
    return store.subscribe(syncViewportPresentation);
  }, [store]);

  useEffect(() => {
    setNodes(reconcileCanvasSelection(baseNodes, selectedNodeIdsRef.current));
  }, [baseNodes, setNodes]);

  useEffect(() => {
    setEdges(reconcileCanvasSelection(routedEdges, selectedEdgeIdsRef.current));
  }, [routedEdges]);

  useEffect(() => {
    if (baseNodes.length === 0) return;
    const retry = window.setTimeout(() => {
      const state = store.getState();
      const updates = new Map();
      baseNodes.forEach((node) => {
        const nodeElement = state.domNode?.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${node.id}"]`,
        );
        if (nodeElement) updates.set(node.id, { id: node.id, nodeElement, force: true });
      });
      state.updateNodeInternals(updates, { triggerFitView: false });
    }, 120);
    return () => window.clearTimeout(retry);
  }, [baseNodes, store]);

  useEffect(() => {
    setNodes((current) => reconcileCanvasSelection(current, selectedNodeIdsRef.current));
  }, [selectedNodeIdsKey, setNodes]);

  useEffect(() => {
    setEdges((current) => reconcileCanvasSelection(current, selectedEdgeIdsRef.current));
  }, [selectedEdgeIdsKey]);

  useEffect(() => {
    if (!nodeFocusRequest) return;
    if (!selectedNodeIdsRef.current.has(nodeFocusRequest.flowNodeId)) {
      setNodeFocusRequest(undefined);
      return;
    }
    const projected = nodes.find((candidate) => candidate.id === nodeFocusRequest.flowNodeId);
    if (
      projected?.data.designPosition.x !== nodeFocusRequest.designPosition.x ||
      projected.data.designPosition.y !== nodeFocusRequest.designPosition.y
    ) return;
    let frame = 0;
    let previousNode: HTMLElement | undefined;
    let stableFrames = 0;
    let attempts = 0;
    const restoreFocus = () => {
      const root = store.getState().domNode;
      const node = [...(root?.querySelectorAll<HTMLElement>(".react-flow__node") ?? [])]
        .find((candidate) => candidate.dataset.id === nodeFocusRequest.flowNodeId);
      if (node) {
        node.focus();
        stableFrames = node === previousNode && document.activeElement === node ? stableFrames + 1 : 0;
        previousNode = node;
        if (stableFrames >= 2) {
          setNodeFocusRequest((current) => current === nodeFocusRequest ? undefined : current);
          return;
        }
      }
      attempts += 1;
      if (attempts < 12) frame = window.requestAnimationFrame(restoreFocus);
    };
    frame = window.requestAnimationFrame(restoreFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [nodeFocusRequest, nodes, store]);

  useEffect(() => {
    if (!routeHandleFocusRequest) return;
    if (!selectedEdgeIdsRef.current.has(routeHandleFocusRequest.edgeId)) {
      setRouteHandleFocusRequest(undefined);
      return;
    }
    let frame = 0;
    let previousHandle: HTMLButtonElement | undefined;
    let stableFrames = 0;
    let attempts = 0;
    const restoreFocus = () => {
      const root = store.getState().domNode;
      const edge = [...(root?.querySelectorAll<SVGGElement>(".react-flow__edge") ?? [])]
        .find((candidate) => candidate.dataset.id === routeHandleFocusRequest.edgeId);
      const candidates = routeHandleFocusRequest.kind === "segment"
        ? [...(edge?.querySelectorAll<HTMLButtonElement>(
            `.bd-route-segment-handle.bd-route-handle-${routeHandleFocusRequest.axis}`,
          ) ?? [])].filter(
            (candidate) => Number(candidate.getAttribute("aria-valuenow")) === routeHandleFocusRequest.coordinate,
          )
        : [...(edge?.querySelectorAll<HTMLButtonElement>(".bd-route-bend-handle") ?? [])];
      const handle = candidates.find((candidate) =>
        Number(candidate.dataset.routeHandleIndex) === routeHandleFocusRequest.index,
      ) ?? candidates[0];
      if (handle) {
        handle.focus();
        stableFrames = handle === previousHandle && document.activeElement === handle ? stableFrames + 1 : 0;
        previousHandle = handle;
        if (stableFrames >= 2) {
          setRouteHandleFocusRequest((current) => current === routeHandleFocusRequest ? undefined : current);
          return;
        }
      }
      attempts += 1;
      if (attempts < 12) frame = window.requestAnimationFrame(restoreFocus);
    };
    frame = window.requestAnimationFrame(restoreFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [edges, routeHandleFocusRequest, store]);

  useEffect(() => {
    if (fitRequest <= 0) return;
    const timer = window.setTimeout(() => navigateViewport({ padding: FIT_PADDING, duration: fitDuration() }), 60);
    return () => window.clearTimeout(timer);
  }, [fitRequest, navigateViewport]);

  useEffect(() => {
    if (revealSelectionRequest <= handledRevealSelectionRequest.current) return;
    const targetNodeIds = new Set<string>();
    if (selection.kind === "node" || selection.kind === "port") {
      flowNodeIdsBySelection
        .get(`${selection.levelId}\u0000${selection.nodeId}`)
        ?.forEach((id) => targetNodeIds.add(id));
    } else if (selection.kind === "connection") {
      flowEdgeIdsBySelection
        .get(`${selection.levelId}\u0000${selection.connectionId}`)
        ?.forEach((id) => {
          const edge = routedEdges.find((candidate) => candidate.id === id);
          if (edge) {
            targetNodeIds.add(edge.source);
            targetNodeIds.add(edge.target);
          }
        });
    } else if (selection.kind === "level") {
      baseNodes
        .filter((node) => node.data.levelId === selection.levelId)
        .forEach((node) => targetNodeIds.add(node.id));
    } else {
      handledRevealSelectionRequest.current = revealSelectionRequest;
      return;
    }
    if (targetNodeIds.size === 0) return;
    handledRevealSelectionRequest.current = revealSelectionRequest;
    const timer = window.setTimeout(() => {
      navigateViewport({
        nodes: [...targetNodeIds].map((id) => ({ id })),
        padding: 0.55,
        maxZoom: 1.05,
        duration: navigationDuration,
        interpolate: navigationInterpolation,
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [
    baseNodes,
    flowEdgeIdsBySelection,
    flowNodeIdsBySelection,
    navigationDuration,
    navigationInterpolation,
    navigateViewport,
    revealSelectionRequest,
    routedEdges,
    selection,
  ]);

  const onNodeClick = useCallback<NodeMouseHandler<CanvasFlowNode>>((_, node) => {
    onSelect({ kind: "node", levelId: node.data.levelId, nodeId: node.data.block.id });
  }, [onSelect]);
  const onNodeDoubleClick = useCallback<NodeMouseHandler<CanvasFlowNode>>((_, node) => {
    if (node.data.block.hierarchy) onToggleHierarchy(node.data.block.hierarchy.childLevelId);
  }, [onToggleHierarchy]);
  const onEdgeClick = useCallback<EdgeMouseHandler<CanvasFlowEdge>>((_, edge) => {
    if (!edge.data) return;
    onSelect({ kind: "connection", levelId: edge.data.levelId, connectionId: edge.data.connection.id });
  }, [onSelect]);
  const onElementKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches(".react-flow__node, .react-flow__edge")) return;
    const flowId = target.getAttribute("data-id");
    if (!flowId) return;
    const node = baseNodes.find((candidate) => candidate.id === flowId);
    const edge = node ? undefined : routedEdges.find((candidate) => candidate.id === flowId);
    const keyboardDelta = NODE_KEYBOARD_DELTAS[event.key];
    if (node && keyboardDelta && node.data.positionEditable && selectedNodeIdsRef.current.has(flowId)) {
      event.preventDefault();
      event.stopPropagation();
      const designPosition = {
        x: node.data.designPosition.x + keyboardDelta.x,
        y: node.data.designPosition.y + keyboardDelta.y,
      };
      if (onMoveNode(node.data.levelId, node.data.block.id, designPosition)) {
        setNodeFocusRequest({ flowNodeId: flowId, designPosition });
        setCanvasAnnouncement(
          `Moved ${node.data.block.title} ${keyboardDelta.direction}. Position x ${designPosition.x}, y ${designPosition.y}.`,
        );
      }
      return;
    }
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Escape") return;
    const levelId = node?.data.levelId ?? edge?.data?.levelId;
    if (!levelId) return;
    const nextSelection: SelectionRef = event.key === "Escape"
      ? { kind: "level", levelId }
      : node
        ? { kind: "node", levelId, nodeId: node.data.block.id }
        : { kind: "connection", levelId, connectionId: edge!.data!.connection.id };
    event.preventDefault();
    event.stopPropagation();
    if (selectRef.current(nextSelection) && event.key === "Escape") {
      (target as Element & { blur?: () => void }).blur?.();
    }
  }, [baseNodes, onMoveNode, routedEdges]);

  const resolveEndpoint = useCallback((flowNodeId: string | null, handleId: string | null | undefined) => {
    if (!flowNodeId || !handleId) return undefined;
    const flowNode = baseNodes.find((node) => node.id === flowNodeId);
    const port = flowNode?.data.block.ports.find((candidate) => candidate.id === handleId);
    if (!flowNode || !port) return undefined;
    return {
      levelId: flowNode.data.levelId,
      nodeId: flowNode.data.block.id,
      nodeTitle: flowNode.data.block.title,
      portId: port.id,
      label: port.label,
      direction: port.direction,
    };
  }, [baseNodes]);

  const normalizedConnection = useCallback((connection: Connection | CanvasFlowEdge) => {
    const first = resolveEndpoint(connection.source, connection.sourceHandle);
    const second = resolveEndpoint(connection.target, connection.targetHandle);
    return normalizeConnectionEndpoints(first, second);
  }, [resolveEndpoint]);

  const onNodeDragStop = useCallback<OnNodeDrag<CanvasFlowNode>>((_, node) => {
    const original = baseNodes.find((candidate) => candidate.id === node.id);
    if (!original) return;
    const accepted = node.data.positionEditable && onMoveNode(node.data.levelId, node.data.block.id, {
      x: Math.round(node.data.designPosition.x + node.position.x - original.position.x),
      y: Math.round(node.data.designPosition.y + node.position.y - original.position.y),
    });
    if (accepted) return;
    setNodes((current) => current.map((candidate) => candidate.id === node.id
      ? { ...candidate, position: { ...original.position }, dragging: false }
      : candidate));
  }, [baseNodes, onMoveNode, setNodes]);
  const onConnect = useCallback((connection: Connection) => {
    const normalized = normalizedConnection(connection);
    if (normalized) onCreateConnection(normalized);
  }, [normalizedConnection, onCreateConnection]);
  const onReconnect = useCallback((edge: CanvasFlowEdge, connection: Connection) => {
    const normalized = normalizedConnection(connection);
    if (!normalized || !edge.data) return;
    onReconnectConnection(
      edge.data.levelId,
      edge.data.connection.id,
      { nodeId: normalized.source.nodeId, portId: normalized.source.portId },
      { nodeId: normalized.target.nodeId, portId: normalized.target.portId },
    );
  }, [normalizedConnection, onReconnectConnection]);
  const isValidConnection = useCallback(
    (connection: Connection | CanvasFlowEdge) => Boolean(normalizedConnection(connection)),
    [normalizedConnection],
  );
  const onPaneClick = useCallback(
    () => onSelect({ kind: "level", levelId: entryLevelId }),
    [entryLevelId, onSelect],
  );
  const onMiniMapNodeClick = useCallback<NonNullable<MiniMapProps<CanvasFlowNode>["onNodeClick"]>>(
    (event, node) => {
      event.stopPropagation();
      if (!selectRef.current({
        kind: "node",
        levelId: node.data.levelId,
        nodeId: node.data.block.id,
      })) return;
      const navigation = navigationOptionsRef.current;
      navigateViewport({
        nodes: [{ id: node.id }],
        padding: 0.55,
        maxZoom: 1.05,
        duration: navigation.duration,
        interpolate: navigation.interpolate,
      });
    },
    [navigateViewport],
  );

  return (
    <>
      <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onEdgeClick={onEdgeClick}
      onPointerMoveCapture={interruptViewportNavigation}
      onKeyDownCapture={onElementKeyDownCapture}
      onConnect={onConnect}
      onReconnect={onReconnect}
      isValidConnection={isValidConnection}
      onError={warnReactFlowError}
      onPaneClick={onPaneClick}
      connectionMode={ConnectionMode.Loose}
      nodesConnectable
      edgesReconnectable
      snapToGrid
      snapGrid={SNAP_GRID}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      panOnScroll
      selectionOnDrag
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      onlyRenderVisibleElements={cullViewportElements}
      proOptions={REACT_FLOW_OPTIONS}
      deleteKeyCode={null}
      className="bd-react-flow"
    >
      {CANVAS_BACKGROUND}
      <CanvasViewportControls
        onZoomIn={zoomInViewport}
        onZoomOut={zoomOutViewport}
        onFit={fitCanvasViewport}
        overviewMapOpen={compactOverviewMapOpen}
        onToggleOverviewMap={() => setCompactOverviewMapOpen((open) => !open)}
      />
      <MiniMap<CanvasFlowNode>
        className={`bd-canvas-minimap${compactOverviewMapOpen ? " is-compact-open" : ""}`}
        position="bottom-right"
        pannable
        zoomable
        nodeColor={miniMapNodeColor}
        maskColor="var(--minimap-mask)"
        onNodeClick={onMiniMapNodeClick}
      />
      </ReactFlow>
      <div className="bd-visually-hidden bd-canvas-announcement" role="status" aria-live="polite" aria-atomic="true">
        {canvasAnnouncement}
      </div>
    </>
  );
});

export function BlockDesignCanvas(props: BlockDesignCanvasProps) {
  const entryLevel = props.document.levels.find((level) => level.id === props.document.entryLevelId)!;
  return (
    <>
      <CanvasInner
        entryLevelId={entryLevel.id}
        layout={props.layout}
        selection={props.selection}
        fitRequest={props.fitRequest}
        revealSelectionRequest={props.revealSelectionRequest}
        routeRevision={props.routeRevision}
        onSelect={props.onSelect}
        onToggleHierarchy={props.onToggleHierarchy}
        onMoveNode={props.onMoveNode}
        onCreateConnection={props.onCreateConnection}
        onRouteConnection={props.onRouteConnection}
        onReconnectConnection={props.onReconnectConnection}
      />
      <div className="bd-canvas-caption bd-canvas-caption-overlay">
        <strong>{entryLevel.title}</strong>
        <span>{entryLevel.description}</span>
      </div>
      {entryLevel.nodes.length === 0 && (
        <section className="bd-canvas-empty" aria-labelledby="empty-design-title">
          <span className="bd-canvas-empty-icon"><Box size={20} aria-hidden="true" /></span>
          <small>EMPTY DESIGN</small>
          <h2 id="empty-design-title">Start with a module</h2>
          <p>Define one responsibility boundary, then add named ports and connect a typed interface.</p>
          <div className="bd-canvas-empty-sequence" aria-label="Design sequence">
            <span>1&nbsp; Module</span><i aria-hidden="true">→</i><span>2&nbsp; Port</span><i aria-hidden="true">→</i><span>3&nbsp; Interface</span>
          </div>
          <button type="button" className="bd-command-button is-primary" onClick={props.onAddModule}>
            <Plus size={15} aria-hidden="true" /> Add first module
          </button>
        </section>
      )}
    </>
  );
}
