import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { DockviewApi, EdgeGroupPosition } from "dockview-react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Box,
  Braces,
  Cable,
  CheckCircle2,
  CircleOff,
  CircuitBoard,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  FilePlus2,
  Focus,
  FolderOpen,
  GitBranchPlus,
  Info,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  MousePointer2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  Route,
  Save,
  Scan,
  ScanSearch,
  Search,
  Scissors,
  Share2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  BlockDesignCanvas,
  type CanvasViewportAction,
  type CanvasViewportActionRequest,
} from "../components/BlockDesignCanvas";
import { CanvasContextMenu } from "../components/CanvasContextMenu";
import { CommandPalette } from "../components/CommandPalette";
import type {
  CanvasContextMenuIntent,
  CanvasContextMenuRequest,
} from "../components/contextMenuModel";
import { DockWorkspace } from "../components/DockWorkspace";
import {
  AddBlockDialog,
  AddChildDesignDialog,
  AddPortDialog,
  CreateConnectionDialog,
  NewDesignDialog,
  SaveDesignDialog,
  SelectConnectionEndpointsDialog,
  type ConnectionEndpointDialogMode,
  type PendingConnection,
} from "../components/EditorDialogs";
import { HierarchyTree } from "../components/HierarchyTree";
import { Inspector } from "../components/Inspector";
import { LoadDesignDialog } from "../components/LoadDesignDialog";
import { MenuBar } from "../components/MenuBar";
import { MessagesPanel } from "../components/MessagesPanel";
import { StudioToolbar } from "../components/StudioToolbar";
import {
  createBlankDesign,
  createBlock,
  createDesignFragment,
  createDesignLevel,
  createInterfaceDefinition,
  createPort,
  parseDesignFragment,
  serializeDesignFragment,
  suggestId,
  uniqueId,
  useDesignEditor,
  type DesignOperation,
  type DesignFragment,
  type NodeMove,
  type NodeResize,
} from "../editor";
import {
  loadDesignFromFile,
  loadDesignFromObject,
  loadDesignFromText,
  loadDesignFromUrl,
  type DesignLoadError,
} from "../io/loadDesign";
import { getDesktopBridge } from "../io/desktopBridge";
import {
  downloadDesign,
  normalizeDesignFileName,
  serializeDesign,
  suggestedDesignFileName,
} from "../io/saveDesign";
import {
  alignSelection,
  distributeSelection,
  layoutBlockDesign,
  layoutFrameSignature,
  layoutProjectionSignature,
  type ArrangementRect,
  type LayoutResult,
  type PlacementMode,
  type SelectionAlignment,
  type SelectionDistribution,
} from "../layout";
import {
  connectionEndpointsEqual,
  connectionPortEndpoints,
  firstConnectablePair,
  hasAlternativeConnectionEndpoints,
  validateBlockDesignDocument,
  type BlockDesignDocument,
  type ConnectionRouting,
  type DesignIssue,
  type DirectConnectionDirection,
} from "../model";
import type { StudioCommandAvailability, StudioCommands } from "./commands";
import { findDesignFragmentPlacement } from "./fragmentPlacement";
import {
  connectionForSelection,
  directInterfaceSelectionExpansion,
  directNeighborhoodSelectionExpansion,
  diagramSelectionKey,
  hierarchyLevelIsWithin,
  hierarchyLevelPath,
  hierarchyLevelTrail,
  hierarchyParentSelection,
  diagramSelectionItems,
  levelForSelection,
  nodeForSelection,
  replaceDiagramSelection,
  sameSelection,
  selectAllInLevel,
  selectDiagramKindInLevel,
  selectionExists,
  selectionForIssue,
  type SelectionRef,
} from "./selection";

function errorMessage(error: unknown): string {
  const loadError = error as DesignLoadError;
  if (loadError?.causeDetail) return `${loadError.message}\n${loadError.causeDetail}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function commandAvailability(
  enabled: boolean,
  unavailableReason: string,
): StudioCommandAvailability {
  return enabled ? { enabled: true } : { enabled: false, unavailableReason };
}

function directSelectionUnavailableReason(
  hasDocument: boolean,
  reason: string | undefined,
  direction: DirectConnectionDirection,
): string {
  if (!hasDocument) return "Open or create a design first.";
  const directionLabel = direction === "both" ? "direct" : direction;
  if (reason === "no-direct-interfaces") {
    return `The selected modules have no ${directionLabel} interfaces.`;
  }
  if (reason === "all-direct-interfaces-selected") {
    return `All ${directionLabel} interfaces are already selected.`;
  }
  if (reason === "all-direct-neighborhood-selected") {
    return `The complete ${directionLabel} neighborhood is already selected.`;
  }
  return "Select one or more modules first.";
}

function fileNameFromSource(document: BlockDesignDocument, source: string): string {
  const tail = source.split(/[\\/]/).at(-1);
  return tail?.endsWith(".json") ? tail : suggestedDesignFileName(document);
}

interface ArrangeableModule extends ArrangementRect {
  levelId: string;
  nodeId: string;
}

interface FragmentModule {
  levelId: string;
  nodeId: string;
  position: { x: number; y: number };
}

type FragmentSelection =
  | { available: true; levelId: string; items: readonly FragmentModule[] }
  | { available: false; reason: string };

type ArrangementSelection =
  | { available: true; items: readonly ArrangeableModule[] }
  | { available: false; reason: string };

type ArrangementRequest =
  | { kind: "align"; alignment: SelectionAlignment }
  | { kind: "distribute"; direction: SelectionDistribution };

type ConnectionEndpointDialogRequest =
  | { kind: "create"; levelId: string }
  | { kind: "reconnect"; levelId: string; connectionId: string };

function designFragmentSummary(fragment: DesignFragment): string {
  return `${fragment.nodes.length} ${fragment.nodes.length === 1 ? "module" : "modules"}` +
    `${fragment.connections.length > 0 ? ` and ${fragment.connections.length} internal ${fragment.connections.length === 1 ? "interface" : "interfaces"}` : ""}`;
}

async function writeDesignFragmentToSystemClipboard(serialized: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(serialized);
    return true;
  } catch {
    return false;
  }
}

export interface BlockDesignStudioProps {
  initialDocument?: unknown;
  initialDesignUrl?: string;
  initialSourceLabel?: string;
}

export function BlockDesignStudio({
  initialDocument,
  initialDesignUrl,
  initialSourceLabel = "embedded document",
}: BlockDesignStudioProps) {
  const bootDocument = useMemo(() => createBlankDesign("studio-loading", "Loading Design"), []);
  const desktopBridge = useMemo(() => getDesktopBridge(), []);
  const editor = useDesignEditor(bootDocument);
  const [documentInstalled, setDocumentInstalled] = useState(false);
  const document = documentInstalled ? editor.document : undefined;
  const [expandedLevelIds, setExpandedLevelIds] = useState<Set<string>>(new Set());
  const [viewRootLevelId, setViewRootLevelId] = useState(bootDocument.entryLevelId);
  const [selection, setSelection] = useState<SelectionRef>({ kind: "document" });
  const [inspectorDraftDirty, setInspectorDraftDirty] = useState(false);
  const [issues, setIssues] = useState<DesignIssue[]>([]);
  const [layout, setLayout] = useState<LayoutResult>({ nodes: [], edges: [] });
  const [placementMode, setPlacementMode] = useState<PlacementMode>("authored");
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [routeRevision, setRouteRevision] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [fitSelectionRequest, setFitSelectionRequest] = useState(0);
  const [viewportActionRequest, setViewportActionRequest] = useState<CanvasViewportActionRequest>({
    revision: 0,
    action: "actual-size",
  });
  const [revealSelectionRequest, setRevealSelectionRequest] = useState(0);
  const [messageFocusRequest, setMessageFocusRequest] = useState(0);
  const [workspaceResetRequest, setWorkspaceResetRequest] = useState(0);
  const [dockApi, setDockApi] = useState<DockviewApi>();
  const [diagramMaximized, setDiagramMaximized] = useState(false);
  const diagramEdgeState = useRef<Map<EdgeGroupPosition, boolean> | undefined>(undefined);
  const fitAfterLayout = useRef(true);
  const revealSelectionAfterLayout = useRef(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuRequest>();
  const canvasContextMenuRevision = useRef(0);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [addBlockLevelId, setAddBlockLevelId] = useState<string>();
  const [addPortTarget, setAddPortTarget] = useState<{ levelId: string; nodeId: string }>();
  const [connectionEndpointRequest, setConnectionEndpointRequest] = useState<ConnectionEndpointDialogRequest>();
  const [inspectorReconnectFocusRequest, setInspectorReconnectFocusRequest] = useState(0);
  const [childDesignTarget, setChildDesignTarget] = useState<{ levelId: string; nodeId: string }>();
  const [pendingConnection, setPendingConnection] = useState<PendingConnection>();
  const [loadError, setLoadError] = useState<string>();
  const [commandError, setCommandError] = useState<string>();
  const [commandNotice, setCommandNotice] = useState<string>();
  const [designClipboard, setDesignClipboard] = useState<DesignFragment>();
  const [busy, setBusy] = useState(true);
  const [layoutBusy, setLayoutBusy] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [sourceLabel, setSourceLabel] = useState(initialDesignUrl ?? initialSourceLabel);
  const [fileName, setFileName] = useState("design.block-design.json");
  const initialLoadStarted = useRef(false);
  const documentRef = useRef<BlockDesignDocument | undefined>(document);
  const editorDocumentRef = useRef(editor.document);
  const editorDirtyRef = useRef(editor.dirty);
  const selectionRef = useRef(selection);
  const viewRootLevelIdRef = useRef(viewRootLevelId);
  const inspectorDraftDirtyRef = useRef(inspectorDraftDirty);
  const pasteInsertionIndex = useRef(0);
  const dockApiRef = useRef(dockApi);
  documentRef.current = document;
  editorDocumentRef.current = editor.document;
  editorDirtyRef.current = editor.dirty;
  selectionRef.current = selection;
  viewRootLevelIdRef.current = viewRootLevelId;
  inspectorDraftDirtyRef.current = inspectorDraftDirty;
  dockApiRef.current = dockApi;
  const layoutProjection = useMemo(
    () => document ? layoutProjectionSignature(document) : undefined,
    [document],
  );

  const installDocument = useCallback((next: BlockDesignDocument, source: string, saved = true) => {
    editor.replace(next, saved);
    setLayout({ nodes: [], edges: [] });
    fitAfterLayout.current = true;
    setDocumentInstalled(true);
    setExpandedLevelIds(new Set());
    setViewRootLevelId(next.entryLevelId);
    viewRootLevelIdRef.current = next.entryLevelId;
    setInspectorDraftDirty(false);
    setSelection({ kind: "level", levelId: next.entryLevelId });
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setSourceLabel(source);
    setFileName(fileNameFromSource(next, source));
    setLoadError(undefined);
    setCommandError(undefined);
    setCommandNotice(undefined);
    setCanvasContextMenu(undefined);
    pasteInsertionIndex.current = 0;
    setLoadDialogOpen(false);
    setBusy(false);
    setLayoutBusy(true);
    setLayoutRevision((value) => value + 1);
  }, [editor.replace]);

  const mayDiscardChanges = useCallback(() => {
    if (!editorDirtyRef.current && !inspectorDraftDirtyRef.current) return true;
    const message = inspectorDraftDirtyRef.current
      ? "Discard unapplied Inspector changes and unsaved changes to the current design?"
      : "Discard unsaved changes to the current design?";
    return window.confirm(message);
  }, []);

  const openUrl = useCallback(async (url: string, initial = false) => {
    if (!initial && !mayDiscardChanges()) return;
    setBusy(true);
    setLoadError(undefined);
    try {
      const next = await loadDesignFromUrl(url);
      if (!initial) await desktopBridge?.clearFileBinding();
      installDocument(next, url);
    } catch (error) {
      setLoadError(errorMessage(error));
      if (!initial) setLoadDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }, [desktopBridge, installDocument, mayDiscardChanges]);

  const openFile = useCallback(async (file: File) => {
    if (!mayDiscardChanges()) return;
    setBusy(true);
    setLoadError(undefined);
    try {
      const next = await loadDesignFromFile(file);
      await desktopBridge?.clearFileBinding();
      installDocument(next, file.name);
    } catch (error) {
      setLoadError(errorMessage(error));
      setLoadDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }, [desktopBridge, installDocument, mayDiscardChanges]);

  const openDesktopDesign = useCallback(async () => {
    if (!desktopBridge || !mayDiscardChanges()) return;
    setBusy(true);
    setLoadError(undefined);
    try {
      const result = await desktopBridge.openDesign();
      if (result.status === "canceled") return;
      const next = loadDesignFromText(result.content, result.fileName);
      if (!await desktopBridge.acceptOpenedDesign(result.token)) {
        throw new Error("The selected desktop file was no longer available to accept.");
      }
      installDocument(next, result.fileName);
    } catch (error) {
      setCommandError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [desktopBridge, installDocument, mayDiscardChanges]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    if (initialDesignUrl) {
      void openUrl(initialDesignUrl, true);
      return;
    }
    try {
      if (initialDocument === undefined) throw new Error("BlockDesignStudio requires an initial document or design URL.");
      installDocument(loadDesignFromObject(initialDocument), initialSourceLabel);
    } catch (error) {
      setLoadError(errorMessage(error));
      setBusy(false);
    }
  }, [initialDesignUrl, initialDocument, initialSourceLabel, installDocument, openUrl]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    setLayoutBusy(true);
    const currentViewRootLevelId = document.levels.some(
      (level) => level.id === viewRootLevelId,
    ) ? viewRootLevelId : document.entryLevelId;
    layoutBlockDesign(document, {
      expandedLevelIds,
      placementMode,
      rootLevelId: currentViewRootLevelId,
    })
      .then((result) => {
        if (!active) return;
        setLayout(result);
        if (revealSelectionAfterLayout.current) {
          revealSelectionAfterLayout.current = false;
          window.setTimeout(() => setRevealSelectionRequest((value) => value + 1), 0);
        }
        if (fitAfterLayout.current && result.nodes.length > 0) {
          fitAfterLayout.current = false;
          window.setTimeout(() => setFitRequest((value) => value + 1), 0);
        }
      })
      .catch((error) => {
        if (!active) return;
        setLayout({ nodes: [], edges: [] });
        setIssues((current) => [
          ...current.filter((issue) => issue.code !== "BD-LAYOUT-FAILED"),
          {
            id: "BD-LAYOUT-FAILED:document",
            severity: "error",
            code: "BD-LAYOUT-FAILED",
            message: errorMessage(error),
            remediation: "Resolve the reported layout input or engine failure, then regenerate the layout.",
            levelId: currentViewRootLevelId,
          },
        ]);
      })
      .finally(() => {
        if (active) setLayoutBusy(false);
      });
    return () => { active = false; };
  }, [layoutProjection, expandedLevelIds, layoutRevision, placementMode, viewRootLevelId]);

  useEffect(() => {
    if (!document || document.levels.some((level) => level.id === viewRootLevelId)) return;
    fitAfterLayout.current = true;
    revealSelectionAfterLayout.current = false;
    viewRootLevelIdRef.current = document.entryLevelId;
    setViewRootLevelId(document.entryLevelId);
  }, [document, viewRootLevelId]);

  useEffect(() => {
    if (document && !selectionExists(document, selection)) {
      setInspectorDraftDirty(false);
      setSelection({ kind: "level", levelId: document.entryLevelId });
    }
  }, [document, selection]);

  useEffect(() => {
    if (!document || !connectionEndpointRequest) return;
    const level = document.levels.find(
      (candidate) => candidate.id === connectionEndpointRequest.levelId,
    );
    let contextExists = Boolean(level);
    if (level && connectionEndpointRequest.kind === "reconnect") {
      const connection = level.connections.find(
        (candidate) => candidate.id === connectionEndpointRequest.connectionId,
      );
      contextExists = Boolean(connection && connectionPortEndpoints(level, connection));
    }
    if (contextExists) return;
    setConnectionEndpointRequest(undefined);
    setCommandError("The interface endpoint context changed. Select the interface and reopen Reconnect Interface.");
  }, [connectionEndpointRequest, document]);

  useEffect(() => {
    if (desktopBridge || (!editor.dirty && !inspectorDraftDirty)) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [desktopBridge, editor.dirty, inspectorDraftDirty]);

  useEffect(() => {
    desktopBridge?.setDirty({
      documentDirty: editor.dirty,
      inspectorDraftDirty,
    });
  }, [desktopBridge, editor.dirty, inspectorDraftDirty]);

  const requestSelection = useCallback((next: SelectionRef): boolean => {
    if (sameSelection(selectionRef.current, next)) return true;
    if (inspectorDraftDirtyRef.current && !window.confirm("Discard unapplied Inspector changes and change selection?")) {
      return false;
    }
    setInspectorDraftDirty(false);
    selectionRef.current = next;
    setSelection(next);
    setCommandNotice(undefined);
    return true;
  }, []);

  const navigateViewRoot = useCallback((
    levelId: string,
    nextSelection: SelectionRef = { kind: "level", levelId },
    notice?: string,
    revealSelection = false,
  ): boolean => {
    const currentDocument = documentRef.current;
    if (!currentDocument || hierarchyLevelTrail(currentDocument, levelId).length === 0) {
      setCommandError(`Cannot display missing or detached design level ${levelId}.`);
      return false;
    }
    if (!requestSelection(nextSelection)) return false;
    if (viewRootLevelIdRef.current !== levelId) {
      viewRootLevelIdRef.current = levelId;
      revealSelectionAfterLayout.current = revealSelection;
      fitAfterLayout.current = !revealSelection;
      setLayoutBusy(true);
      setViewRootLevelId(levelId);
    } else if (revealSelection) {
      setRevealSelectionRequest((value) => value + 1);
    }
    setCanvasContextMenu(undefined);
    setCommandError(undefined);
    if (notice) setCommandNotice(notice);
    return true;
  }, [requestSelection]);

  const requestSelectionFromNavigator = useCallback((next: SelectionRef): boolean => {
    if (!requestSelection(next)) return false;
    setRevealSelectionRequest((value) => value + 1);
    return true;
  }, [requestSelection]);

  const openCanvasContextMenu = useCallback((intent: CanvasContextMenuIntent): boolean => {
    if (!requestSelection(intent.selection)) return false;
    canvasContextMenuRevision.current += 1;
    setCanvasContextMenu({ ...intent, revision: canvasContextMenuRevision.current });
    setCommandError(undefined);
    return true;
  }, [requestSelection]);

  const dismissCanvasContextMenu = useCallback(() => setCanvasContextMenu(undefined), []);

  useEffect(() => {
    if (!canvasContextMenu) return;
    const targetKey = diagramSelectionKey(canvasContextMenu.target);
    const targetStillSelected = diagramSelectionItems(selection)
      .some((item) => diagramSelectionKey(item) === targetKey);
    if (!document || !selectionExists(document, canvasContextMenu.target) || !targetStillSelected) {
      setCanvasContextMenu(undefined);
    }
  }, [canvasContextMenu, document, selection]);

  const requireAppliedInspectorDraft = useCallback((action: string): boolean => {
    if (!inspectorDraftDirtyRef.current) return true;
    setCommandError(`Apply or discard the current Inspector changes before ${action}.`);
    const properties = dockApiRef.current?.getEdgeGroup("right");
    if (properties?.isCollapsed()) properties.expand();
    return false;
  }, []);

  const confirmDiscardInspectorDraft = useCallback((action: string): boolean => {
    if (!inspectorDraftDirtyRef.current) return true;
    return window.confirm(`Discard unapplied Inspector changes and ${action}?`);
  }, []);

  const runOperation = useCallback((operation: DesignOperation): BlockDesignDocument | undefined => {
    try {
      const previousFrame = layoutFrameSignature(editorDocumentRef.current);
      const next = editor.apply(operation);
      if (layoutFrameSignature(next) !== previousFrame) fitAfterLayout.current = true;
      setIssues(validateBlockDesignDocument(next));
      setCommandError(undefined);
      setCommandNotice(undefined);
      setPlacementMode("authored");
      return next;
    } catch (error) {
      setCommandNotice(undefined);
      setCommandError(errorMessage(error));
      return undefined;
    }
  }, [editor.apply]);

  const undoDesign = useCallback(() => {
    if (!confirmDiscardInspectorDraft("undo the last document operation")) return;
    const previousFrame = layoutFrameSignature(editorDocumentRef.current);
    const next = editor.undo();
    if (!next) return;
    setInspectorDraftDirty(false);
    if (layoutFrameSignature(next) !== previousFrame) fitAfterLayout.current = true;
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setCommandError(undefined);
    setCommandNotice(undefined);
  }, [confirmDiscardInspectorDraft, editor.undo]);

  const redoDesign = useCallback(() => {
    if (!confirmDiscardInspectorDraft("redo the next document operation")) return;
    const previousFrame = layoutFrameSignature(editorDocumentRef.current);
    const next = editor.redo();
    if (!next) return;
    setInspectorDraftDirty(false);
    if (layoutFrameSignature(next) !== previousFrame) fitAfterLayout.current = true;
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setCommandError(undefined);
    setCommandNotice(undefined);
  }, [confirmDiscardInspectorDraft, editor.redo]);

  const persistDesktopDesign = useCallback(async (
    mode: "save" | "saveAs" | "export",
  ): Promise<boolean> => {
    if (!document || !desktopBridge) return false;
    if (!requireAppliedInspectorDraft(mode === "export" ? "exporting" : "saving")) return false;
    try {
      const result = await desktopBridge.saveDesign({
        content: serializeDesign(document),
        suggestedFileName: mode === "export"
          ? `${document.id}.export.block-design.json`
          : fileName,
        mode,
      });
      if (result.status === "canceled") return false;
      if (mode !== "export") {
        setFileName(result.fileName);
        setSourceLabel(result.fileName);
        editor.markSaved();
      }
      setCommandError(undefined);
      return true;
    } catch (error) {
      setCommandError(errorMessage(error));
      return false;
    }
  }, [desktopBridge, document, editor.markSaved, fileName, requireAppliedInspectorDraft]);

  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!document) return false;
    if (desktopBridge) return persistDesktopDesign("save");
    if (!requireAppliedInspectorDraft("saving")) return false;
    try {
      const savedName = downloadDesign(document, fileName);
      setFileName(savedName);
      setSourceLabel(savedName);
      editor.markSaved();
      setCommandError(undefined);
      return true;
    } catch (error) {
      setCommandError(errorMessage(error));
      return false;
    }
  }, [desktopBridge, document, editor.markSaved, fileName, persistDesktopDesign, requireAppliedInspectorDraft]);

  const exportCurrent = useCallback(() => {
    if (!document) return;
    if (desktopBridge) {
      void persistDesktopDesign("export");
      return;
    }
    if (!requireAppliedInspectorDraft("exporting")) return;
    try {
      downloadDesign(document, `${document.id}.export.block-design.json`);
      setCommandError(undefined);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  }, [desktopBridge, document, persistDesktopDesign, requireAppliedInspectorDraft]);

  const openSaveAs = useCallback(() => {
    if (desktopBridge) {
      void persistDesktopDesign("saveAs");
      return;
    }
    if (!requireAppliedInspectorDraft("opening Save As")) return;
    setCommandError(undefined);
    setSaveAsDialogOpen(true);
  }, [desktopBridge, persistDesktopDesign, requireAppliedInspectorDraft]);

  useEffect(() => {
    if (!desktopBridge) return;
    return desktopBridge.onSaveBeforeClose(() => {
      void saveCurrent().then((saved) => desktopBridge.completeSaveBeforeClose(saved));
    });
  }, [desktopBridge, saveCurrent]);

  const deleteSelection = useCallback(() => {
    if (!document || selection.kind === "document" || selection.kind === "level") return;
    const description = selection.kind === "multiple"
      ? `Delete ${selection.items.length} selected diagram objects? Modules also remove attached interfaces and exclusively owned child designs.`
      : selection.kind === "node"
        ? "Delete this module, its connections, and its exclusively owned child design?"
        : selection.kind === "port"
          ? "Delete this port and all attached connections?"
          : "Delete this connection and its unused interface definition?";
    const draftWarning = inspectorDraftDirty ? " Unapplied Inspector changes will also be discarded." : "";
    if (!window.confirm(`${description}${draftWarning}`)) return;
    const operation: DesignOperation = selection.kind === "multiple"
      ? { type: "objects/delete", targets: selection.items }
      : selection.kind === "node"
        ? { type: "node/delete", levelId: selection.levelId, nodeId: selection.nodeId }
        : selection.kind === "port"
          ? { type: "port/delete", levelId: selection.levelId, nodeId: selection.nodeId, portId: selection.portId }
          : { type: "connection/delete", levelId: selection.levelId, connectionId: selection.connectionId };
    const next = runOperation(operation);
    if (next) {
      setInspectorDraftDirty(false);
      setSelection({
        kind: "level",
        levelId: selection.kind === "multiple" ? next.entryLevelId : selection.levelId,
      });
    }
  }, [document, inspectorDraftDirty, runOperation, selection]);

  const revealLevel = useCallback((levelId: string) => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const path = hierarchyLevelPath(currentDocument, levelId);
    const currentViewRoot = viewRootLevelIdRef.current;
    if (
      levelId !== currentDocument.entryLevelId &&
      path.length === 0
    ) return;
    if (!hierarchyLevelIsWithin(currentDocument, currentViewRoot, levelId)) {
      const selected = selectionRef.current;
      const selectedLevelId = selected.kind === "document" || selected.kind === "multiple"
        ? undefined
        : selected.levelId;
      const revealSelection = selectedLevelId === levelId &&
        selected.kind !== "document" && selected.kind !== "level";
      viewRootLevelIdRef.current = levelId;
      revealSelectionAfterLayout.current = revealSelection;
      fitAfterLayout.current = !revealSelection;
      setLayoutBusy(true);
      setViewRootLevelId(levelId);
      return;
    }
    const visiblePath = path.slice(Math.max(0, path.indexOf(currentViewRoot) + 1));
    setExpandedLevelIds((current) => {
      if (visiblePath.every((id) => current.has(id))) return current;
      fitAfterLayout.current = true;
      setLayoutBusy(true);
      return new Set([...current, ...visiblePath]);
    });
  }, []);

  const toggleHierarchy = useCallback((levelId: string) => {
    fitAfterLayout.current = true;
    setLayoutBusy(true);
    setExpandedLevelIds((current) => {
      const next = new Set(current);
      if (next.has(levelId)) {
        next.delete(levelId);
        const currentDocument = documentRef.current;
        if (currentDocument) {
          currentDocument.levels.forEach((level) => {
            if (hierarchyLevelPath(currentDocument, level.id).includes(levelId)) next.delete(level.id);
          });
        }
      } else {
        const currentDocument = documentRef.current;
        if (currentDocument) hierarchyLevelPath(currentDocument, levelId).forEach((id) => next.add(id));
        else next.add(levelId);
      }
      return next;
    });
  }, []);

  const selectIssue = useCallback((issue: DesignIssue) => {
    if (!requestSelectionFromNavigator(selectionForIssue(issue))) return;
    if (issue.levelId) revealLevel(issue.levelId);
  }, [requestSelectionFromNavigator, revealLevel]);

  const toggleDock = useCallback((position: EdgeGroupPosition) => {
    const group = dockApi?.getEdgeGroup(position);
    if (!group) return;
    if (group.isCollapsed()) {
      group.expand();
      if (position === "bottom") setMessageFocusRequest((value) => value + 1);
    } else {
      group.collapse();
    }
    window.setTimeout(() => setFitRequest((value) => value + 1), 180);
  }, [dockApi]);

  const maximizeDiagram = useCallback(() => {
    if (!dockApi) return;
    if (diagramEdgeState.current) {
      dockApi.exitMaximizedGroup();
      diagramEdgeState.current.forEach((collapsed, position) => {
        const group = dockApi.getEdgeGroup(position);
        if (!group) return;
        if (collapsed) group.collapse();
        else group.expand();
      });
      diagramEdgeState.current = undefined;
      setDiagramMaximized(false);
      window.setTimeout(() => setFitRequest((value) => value + 1), 180);
      return;
    }
    const edgeState = new Map<EdgeGroupPosition, boolean>();
    (["left", "right", "bottom"] as const).forEach((position) => {
      const group = dockApi.getEdgeGroup(position);
      if (!group) return;
      edgeState.set(position, group.isCollapsed());
      group.collapse();
    });
    const panel = dockApi.getPanel("diagram");
    if (panel) {
      diagramEdgeState.current = edgeState;
      dockApi.maximizeGroup(panel);
      setDiagramMaximized(true);
      window.setTimeout(() => setFitRequest((value) => value + 1), 180);
    }
  }, [dockApi]);

  const validateDesign = useCallback(() => {
    if (!document) return;
    setIssues(validateBlockDesignDocument(document));
    dockApi?.getEdgeGroup("bottom")?.expand();
    setMessageFocusRequest((value) => value + 1);
  }, [dockApi, document]);

  const effectiveViewRootLevelId = document?.levels.some((level) => level.id === viewRootLevelId)
    ? viewRootLevelId
    : document?.entryLevelId;
  const viewRootLevel = document?.levels.find((level) => level.id === effectiveViewRootLevelId);
  const viewRootPath = useMemo(
    () => document && effectiveViewRootLevelId
      ? hierarchyLevelTrail(document, effectiveViewRootLevelId)
      : [],
    [document, effectiveViewRootLevelId],
  );
  const activeLevel = document
    ? selection.kind === "document"
      ? viewRootLevel
      : levelForSelection(document, selection)
    : undefined;
  const selectedNode = document ? nodeForSelection(document, selection) : undefined;
  const selectedConnection = document ? connectionForSelection(document, selection) : undefined;
  const selectedDiagramItemCount = diagramSelectionItems(selection).length;
  const selectedChildLevelId = selectedNode?.node.hierarchy?.childLevelId;
  const parentViewSelection = document && effectiveViewRootLevelId
    ? hierarchyParentSelection(document, effectiveViewRootLevelId)
    : undefined;
  const enterHierarchy = useCallback(() => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const selected = nodeForSelection(currentDocument, selectionRef.current);
    const childLevelId = selected?.node.hierarchy?.childLevelId;
    const childLevel = currentDocument?.levels.find((level) => level.id === childLevelId);
    if (!childLevelId || !childLevel) return;
    navigateViewRoot(
      childLevelId,
      { kind: "level", levelId: childLevelId },
      `Entered ${childLevel.title}. Use Exit Module or the breadcrumb to restore context.`,
    );
  }, [navigateViewRoot]);
  const exitHierarchy = useCallback(() => {
    const currentDocument = documentRef.current;
    const currentRoot = viewRootLevelIdRef.current;
    if (!currentDocument) return;
    const parentSelection = hierarchyParentSelection(currentDocument, currentRoot);
    if (!parentSelection) return;
    const parentLevelId = parentSelection.kind === "level" || parentSelection.kind === "node"
      ? parentSelection.levelId
      : currentDocument.entryLevelId;
    const parentLevel = currentDocument.levels.find((level) => level.id === parentLevelId);
    navigateViewRoot(
      parentLevelId,
      parentSelection,
      `Exited to ${parentLevel?.title ?? parentLevelId}.`,
      parentSelection.kind === "node",
    );
  }, [navigateViewRoot]);
  const homeHierarchy = useCallback(() => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const entry = currentDocument.levels.find((level) => level.id === currentDocument.entryLevelId);
    navigateViewRoot(
      currentDocument.entryLevelId,
      { kind: "level", levelId: currentDocument.entryLevelId },
      `Returned to ${entry?.title ?? currentDocument.entryLevelId}.`,
    );
  }, [navigateViewRoot]);
  const activeLevelDiagramItemCount = activeLevel
    ? activeLevel.nodes.length + activeLevel.connections.length
    : 0;
  const directInterfaceExpansion = useMemo(
    () => document ? directInterfaceSelectionExpansion(document, selection) : undefined,
    [document, selection],
  );
  const directNeighborhoodExpansion = useMemo(
    () => document ? directNeighborhoodSelectionExpansion(document, selection) : undefined,
    [document, selection],
  );
  const incomingInterfaceExpansion = useMemo(
    () => document ? directInterfaceSelectionExpansion(document, selection, "incoming") : undefined,
    [document, selection],
  );
  const outgoingInterfaceExpansion = useMemo(
    () => document ? directInterfaceSelectionExpansion(document, selection, "outgoing") : undefined,
    [document, selection],
  );
  const incomingNeighborhoodExpansion = useMemo(
    () => document ? directNeighborhoodSelectionExpansion(document, selection, "incoming") : undefined,
    [document, selection],
  );
  const outgoingNeighborhoodExpansion = useMemo(
    () => document ? directNeighborhoodSelectionExpansion(document, selection, "outgoing") : undefined,
    [document, selection],
  );
  const requestViewportAction = useCallback((action: CanvasViewportAction) => {
    setViewportActionRequest((current) => ({ revision: current.revision + 1, action }));
  }, []);
  const arrangementSelection = useMemo<ArrangementSelection>(() => {
    if (!document) return { available: false, reason: "Open or create a design first." };
    if (layoutBusy) return { available: false, reason: "Wait for the diagram layout to finish." };
    if (selection.kind !== "multiple") {
      return { available: false, reason: "Select at least two modules first." };
    }
    if (selection.items.some((item) => item.kind !== "node")) {
      return { available: false, reason: "Select modules only; interfaces cannot be arranged." };
    }
    if (new Set(selection.items.map((item) => item.levelId)).size !== 1) {
      return { available: false, reason: "Select modules from the same design level." };
    }

    const projections = new Map<string, typeof layout.nodes>();
    layout.nodes.forEach((node) => {
      const identity = `${node.data.levelId}\u0000${node.data.block.id}`;
      projections.set(identity, [...(projections.get(identity) ?? []), node]);
    });
    const items: ArrangeableModule[] = [];
    for (const item of selection.items) {
      if (item.kind !== "node") continue;
      const identity = `${item.levelId}\u0000${item.nodeId}`;
      const matches = projections.get(identity) ?? [];
      if (matches.length !== 1) {
        return {
          available: false,
          reason: "Each selected module must have one visible diagram instance.",
        };
      }
      const [node] = matches;
      if (!node.data.positionEditable || node.data.expanded) {
        return {
          available: false,
          reason: "Collapse expanded hierarchy and use authored placement before arranging modules.",
        };
      }
      if (!node.width || !node.height) {
        return { available: false, reason: "Wait for the selected module geometry to finish measuring." };
      }
      items.push({
        id: identity,
        levelId: item.levelId,
        nodeId: item.nodeId,
        x: node.data.designPosition.x,
        y: node.data.designPosition.y,
        width: node.width,
        height: node.height,
      });
    }
    return { available: true, items };
  }, [document, layout.nodes, layoutBusy, selection]);

  const fragmentSelection = useMemo<FragmentSelection>(() => {
    if (!document) return { available: false, reason: "Open or create a design first." };
    if (layoutBusy) return { available: false, reason: "Wait for the diagram layout to finish." };
    const selectedItems = diagramSelectionItems(selection);
    const selectedNodes = selectedItems.filter((item) => item.kind === "node");
    if (selectedNodes.length === 0) {
      return { available: false, reason: "Select one or more modules first." };
    }
    if (new Set(selectedItems.map((item) => item.levelId)).size !== 1) {
      return { available: false, reason: "Select modules and interfaces from the same design level." };
    }
    const levelId = selectedNodes[0].levelId;
    const items: FragmentModule[] = [];
    for (const item of selectedNodes) {
      const matches = layout.nodes.filter((node) =>
        node.data.levelId === item.levelId && node.data.block.id === item.nodeId
      );
      if (matches.length !== 1) {
        return {
          available: false,
          reason: "Each selected module must have one visible diagram instance.",
        };
      }
      items.push({
        levelId: item.levelId,
        nodeId: item.nodeId,
        position: { ...matches[0].data.designPosition },
      });
    }
    return { available: true, levelId, items };
  }, [document, layout.nodes, layoutBusy, selection]);

  const openAddBlock = useCallback(() => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    if (!requireAppliedInspectorDraft("adding a module")) return;
    setCommandError(undefined);
    setAddBlockLevelId(levelForSelection(currentDocument, selectionRef.current)?.id);
  }, [requireAppliedInspectorDraft]);

  const openAddPort = useCallback(() => {
    if (!selectedNode || !requireAppliedInspectorDraft("adding a port")) return;
    setCommandError(undefined);
    setAddPortTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id });
  }, [requireAppliedInspectorDraft, selectedNode]);

  const openAddConnection = useCallback(() => {
    if (!activeLevel || !requireAppliedInspectorDraft("creating an interface")) return;
    setCommandError(undefined);
    setConnectionEndpointRequest({ kind: "create", levelId: activeLevel.id });
  }, [activeLevel, requireAppliedInspectorDraft]);

  const openReconnectConnection = useCallback(() => {
    if (!selectedConnection || !requireAppliedInspectorDraft("reconnecting an interface")) return;
    if (!hasAlternativeConnectionEndpoints(selectedConnection.level, selectedConnection.connection)) return;
    setCommandError(undefined);
    setConnectionEndpointRequest({
      kind: "reconnect",
      levelId: selectedConnection.level.id,
      connectionId: selectedConnection.connection.id,
    });
  }, [requireAppliedInspectorDraft, selectedConnection]);

  const openAddChildDesign = useCallback(() => {
    if (!selectedNode || !requireAppliedInspectorDraft("creating a child design")) return;
    setCommandError(undefined);
    setChildDesignTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id });
  }, [requireAppliedInspectorDraft, selectedNode]);

  const moveNodes = useCallback((moves: readonly NodeMove[]) => {
    if (!requireAppliedInspectorDraft("moving a module")) return false;
    return Boolean(runOperation(moves.length === 1
      ? { type: "node/move", ...moves[0] }
      : { type: "nodes/move", moves }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const renameNode = useCallback((levelId: string, nodeId: string, title: string) => {
    if (!requireAppliedInspectorDraft("renaming a module")) return false;
    return Boolean(runOperation({ type: "node/rename", levelId, nodeId, title }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const arrangeModules = useCallback((request: ArrangementRequest) => {
    if (!arrangementSelection.available) return false;
    if (!requireAppliedInspectorDraft("arranging the selected modules")) return false;
    try {
      const positions = request.kind === "align"
        ? alignSelection(arrangementSelection.items, request.alignment)
        : distributeSelection(arrangementSelection.items, request.direction);
      const modules = new Map(arrangementSelection.items.map((item) => [item.id, item]));
      const moves = positions.map(({ id, position }) => {
        const module = modules.get(id)!;
        return {
          levelId: module.levelId,
          nodeId: module.nodeId,
          position,
        };
      });
      return Boolean(runOperation({ type: "nodes/move", moves }));
    } catch (error) {
      setCommandError(errorMessage(error));
      return false;
    }
  }, [arrangementSelection, requireAppliedInspectorDraft, runOperation]);

  const selectedFragment = useCallback((): DesignFragment | undefined => {
    const currentDocument = documentRef.current;
    if (!currentDocument || !fragmentSelection.available) return undefined;
    try {
      return createDesignFragment(
        currentDocument,
        fragmentSelection.levelId,
        fragmentSelection.items.map((item) => item.nodeId),
        new Map(fragmentSelection.items.map((item) => [item.nodeId, item.position])),
      );
    } catch (error) {
      setCommandNotice(undefined);
      setCommandError(errorMessage(error));
      return undefined;
    }
  }, [fragmentSelection]);

  const establishDesignClipboard = useCallback((fragment: DesignFragment): {
    serialized: string;
    summary: string;
  } | undefined => {
    try {
      const serialized = serializeDesignFragment(fragment);
      setDesignClipboard(fragment);
      pasteInsertionIndex.current = 0;
      return { serialized, summary: designFragmentSummary(fragment) };
    } catch (error) {
      setCommandNotice(undefined);
      setCommandError(errorMessage(error));
      return undefined;
    }
  }, []);

  const insertFragment = useCallback((
    fragment: DesignFragment,
    levelId: string,
    insertionIndex: number,
    explicitOffset?: { x: number; y: number },
  ): readonly string[] | undefined => {
    const before = new Set(
      documentRef.current?.levels.find((level) => level.id === levelId)?.nodes.map((node) => node.id) ?? [],
    );
    const offset = explicitOffset ?? findDesignFragmentPlacement(
      fragment,
      layout.nodes
        .filter((node) => node.data.levelId === levelId)
        .map((node) => ({
          x: node.data.designPosition.x,
          y: node.data.designPosition.y,
          width: (node.width ?? Number(node.style?.width)) || 0,
          height: (node.height ?? Number(node.style?.height)) || 0,
        })),
      insertionIndex,
    );
    const next = runOperation({
      type: "fragment/insert",
      levelId,
      fragment,
      offset,
    });
    if (!next) return undefined;
    const insertedNodeIds = next.levels
      .find((level) => level.id === levelId)?.nodes
      .map((node) => node.id)
      .filter((nodeId) => !before.has(nodeId)) ?? [];
    setSelection(replaceDiagramSelection(
      insertedNodeIds.map((nodeId) => ({ kind: "node" as const, levelId, nodeId })),
      levelId,
    ));
    setRevealSelectionRequest((value) => value + 1);
    return insertedNodeIds;
  }, [layout.nodes, runOperation]);

  const copySelectedModules = useCallback(async () => {
    if (!requireAppliedInspectorDraft("copying the selected modules")) return;
    const fragment = selectedFragment();
    if (!fragment) return;
    const clipboard = establishDesignClipboard(fragment);
    if (!clipboard) return;
    setCommandError(undefined);
    setCommandNotice(`Copied ${clipboard.summary}.`);
    if (!await writeDesignFragmentToSystemClipboard(clipboard.serialized)) {
      setCommandNotice(`Copied ${clipboard.summary} inside this workspace. System clipboard access is unavailable.`);
    }
  }, [establishDesignClipboard, requireAppliedInspectorDraft, selectedFragment]);

  const cutSelectedModules = useCallback(() => {
    if (!requireAppliedInspectorDraft("cutting the selected modules")) return;
    if (!fragmentSelection.available) return;
    const fragment = selectedFragment();
    if (!fragment) return;
    const clipboard = establishDesignClipboard(fragment);
    if (!clipboard) return;
    const next = runOperation({
      type: "objects/delete",
      targets: fragmentSelection.items.map((item) => ({
        kind: "node" as const,
        levelId: item.levelId,
        nodeId: item.nodeId,
      })),
    });
    if (!next) return;
    setSelection({ kind: "level", levelId: fragmentSelection.levelId });
    setCommandError(undefined);
    setCommandNotice(`Cut ${clipboard.summary}.`);
    void writeDesignFragmentToSystemClipboard(clipboard.serialized).then((written) => {
      if (!written) {
        setCommandNotice(`Cut ${clipboard.summary} inside this workspace. System clipboard access is unavailable.`);
      }
    });
  }, [establishDesignClipboard, fragmentSelection, requireAppliedInspectorDraft, runOperation, selectedFragment]);

  const pasteDesignFragment = useCallback(async () => {
    if (!requireAppliedInspectorDraft("pasting modules")) return;
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const targetLevel = levelForSelection(currentDocument, selectionRef.current);
    let fragment = designClipboard;
    if (!fragment) {
      try {
        if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
        fragment = parseDesignFragment(await navigator.clipboard.readText());
        setDesignClipboard(fragment);
      } catch (error) {
        setCommandNotice(undefined);
        const clipboardUnavailable = error instanceof Error && (
          error.message === "Clipboard API unavailable" || error.name === "NotAllowedError"
        );
        setCommandError(errorMessage(clipboardUnavailable
          ? new Error("Copy one or more modules in this Studio first, or allow system clipboard access.")
          : error));
        return;
      }
    }
    const insertionIndex = pasteInsertionIndex.current + 1;
    const insertedNodeIds = insertFragment(fragment, targetLevel.id, insertionIndex);
    if (!insertedNodeIds) return;
    pasteInsertionIndex.current = insertionIndex;
    setCommandNotice(`Pasted ${insertedNodeIds.length} ${insertedNodeIds.length === 1 ? "module" : "modules"} into ${targetLevel.title}.`);
  }, [designClipboard, insertFragment, requireAppliedInspectorDraft]);

  const duplicateSelectedModules = useCallback(() => {
    if (!requireAppliedInspectorDraft("duplicating the selected modules")) return;
    const fragment = selectedFragment();
    if (!fragment || !fragmentSelection.available) return;
    const insertedNodeIds = insertFragment(fragment, fragmentSelection.levelId, 1);
    if (!insertedNodeIds) return;
    setCommandNotice(`Duplicated ${insertedNodeIds.length} ${insertedNodeIds.length === 1 ? "module" : "modules"}.`);
  }, [fragmentSelection, insertFragment, requireAppliedInspectorDraft, selectedFragment]);

  const cloneDraggedModules = useCallback((moves: readonly NodeMove[]): boolean => {
    if (!requireAppliedInspectorDraft("cloning the dragged modules")) return false;
    const currentDocument = documentRef.current;
    if (!currentDocument || moves.length === 0) return false;
    try {
      const levelIds = new Set(moves.map((move) => move.levelId));
      if (levelIds.size !== 1) throw new Error("Dragged modules must belong to one design level to clone them.");
      const levelId = moves[0].levelId;
      const sourcePositions = new Map<string, { x: number; y: number }>();
      const deltas = moves.map((move) => {
        const source = layout.nodes.find((node) =>
          node.data.levelId === move.levelId && node.data.block.id === move.nodeId);
        if (!source) throw new Error(`Module ${move.nodeId} has no visible source geometry to clone.`);
        sourcePositions.set(move.nodeId, source.data.designPosition);
        return {
          x: move.position.x - source.data.designPosition.x,
          y: move.position.y - source.data.designPosition.y,
        };
      });
      const offset = { x: Math.round(deltas[0].x), y: Math.round(deltas[0].y) };
      if (deltas.some((delta) => Math.abs(delta.x - offset.x) > 0.5 || Math.abs(delta.y - offset.y) > 0.5)) {
        throw new Error("Dragged modules must share one clone translation.");
      }
      const fragment = createDesignFragment(
        currentDocument,
        levelId,
        moves.map((move) => move.nodeId),
        sourcePositions,
      );
      const insertedNodeIds = insertFragment(fragment, levelId, 1, offset);
      if (!insertedNodeIds) return false;
      setCommandError(undefined);
      setCommandNotice(`Cloned ${insertedNodeIds.length} ${insertedNodeIds.length === 1 ? "module" : "modules"} at the dragged position.`);
      return true;
    } catch (error) {
      setCommandNotice(undefined);
      setCommandError(errorMessage(error));
      return false;
    }
  }, [insertFragment, layout.nodes, requireAppliedInspectorDraft]);

  const resizeNode = useCallback((
    levelId: string,
    nodeId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => {
    if (!requireAppliedInspectorDraft("resizing a module")) return false;
    return Boolean(runOperation({ type: "node/resize", levelId, nodeId, position, size }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const resizeNodes = useCallback((resizes: readonly NodeResize[]) => {
    if (!requireAppliedInspectorDraft("resizing the selected modules")) return false;
    return Boolean(runOperation({ type: "nodes/resize", resizes }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const createConnection = useCallback((connection: {
    levelId: string;
    source: { nodeId: string; portId: string; label: string };
    target: { nodeId: string; portId: string; label: string };
  }) => {
    const currentDocument = documentRef.current;
    if (!currentDocument || !requireAppliedInspectorDraft("creating an interface")) return false;
    const level = currentDocument.levels.find((candidate) => candidate.id === connection.levelId);
    if (!level) return false;
    const connectionBase = suggestId(`${connection.source.nodeId}-to-${connection.target.nodeId}`, "connection");
    const interfaceBase = suggestId(`${connection.source.nodeId}.${connection.source.portId}-to-${connection.target.nodeId}.${connection.target.portId}`, "interface");
    setPendingConnection({
      ...connection,
      defaultConnectionId: uniqueId(connectionBase, level.connections.map((candidate) => candidate.id)),
      defaultInterfaceId: uniqueId(interfaceBase, Object.keys(currentDocument.interfaceDefinitions)),
    });
    setCommandError(undefined);
    return true;
  }, [requireAppliedInspectorDraft]);

  const routeConnection = useCallback((levelId: string, connectionId: string, routing: ConnectionRouting | undefined): boolean => {
    if (!requireAppliedInspectorDraft("adjusting interface routing")) return false;
    return Boolean(runOperation({ type: "connection/route", levelId, connectionId, routing }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const applyConnectionReconnect = useCallback((
    levelId: string,
    connectionId: string,
    source: { nodeId: string; portId: string },
    target: { nodeId: string; portId: string },
  ): "changed" | "unchanged" | "rejected" => {
    if (!requireAppliedInspectorDraft("reconnecting an interface")) return "rejected";
    const currentConnection = documentRef.current?.levels
      .find((level) => level.id === levelId)?.connections
      .find((connection) => connection.id === connectionId);
    if (currentConnection && connectionEndpointsEqual(currentConnection, source, target)) return "unchanged";
    return runOperation({
      type: "connection/reconnect",
      levelId,
      connectionId,
      source,
      target,
    }) ? "changed" : "rejected";
  }, [requireAppliedInspectorDraft, runOperation]);

  const selectDirectInterfaces = useCallback((direction: DirectConnectionDirection = "both") => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const expansion = directInterfaceSelectionExpansion(currentDocument, selectionRef.current, direction);
    if (!expansion.available || !requestSelection(expansion.selection)) return;
    const directionLabel = direction === "both" ? "direct" : direction;
    setCommandError(undefined);
    setCommandNotice(
      `Added ${expansion.addedInterfaceCount} ${directionLabel} ${expansion.addedInterfaceCount === 1 ? "interface" : "interfaces"} ` +
      `for ${expansion.selectedNodeCount} selected ${expansion.selectedNodeCount === 1 ? "module" : "modules"}.`,
    );
  }, [requestSelection]);

  const selectDirectNeighborhood = useCallback((direction: DirectConnectionDirection = "both") => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const expansion = directNeighborhoodSelectionExpansion(currentDocument, selectionRef.current, direction);
    if (!expansion.available || !requestSelection(expansion.selection)) return;
    const directionLabel = direction === "both" ? "direct" : direction;
    setCommandError(undefined);
    setCommandNotice(
      `Added ${expansion.addedNodeCount} neighboring ${expansion.addedNodeCount === 1 ? "module" : "modules"} ` +
      `and ${expansion.addedInterfaceCount} ${directionLabel} ${expansion.addedInterfaceCount === 1 ? "interface" : "interfaces"} ` +
      `for ${expansion.selectedNodeCount} selected ${expansion.selectedNodeCount === 1 ? "module" : "modules"}.`,
    );
  }, [requestSelection]);

  const canDelete = selection.kind === "node" || selection.kind === "port" ||
    selection.kind === "connection" || selection.kind === "multiple";
  const deleteUnavailableReason = "Select a module, port, or interface first.";
  const directInterfaceUnavailableReason = directSelectionUnavailableReason(
    Boolean(document), directInterfaceExpansion?.available ? undefined : directInterfaceExpansion?.reason,
    "both",
  );
  const incomingInterfaceUnavailableReason = directSelectionUnavailableReason(
    Boolean(document), incomingInterfaceExpansion?.available ? undefined : incomingInterfaceExpansion?.reason,
    "incoming",
  );
  const outgoingInterfaceUnavailableReason = directSelectionUnavailableReason(
    Boolean(document), outgoingInterfaceExpansion?.available ? undefined : outgoingInterfaceExpansion?.reason,
    "outgoing",
  );
  const directNeighborhoodUnavailableReason = directSelectionUnavailableReason(
    Boolean(document), directNeighborhoodExpansion?.available ? undefined : directNeighborhoodExpansion?.reason,
    "both",
  );
  const incomingNeighborhoodUnavailableReason = directSelectionUnavailableReason(
    Boolean(document), incomingNeighborhoodExpansion?.available ? undefined : incomingNeighborhoodExpansion?.reason,
    "incoming",
  );
  const outgoingNeighborhoodUnavailableReason = directSelectionUnavailableReason(
    Boolean(document), outgoingNeighborhoodExpansion?.available ? undefined : outgoingNeighborhoodExpansion?.reason,
    "outgoing",
  );
  const canAddChildDesign = Boolean(selectedNode && !selectedNode.node.hierarchy);
  const canEnterHierarchy = Boolean(
    selectedChildLevelId && document?.levels.some((level) => level.id === selectedChildLevelId),
  );
  const canExitHierarchy = Boolean(parentViewSelection);
  const canHomeHierarchy = Boolean(
    document && effectiveViewRootLevelId && effectiveViewRootLevelId !== document.entryLevelId,
  );
  const canAddConnection = Boolean(activeLevel && firstConnectablePair(activeLevel));
  const canAlignSelection = arrangementSelection.available && !inspectorDraftDirty;
  const alignUnavailableReason = arrangementSelection.available
    ? "Apply or discard the current Inspector changes before arranging modules."
    : arrangementSelection.reason;
  const canDistributeSelection = canAlignSelection && arrangementSelection.items.length >= 3;
  const distributeUnavailableReason = arrangementSelection.available && arrangementSelection.items.length < 3
    ? "Select at least three modules to distribute."
    : alignUnavailableReason;
  const editorDialogOpen = Boolean(
    loadDialogOpen ||
    newDialogOpen ||
    saveAsDialogOpen ||
    addBlockLevelId ||
    addPortTarget ||
    connectionEndpointRequest ||
    childDesignTarget ||
    pendingConnection
  );
  const selectedConnectionHasAlternative = Boolean(
    selectedConnection && hasAlternativeConnectionEndpoints(
      selectedConnection.level,
      selectedConnection.connection,
    )
  );
  const reconnectUnavailableReason = editorDialogOpen
    ? "Close the current dialog first."
    : inspectorDraftDirty
      ? "Apply or discard the current Inspector changes first."
      : !selectedConnection
        ? "Select one interface first."
        : "Add another compatible output or input port to this level first.";
  const canReconnectConnection = selectedConnectionHasAlternative && !editorDialogOpen && !inspectorDraftDirty;
  const fragmentCommandBlockReason = editorDialogOpen
    ? "Close the current dialog first."
    : inspectorDraftDirty
      ? "Apply or discard the current Inspector changes first."
      : undefined;
  const canCopySelection = fragmentSelection.available && !fragmentCommandBlockReason;
  const copyUnavailableReason = fragmentCommandBlockReason ?? (
    fragmentSelection.available ? "Select one or more modules first." : fragmentSelection.reason
  );
  const canPaste = Boolean(document) && !layoutBusy && !fragmentCommandBlockReason;
  const pasteUnavailableReason = fragmentCommandBlockReason ?? (
    layoutBusy ? "Wait for the diagram layout to finish." : "Open or create a design first."
  );
  const commands = useMemo<StudioCommands>(() => ({
    newDesign: {
      id: "newDesign", label: "New Design...", toolbarTitle: "新建设计", icon: FilePlus2, enabled: true,
      execute: () => {
        if (!mayDiscardChanges()) return;
        setCommandError(undefined);
        setNewDialogOpen(true);
      },
    },
    openDesign: {
      id: "openDesign", label: "Open Design...", toolbarTitle: "打开设计", icon: FolderOpen, enabled: true,
      execute: () => {
        if (desktopBridge) void openDesktopDesign();
        else setLoadDialogOpen(true);
      },
    },
    save: {
      id: "save", label: "Save", toolbarTitle: "保存设计", shortcut: "Ctrl/⌘ S", icon: Save,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: saveCurrent,
    },
    saveAs: {
      id: "saveAs", label: "Save As...", shortcut: "Ctrl/⌘ ⇧ S", icon: Save,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: openSaveAs,
    },
    exportJson: {
      id: "exportJson", label: "Export JSON", icon: Download,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: exportCurrent,
    },
    undo: {
      id: "undo", label: "Undo", toolbarTitle: "撤销", shortcut: "Ctrl/⌘ Z", icon: Undo2,
      ...commandAvailability(editor.canUndo, "No design changes to undo."), execute: undoDesign,
    },
    redo: {
      id: "redo", label: "Redo", toolbarTitle: "重做", shortcut: "Ctrl/⌘ ⇧ Z", icon: Redo2,
      ...commandAvailability(editor.canRedo, "No design changes to redo."), execute: redoDesign,
    },
    selectAll: {
      id: "selectAll", label: "Select All in Level", shortcut: "Ctrl/⌘ A", icon: MousePointer2,
      ...commandAvailability(
        Boolean(activeLevel && activeLevelDiagramItemCount > 0),
        "The current design level has no modules or interfaces to select.",
      ),
      execute: () => {
        if (!activeLevel) return;
        const next = selectAllInLevel(activeLevel);
        if (!requestSelection(next)) return;
        setCommandError(undefined);
        setCommandNotice(
          `Selected ${activeLevelDiagramItemCount} diagram ${activeLevelDiagramItemCount === 1 ? "object" : "objects"} in ${activeLevel.title}.`,
        );
      },
    },
    selectModulesInLevel: {
      id: "selectModulesInLevel", label: "Select Modules in Level", icon: Box,
      ...commandAvailability(
        Boolean(activeLevel && activeLevel.nodes.length > 0),
        "The current design level has no modules to select.",
      ),
      execute: () => {
        if (!activeLevel) return;
        const next = selectDiagramKindInLevel(activeLevel, "node");
        if (!requestSelection(next)) return;
        setCommandError(undefined);
        setCommandNotice(
          `Selected ${activeLevel.nodes.length} ${activeLevel.nodes.length === 1 ? "module" : "modules"} in ${activeLevel.title}.`,
        );
      },
    },
    selectInterfacesInLevel: {
      id: "selectInterfacesInLevel", label: "Select Interfaces in Level", icon: Cable,
      ...commandAvailability(
        Boolean(activeLevel && activeLevel.connections.length > 0),
        "The current design level has no interfaces to select.",
      ),
      execute: () => {
        if (!activeLevel) return;
        const next = selectDiagramKindInLevel(activeLevel, "connection");
        if (!requestSelection(next)) return;
        setCommandError(undefined);
        setCommandNotice(
          `Selected ${activeLevel.connections.length} ${activeLevel.connections.length === 1 ? "interface" : "interfaces"} in ${activeLevel.title}.`,
        );
      },
    },
    selectDirectInterfaces: {
      id: "selectDirectInterfaces", label: "Select Direct Interfaces", icon: Cable,
      ...commandAvailability(
        Boolean(directInterfaceExpansion?.available),
        directInterfaceUnavailableReason,
      ),
      execute: selectDirectInterfaces,
    },
    selectIncomingInterfaces: {
      id: "selectIncomingInterfaces", label: "Select Incoming Interfaces", icon: Cable,
      ...commandAvailability(
        Boolean(incomingInterfaceExpansion?.available),
        incomingInterfaceUnavailableReason,
      ),
      execute: () => selectDirectInterfaces("incoming"),
    },
    selectOutgoingInterfaces: {
      id: "selectOutgoingInterfaces", label: "Select Outgoing Interfaces", icon: Cable,
      ...commandAvailability(
        Boolean(outgoingInterfaceExpansion?.available),
        outgoingInterfaceUnavailableReason,
      ),
      execute: () => selectDirectInterfaces("outgoing"),
    },
    selectDirectNeighborhood: {
      id: "selectDirectNeighborhood", label: "Select Direct Neighborhood", icon: Share2,
      ...commandAvailability(
        Boolean(directNeighborhoodExpansion?.available),
        directNeighborhoodUnavailableReason,
      ),
      execute: selectDirectNeighborhood,
    },
    selectIncomingNeighborhood: {
      id: "selectIncomingNeighborhood", label: "Select Incoming Neighborhood", icon: Share2,
      ...commandAvailability(
        Boolean(incomingNeighborhoodExpansion?.available),
        incomingNeighborhoodUnavailableReason,
      ),
      execute: () => selectDirectNeighborhood("incoming"),
    },
    selectOutgoingNeighborhood: {
      id: "selectOutgoingNeighborhood", label: "Select Outgoing Neighborhood", icon: Share2,
      ...commandAvailability(
        Boolean(outgoingNeighborhoodExpansion?.available),
        outgoingNeighborhoodUnavailableReason,
      ),
      execute: () => selectDirectNeighborhood("outgoing"),
    },
    clearSelection: {
      id: "clearSelection", label: "Clear Selection", shortcut: "Ctrl/⌘ ⇧ A", icon: CircleOff,
      ...commandAvailability(selectedDiagramItemCount > 0, "No diagram objects are selected."),
      execute: () => {
        if (!activeLevel || !requestSelection({ kind: "level", levelId: activeLevel.id })) return;
        setCommandError(undefined);
        setCommandNotice("Selection cleared.");
      },
    },
    copySelection: {
      id: "copySelection", label: "Copy", shortcut: "Ctrl/⌘ C", icon: Copy,
      ...commandAvailability(canCopySelection, copyUnavailableReason),
      execute: () => { void copySelectedModules(); },
    },
    cutSelection: {
      id: "cutSelection", label: "Cut", shortcut: "Ctrl/⌘ X", icon: Scissors,
      ...commandAvailability(canCopySelection, copyUnavailableReason),
      execute: cutSelectedModules,
    },
    paste: {
      id: "paste", label: "Paste", shortcut: "Ctrl/⌘ V", icon: ClipboardPaste,
      ...commandAvailability(canPaste, pasteUnavailableReason),
      execute: () => { void pasteDesignFragment(); },
    },
    duplicateSelection: {
      id: "duplicateSelection", label: "Duplicate", shortcut: "Ctrl/⌘ D", icon: CopyPlus,
      ...commandAvailability(canCopySelection, copyUnavailableReason),
      execute: duplicateSelectedModules,
    },
    deleteSelection: {
      id: "deleteSelection", label: "Delete Selection", toolbarTitle: "删除所选内容", shortcut: "Del", icon: Trash2,
      ...commandAvailability(canDelete, deleteUnavailableReason), execute: deleteSelection,
    },
    alignSelectionLeft: {
      id: "alignSelectionLeft", label: "Align Left", icon: AlignStartVertical,
      ...commandAvailability(canAlignSelection, alignUnavailableReason),
      execute: () => { arrangeModules({ kind: "align", alignment: "left" }); },
    },
    alignSelectionCenter: {
      id: "alignSelectionCenter", label: "Align Center", icon: AlignCenterVertical,
      ...commandAvailability(canAlignSelection, alignUnavailableReason),
      execute: () => { arrangeModules({ kind: "align", alignment: "center" }); },
    },
    alignSelectionRight: {
      id: "alignSelectionRight", label: "Align Right", icon: AlignEndVertical,
      ...commandAvailability(canAlignSelection, alignUnavailableReason),
      execute: () => { arrangeModules({ kind: "align", alignment: "right" }); },
    },
    alignSelectionTop: {
      id: "alignSelectionTop", label: "Align Top", icon: AlignStartHorizontal,
      ...commandAvailability(canAlignSelection, alignUnavailableReason),
      execute: () => { arrangeModules({ kind: "align", alignment: "top" }); },
    },
    alignSelectionMiddle: {
      id: "alignSelectionMiddle", label: "Align Middle", icon: AlignCenterHorizontal,
      ...commandAvailability(canAlignSelection, alignUnavailableReason),
      execute: () => { arrangeModules({ kind: "align", alignment: "middle" }); },
    },
    alignSelectionBottom: {
      id: "alignSelectionBottom", label: "Align Bottom", icon: AlignEndHorizontal,
      ...commandAvailability(canAlignSelection, alignUnavailableReason),
      execute: () => { arrangeModules({ kind: "align", alignment: "bottom" }); },
    },
    distributeSelectionHorizontally: {
      id: "distributeSelectionHorizontally", label: "Distribute Horizontally", icon: AlignHorizontalDistributeCenter,
      ...commandAvailability(canDistributeSelection, distributeUnavailableReason),
      execute: () => { arrangeModules({ kind: "distribute", direction: "horizontal" }); },
    },
    distributeSelectionVertically: {
      id: "distributeSelectionVertically", label: "Distribute Vertically", icon: AlignVerticalDistributeCenter,
      ...commandAvailability(canDistributeSelection, distributeUnavailableReason),
      execute: () => { arrangeModules({ kind: "distribute", direction: "vertical" }); },
    },
    addBlock: {
      id: "addBlock", label: "Add Module...", toolbarTitle: "添加模块", icon: Box,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: openAddBlock,
    },
    addPort: {
      id: "addPort", label: "Add Port...", toolbarTitle: "添加端口", icon: Cable,
      ...commandAvailability(Boolean(selectedNode), "Select a module first."), execute: openAddPort,
    },
    addConnection: {
      id: "addConnection", label: "Add Interface...", toolbarTitle: "添加接口", icon: Share2,
      ...commandAvailability(canAddConnection, "Add compatible output/input ports to this level first."), execute: openAddConnection,
    },
    reconnectConnection: {
      id: "reconnectConnection", label: "Reconnect Interface...", icon: Cable,
      ...commandAvailability(canReconnectConnection, reconnectUnavailableReason),
      execute: openReconnectConnection,
    },
    addChildDesign: {
      id: "addChildDesign", label: "Create Child Design...", toolbarTitle: "创建子设计", icon: GitBranchPlus,
      ...commandAvailability(
        canAddChildDesign,
        selectedNode?.node.hierarchy
          ? "Use this module's hierarchy control to open its child design."
          : "Select a module first.",
      ),
      execute: openAddChildDesign,
    },
    regenerateLayout: {
      id: "regenerateLayout", label: "Regenerate Layout", toolbarTitle: "重新生成布局", icon: LayoutDashboard,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: () => {
        fitAfterLayout.current = true;
        setLayoutBusy(true);
        setPlacementMode("automatic");
        setLayoutRevision((value) => value + 1);
      },
    },
    optimizeRouting: {
      id: "optimizeRouting", label: "Optimize Routing", toolbarTitle: "仅优化布线", icon: Route,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: () => setRouteRevision((value) => value + 1),
    },
    validateDesign: {
      id: "validateDesign", label: "Validate Design", toolbarTitle: "验证设计", icon: ShieldCheck,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: validateDesign,
    },
    enterHierarchy: {
      id: "enterHierarchy", label: "Enter Module", shortcut: "Ctrl/⌘ ⇧ End", icon: GitBranchPlus,
      ...commandAvailability(canEnterHierarchy, "Select a module with a child design first."),
      execute: enterHierarchy,
    },
    exitHierarchy: {
      id: "exitHierarchy", label: "Exit Module", shortcut: "Ctrl/⌘ ⇧ Home", icon: RotateCcw,
      ...commandAvailability(canExitHierarchy, "The current view is already at the entry level."),
      execute: exitHierarchy,
    },
    homeHierarchy: {
      id: "homeHierarchy", label: "Architecture Home", shortcut: "⇧ Home", icon: CircuitBoard,
      ...commandAvailability(canHomeHierarchy, "The current view is already at the entry level."),
      execute: homeHierarchy,
    },
    fitSelection: {
      id: "fitSelection", label: "Fit Selection", shortcut: "Ctrl/⌘ ⇧ H", icon: ScanSearch,
      ...commandAvailability(selectedDiagramItemCount > 0, "Select a module or interface first."),
      execute: () => {
        setFitSelectionRequest((value) => value + 1);
        setCommandError(undefined);
        setCommandNotice(
          `Fitting ${selectedDiagramItemCount} selected diagram ${selectedDiagramItemCount === 1 ? "object" : "objects"}.`,
        );
      },
    },
    fitDesign: {
      id: "fitDesign", label: "Fit Design", toolbarTitle: "适应窗口", icon: Scan,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: () => setFitRequest((value) => value + 1),
    },
    zoomIn: {
      id: "zoomIn", label: "Zoom In", shortcut: "Ctrl/⌘ +", icon: ZoomIn,
      ...commandAvailability(Boolean(document), "Open or create a design first."),
      execute: () => requestViewportAction("zoom-in"),
    },
    zoomOut: {
      id: "zoomOut", label: "Zoom Out", shortcut: "Ctrl/⌘ −", icon: ZoomOut,
      ...commandAvailability(Boolean(document), "Open or create a design first."),
      execute: () => requestViewportAction("zoom-out"),
    },
    actualSize: {
      id: "actualSize", label: "Actual Size (100%)", icon: Focus,
      ...commandAvailability(Boolean(document), "Open or create a design first."),
      execute: () => requestViewportAction("actual-size"),
    },
    openCommandPalette: {
      id: "openCommandPalette", label: "Command Palette...", shortcut: "Ctrl/⌘ K", showInPalette: false, icon: Search,
      ...commandAvailability(!editorDialogOpen, "Close the current dialog first."), execute: () => setCommandPaletteOpen(true),
    },
    toggleSources: {
      id: "toggleSources", label: "Toggle Sources", toolbarTitle: "Sources", icon: PanelLeft,
      enabled: true, execute: () => toggleDock("left"),
    },
    toggleProperties: {
      id: "toggleProperties", label: "Toggle Properties", toolbarTitle: "Properties", icon: PanelRight,
      enabled: true, execute: () => toggleDock("right"),
    },
    toggleMessages: {
      id: "toggleMessages", label: "Toggle Messages", toolbarTitle: "Messages", icon: PanelBottom,
      enabled: true, execute: () => toggleDock("bottom"),
    },
    maximizeDiagram: {
      id: "maximizeDiagram", label: diagramMaximized ? "Restore Diagram" : "Maximize Diagram", toolbarTitle: "最大化或还原画布",
      icon: diagramMaximized ? Minimize2 : Maximize2, enabled: true, execute: maximizeDiagram,
    },
    resetWorkspace: {
      id: "resetWorkspace", label: "Reset Workspace", icon: RotateCcw, enabled: true,
      execute: () => {
        if (requireAppliedInspectorDraft("resetting the workspace")) setWorkspaceResetRequest((value) => value + 1);
      },
    },
  }), [
    alignUnavailableReason,
    activeLevel,
    activeLevelDiagramItemCount,
    arrangeModules,
    canAddChildDesign,
    canAddConnection,
    canAlignSelection,
    canCopySelection,
    canDelete,
    canDistributeSelection,
    canEnterHierarchy,
    canExitHierarchy,
    canHomeHierarchy,
    canPaste,
    canReconnectConnection,
    copySelectedModules,
    cutSelectedModules,
    copyUnavailableReason,
    deleteUnavailableReason,
    deleteSelection,
    diagramMaximized,
    directInterfaceExpansion,
    directInterfaceUnavailableReason,
    directNeighborhoodExpansion,
    directNeighborhoodUnavailableReason,
    desktopBridge,
    incomingInterfaceExpansion,
    incomingInterfaceUnavailableReason,
    incomingNeighborhoodExpansion,
    incomingNeighborhoodUnavailableReason,
    document,
    distributeUnavailableReason,
    duplicateSelectedModules,
    editor.canRedo,
    editor.canUndo,
    editorDialogOpen,
    enterHierarchy,
    exportCurrent,
    exitHierarchy,
    homeHierarchy,
    maximizeDiagram,
    mayDiscardChanges,
    openAddBlock,
    openAddChildDesign,
    openAddConnection,
    openAddPort,
    openReconnectConnection,
    openDesktopDesign,
    openSaveAs,
    outgoingInterfaceExpansion,
    outgoingInterfaceUnavailableReason,
    outgoingNeighborhoodExpansion,
    outgoingNeighborhoodUnavailableReason,
    pasteDesignFragment,
    pasteUnavailableReason,
    redoDesign,
    reconnectUnavailableReason,
    requestViewportAction,
    requestSelection,
    requireAppliedInspectorDraft,
    saveCurrent,
    selectDirectInterfaces,
    selectDirectNeighborhood,
    selectedNode,
    selectedDiagramItemCount,
    toggleDock,
    undoDesign,
    validateDesign,
  ]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLocaleLowerCase();
      if (modifier && key === "s") {
        event.preventDefault();
        const command = event.shiftKey ? commands.saveAs : commands.save;
        if (command.enabled) command.execute();
        return;
      }
      if (modifier && key === "k") {
        if (commands.openCommandPalette.enabled) {
          event.preventDefault();
          commands.openCommandPalette.execute();
        }
        return;
      }
      if (modifier && (key === "+" || key === "=")) {
        if (commands.zoomIn.enabled) {
          event.preventDefault();
          commands.zoomIn.execute();
        }
        return;
      }
      if (modifier && key === "-") {
        if (commands.zoomOut.enabled) {
          event.preventDefault();
          commands.zoomOut.execute();
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      const editingText = target?.matches("input, textarea, select, [contenteditable='true']");
      if (editingText) return;
      if (modifier && event.shiftKey && event.key === "End") {
        if (commands.enterHierarchy.enabled) {
          event.preventDefault();
          commands.enterHierarchy.execute();
        }
      } else if (modifier && event.shiftKey && event.key === "Home") {
        if (commands.exitHierarchy.enabled) {
          event.preventDefault();
          commands.exitHierarchy.execute();
        }
      } else if (!modifier && event.shiftKey && event.key === "Home") {
        if (commands.homeHierarchy.enabled) {
          event.preventDefault();
          commands.homeHierarchy.execute();
        }
      } else if (
        event.key === "Escape" &&
        commands.exitHierarchy.enabled &&
        selectionRef.current.kind === "level" &&
        selectionRef.current.levelId === viewRootLevelIdRef.current &&
        target?.closest(".bd-react-flow")
      ) {
        event.preventDefault();
        commands.exitHierarchy.execute();
      } else if (modifier && !event.shiftKey && key === "a") {
        if (commands.selectAll.enabled) {
          event.preventDefault();
          commands.selectAll.execute();
        }
      } else if (modifier && event.shiftKey && key === "a") {
        if (commands.clearSelection.enabled) {
          event.preventDefault();
          commands.clearSelection.execute();
        }
      } else if (modifier && event.shiftKey && key === "h") {
        if (commands.fitSelection.enabled) {
          event.preventDefault();
          commands.fitSelection.execute();
        }
      } else if (modifier && !event.shiftKey && key === "c") {
        if (commands.copySelection.enabled) {
          event.preventDefault();
          commands.copySelection.execute();
        }
      } else if (modifier && !event.shiftKey && key === "x") {
        if (commands.cutSelection.enabled) {
          event.preventDefault();
          commands.cutSelection.execute();
        }
      } else if (modifier && !event.shiftKey && key === "v") {
        if (commands.paste.enabled) {
          event.preventDefault();
          commands.paste.execute();
        }
      } else if (modifier && !event.shiftKey && key === "d") {
        if (commands.duplicateSelection.enabled) {
          event.preventDefault();
          commands.duplicateSelection.execute();
        }
      } else if (modifier && key === "z") {
        event.preventDefault();
        const command = event.shiftKey ? commands.redo : commands.undo;
        if (command.enabled) command.execute();
      } else if (modifier && key === "y") {
        event.preventDefault();
        if (commands.redo.enabled) commands.redo.execute();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (commands.deleteSelection.enabled) commands.deleteSelection.execute();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [commands]);

  if (!document) {
    return (
      <main className="bd-boot-screen">
        <CircuitBoard size={34} aria-hidden="true" />
        <h1>Architecture Block Studio</h1>
        <p>{busy ? "Loading design document..." : "The design could not be loaded."}</p>
        {loadError && <pre>{loadError}</pre>}
        {!busy && <div className="bd-boot-actions">
          <button type="button" className="bd-command-button" onClick={() => setNewDialogOpen(true)}><FilePlus2 size={15} /> New design</button>
          <button type="button" className="bd-command-button" onClick={() => {
            if (desktopBridge) void openDesktopDesign();
            else setLoadDialogOpen(true);
          }}><FolderOpen size={15} /> Open another design</button>
        </div>}
        <LoadDesignDialog open={loadDialogOpen} busy={busy} error={loadError} onClose={() => { setLoadDialogOpen(false); setLoadError(undefined); }} onLoadFile={(file) => void openFile(file)} onLoadUrl={(url) => void openUrl(url)} />
        <NewDesignDialog open={newDialogOpen} error={commandError} idFromTitle={(title) => suggestId(title, "design")} onClose={() => { setNewDialogOpen(false); setCommandError(undefined); }} onCreate={async ({ id, title }) => {
          try {
            await desktopBridge?.clearFileBinding();
            installDocument(createBlankDesign(id, title), "New unsaved design", false);
            setNewDialogOpen(false);
          } catch (error) { setCommandError(errorMessage(error)); }
        }} />
      </main>
    );
  }

  const addBlockLevel = addBlockLevelId ? document.levels.find((level) => level.id === addBlockLevelId) : undefined;
  const addPortNode = addPortTarget
    ? document.levels.find((level) => level.id === addPortTarget.levelId)?.nodes.find((node) => node.id === addPortTarget.nodeId)
    : undefined;
  const childDesignNode = childDesignTarget
    ? document.levels.find((level) => level.id === childDesignTarget.levelId)?.nodes.find((node) => node.id === childDesignTarget.nodeId)
    : undefined;
  const connectionEndpointLevel = connectionEndpointRequest
    ? document.levels.find((level) => level.id === connectionEndpointRequest.levelId)
    : undefined;
  const connectionEndpointConnection = connectionEndpointRequest?.kind === "reconnect"
    ? connectionEndpointLevel?.connections.find(
      (connection) => connection.id === connectionEndpointRequest.connectionId,
    )
    : undefined;
  const connectionEndpointInitial = connectionEndpointLevel && connectionEndpointConnection
    ? connectionPortEndpoints(connectionEndpointLevel, connectionEndpointConnection)
    : undefined;
  const connectionEndpointMode: ConnectionEndpointDialogMode | undefined = connectionEndpointRequest?.kind === "create"
    ? { kind: "create" }
    : connectionEndpointConnection && connectionEndpointInitial
      ? {
        kind: "reconnect",
        interfaceTitle: connectionEndpointConnection.label ??
          document.interfaceDefinitions[connectionEndpointConnection.interfaceId]?.title ??
          connectionEndpointConnection.interfaceId,
        hasManualRouting: Boolean(connectionEndpointConnection.routing),
        initial: connectionEndpointInitial,
      }
      : undefined;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const visibleConnections = layout.edges.filter((edge) => !edge.data?.boundaryContinuation).length;

  const dockContent = {
    sources: <HierarchyTree
      document={document}
      expandedLevelIds={expandedLevelIds}
      viewRootLevelId={effectiveViewRootLevelId!}
      selection={selection}
      onToggleLevel={toggleHierarchy}
      onEnterLevel={(levelId) => {
        const level = document.levels.find((candidate) => candidate.id === levelId);
        navigateViewRoot(
          levelId,
          { kind: "level", levelId },
          `Entered ${level?.title ?? levelId}. Use the breadcrumb to restore context.`,
        );
      }}
      onRevealLevel={revealLevel}
      onSelect={requestSelectionFromNavigator}
    />,
    diagram: (
      <section className="bd-canvas-pane">
        <ReactFlowProvider>
          <BlockDesignCanvas
            document={document}
            viewRootLevelId={effectiveViewRootLevelId!}
            layout={layout}
            selection={selection}
            fitRequest={fitRequest}
            fitSelectionRequest={fitSelectionRequest}
            viewportActionRequest={viewportActionRequest}
            revealSelectionRequest={revealSelectionRequest}
            routeRevision={routeRevision}
            onSelect={requestSelection}
            onOpenContextMenu={openCanvasContextMenu}
            onDismissContextMenu={dismissCanvasContextMenu}
            onToggleHierarchy={toggleHierarchy}
            onRenameNode={renameNode}
            onAddModule={openAddBlock}
            onMoveNodes={moveNodes}
            onCloneNodes={cloneDraggedModules}
            onResizeNode={resizeNode}
            onResizeNodes={resizeNodes}
            onCreateConnection={createConnection}
            onRouteConnection={routeConnection}
            onReconnectConnection={applyConnectionReconnect}
          />
        </ReactFlowProvider>
        {(layoutBusy || busy) && <div className="bd-canvas-busy" role="status">Updating diagram...</div>}
      </section>
    ),
    properties: <Inspector
      document={document}
      selection={selection}
      reconnectCommand={commands.reconnectConnection}
      reconnectFocusRequest={inspectorReconnectFocusRequest}
      onOperation={runOperation}
      onDelete={deleteSelection}
      onDraftChange={setInspectorDraftDirty}
      onSelect={requestSelectionFromNavigator}
    />,
    messages: <MessagesPanel issues={issues} focusRequest={messageFocusRequest} onSelect={selectIssue} />,
  };

  return (
    <main className="bd-studio" onDragEnter={(event) => {
      if (event.dataTransfer.types.includes("Files")) setDragActive(true);
    }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => {
      if (event.currentTarget === event.target) setDragActive(false);
    }} onDrop={(event) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files[0];
      if (file) void openFile(file);
    }}>
      <header className="bd-app-header">
        <div className="bd-brand"><span className="bd-brand-mark"><CircuitBoard size={16} /></span><strong>Architecture Block Studio</strong></div>
        <div className="bd-document-title"><span>{document.title}{editor.dirty || inspectorDraftDirty ? " *" : ""}</span><small>{sourceLabel}{inspectorDraftDirty ? " · Unapplied Inspector changes" : editor.dirty ? " · Unsaved" : ""}</small></div>
        <div className={`bd-validation-summary${errorCount > 0 ? " has-errors" : " is-clean"}`}>
          {errorCount === 0 ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
          <span>{errorCount} errors</span><span>{warningCount} warnings</span>
        </div>
      </header>

      <MenuBar sourceRef={document.sourceRef} commands={commands} />

      <StudioToolbar
        commands={commands}
        viewRootPath={viewRootPath}
        onNavigateViewRoot={(levelId) => {
          const level = document.levels.find((candidate) => candidate.id === levelId);
          navigateViewRoot(
            levelId,
            { kind: "level", levelId },
            `Viewing ${level?.title ?? levelId}.`,
          );
        }}
        expandedCount={expandedLevelIds.size}
      />

      <section className="bd-workspace"><DockWorkspace content={dockContent} resetRequest={workspaceResetRequest} onReady={setDockApi} /></section>
      <footer className="bd-statusbar">
        <span><Braces size={12} /> BlockDesignDocument {document.schemaVersion}</span>
        <span className={editor.dirty || inspectorDraftDirty ? "is-dirty" : ""}>{inspectorDraftDirty ? "Unapplied Inspector changes" : editor.dirty ? "Unsaved changes" : "Saved"}</span>
        <span>{layout.nodes.length} diagram blocks</span><span>{visibleConnections} diagram interfaces</span>
        <span>View root: {viewRootLevel?.title}</span>
        <span>ELK placement · obstacle-aware orthogonal routes</span>
      </footer>

      {commandError && <div className="bd-command-error" role="alert"><TriangleAlert size={15} /><span>{commandError}</span><button type="button" onClick={() => setCommandError(undefined)}>Dismiss</button></div>}
      {commandNotice && !commandError && <div className="bd-command-notice" role="status"><Info size={15} /><span>{commandNotice}</span><button type="button" onClick={() => setCommandNotice(undefined)}>Dismiss</button></div>}
      {dragActive && <div className="bd-drop-overlay"><FileJsonDrop /></div>}
      {canvasContextMenu && (
        <CanvasContextMenu
          key={canvasContextMenu.revision}
          request={canvasContextMenu}
          commands={commands}
          onClose={dismissCanvasContextMenu}
        />
      )}
      <CommandPalette open={commandPaletteOpen} commands={commands} onClose={() => setCommandPaletteOpen(false)} />
      <LoadDesignDialog open={loadDialogOpen} busy={busy} error={loadError} onClose={() => { setLoadDialogOpen(false); setLoadError(undefined); }} onLoadFile={(file) => void openFile(file)} onLoadUrl={(url) => void openUrl(url)} />
      <NewDesignDialog open={newDialogOpen} error={commandError} idFromTitle={(title) => suggestId(title, "design")} onClose={() => { setNewDialogOpen(false); setCommandError(undefined); }} onCreate={async ({ id, title }) => {
        try {
          await desktopBridge?.clearFileBinding();
          installDocument(createBlankDesign(id, title), "New unsaved design", false);
          setNewDialogOpen(false);
        } catch (error) { setCommandError(errorMessage(error)); }
      }} />
      <SaveDesignDialog open={saveAsDialogOpen} initialFileName={fileName} error={commandError} onClose={() => { setSaveAsDialogOpen(false); setCommandError(undefined); }} onSave={(requestedFileName) => {
        try {
          const savedName = downloadDesign(document, normalizeDesignFileName(requestedFileName));
          setFileName(savedName);
          setSourceLabel(savedName);
          editor.markSaved();
          setCommandError(undefined);
          setSaveAsDialogOpen(false);
        } catch (error) { setCommandError(errorMessage(error)); }
      }} />
      <AddBlockDialog
        open={Boolean(addBlockLevel)}
        levelTitle={addBlockLevel?.title ?? "design"}
        defaultId={addBlockLevel ? uniqueId("module", addBlockLevel.nodes.map((node) => node.id)) : "module"}
        idFromTitle={(title) => addBlockLevel
          ? uniqueId(suggestId(title, "module"), addBlockLevel.nodes.map((node) => node.id))
          : suggestId(title, "module")}
        error={commandError}
        onClose={() => { setAddBlockLevelId(undefined); setCommandError(undefined); }}
        onCreate={(values) => {
          if (!addBlockLevel) return;
          try {
            if (runOperation({ type: "node/add", levelId: addBlockLevel.id, node: createBlock(values) })) {
              setSelection({ kind: "node", levelId: addBlockLevel.id, nodeId: values.id });
              setAddBlockLevelId(undefined);
            }
          } catch (error) { setCommandError(errorMessage(error)); }
        }}
      />
      <AddPortDialog
        open={Boolean(addPortTarget && addPortNode)}
        blockTitle={addPortNode?.title ?? "module"}
        defaultId={addPortNode ? uniqueId("port", addPortNode.ports.map((port) => port.id)) : "port"}
        idFromLabel={(label) => addPortNode
          ? uniqueId(suggestId(label, "port"), addPortNode.ports.map((port) => port.id))
          : suggestId(label, "port")}
        error={commandError}
        onClose={() => { setAddPortTarget(undefined); setCommandError(undefined); }}
        onCreate={(values) => {
          if (!addPortTarget) return;
          try {
            if (runOperation({ type: "port/add", ...addPortTarget, port: createPort(values) })) {
              setSelection({ kind: "port", ...addPortTarget, portId: values.id });
              setAddPortTarget(undefined);
            }
          } catch (error) { setCommandError(errorMessage(error)); }
        }}
      />
      {connectionEndpointMode && (
        <SelectConnectionEndpointsDialog
          key={connectionEndpointRequest?.kind === "reconnect"
            ? `reconnect:${connectionEndpointRequest.levelId}:${connectionEndpointRequest.connectionId}`
            : `create:${connectionEndpointRequest?.levelId}`}
          level={connectionEndpointLevel}
          mode={connectionEndpointMode}
          error={commandError}
          onClose={() => { setConnectionEndpointRequest(undefined); setCommandError(undefined); }}
          onContinue={(connection) => {
            if (connectionEndpointRequest?.kind === "reconnect") {
              if (connectionEndpointMode.kind !== "reconnect") return;
              if (applyConnectionReconnect(
                connectionEndpointRequest.levelId,
                connectionEndpointRequest.connectionId,
                connection.source,
                connection.target,
              ) === "changed") {
                setConnectionEndpointRequest(undefined);
                setInspectorReconnectFocusRequest((value) => value + 1);
                setCommandNotice(`Reconnected ${connectionEndpointMode.interfaceTitle}.`);
              }
              return;
            }
            setConnectionEndpointRequest(undefined);
            createConnection(connection);
          }}
        />
      )}
      <AddChildDesignDialog
        open={Boolean(childDesignTarget && childDesignNode)}
        blockTitle={childDesignNode?.title ?? "module"}
        defaultId={childDesignNode ? uniqueId(`${childDesignNode.id}-internals`, document.levels.map((level) => level.id)) : "module-internals"}
        idFromTitle={(title) => uniqueId(
          suggestId(title, childDesignNode ? `${childDesignNode.id}-internals` : "module-internals"),
          document.levels.map((level) => level.id),
        )}
        error={commandError}
        onClose={() => { setChildDesignTarget(undefined); setCommandError(undefined); }}
        onCreate={({ id, title }) => {
          if (!childDesignTarget) return;
          try {
            const childLevel = createDesignLevel(id, title, childDesignTarget.levelId);
            if (runOperation({ type: "hierarchy/add", ...childDesignTarget, childLevel })) {
              setExpandedLevelIds((current) => new Set([...current, id]));
              setSelection({ kind: "level", levelId: id });
              setChildDesignTarget(undefined);
            }
          } catch (error) { setCommandError(errorMessage(error)); }
        }}
      />
      <CreateConnectionDialog pending={pendingConnection} error={commandError} onClose={() => { setPendingConnection(undefined); setCommandError(undefined); }} onCreate={({ connectionId, interfaceId, title, kind, owner }) => {
        if (!pendingConnection) return;
        try {
          const definition = createInterfaceDefinition({ id: interfaceId, title, kind, owner });
          if (runOperation({
            type: "connection/add",
            levelId: pendingConnection.levelId,
            connection: {
              id: connectionId,
              interfaceId,
              source: { nodeId: pendingConnection.source.nodeId, portId: pendingConnection.source.portId },
              target: { nodeId: pendingConnection.target.nodeId, portId: pendingConnection.target.portId },
            },
            definition,
          })) {
            setSelection({ kind: "connection", levelId: pendingConnection.levelId, connectionId });
            setPendingConnection(undefined);
          }
        } catch (error) { setCommandError(errorMessage(error)); }
      }} />
    </main>
  );
}

function FileJsonDrop() {
  return <div><FolderOpen size={32} /><strong>Drop BlockDesignDocument JSON</strong></div>;
}
