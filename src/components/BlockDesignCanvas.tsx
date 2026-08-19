import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Box, Hand, Map as MapIcon, Minus, Plus, Scan } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
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
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import { normalizeConnectionEndpoints } from "../model";
import type { NodeMove } from "../editor";
import type {
  BlockDesignDocument,
  BlockPort,
  ConnectablePortEndpoint,
  ConnectionRouting,
  PortDirection,
} from "../model";
import {
  BLOCK_NODE_GEOMETRY,
  minimumNodeDimensions,
  snapMovingRect,
  snapResizingRect,
  type AlignmentGuide,
  type AlignmentRect,
  type LayoutFlowNode,
  type LayoutResult,
  type ResizeLimits,
} from "../layout";
import {
  createRoutingSceneFromLayout,
  planRouteJumps,
  routingPolicyForScene,
  solveRoutingScene,
  type RoutingResult,
} from "../routing";
import {
  diagramSelectionKey,
  diagramSelectionItems,
  replaceDiagramSelection,
  toggleDiagramSelection,
  type DiagramSelectionRef,
  type SelectionRef,
} from "../studio/selection";
import { AlignmentGuideLayer } from "./AlignmentGuideLayer";
import { BlockNodeComponent } from "./BlockNode";
import {
  ConnectionGestureFeedbackPanel,
  ConnectionGesturePanel,
  ConnectionGesturePreview,
  type ActiveConnectionGesture,
  type ConnectionGestureFeedback,
} from "./ConnectionGestureLayer";
import { canvasDetailLevel, type CanvasDetailLevel } from "./canvasDetail";
import {
  canvasBoundsSelectBounds,
  canvasBoundsSelectRoute,
  canvasClientBounds,
  canvasGeometryBounds,
  canvasPointHitStack,
  canvasSelectionTraversal,
  nextCanvasPointHitTarget,
  nextCanvasTraversalTarget,
  reconcileCanvasSelection,
  type CanvasBoundsSelectionMode,
  type CanvasPointHitTarget,
  type CanvasTraversalTarget,
} from "./canvasSelection";
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
const CANVAS_OBJECT_CONTROL_SELECTOR = "button:not([disabled]), [tabindex='0']";
const FIT_VIEW_OPTIONS = { padding: FIT_PADDING };
const REACT_FLOW_OPTIONS = { hideAttribution: true };
const VIEWPORT_CULL_NODE_COUNT = 500;
const VIEWPORT_CULL_EDGE_COUNT = 1000;
const routingResultCache = new WeakMap<object, { geometrySignature: string; result: RoutingResult }>();
const ALIGNMENT_TOLERANCE_PX = 6;
const ALIGNMENT_VIEWPORT_MARGIN_PX = 80;
const ALT_CLICK_TOLERANCE_PX = 5;
const EDGE_POINTER_TOLERANCE_PX = 14;
const NODE_VISUAL_LAYER_BASE = 1_000;
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
  onActualSize,
  onFit,
  overviewMapOpen,
  onToggleOverviewMap,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onActualSize: () => void;
  onFit: () => void;
  overviewMapOpen: boolean;
  onToggleOverviewMap: () => void;
}) {
  const zoom = useStore((state) => state.transform[2]);
  return (
    <Controls
      className="bd-canvas-controls nokey"
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
      <Tooltip label="Actual size" detail="Reset the canvas to 100%" side="right">
        <ControlButton
          type="button"
          className="bd-canvas-zoom-readout"
          aria-label={`Actual size, current zoom ${Math.round(zoom * 100)}%`}
          onClick={onActualSize}
        >
          {Math.round(zoom * 100)}%
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

function warnReactFlowError(code: string, message: string): void {
  console.warn(`[React Flow ${code}] ${message}`);
}

export type CanvasViewportAction = "zoom-in" | "zoom-out" | "actual-size";

export interface CanvasViewportActionRequest {
  revision: number;
  action: CanvasViewportAction;
}

interface CanvasInnerProps {
  entryLevelId: string;
  layout: LayoutResult;
  selection: SelectionRef;
  fitRequest: number;
  fitSelectionRequest: number;
  viewportActionRequest: CanvasViewportActionRequest;
  revealSelectionRequest: number;
  routeRevision: number;
  onSelect: (selection: SelectionRef) => boolean;
  onToggleHierarchy: (levelId: string) => void;
  onMoveNodes: (moves: readonly NodeMove[]) => boolean;
  onCloneNodes: (moves: readonly NodeMove[]) => boolean;
  onResizeNode: (
    levelId: string,
    nodeId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => boolean;
  onCreateConnection: (connection: {
    levelId: string;
    source: { nodeId: string; portId: string; label: string };
    target: { nodeId: string; portId: string; label: string };
  }) => boolean;
  onRouteConnection: (levelId: string, connectionId: string, routing: ConnectionRouting | undefined) => boolean;
  onReconnectConnection: (
    levelId: string,
    connectionId: string,
    source: { nodeId: string; portId: string },
    target: { nodeId: string; portId: string },
  ) => "changed" | "unchanged" | "rejected";
}

type ConnectionGestureCommitResult = "accepted" | "changed" | "unchanged" | "rejected";

type RouteHandleFocusRequest = RouteHandleFocusTarget & {
  edgeId: string;
};

interface NodeFocusRequest {
  flowNodeId: string;
  designPosition: { x: number; y: number };
  dimensions?: { width: number; height: number };
}

interface SelectionFocusRequest {
  revision: number;
  item: DiagramSelectionRef;
}

interface AlignmentGesture {
  nodeId: string;
  original: AlignmentRect;
  originalLocalPosition: { x: number; y: number };
  candidates: AlignmentRect[];
  tolerance: number;
  limits: ResizeLimits;
}

interface ResizePreview {
  nodeId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface BoxSelectionGesture {
  base: SelectionRef;
  toggle: boolean;
  mode: CanvasBoundsSelectionMode;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface AltClickGesture {
  pointerId: number;
  start: { x: number; y: number };
  moved: boolean;
}

function hasToggleModifier(event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

function blocksCanvasPanMode(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='menu']",
  ));
}

function renderedFlowElement(
  root: HTMLElement | null | undefined,
  selector: ".react-flow__node" | ".react-flow__edge",
  ids: readonly string[],
): HTMLElement | SVGElement | undefined {
  if (!root || ids.length === 0) return undefined;
  const idSet = new Set(ids);
  return [...root.querySelectorAll<HTMLElement | SVGElement>(`${selector}[data-id]`)]
    .find((element) => idSet.has(element.getAttribute("data-id") ?? ""));
}

function flowElementIntersectsCanvas(element: Element, root: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  const canvas = root.getBoundingClientRect();
  return bounds.right >= canvas.left && bounds.left <= canvas.right
    && bounds.bottom >= canvas.top && bounds.top <= canvas.bottom;
}

function focusRestorationWasSuperseded(previousElement: Element | undefined): boolean {
  return Boolean(
    previousElement?.isConnected && document.activeElement !== previousElement,
  );
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
  fitSelectionRequest,
  viewportActionRequest,
  revealSelectionRequest,
  routeRevision,
  onSelect,
  onToggleHierarchy,
  onMoveNodes,
  onCloneNodes,
  onResizeNode,
  onCreateConnection,
  onRouteConnection,
  onReconnectConnection,
}: CanvasInnerProps) {
  const { fitBounds, fitView, getViewport, setViewport, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const store = useStoreApi();
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [nodeFocusRequest, setNodeFocusRequest] = useState<NodeFocusRequest>();
  const [selectionFocusRequest, setSelectionFocusRequest] = useState<SelectionFocusRequest>();
  const selectionFocusRevision = useRef(0);
  const [routeHandleFocusRequest, setRouteHandleFocusRequest] = useState<RouteHandleFocusRequest>();
  const [canvasAnnouncement, setCanvasAnnouncement] = useState("");
  const [connectionGesture, setConnectionGesture] = useState<ActiveConnectionGesture>();
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionGestureFeedback>();
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [compactOverviewMapOpen, setCompactOverviewMapOpen] = useState(false);
  const [resizeRestoreRevision, setResizeRestoreRevision] = useState(0);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const alignmentGestureRef = useRef<AlignmentGesture | undefined>(undefined);
  const boxSelectionStartRef = useRef<{
    x: number;
    y: number;
    mode: CanvasBoundsSelectionMode;
  } | undefined>(undefined);
  const boxSelectionGestureRef = useRef<BoxSelectionGesture | undefined>(undefined);
  const altClickGestureRef = useRef<AltClickGesture | undefined>(undefined);
  const suppressAltClickRef = useRef(false);
  const resizePreviewRef = useRef<ResizePreview | undefined>(undefined);
  const connectionGestureRef = useRef<ActiveConnectionGesture | undefined>(connectionGesture);
  const pendingReconnectGestureRef = useRef(false);
  const connectionGestureCommitRef = useRef<ConnectionGestureCommitResult | undefined>(undefined);
  const connectionGestureCancelledRef = useRef(false);
  const connectionFeedbackRevision = useRef(0);
  connectionGestureRef.current = connectionGesture;
  const multiSelection = selection.kind === "multiple";
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
  const actualSizeViewport = useCallback(() => {
    const duration = fitDuration();
    runViewportNavigation(duration, () => zoomTo(1, { duration }));
  }, [runViewportNavigation, zoomTo]);
  const fitCanvasViewport = useCallback(() => {
    navigateViewport({ ...FIT_VIEW_OPTIONS, duration: fitDuration() });
  }, [navigateViewport]);
  const interruptViewportNavigation = useCallback((force = false) => {
    if (!force && !animatedViewportNavigationActive.current) return;
    animatedViewportNavigationActive.current = false;
    viewportNavigationGeneration.current += 1;
    void setViewport(getViewport(), { duration: 0 });
  }, [getViewport, setViewport]);
  const publishConnectionFeedback = useCallback((
    tone: ConnectionGestureFeedback["tone"],
    title: string,
    detail: string,
  ) => {
    connectionFeedbackRevision.current += 1;
    setConnectionFeedback({
      revision: connectionFeedbackRevision.current,
      tone,
      title,
      detail,
    });
    setCanvasAnnouncement(`${title} ${detail}`);
  }, []);
  const connectionCandidateCount = useMemo(() => {
    if (!connectionGesture) return 0;
    const candidates = new Map<string, ConnectablePortEndpoint>();
    layout.nodes.forEach((node) => {
      node.data.block.ports.forEach((port) => {
        const endpoint = {
          levelId: node.data.levelId,
          nodeId: node.data.block.id,
          nodeTitle: node.data.block.title,
          portId: port.id,
          label: port.label,
          direction: port.direction,
        };
        if (normalizeConnectionEndpoints(connectionGesture.origin, endpoint)) {
          candidates.set(`${endpoint.levelId}\u0000${endpoint.nodeId}\u0000${endpoint.portId}`, endpoint);
        }
      });
    });
    return candidates.size;
  }, [connectionGesture, layout.nodes]);
  const onCanvasPointerMoveCapture = useCallback((event: ReactPointerEvent) => {
    interruptViewportNavigation();
    const altClickGesture = altClickGestureRef.current;
    if (altClickGesture?.pointerId === event.pointerId && !altClickGesture.moved) {
      const deltaX = event.clientX - altClickGesture.start.x;
      const deltaY = event.clientY - altClickGesture.start.y;
      altClickGesture.moved = Math.hypot(deltaX, deltaY) > ALT_CLICK_TOLERANCE_PX;
    }
    const gesture = boxSelectionGestureRef.current;
    if (gesture) {
      gesture.end = { x: event.clientX, y: event.clientY };
      if (event.altKey) gesture.mode = "intersecting";
    }
  }, [interruptViewportNavigation]);
  const onCanvasPointerDownCapture = useCallback((event: ReactPointerEvent) => {
    // A direct gesture owns the viewport immediately. Freeze even when a
    // third-party navigation promise has already reported completion: Firefox
    // can still deliver a final interpolated frame after that promise settles.
    interruptViewportNavigation(true);
    const target = event.target instanceof Element ? event.target : undefined;
    const directPaneGesture = target?.classList.contains("react-flow__pane") ?? false;
    const forcedSelectionGesture = Boolean(event.altKey && target && !target.closest(".nokey"));
    altClickGestureRef.current = event.button === 0 && event.isPrimary && forcedSelectionGesture
      ? {
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          moved: false,
        }
      : undefined;
    suppressAltClickRef.current = false;
    if (event.button === 0 && event.isPrimary && (directPaneGesture || forcedSelectionGesture)) {
      boxSelectionStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        mode: event.altKey ? "intersecting" : "full",
      };
    } else {
      boxSelectionStartRef.current = undefined;
    }
  }, [interruptViewportNavigation]);
  const beginAlignmentGesture = useCallback((
    nodeId: string,
    excludedNodeIds: ReadonlySet<string> = new Set([nodeId]),
  ): AlignmentGesture | undefined => {
    const state = store.getState();
    const subject = state.nodeLookup.get(nodeId);
    const layoutSubject = layout.nodes.find((node) => node.id === nodeId);
    const subjectWidth = subject?.measured.width ?? subject?.width ?? 0;
    const subjectHeight = subject?.measured.height ?? subject?.height ?? 0;
    if (!subject || !layoutSubject || subjectWidth <= 0 || subjectHeight <= 0) return undefined;
    const [translateX, translateY, zoom] = state.transform;
    const margin = ALIGNMENT_VIEWPORT_MARGIN_PX / zoom;
    const viewport = {
      left: -translateX / zoom - margin,
      top: -translateY / zoom - margin,
      right: (-translateX + state.width) / zoom + margin,
      bottom: (-translateY + state.height) / zoom + margin,
    };
    const candidates: AlignmentRect[] = [];
    state.nodeLookup.forEach((candidate, candidateId) => {
      if (excludedNodeIds.has(candidateId) || candidate.parentId !== subject.parentId || candidate.hidden) return;
      const width = candidate.measured.width ?? candidate.width ?? 0;
      const height = candidate.measured.height ?? candidate.height ?? 0;
      const { x, y } = candidate.internals.positionAbsolute;
      if (
        width <= 0 || height <= 0 ||
        x + width < viewport.left || x > viewport.right ||
        y + height < viewport.top || y > viewport.bottom
      ) return;
      candidates.push({ id: candidateId, x, y, width, height });
    });
    const minimum = minimumNodeDimensions(layoutSubject.data.block);
    const gesture = {
      nodeId,
      original: {
        id: nodeId,
        x: subject.internals.positionAbsolute.x,
        y: subject.internals.positionAbsolute.y,
        width: subjectWidth,
        height: subjectHeight,
      },
      originalLocalPosition: { ...subject.position },
      candidates,
      tolerance: ALIGNMENT_TOLERANCE_PX / zoom,
      limits: {
        minWidth: minimum.width,
        minHeight: minimum.height,
        maxWidth: BLOCK_NODE_GEOMETRY.maximumWidth,
        maxHeight: BLOCK_NODE_GEOMETRY.maximumHeight,
      },
    };
    alignmentGestureRef.current = gesture;
    resizePreviewRef.current = undefined;
    setAlignmentGuides([]);
    return gesture;
  }, [layout.nodes, store]);
  const snapResizeGeometry = useCallback((
    node: LayoutFlowNode,
    geometry: { position: { x: number; y: number }; size: { width: number; height: number } },
    disableSnap: boolean,
  ) => {
    const gesture = alignmentGestureRef.current?.nodeId === node.id
      ? alignmentGestureRef.current
      : beginAlignmentGesture(node.id);
    if (!gesture || disableSnap) {
      resizePreviewRef.current = undefined;
      setAlignmentGuides([]);
      return geometry;
    }
    const preview = {
      id: node.id,
      x: gesture.original.x + geometry.position.x - gesture.originalLocalPosition.x,
      y: gesture.original.y + geometry.position.y - gesture.originalLocalPosition.y,
      width: geometry.size.width,
      height: geometry.size.height,
    };
    const snapped = snapResizingRect(
      gesture.original,
      preview,
      gesture.candidates,
      gesture.tolerance,
      gesture.limits,
    );
    resizePreviewRef.current = {
      nodeId: node.id,
      position: {
        x: gesture.originalLocalPosition.x + snapped.rect.x - gesture.original.x,
        y: gesture.originalLocalPosition.y + snapped.rect.y - gesture.original.y,
      },
      size: { width: snapped.rect.width, height: snapped.rect.height },
    };
    setAlignmentGuides(snapped.guides);
    return {
      position: resizePreviewRef.current.position,
      size: resizePreviewRef.current.size,
    };
  }, [beginAlignmentGesture]);
  const baseNodes = useMemo<CanvasFlowNode[]>(
    () =>
      layout.nodes.map((node) => ({
        ...node,
        focusable: true,
        domAttributes: {
          ...node.domAttributes,
          tabIndex: -1,
        },
        data: {
          ...node.data,
          toggleHierarchy: onToggleHierarchy,
          canEditSelection: () => boxSelectionGestureRef.current === undefined && selectionRef.current.kind !== "multiple",
          inspectPort: (nodeId: string, port: BlockPort) =>
            selectRef.current({ kind: "port", levelId: node.data.levelId, nodeId, portId: port.id }),
          beginResize: node.data.positionEditable && !node.data.expanded
            ? () => { beginAlignmentGesture(node.id); }
            : undefined,
          previewResize: node.data.positionEditable && !node.data.expanded
            ? (geometry, disableSnap) => { snapResizeGeometry(node, geometry, disableSnap); }
            : undefined,
          resizeNode: node.data.positionEditable && !node.data.expanded
            ? (geometry, disableSnap) => {
                const snapped = snapResizeGeometry(node, geometry, disableSnap);
                alignmentGestureRef.current = undefined;
                resizePreviewRef.current = undefined;
                setAlignmentGuides([]);
                const accepted = onResizeNode(
                  node.data.levelId,
                  node.data.block.id,
                  {
                    x: node.data.designPosition.x + snapped.position.x - node.position.x,
                    y: node.data.designPosition.y + snapped.position.y - node.position.y,
                  },
                  snapped.size,
                );
                if (!accepted) setResizeRestoreRevision((revision) => revision + 1);
                return accepted;
              }
            : undefined,
        },
      })),
    [
      beginAlignmentGesture,
      layout.nodes,
      onResizeNode,
      onToggleHierarchy,
      resizeRestoreRevision,
      multiSelection,
      snapResizeGeometry,
    ],
  );
  const baseNodeById = useMemo(() => new Map(baseNodes.map((node) => [node.id, node])), [baseNodes]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(baseNodes);
  // Automatic routing follows committed layout geometry. Pointer move/resize
  // previews adapt only their incident endpoints in InterfaceEdge, avoiding a
  // scene-wide solve on every animation frame.
  const routingNodes = baseNodes;
  const routingGeometrySignature = routingNodes.map((node) => {
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    return `${node.id}:${node.parentId ?? "root"}:${node.position.x},${node.position.y},${width},${height}`;
  }).join("|");
  const routingCacheSignature = `${routingGeometrySignature}|revision:${routeRevision}`;
  const routingResult = useMemo(() => {
    const cached = routingResultCache.get(layout.edges);
    if (cached?.geometrySignature === routingCacheSignature) return cached.result;
    const scene = createRoutingSceneFromLayout(routingNodes, layout.edges);
    const result = solveRoutingScene(scene, routingPolicyForScene(scene));
    routingResultCache.set(layout.edges, { geometrySignature: routingCacheSignature, result });
    return result;
  }, [layout.edges, routingCacheSignature]);
  const unresolvedDetail = routingResult.certificate.objective.unrouted > 0
    ? `${routingResult.certificate.objective.unrouted} connection${routingResult.certificate.objective.unrouted === 1 ? "" : "s"} could not be routed.`
    : routingResult.certificate.objective.capacityViolations > 0
      ? `${routingResult.certificate.objective.capacityViolations} route spacing conflict${routingResult.certificate.objective.capacityViolations === 1 ? "" : "s"} remain.`
      : `${routingResult.diagnostics.length} route verification issue${routingResult.diagnostics.length === 1 ? "" : "s"} remain.`;
  const routingFailure = routingResult.status === "Optimal" || routingResult.status === "Feasible"
    ? undefined
    : {
        title: `Routing ${routingResult.status}`,
        detail: routingResult.status === "InvalidInput"
          ? `${routingResult.diagnostics.length} locked or scene geometry issue${routingResult.diagnostics.length === 1 ? "" : "s"}; manual geometry was preserved.`
          : `${unresolvedDetail} Move modules apart or add manual waypoints.`,
      };
  const routeJumps = useMemo(() => planRouteJumps(routingResult.routes), [routingResult]);
  const simplifiedEdgeInteraction = layout.nodes.length >= 120 || layout.edges.length >= 240;
  const baseEdges = useMemo<CanvasFlowEdge[]>(
    () => layout.edges.map<CanvasFlowEdge>((edge) => {
        const data = edge.data;
        if (!data) throw new Error(`Layout edge ${edge.id} is missing interface data.`);
        const plannedRoute = routingResult.routes.get(edge.id)?.points;
        return {
          ...edge,
          focusable: true,
          domAttributes: {
            ...edge.domAttributes,
            tabIndex: -1,
          },
          reconnectable: !data.boundaryContinuation,
          markerEnd: data.boundaryContinuation ? undefined : CONNECTION_TARGET_MARKER,
          data: {
            ...data,
            canEditSelection: () => selectionRef.current.kind !== "multiple",
            plannedRoute,
            routeJumps: routeJumps.get(edge.id),
            routingStatus: routingResult.status,
            simplifiedInteraction: simplifiedEdgeInteraction,
            updateRouting: data.boundaryContinuation
              ? undefined
              : (routing) => onRouteConnection(data.levelId, data.connection.id, routing),
            requestRouteHandleFocus: data.boundaryContinuation
              ? undefined
              : (handle) => setRouteHandleFocusRequest({ edgeId: edge.id, ...handle }),
          },
        };
      }),
    [layout.edges, multiSelection, onRouteConnection, routeJumps, routingResult, simplifiedEdgeInteraction],
  );
  const onCanvasNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const preview = resizePreviewRef.current;
    if (!preview) {
      onNodesChange(changes);
      return;
    }
    onNodesChange(changes.map((change) => {
      if (!("id" in change) || change.id !== preview.nodeId) return change;
      if (change.type === "position" && change.position) {
        return { ...change, position: preview.position };
      }
      if (change.type === "dimensions" && change.dimensions) {
        return { ...change, dimensions: preview.size };
      }
      return change;
    }));
  }, [onNodesChange]);
  const flowNodeIdsBySelection = useMemo(() => {
    const result = new Map<string, string[]>();
    baseNodes.forEach((node) => {
      const key = `${node.data.levelId}\u0000${node.data.block.id}`;
      result.set(key, [...(result.get(key) ?? []), node.id]);
    });
    return result;
  }, [baseNodes]);
  const selectedDiagramItems = diagramSelectionItems(selection);
  const selectedNodeIds = selectedDiagramItems.length === 0
    ? NO_SELECTED_IDS
    : [...new Set(selectedDiagramItems.flatMap((item) => item.kind === "node"
        ? flowNodeIdsBySelection.get(`${item.levelId}\u0000${item.nodeId}`) ?? []
        : []))];
  const selectedNodeIdsKey = selectedNodeIds.join("\u0000");
  const selectedNodeIdsRef = useRef<ReadonlySet<string>>(new Set(selectedNodeIds));
  selectedNodeIdsRef.current = new Set(selectedNodeIds);
  const routedEdges = baseEdges;
  const routedEdgeById = useMemo(() => new Map(routedEdges.map((edge) => [edge.id, edge])), [routedEdges]);
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
  const canvasKeyboardTraversal = useMemo(() => {
    const selectionByKey = new Map<string, DiagramSelectionRef>();
    const traversalNodes: CanvasTraversalTarget[] = baseNodes.map((node) => {
      const item: DiagramSelectionRef = {
        kind: "node",
        levelId: node.data.levelId,
        nodeId: node.data.block.id,
      };
      const selectionKey = diagramSelectionKey(item);
      selectionByKey.set(selectionKey, item);
      return {
        id: node.id,
        selectionKey,
        levelId: node.data.levelId,
        kind: "node",
        parentId: node.parentId,
      };
    });
    const traversalConnections: CanvasTraversalTarget[] = routedEdges.flatMap((edge) => {
      if (!edge.data) return [];
      const item: DiagramSelectionRef = {
        kind: "connection",
        levelId: edge.data.levelId,
        connectionId: edge.data.connection.id,
      };
      const selectionKey = diagramSelectionKey(item);
      selectionByKey.set(selectionKey, item);
      return [{
        id: edge.id,
        selectionKey,
        levelId: edge.data.levelId,
        kind: "connection" as const,
      }];
    });
    return {
      ...canvasSelectionTraversal(traversalNodes, traversalConnections),
      selectionByKey,
    };
  }, [baseNodes, routedEdges]);
  const selectedEdgeIds = selectedDiagramItems.length === 0
    ? NO_SELECTED_IDS
    : [...new Set(selectedDiagramItems.flatMap((item) => item.kind === "connection"
        ? flowEdgeIdsBySelection.get(`${item.levelId}\u0000${item.connectionId}`) ?? []
        : []))];
  const selectedEdgeIdsKey = selectedEdgeIds.join("\u0000");
  const selectedEdgeIdsRef = useRef<ReadonlySet<string>>(new Set(selectedEdgeIds));
  selectedEdgeIdsRef.current = new Set(selectedEdgeIds);
  const [selectionRestoreRevision, setSelectionRestoreRevision] = useState(0);
  const handledRevealSelectionRequest = useRef(0);
  const handledFitSelectionRequest = useRef(0);
  const handledViewportActionRequest = useRef(0);
  const [edges, setEdges] = useState<CanvasFlowEdge[]>(() =>
    reconcileCanvasSelection(routedEdges, selectedEdgeIdsRef.current),
  );

  useEffect(() => {
    if (!connectionFeedback) return;
    const revision = connectionFeedback.revision;
    const timer = window.setTimeout(() => {
      setConnectionFeedback((current) => current?.revision === revision ? undefined : current);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [connectionFeedback]);

  useEffect(() => {
    const root = store.getState().domNode;
    if (!root) return;
    const ports = [...root.querySelectorAll<HTMLElement>(".bd-port")];
    if (connectionGesture) root.dataset.connectionGesture = connectionGesture.kind;
    else delete root.dataset.connectionGesture;
    ports.forEach((element) => {
      if (!connectionGesture) {
        delete element.dataset.connectionRole;
        return;
      }
      const { levelId, nodeId, portId, portDirection } = element.dataset;
      if (!levelId || !nodeId || !portId || !portDirection) {
        element.dataset.connectionRole = "incompatible";
        return;
      }
      const endpoint: ConnectablePortEndpoint = {
        levelId,
        nodeId,
        nodeTitle: "",
        portId,
        label: "",
        direction: portDirection as PortDirection,
      };
      const origin = connectionGesture.origin;
      element.dataset.connectionRole = origin.levelId === endpoint.levelId &&
        origin.nodeId === endpoint.nodeId && origin.portId === endpoint.portId
        ? "origin"
        : normalizeConnectionEndpoints(origin, endpoint)
          ? "candidate"
          : "incompatible";
    });
    return () => {
      delete root.dataset.connectionGesture;
      ports.forEach((element) => delete element.dataset.connectionRole);
    };
  }, [connectionGesture, store]);

  useEffect(() => {
    if (!connectionGesture) return;
    const cancelGesture = (reason: string) => {
      const mode = connectionGestureRef.current?.kind ?? connectionGesture.kind;
      connectionGestureCancelledRef.current = true;
      connectionGestureCommitRef.current = undefined;
      pendingReconnectGestureRef.current = false;
      connectionGestureRef.current = undefined;
      store.getState().cancelConnection();
      setConnectionGesture(undefined);
      publishConnectionFeedback(
        "warning",
        mode === "reconnect" ? "Reconnect canceled" : "Connection canceled",
        `${reason} Design unchanged.`,
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelGesture("Canceled with Escape.");
    };
    const onWindowBlur = () => cancelGesture("The canvas lost focus.");
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [connectionGesture, publishConnectionFeedback, store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !event.repeat && !blocksCanvasPanMode(event.target)) {
        setSpacePanActive(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePanActive(false);
    };
    const onWindowBlur = () => setSpacePanActive(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

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
  }, [selectedNodeIdsKey, selectionRestoreRevision, setNodes]);

  useEffect(() => {
    setEdges((current) => reconcileCanvasSelection(current, selectedEdgeIdsRef.current));
  }, [selectedEdgeIdsKey, selectionRestoreRevision]);

  useEffect(() => {
    if (!nodeFocusRequest) return;
    if (!selectedNodeIdsRef.current.has(nodeFocusRequest.flowNodeId)) {
      setNodeFocusRequest(undefined);
      return;
    }
    const projected = nodes.find((candidate) => candidate.id === nodeFocusRequest.flowNodeId);
    if (
      projected?.data.designPosition.x !== nodeFocusRequest.designPosition.x ||
      projected.data.designPosition.y !== nodeFocusRequest.designPosition.y ||
      (nodeFocusRequest.dimensions && (
        projected.width !== nodeFocusRequest.dimensions.width ||
        projected.height !== nodeFocusRequest.dimensions.height
      ))
    ) return;
    let frame = 0;
    let previousNode: HTMLElement | undefined;
    let stableFrames = 0;
    let attempts = 0;
    const restoreFocus = () => {
      if (focusRestorationWasSuperseded(previousNode)) {
        setNodeFocusRequest((current) => current === nodeFocusRequest ? undefined : current);
        return;
      }
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
    if (!selectionFocusRequest) return;
    const item = selectionFocusRequest.item;
    const ids = item.kind === "node"
      ? flowNodeIdsBySelection.get(`${item.levelId}\u0000${item.nodeId}`) ?? []
      : flowEdgeIdsBySelection.get(`${item.levelId}\u0000${item.connectionId}`) ?? [];
    const selector = item.kind === "node" ? ".react-flow__node" : ".react-flow__edge";
    if (ids.length === 0) {
      setSelectionFocusRequest(undefined);
      return;
    }
    let frame = 0;
    let previousElement: HTMLElement | SVGElement | undefined;
    let stableFrames = 0;
    let attempts = 0;
    const restoreFocus = () => {
      if (focusRestorationWasSuperseded(previousElement)) {
        setSelectionFocusRequest((current) =>
          current?.revision === selectionFocusRequest.revision ? undefined : current);
        return;
      }
      const element = renderedFlowElement(store.getState().domNode, selector, ids);
      if (element) {
        element.focus();
        stableFrames = element === previousElement && document.activeElement === element
          ? stableFrames + 1
          : 0;
        previousElement = element;
        if (stableFrames >= 2) {
          setSelectionFocusRequest((current) =>
            current?.revision === selectionFocusRequest.revision ? undefined : current);
          return;
        }
      }
      attempts += 1;
      if (attempts < 36) frame = window.requestAnimationFrame(restoreFocus);
    };
    frame = window.requestAnimationFrame(restoreFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [edges, flowEdgeIdsBySelection, flowNodeIdsBySelection, nodes, selectionFocusRequest, store]);

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
      if (focusRestorationWasSuperseded(previousHandle)) {
        setRouteHandleFocusRequest((current) => current === routeHandleFocusRequest ? undefined : current);
        return;
      }
      const root = store.getState().domNode;
      const edge = [...(root?.querySelectorAll<SVGGElement>(".react-flow__edge") ?? [])]
        .find((candidate) => candidate.dataset.id === routeHandleFocusRequest.edgeId);
      const candidates = routeHandleFocusRequest.kind === "segment"
        ? [...(edge?.querySelectorAll<HTMLButtonElement>(
            `.bd-route-segment-handle.bd-route-handle-${routeHandleFocusRequest.axis}`,
          ) ?? [])].filter(
            (candidate) => Number(candidate.getAttribute("aria-valuenow")) === routeHandleFocusRequest.coordinate,
          )
        : [...(edge?.querySelectorAll<HTMLButtonElement>(".bd-route-bend-handle") ?? [])].filter(
            (candidate) =>
              Number(candidate.dataset.routeX) === routeHandleFocusRequest.point.x &&
              Number(candidate.dataset.routeY) === routeHandleFocusRequest.point.y,
          );
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
    if (viewportActionRequest.revision <= handledViewportActionRequest.current) return;
    handledViewportActionRequest.current = viewportActionRequest.revision;
    if (viewportActionRequest.action === "zoom-in") zoomInViewport();
    else if (viewportActionRequest.action === "zoom-out") zoomOutViewport();
    else actualSizeViewport();
  }, [actualSizeViewport, viewportActionRequest, zoomInViewport, zoomOutViewport]);

  useEffect(() => {
    if (fitSelectionRequest <= handledFitSelectionRequest.current) return;
    const state = store.getState();
    const selectedEdges = routedEdges.filter((edge) => selectedEdgeIdsRef.current.has(edge.id));
    const contextualNodeIds = new Set(selectedNodeIdsRef.current);
    selectedEdges.forEach((edge) => {
      contextualNodeIds.add(edge.source);
      contextualNodeIds.add(edge.target);
    });
    const rectangles = [...contextualNodeIds].flatMap((id) => {
      const node = state.nodeLookup.get(id);
      const width = node?.measured.width ?? node?.width;
      const height = node?.measured.height ?? node?.height;
      if (!node || !width || !height) return [];
      return [{
        x: node.internals.positionAbsolute.x,
        y: node.internals.positionAbsolute.y,
        width,
        height,
      }];
    });
    const paths = selectedEdges.flatMap((edge) => {
      const route = routingResult.routes.get(edge.id)?.points;
      return route ? [route] : [];
    });
    const bounds = canvasGeometryBounds(rectangles, paths);
    if (!bounds) return;
    handledFitSelectionRequest.current = fitSelectionRequest;
    const duration = fitDuration();
    runViewportNavigation(duration, () => fitBounds(bounds, {
      padding: 0.24,
      duration,
      interpolate: navigationInterpolation,
    }));
    setCanvasAnnouncement(
      `Fitted ${selectedDiagramItems.length} selected diagram ${selectedDiagramItems.length === 1 ? "object" : "objects"} to the canvas.`,
    );
  }, [
    fitBounds,
    fitSelectionRequest,
    navigationInterpolation,
    nodes,
    routedEdges,
    routingResult.routes,
    runViewportNavigation,
    selectedDiagramItems.length,
    store,
  ]);

  useEffect(() => {
    if (revealSelectionRequest <= handledRevealSelectionRequest.current) return;
    const targetNodeIds = new Set<string>();
    if (selection.kind === "multiple") {
      selection.items.forEach((item) => {
        if (item.kind === "node") {
          flowNodeIdsBySelection
            .get(`${item.levelId}\u0000${item.nodeId}`)
            ?.forEach((id) => targetNodeIds.add(id));
          return;
        }
        flowEdgeIdsBySelection
          .get(`${item.levelId}\u0000${item.connectionId}`)
          ?.forEach((id) => {
            const edge = routedEdges.find((candidate) => candidate.id === id);
            if (edge) {
              targetNodeIds.add(edge.source);
              targetNodeIds.add(edge.target);
            }
          });
      });
    } else if (selection.kind === "node" || selection.kind === "port") {
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

  const commitCanvasSelection = useCallback((next: SelectionRef, announcement?: string) => {
    const accepted = onSelect(next);
    if (!accepted) setSelectionRestoreRevision((revision) => revision + 1);
    else if (announcement) setCanvasAnnouncement(announcement);
    return accepted;
  }, [onSelect]);
  const focusCanvasSelection = useCallback((item: DiagramSelectionRef) => {
    const root = store.getState().domNode;
    const flowIds = item.kind === "node"
      ? flowNodeIdsBySelection.get(`${item.levelId}\u0000${item.nodeId}`) ?? []
      : flowEdgeIdsBySelection.get(`${item.levelId}\u0000${item.connectionId}`) ?? [];
    const selector = item.kind === "node" ? ".react-flow__node" : ".react-flow__edge";
    const element = renderedFlowElement(root, selector, flowIds);
    if (root && (!element || !flowElementIntersectsCanvas(element, root))) {
      const navigationNodeIds = item.kind === "node"
        ? flowIds
        : [...new Set(flowIds.flatMap((id) => {
            const edge = routedEdgeById.get(id);
            return edge ? [edge.source, edge.target] : [];
          }))];
      if (navigationNodeIds.length > 0) {
        navigateViewport({
          nodes: navigationNodeIds.map((id) => ({ id })),
          padding: 0.55,
          maxZoom: 1.05,
          duration: navigationDuration,
          interpolate: navigationInterpolation,
        });
      }
    }
    selectionFocusRevision.current += 1;
    setSelectionFocusRequest({ revision: selectionFocusRevision.current, item });
  }, [
    flowEdgeIdsBySelection,
    flowNodeIdsBySelection,
    navigateViewport,
    navigationDuration,
    navigationInterpolation,
    routedEdgeById,
    store,
  ]);
  const canvasPointHitSelections = useCallback((point: { x: number; y: number }) => {
    const canvasRoot = store.getState().domNode;
    const rootBounds = canvasRoot?.getBoundingClientRect();
    if (!canvasRoot || !rootBounds) return [];
    const nodeElements = new Map(
      [...canvasRoot.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")]
        .map((element) => [element.dataset.id ?? "", element] as const),
    );
    const renderedEdgeIds = new Set(
      [...canvasRoot.querySelectorAll<SVGGElement>(".react-flow__edge[data-id]")]
        .map((element) => element.dataset.id ?? ""),
    );
    const selectionByKey = new Map<string, DiagramSelectionRef>();
    const targets: CanvasPointHitTarget[] = baseNodes.flatMap((node, order) => {
      const element = nodeElements.get(node.id);
      if (!element) return [];
      const item: DiagramSelectionRef = {
        kind: "node",
        levelId: node.data.levelId,
        nodeId: node.data.block.id,
      };
      const selectionKey = diagramSelectionKey(item);
      selectionByKey.set(selectionKey, item);
      return [{
        id: node.id,
        selectionKey,
        parentId: node.parentId,
        layer: NODE_VISUAL_LAYER_BASE + (node.zIndex ?? 0),
        order,
        bounds: element.getBoundingClientRect(),
      }];
    });
    const state = store.getState();
    const [translateX, translateY, zoom] = state.transform;
    routedEdges.forEach((edge, order) => {
      if (!edge.data?.plannedRoute || !renderedEdgeIds.has(edge.id)) return;
      const item: DiagramSelectionRef = {
        kind: "connection",
        levelId: edge.data.levelId,
        connectionId: edge.data.connection.id,
      };
      const selectionKey = diagramSelectionKey(item);
      selectionByKey.set(selectionKey, item);
      targets.push({
        id: edge.id,
        selectionKey,
        layer: edge.zIndex ?? 0,
        order,
        route: edge.data.plannedRoute.map((routePoint) => ({
          x: rootBounds.left + translateX + routePoint.x * zoom,
          y: rootBounds.top + translateY + routePoint.y * zoom,
        })),
        routeTolerance: EDGE_POINTER_TOLERANCE_PX,
      });
    });
    return canvasPointHitStack(point, targets).flatMap((target) => {
      const item = selectionByKey.get(target.selectionKey);
      return item ? [{ target, item }] : [];
    });
  }, [baseNodes, routedEdges, store]);
  const onCanvasPointerUpCapture = useCallback((event: ReactPointerEvent) => {
    const gesture = altClickGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    altClickGestureRef.current = undefined;
    if (gesture.moved || !event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    boxSelectionStartRef.current = undefined;
    boxSelectionGestureRef.current = undefined;
    suppressAltClickRef.current = true;
    window.requestAnimationFrame(() => { suppressAltClickRef.current = false; });

    const hits = canvasPointHitSelections({ x: event.clientX, y: event.clientY });
    const top = hits[0];
    if (hasToggleModifier(event)) {
      if (top) {
        commitCanvasSelection(
          toggleDiagramSelection(selectionRef.current, [top.item], entryLevelId),
          "Toggled the top diagram object under the pointer.",
        );
      }
      return;
    }
    const selectedKeys = new Set(
      diagramSelectionItems(selectionRef.current).map(diagramSelectionKey),
    );
    const nextTarget = nextCanvasPointHitTarget(
      hits.map((hit) => hit.target),
      selectedKeys,
    );
    const nextTargetId = nextTarget?.id;
    const next = hits.find((hit) => hit.target.id === nextTargetId)?.item;
    if (!nextTargetId || !next) {
      commitCanvasSelection({ kind: "level", levelId: entryLevelId }, "No diagram object under the pointer.");
      return;
    }
    const index = hits.findIndex((hit) => hit.target.id === nextTargetId);
    commitCanvasSelection(
      next,
      hits.length > 1
        ? `Selected object ${index + 1} of ${hits.length} under the pointer.`
        : "Selected the diagram object under the pointer.",
    );
  }, [canvasPointHitSelections, commitCanvasSelection, entryLevelId]);
  const onCanvasClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!suppressAltClickRef.current) return;
    suppressAltClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const onCanvasPointerCancelCapture = useCallback(() => {
    altClickGestureRef.current = undefined;
    suppressAltClickRef.current = false;
  }, []);
  const onNodeClick = useCallback<NodeMouseHandler<CanvasFlowNode>>((event, node) => {
    const item: DiagramSelectionRef = {
      kind: "node",
      levelId: node.data.levelId,
      nodeId: node.data.block.id,
    };
    const next = hasToggleModifier(event)
      ? toggleDiagramSelection(selectionRef.current, [item], node.data.levelId)
      : item;
    commitCanvasSelection(next);
  }, [commitCanvasSelection]);
  const onNodeDoubleClick = useCallback<NodeMouseHandler<CanvasFlowNode>>((_, node) => {
    if (node.data.block.hierarchy) onToggleHierarchy(node.data.block.hierarchy.childLevelId);
  }, [onToggleHierarchy]);
  const onEdgeClick = useCallback<EdgeMouseHandler<CanvasFlowEdge>>((event, edge) => {
    if (!edge.data) return;
    const item: DiagramSelectionRef = {
      kind: "connection",
      levelId: edge.data.levelId,
      connectionId: edge.data.connection.id,
    };
    const next = hasToggleModifier(event)
      ? toggleDiagramSelection(selectionRef.current, [item], edge.data.levelId)
      : item;
    commitCanvasSelection(next);
  }, [commitCanvasSelection]);
  const onSelectionStart = useCallback((event: ReactMouseEvent) => {
    const capturedStart = boxSelectionStartRef.current;
    const start = capturedStart ?? { x: event.clientX, y: event.clientY };
    boxSelectionGestureRef.current = {
      base: selectionRef.current,
      toggle: hasToggleModifier(event),
      mode: capturedStart?.mode ?? (event.altKey ? "intersecting" : "full"),
      start,
      end: { x: event.clientX, y: event.clientY },
    };
    boxSelectionStartRef.current = undefined;
  }, []);
  const onSelectionEnd = useCallback((event: ReactMouseEvent) => {
    const gesture = boxSelectionGestureRef.current;
    if (!gesture) return;
    if (event.altKey) gesture.mode = "intersecting";
    const items: DiagramSelectionRef[] = [];
    const canvasRoot = store.getState().domNode;
    const selectionBounds = canvasClientBounds(gesture.start, gesture.end);
    canvasRoot?.querySelectorAll<HTMLElement>(".react-flow__node").forEach((element) => {
      const node = baseNodeById.get(element.dataset.id ?? "");
      if (!node) return;
      const bounds = element.getBoundingClientRect();
      if (!canvasBoundsSelectBounds(selectionBounds, bounds, gesture.mode)) return;
      items.push({ kind: "node", levelId: node.data.levelId, nodeId: node.data.block.id });
    });
    const state = store.getState();
    const rootBounds = canvasRoot?.getBoundingClientRect();
    const [translateX, translateY, zoom] = state.transform;
    canvasRoot?.querySelectorAll<SVGGElement>(".react-flow__edge").forEach((element) => {
      const edge = routedEdgeById.get(element.dataset.id ?? "");
      if (!edge?.data || edge.data.boundaryContinuation || !edge.data.plannedRoute || !rootBounds) return;
      const route = edge.data.plannedRoute.map((point) => ({
        x: rootBounds.left + translateX + point.x * zoom,
        y: rootBounds.top + translateY + point.y * zoom,
      }));
      if (!canvasBoundsSelectRoute(selectionBounds, route, gesture.mode)) return;
      items.push({
        kind: "connection",
        levelId: edge.data.levelId,
        connectionId: edge.data.connection.id,
      });
    });
    const next = gesture.toggle
      ? toggleDiagramSelection(gesture.base, items, entryLevelId)
      : replaceDiagramSelection(items, entryLevelId);
    const count = diagramSelectionItems(next).length;
    commitCanvasSelection(
      next,
      count > 1 ? `${count} diagram objects selected.` : count === 1 ? "1 diagram object selected." : "Selection cleared.",
    );
    window.requestAnimationFrame(() => {
      if (boxSelectionGestureRef.current === gesture) boxSelectionGestureRef.current = undefined;
    });
  }, [baseNodeById, commitCanvasSelection, entryLevelId, routedEdgeById, store]);
  const onElementKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const canvasRoot = store.getState().domNode;
    const containingFlowElement = target.closest<HTMLElement | SVGElement>(
      ".react-flow__node, .react-flow__edge",
    );
    const flowElementFocused = target === containingFlowElement;
    const canvasRootFocused = target === canvasRoot || target.classList.contains("bd-react-flow");
    if (
      containingFlowElement &&
      !flowElementFocused &&
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const controls = [...containingFlowElement.querySelectorAll<HTMLElement>(
        CANVAS_OBJECT_CONTROL_SELECTOR,
      )].filter((candidate) => candidate.getClientRects().length > 0);
      const currentIndex = controls.indexOf(target as HTMLElement);
      const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
      if (currentIndex >= 0 && nextIndex >= 0 && nextIndex < controls.length) {
        event.preventDefault();
        event.stopPropagation();
        controls[nextIndex].focus();
        setCanvasAnnouncement(
          `Focused object control ${nextIndex + 1} of ${controls.length}.`,
        );
        return;
      }
      if (currentIndex === 0 && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        containingFlowElement.focus();
        setCanvasAnnouncement("Returned focus to the selected diagram object.");
        return;
      }
    }
    if (containingFlowElement && !flowElementFocused && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      containingFlowElement.focus();
      setCanvasAnnouncement("Returned focus to the selected diagram object.");
      return;
    }
    if (
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.metaKey &&
      (flowElementFocused || canvasRootFocused)
    ) {
      const current = selectionRef.current;
      let traversalTarget: CanvasTraversalTarget | undefined;
      let announcement: string;
      if (event.altKey) {
        const currentLevelId = current.kind === "document" || current.kind === "multiple"
          ? undefined
          : current.levelId;
        const parentSelectionKey = currentLevelId
          ? canvasKeyboardTraversal.parentSelectionKeyByLevelId.get(currentLevelId)
          : undefined;
        traversalTarget = parentSelectionKey
          ? canvasKeyboardTraversal.items.find((item) => item.selectionKey === parentSelectionKey)
          : undefined;
        announcement = traversalTarget
          ? "Selected the parent module."
          : current.kind === "multiple"
            ? "Select one diagram object before moving to its parent."
            : "The current diagram object has no visible parent module.";
      } else {
        const selectedKeys = new Set(
          diagramSelectionItems(current).map(diagramSelectionKey),
        );
        if (current.kind === "port") {
          selectedKeys.add(diagramSelectionKey({
            kind: "node",
            levelId: current.levelId,
            nodeId: current.nodeId,
          }));
        }
        const currentIndex = selectedKeys.size === 1
          ? canvasKeyboardTraversal.items.findIndex((item) => selectedKeys.has(item.selectionKey))
          : -1;
        const leavingTraversal = currentIndex >= 0 && (
          (!event.shiftKey && currentIndex === canvasKeyboardTraversal.items.length - 1) ||
          (event.shiftKey && currentIndex === 0)
        );
        if (leavingTraversal) return;
        traversalTarget = nextCanvasTraversalTarget(
          canvasKeyboardTraversal.items,
          selectedKeys,
          event.shiftKey ? "backward" : "forward",
          current.kind === "level" ? current.levelId : undefined,
        );
        const targetIndex = traversalTarget
          ? canvasKeyboardTraversal.items.findIndex((item) => item.selectionKey === traversalTarget?.selectionKey)
          : -1;
        announcement = traversalTarget
          ? `Selected diagram object ${targetIndex + 1} of ${canvasKeyboardTraversal.items.length}.`
          : "There are no visible diagram objects to select.";
      }
      event.preventDefault();
      event.stopPropagation();
      if (!traversalTarget) {
        setCanvasAnnouncement(announcement);
        return;
      }
      const next = canvasKeyboardTraversal.selectionByKey.get(traversalTarget.selectionKey);
      if (next && commitCanvasSelection(next, announcement)) focusCanvasSelection(next);
      return;
    }
    if (!flowElementFocused) return;
    const flowId = target.getAttribute("data-id");
    if (!flowId) return;
    const node = baseNodes.find((candidate) => candidate.id === flowId);
    const edge = node ? undefined : routedEdges.find((candidate) => candidate.id === flowId);
    if (
      event.key === "Enter" &&
      ((node && selectedNodeIdsRef.current.has(flowId)) || (edge && selectedEdgeIdsRef.current.has(flowId)))
    ) {
      const editorControl = [...target.querySelectorAll<HTMLElement>(
        CANVAS_OBJECT_CONTROL_SELECTOR,
      )].find((candidate) => candidate !== target && candidate.getClientRects().length > 0);
      if (editorControl) {
        event.preventDefault();
        event.stopPropagation();
        editorControl.focus();
        setCanvasAnnouncement(
          node ? `Editing controls inside ${node.data.block.title}.` : "Editing the selected route.",
        );
        return;
      }
    }
    const keyboardDelta = NODE_KEYBOARD_DELTAS[event.key];
    if (node && keyboardDelta && event.shiftKey && selectedNodeIdsRef.current.has(flowId)) {
      event.preventDefault();
      event.stopPropagation();
      const resizeModifier = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (!resizeModifier || !node.data.resizeNode || node.data.canEditSelection?.() === false) return;
      const minimum = minimumNodeDimensions(node.data.block);
      const currentWidth = node.width ?? minimum.width;
      const currentHeight = node.height ?? minimum.height;
      const dimensions = {
        width: Math.max(
          minimum.width,
          Math.min(
            BLOCK_NODE_GEOMETRY.maximumWidth,
            currentWidth + (event.key === "ArrowLeft" ? -SNAP_GRID[0] : event.key === "ArrowRight" ? SNAP_GRID[0] : 0),
          ),
        ),
        height: Math.max(
          minimum.height,
          Math.min(
            BLOCK_NODE_GEOMETRY.maximumHeight,
            currentHeight + (event.key === "ArrowUp" ? -SNAP_GRID[1] : event.key === "ArrowDown" ? SNAP_GRID[1] : 0),
          ),
        ),
      };
      if (dimensions.width === currentWidth && dimensions.height === currentHeight) return;
      if (onResizeNode(
        node.data.levelId,
        node.data.block.id,
        node.data.designPosition,
        dimensions,
      )) {
        setNodeFocusRequest({
          flowNodeId: flowId,
          designPosition: node.data.designPosition,
          dimensions,
        });
        setCanvasAnnouncement(
          `Resized ${node.data.block.title}. Width ${dimensions.width}, height ${dimensions.height}.`,
        );
      }
      return;
    }
    if (node && keyboardDelta && !event.shiftKey && node.data.positionEditable && selectedNodeIdsRef.current.has(flowId)) {
      event.preventDefault();
      event.stopPropagation();
      const moves = new Map<string, NodeMove>();
      baseNodes.forEach((candidate) => {
        if (!candidate.data.positionEditable || !selectedNodeIdsRef.current.has(candidate.id)) return;
        const identity = `${candidate.data.levelId}\u0000${candidate.data.block.id}`;
        moves.set(identity, {
          levelId: candidate.data.levelId,
          nodeId: candidate.data.block.id,
          position: {
            x: candidate.data.designPosition.x + keyboardDelta.x,
            y: candidate.data.designPosition.y + keyboardDelta.y,
          },
        });
      });
      const designPosition = moves.get(`${node.data.levelId}\u0000${node.data.block.id}`)?.position;
      if (designPosition && onMoveNodes([...moves.values()])) {
        setNodeFocusRequest({ flowNodeId: flowId, designPosition });
        setCanvasAnnouncement(
          moves.size > 1
            ? `Moved ${moves.size} modules ${keyboardDelta.direction}.`
            : `Moved ${node.data.block.title} ${keyboardDelta.direction}. Position x ${designPosition.x}, y ${designPosition.y}.`,
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
    if (event.key !== " ") event.stopPropagation();
    if (selectRef.current(nextSelection) && event.key === "Escape") {
      (target as Element & { blur?: () => void }).blur?.();
    }
  }, [
    baseNodes,
    canvasKeyboardTraversal,
    commitCanvasSelection,
    focusCanvasSelection,
    onMoveNodes,
    onResizeNode,
    routedEdges,
    store,
  ]);

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

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    const origin = resolveEndpoint(params.nodeId, params.handleId);
    if (!origin) return;
    const next: ActiveConnectionGesture = pendingReconnectGestureRef.current
      ? { kind: "reconnect", origin }
      : { kind: "create", origin };
    connectionGestureCancelledRef.current = false;
    connectionGestureCommitRef.current = undefined;
    connectionGestureRef.current = next;
    setConnectionFeedback(undefined);
    setConnectionGesture(next);
    setCanvasAnnouncement(
      `${next.kind === "reconnect" ? "Reconnect" : "Connection"} started from ${origin.nodeTitle}, ${origin.label}. Escape cancels.`,
    );
  }, [resolveEndpoint]);

  const onReconnectStart = useCallback(() => {
    pendingReconnectGestureRef.current = true;
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>((_event, finalState) => {
    if (connectionGestureCancelledRef.current) {
      connectionGestureCancelledRef.current = false;
      connectionGestureCommitRef.current = undefined;
      pendingReconnectGestureRef.current = false;
      connectionGestureRef.current = undefined;
      setConnectionGesture(undefined);
      return;
    }
    const active = connectionGestureRef.current;
    if (!active) return;
    const result = connectionGestureCommitRef.current;
    if (result === "accepted") {
      publishConnectionFeedback(
        "success",
        "Ports selected",
        "Complete the interface contract to create the connection.",
      );
    } else if (result === "changed") {
      publishConnectionFeedback(
        "success",
        "Interface reconnected",
        "The old manual route was cleared and the new endpoints were routed automatically.",
      );
    } else if (result === "unchanged") {
      publishConnectionFeedback(
        "warning",
        "Endpoint unchanged",
        "The existing endpoints, manual route, and history were preserved.",
      );
    } else if (result === "rejected") {
      publishConnectionFeedback(
        "error",
        active.kind === "reconnect" ? "Reconnect rejected" : "Connection rejected",
        "Resolve the visible editor issue and try again. Design unchanged.",
      );
    } else if (finalState.toHandle) {
      publishConnectionFeedback(
        "error",
        "Ports are not compatible",
        "Connections require compatible directions on the same design level. Design unchanged.",
      );
    } else {
      publishConnectionFeedback(
        "warning",
        active.kind === "reconnect" ? "Reconnect canceled" : "Connection canceled",
        "Drop on a highlighted compatible port. Design unchanged.",
      );
    }
    connectionGestureCommitRef.current = undefined;
    pendingReconnectGestureRef.current = false;
    connectionGestureRef.current = undefined;
    setConnectionGesture(undefined);
  }, [publishConnectionFeedback]);

  const snapMovingNode = useCallback((node: CanvasFlowNode, disableSnap: boolean) => {
    const gesture = alignmentGestureRef.current?.nodeId === node.id
      ? alignmentGestureRef.current
      : beginAlignmentGesture(node.id);
    if (!gesture || disableSnap) {
      setAlignmentGuides([]);
      return { position: node.position, guides: [] as AlignmentGuide[] };
    }
    const preview = {
      ...gesture.original,
      x: gesture.original.x + node.position.x - gesture.originalLocalPosition.x,
      y: gesture.original.y + node.position.y - gesture.originalLocalPosition.y,
    };
    const snapped = snapMovingRect(preview, gesture.candidates, gesture.tolerance);
    setAlignmentGuides(snapped.guides);
    return {
      position: {
        x: node.position.x + snapped.rect.x - preview.x,
        y: node.position.y + snapped.rect.y - preview.y,
      },
      guides: snapped.guides,
    };
  }, [beginAlignmentGesture]);
  const onNodeDragStart = useCallback<OnNodeDrag<CanvasFlowNode>>((_, node, draggedNodes) => {
    beginAlignmentGesture(node.id, new Set([node.id, ...draggedNodes.map((candidate) => candidate.id)]));
  }, [beginAlignmentGesture]);
  const onNodeDrag = useCallback<OnNodeDrag<CanvasFlowNode>>((event, node, draggedNodes) => {
    const snapped = snapMovingNode(node, event.altKey);
    const correction = {
      x: snapped.position.x - node.position.x,
      y: snapped.position.y - node.position.y,
    };
    if (correction.x === 0 && correction.y === 0) return;
    const movingIds = new Set([node.id, ...draggedNodes.map((candidate) => candidate.id)]);
    setNodes((current) => current.map((candidate) => movingIds.has(candidate.id)
      ? {
          ...candidate,
          position: {
            x: candidate.position.x + correction.x,
            y: candidate.position.y + correction.y,
          },
        }
      : candidate));
  }, [setNodes, snapMovingNode]);
  const onNodeDragStop = useCallback<OnNodeDrag<CanvasFlowNode>>((event, node, draggedNodes) => {
    const original = baseNodes.find((candidate) => candidate.id === node.id);
    if (!original) {
      alignmentGestureRef.current = undefined;
      setAlignmentGuides([]);
      return;
    }
    const snapped = snapMovingNode(node, event.altKey);
    const correction = {
      x: snapped.position.x - node.position.x,
      y: snapped.position.y - node.position.y,
    };
    alignmentGestureRef.current = undefined;
    setAlignmentGuides([]);
    const movedById = new Map(draggedNodes.map((candidate) => [candidate.id, candidate]));
    movedById.set(node.id, node);
    const moves = new Map<string, NodeMove>();
    movedById.forEach((moved, flowId) => {
      const baseline = baseNodes.find((candidate) => candidate.id === flowId);
      if (!baseline?.data.positionEditable) return;
      moves.set(`${baseline.data.levelId}\u0000${baseline.data.block.id}`, {
        levelId: baseline.data.levelId,
        nodeId: baseline.data.block.id,
        position: {
          x: baseline.data.designPosition.x + moved.position.x + correction.x - baseline.position.x,
          y: baseline.data.designPosition.y + moved.position.y + correction.y - baseline.position.y,
        },
      });
    });
    const restoreSourceNodes = () => setNodes((current) => current.map((candidate) => {
      if (!movedById.has(candidate.id)) return candidate;
      const baseline = baseNodes.find((item) => item.id === candidate.id);
      return baseline ? { ...candidate, position: { ...baseline.position }, dragging: false } : candidate;
    }));
    if ((event.ctrlKey || event.metaKey) && moves.size > 0) {
      const cloned = onCloneNodes([...moves.values()]);
      restoreSourceNodes();
      if (cloned) setCanvasAnnouncement(moves.size > 1 ? `Cloned ${moves.size} modules.` : `Cloned ${node.data.block.title}.`);
      return;
    }
    const accepted = moves.size > 0 && onMoveNodes([...moves.values()]);
    if (accepted) {
      setCanvasAnnouncement(moves.size > 1 ? `Moved ${moves.size} modules.` : `Moved ${node.data.block.title}.`);
      return;
    }
    restoreSourceNodes();
  }, [baseNodes, onCloneNodes, onMoveNodes, setNodes, snapMovingNode]);
  const onConnect = useCallback((connection: Connection) => {
    if (connectionGestureCancelledRef.current) return;
    const normalized = normalizedConnection(connection);
    if (normalized) {
      connectionGestureCommitRef.current = onCreateConnection(normalized) ? "accepted" : "rejected";
    }
  }, [normalizedConnection, onCreateConnection]);
  const onReconnect = useCallback((edge: CanvasFlowEdge, connection: Connection) => {
    if (connectionGestureCancelledRef.current) return;
    const normalized = normalizedConnection(connection);
    if (!normalized || !edge.data) return;
    connectionGestureCommitRef.current = onReconnectConnection(
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
    () => {
      boxSelectionStartRef.current = undefined;
      alignmentGestureRef.current = undefined;
      resizePreviewRef.current = undefined;
      setAlignmentGuides([]);
      commitCanvasSelection({ kind: "level", levelId: entryLevelId });
    },
    [commitCanvasSelection, entryLevelId],
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
      onNodesChange={onCanvasNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onEdgeClick={onEdgeClick}
      onSelectionStart={onSelectionStart}
      onSelectionEnd={onSelectionEnd}
      onPointerDownCapture={onCanvasPointerDownCapture}
      onPointerMoveCapture={onCanvasPointerMoveCapture}
      onPointerUpCapture={onCanvasPointerUpCapture}
      onPointerCancelCapture={onCanvasPointerCancelCapture}
      onClickCapture={onCanvasClickCapture}
      onKeyDownCapture={onElementKeyDownCapture}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onReconnect={onReconnect}
      onReconnectStart={onReconnectStart}
      isValidConnection={isValidConnection}
      onError={warnReactFlowError}
      onPaneClick={onPaneClick}
      tabIndex={0}
      aria-label="Architecture diagram canvas"
      connectionMode={ConnectionMode.Loose}
      connectionLineComponent={ConnectionGesturePreview}
      nodesConnectable
      edgesReconnectable
      snapToGrid
      snapGrid={SNAP_GRID}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      panOnScroll
      panOnDrag={[1, 2]}
      panActivationKeyCode="Space"
      zoomActivationKeyCode={["Control", "Meta"]}
      selectionOnDrag
      selectionKeyCode="Alt"
      multiSelectionKeyCode={["Control", "Meta"]}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      onlyRenderVisibleElements={cullViewportElements}
      proOptions={REACT_FLOW_OPTIONS}
      deleteKeyCode={null}
      className="bd-react-flow"
    >
      {CANVAS_BACKGROUND}
      {spacePanActive ? (
        <Panel className="bd-canvas-pan-mode nokey" position="top-right" aria-live="polite">
          <Hand size={13} aria-hidden="true" />
          <strong>PAN MODE</strong>
          <span>Drag the canvas · release Space to return</span>
        </Panel>
      ) : null}
      {connectionGesture ? (
        <ConnectionGesturePanel
          gesture={connectionGesture}
          candidateCount={connectionCandidateCount}
        />
      ) : connectionFeedback ? (
        <ConnectionGestureFeedbackPanel feedback={connectionFeedback} />
      ) : null}
      <AlignmentGuideLayer guides={alignmentGuides} />
      {routingFailure ? (
        <div
          className="bd-routing-diagnostic nokey"
          role="status"
          title={routingResult.diagnostics.map((diagnostic) => diagnostic.message).join("\n")}
        >
          <strong>{routingFailure.title}</strong>
          <span>{routingFailure.detail}</span>
        </div>
      ) : null}
      <CanvasViewportControls
        onZoomIn={zoomInViewport}
        onZoomOut={zoomOutViewport}
        onActualSize={actualSizeViewport}
        onFit={fitCanvasViewport}
        overviewMapOpen={compactOverviewMapOpen}
        onToggleOverviewMap={() => setCompactOverviewMapOpen((open) => !open)}
      />
      <MiniMap<CanvasFlowNode>
        className={`bd-canvas-minimap nokey${compactOverviewMapOpen ? " is-compact-open" : ""}`}
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
        fitSelectionRequest={props.fitSelectionRequest}
        viewportActionRequest={props.viewportActionRequest}
        revealSelectionRequest={props.revealSelectionRequest}
        routeRevision={props.routeRevision}
        onSelect={props.onSelect}
        onToggleHierarchy={props.onToggleHierarchy}
        onMoveNodes={props.onMoveNodes}
        onCloneNodes={props.onCloneNodes}
        onResizeNode={props.onResizeNode}
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
