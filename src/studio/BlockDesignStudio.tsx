import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { DockviewApi, EdgeGroupPosition } from "dockview-react";
import {
  Box,
  Braces,
  Cable,
  CheckCircle2,
  CircuitBoard,
  Download,
  FilePlus2,
  FolderOpen,
  GitBranchPlus,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  Route,
  Save,
  Scan,
  Share2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { BlockDesignCanvas } from "../components/BlockDesignCanvas";
import { DockWorkspace } from "../components/DockWorkspace";
import {
  AddBlockDialog,
  AddChildDesignDialog,
  AddPortDialog,
  CreateConnectionDialog,
  NewDesignDialog,
  SaveDesignDialog,
  SelectConnectionEndpointsDialog,
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
  createDesignLevel,
  createInterfaceDefinition,
  createPort,
  suggestId,
  uniqueId,
  useDesignEditor,
  type DesignOperation,
} from "../editor";
import {
  loadDesignFromFile,
  loadDesignFromObject,
  loadDesignFromUrl,
  type DesignLoadError,
} from "../io/loadDesign";
import {
  downloadDesign,
  normalizeDesignFileName,
  suggestedDesignFileName,
} from "../io/saveDesign";
import {
  layoutBlockDesign,
  layoutGeometrySignature,
  layoutProjectionSignature,
  type LayoutResult,
  type PlacementMode,
} from "../layout";
import {
  firstConnectablePair,
  validateBlockDesignDocument,
  type BlockDesignDocument,
  type ConnectionRouting,
  type DesignIssue,
} from "../model";
import type { StudioCommandAvailability, StudioCommands } from "./commands";
import {
  hierarchyLevelPath,
  levelForSelection,
  nodeForSelection,
  sameSelection,
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

function fileNameFromSource(document: BlockDesignDocument, source: string): string {
  const tail = source.split(/[\\/]/).at(-1);
  return tail?.endsWith(".json") ? tail : suggestedDesignFileName(document);
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
  const editor = useDesignEditor(bootDocument);
  const [documentInstalled, setDocumentInstalled] = useState(false);
  const document = documentInstalled ? editor.document : undefined;
  const [expandedLevelIds, setExpandedLevelIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<SelectionRef>({ kind: "document" });
  const [inspectorDraftDirty, setInspectorDraftDirty] = useState(false);
  const [issues, setIssues] = useState<DesignIssue[]>([]);
  const [layout, setLayout] = useState<LayoutResult>({ nodes: [], edges: [] });
  const [placementMode, setPlacementMode] = useState<PlacementMode>("authored");
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [routeRevision, setRouteRevision] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [revealSelectionRequest, setRevealSelectionRequest] = useState(0);
  const [messageFocusRequest, setMessageFocusRequest] = useState(0);
  const [workspaceResetRequest, setWorkspaceResetRequest] = useState(0);
  const [dockApi, setDockApi] = useState<DockviewApi>();
  const [diagramMaximized, setDiagramMaximized] = useState(false);
  const diagramEdgeState = useRef<Map<EdgeGroupPosition, boolean> | undefined>(undefined);
  const fitAfterLayout = useRef(true);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [addBlockLevelId, setAddBlockLevelId] = useState<string>();
  const [addPortTarget, setAddPortTarget] = useState<{ levelId: string; nodeId: string }>();
  const [connectionEndpointLevelId, setConnectionEndpointLevelId] = useState<string>();
  const [childDesignTarget, setChildDesignTarget] = useState<{ levelId: string; nodeId: string }>();
  const [pendingConnection, setPendingConnection] = useState<PendingConnection>();
  const [loadError, setLoadError] = useState<string>();
  const [commandError, setCommandError] = useState<string>();
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
  const inspectorDraftDirtyRef = useRef(inspectorDraftDirty);
  const dockApiRef = useRef(dockApi);
  documentRef.current = document;
  editorDocumentRef.current = editor.document;
  editorDirtyRef.current = editor.dirty;
  selectionRef.current = selection;
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
    setInspectorDraftDirty(false);
    setSelection({ kind: "level", levelId: next.entryLevelId });
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setSourceLabel(source);
    setFileName(fileNameFromSource(next, source));
    setLoadError(undefined);
    setCommandError(undefined);
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
      installDocument(await loadDesignFromUrl(url), url);
    } catch (error) {
      setLoadError(errorMessage(error));
      if (!initial) setLoadDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }, [installDocument, mayDiscardChanges]);

  const openFile = useCallback(async (file: File) => {
    if (!mayDiscardChanges()) return;
    setBusy(true);
    setLoadError(undefined);
    try {
      installDocument(await loadDesignFromFile(file), file.name);
    } catch (error) {
      setLoadError(errorMessage(error));
      setLoadDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }, [installDocument, mayDiscardChanges]);

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
    layoutBlockDesign(document, { expandedLevelIds, placementMode })
      .then((result) => {
        if (!active) return;
        setLayout(result);
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
            levelId: document.entryLevelId,
          },
        ]);
      })
      .finally(() => {
        if (active) setLayoutBusy(false);
      });
    return () => { active = false; };
  }, [layoutProjection, expandedLevelIds, layoutRevision, placementMode]);

  useEffect(() => {
    if (document && !selectionExists(document, selection)) {
      setInspectorDraftDirty(false);
      setSelection({ kind: "level", levelId: document.entryLevelId });
    }
  }, [document, selection]);

  useEffect(() => {
    if (!editor.dirty && !inspectorDraftDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editor.dirty, inspectorDraftDirty]);

  const requestSelection = useCallback((next: SelectionRef): boolean => {
    if (sameSelection(selectionRef.current, next)) return true;
    if (inspectorDraftDirtyRef.current && !window.confirm("Discard unapplied Inspector changes and change selection?")) {
      return false;
    }
    setInspectorDraftDirty(false);
    setSelection(next);
    return true;
  }, []);

  const requestSelectionFromNavigator = useCallback((next: SelectionRef): boolean => {
    if (!requestSelection(next)) return false;
    setRevealSelectionRequest((value) => value + 1);
    return true;
  }, [requestSelection]);

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
      const previousGeometry = layoutGeometrySignature(editorDocumentRef.current);
      const next = editor.apply(operation);
      if (layoutGeometrySignature(next) !== previousGeometry) fitAfterLayout.current = true;
      setIssues(validateBlockDesignDocument(next));
      setCommandError(undefined);
      setPlacementMode("authored");
      return next;
    } catch (error) {
      setCommandError(errorMessage(error));
      return undefined;
    }
  }, [editor.apply]);

  const undoDesign = useCallback(() => {
    if (!confirmDiscardInspectorDraft("undo the last document operation")) return;
    const previousGeometry = layoutGeometrySignature(editorDocumentRef.current);
    const next = editor.undo();
    if (!next) return;
    setInspectorDraftDirty(false);
    if (layoutGeometrySignature(next) !== previousGeometry) fitAfterLayout.current = true;
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setCommandError(undefined);
  }, [confirmDiscardInspectorDraft, editor.undo]);

  const redoDesign = useCallback(() => {
    if (!confirmDiscardInspectorDraft("redo the next document operation")) return;
    const previousGeometry = layoutGeometrySignature(editorDocumentRef.current);
    const next = editor.redo();
    if (!next) return;
    setInspectorDraftDirty(false);
    if (layoutGeometrySignature(next) !== previousGeometry) fitAfterLayout.current = true;
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setCommandError(undefined);
  }, [confirmDiscardInspectorDraft, editor.redo]);

  const saveCurrent = useCallback(() => {
    if (!document) return;
    if (!requireAppliedInspectorDraft("saving")) return;
    try {
      const savedName = downloadDesign(document, fileName);
      setFileName(savedName);
      setSourceLabel(savedName);
      editor.markSaved();
      setCommandError(undefined);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  }, [document, editor.markSaved, fileName, requireAppliedInspectorDraft]);

  const exportCurrent = useCallback(() => {
    if (!document) return;
    if (!requireAppliedInspectorDraft("exporting")) return;
    try {
      downloadDesign(document, `${document.id}.export.block-design.json`);
      setCommandError(undefined);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  }, [document, requireAppliedInspectorDraft]);

  const openSaveAs = useCallback(() => {
    if (!requireAppliedInspectorDraft("opening Save As")) return;
    setCommandError(undefined);
    setSaveAsDialogOpen(true);
  }, [requireAppliedInspectorDraft]);

  const deleteSelection = useCallback(() => {
    if (!document || selection.kind === "document" || selection.kind === "level") return;
    const description = selection.kind === "node"
      ? "Delete this module, its connections, and its exclusively owned child design?"
      : selection.kind === "port"
        ? "Delete this port and all attached connections?"
        : "Delete this connection and its unused interface definition?";
    const draftWarning = inspectorDraftDirty ? " Unapplied Inspector changes will also be discarded." : "";
    if (!window.confirm(`${description}${draftWarning}`)) return;
    const operation: DesignOperation = selection.kind === "node"
      ? { type: "node/delete", levelId: selection.levelId, nodeId: selection.nodeId }
      : selection.kind === "port"
        ? { type: "port/delete", levelId: selection.levelId, nodeId: selection.nodeId, portId: selection.portId }
        : { type: "connection/delete", levelId: selection.levelId, connectionId: selection.connectionId };
    if (runOperation(operation)) {
      setInspectorDraftDirty(false);
      setSelection({ kind: "level", levelId: selection.levelId });
    }
  }, [document, inspectorDraftDirty, runOperation, selection]);

  const revealLevel = useCallback((levelId: string) => {
    const currentDocument = documentRef.current;
    if (!currentDocument) return;
    const path = hierarchyLevelPath(currentDocument, levelId);
    if (path.length === 0) return;
    setExpandedLevelIds((current) => {
      if (path.every((id) => current.has(id))) return current;
      fitAfterLayout.current = true;
      setLayoutBusy(true);
      return new Set([...current, ...path]);
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

  const activeLevel = document ? levelForSelection(document, selection) : undefined;
  const selectedNode = document ? nodeForSelection(document, selection) : undefined;

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
    setConnectionEndpointLevelId(activeLevel.id);
  }, [activeLevel, requireAppliedInspectorDraft]);

  const openAddChildDesign = useCallback(() => {
    if (!selectedNode || !requireAppliedInspectorDraft("creating a child design")) return;
    setCommandError(undefined);
    setChildDesignTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id });
  }, [requireAppliedInspectorDraft, selectedNode]);

  const moveNode = useCallback((levelId: string, nodeId: string, position: { x: number; y: number }) => {
    if (!requireAppliedInspectorDraft("moving a module")) return false;
    return Boolean(runOperation({ type: "node/move", levelId, nodeId, position }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const createConnection = useCallback((connection: {
    levelId: string;
    source: { nodeId: string; portId: string; label: string };
    target: { nodeId: string; portId: string; label: string };
  }) => {
    const currentDocument = documentRef.current;
    if (!currentDocument || !requireAppliedInspectorDraft("creating an interface")) return;
    const level = currentDocument.levels.find((candidate) => candidate.id === connection.levelId);
    if (!level) return;
    const connectionBase = suggestId(`${connection.source.nodeId}-to-${connection.target.nodeId}`, "connection");
    const interfaceBase = suggestId(`${connection.source.nodeId}.${connection.source.portId}-to-${connection.target.nodeId}.${connection.target.portId}`, "interface");
    setPendingConnection({
      ...connection,
      defaultConnectionId: uniqueId(connectionBase, level.connections.map((candidate) => candidate.id)),
      defaultInterfaceId: uniqueId(interfaceBase, Object.keys(currentDocument.interfaceDefinitions)),
    });
    setCommandError(undefined);
  }, [requireAppliedInspectorDraft]);

  const routeConnection = useCallback((levelId: string, connectionId: string, routing: ConnectionRouting | undefined): boolean => {
    if (!requireAppliedInspectorDraft("adjusting interface routing")) return false;
    return Boolean(runOperation({ type: "connection/route", levelId, connectionId, routing }));
  }, [requireAppliedInspectorDraft, runOperation]);

  const canDelete = selection.kind === "node" || selection.kind === "port" || selection.kind === "connection";
  const canAddChildDesign = Boolean(selectedNode && !selectedNode.node.hierarchy);
  const canAddConnection = Boolean(activeLevel && firstConnectablePair(activeLevel));
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
      execute: () => setLoadDialogOpen(true),
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
    deleteSelection: {
      id: "deleteSelection", label: "Delete Selection", toolbarTitle: "删除所选内容", shortcut: "Del", icon: Trash2,
      ...commandAvailability(canDelete, "Select a module, port, or interface first."), execute: deleteSelection,
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
    fitDesign: {
      id: "fitDesign", label: "Fit Design", toolbarTitle: "适应窗口", icon: Scan,
      ...commandAvailability(Boolean(document), "Open or create a design first."), execute: () => setFitRequest((value) => value + 1),
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
    canAddChildDesign,
    canAddConnection,
    canDelete,
    deleteSelection,
    diagramMaximized,
    document,
    editor.canRedo,
    editor.canUndo,
    exportCurrent,
    maximizeDiagram,
    mayDiscardChanges,
    openAddBlock,
    openAddChildDesign,
    openAddConnection,
    openAddPort,
    openSaveAs,
    redoDesign,
    requireAppliedInspectorDraft,
    saveCurrent,
    selectedNode,
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
      const target = event.target as HTMLElement | null;
      const editingText = target?.matches("input, textarea, select, [contenteditable='true']");
      if (editingText) return;
      if (modifier && key === "z") {
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
          <button type="button" className="bd-command-button" onClick={() => setLoadDialogOpen(true)}><FolderOpen size={15} /> Open another design</button>
        </div>}
        <LoadDesignDialog open={loadDialogOpen} busy={busy} error={loadError} onClose={() => { setLoadDialogOpen(false); setLoadError(undefined); }} onLoadFile={(file) => void openFile(file)} onLoadUrl={(url) => void openUrl(url)} />
        <NewDesignDialog open={newDialogOpen} error={commandError} idFromTitle={(title) => suggestId(title, "design")} onClose={() => { setNewDialogOpen(false); setCommandError(undefined); }} onCreate={({ id, title }) => {
          try {
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
  const connectionEndpointLevel = connectionEndpointLevelId
    ? document.levels.find((level) => level.id === connectionEndpointLevelId)
    : undefined;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const expandedTitles = document.levels.filter((level) => expandedLevelIds.has(level.id)).map((level) => level.title);
  const visibleConnections = layout.edges.filter((edge) => !edge.data?.boundaryContinuation).length;

  const dockContent = {
    sources: <HierarchyTree document={document} expandedLevelIds={expandedLevelIds} selection={selection} onToggleLevel={toggleHierarchy} onRevealLevel={revealLevel} onSelect={requestSelectionFromNavigator} />,
    diagram: (
      <section className="bd-canvas-pane">
        <ReactFlowProvider>
          <BlockDesignCanvas
            document={document}
            layout={layout}
            selection={selection}
            fitRequest={fitRequest}
            revealSelectionRequest={revealSelectionRequest}
            routeRevision={routeRevision}
            onSelect={requestSelection}
            onToggleHierarchy={toggleHierarchy}
            onAddModule={openAddBlock}
            onMoveNode={moveNode}
            onCreateConnection={createConnection}
            onRouteConnection={routeConnection}
          />
        </ReactFlowProvider>
        {(layoutBusy || busy) && <div className="bd-canvas-busy" role="status">Updating diagram...</div>}
      </section>
    ),
    properties: <Inspector document={document} selection={selection} onOperation={runOperation} onDelete={deleteSelection} onDraftChange={setInspectorDraftDirty} onSelect={requestSelectionFromNavigator} />,
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
        activeLevelTitle={activeLevel!.title}
        expandedTitles={expandedTitles}
        expandedCount={expandedLevelIds.size}
      />

      <section className="bd-workspace"><DockWorkspace content={dockContent} resetRequest={workspaceResetRequest} onReady={setDockApi} /></section>
      <footer className="bd-statusbar">
        <span><Braces size={12} /> BlockDesignDocument {document.schemaVersion}</span>
        <span className={editor.dirty || inspectorDraftDirty ? "is-dirty" : ""}>{inspectorDraftDirty ? "Unapplied Inspector changes" : editor.dirty ? "Unsaved changes" : "Saved"}</span>
        <span>{layout.nodes.length} diagram blocks</span><span>{visibleConnections} diagram interfaces</span>
        <span>ELK placement · obstacle-aware orthogonal routes</span>
      </footer>

      {commandError && <div className="bd-command-error" role="alert"><TriangleAlert size={15} /><span>{commandError}</span><button type="button" onClick={() => setCommandError(undefined)}>Dismiss</button></div>}
      {dragActive && <div className="bd-drop-overlay"><FileJsonDrop /></div>}
      <LoadDesignDialog open={loadDialogOpen} busy={busy} error={loadError} onClose={() => { setLoadDialogOpen(false); setLoadError(undefined); }} onLoadFile={(file) => void openFile(file)} onLoadUrl={(url) => void openUrl(url)} />
      <NewDesignDialog open={newDialogOpen} error={commandError} idFromTitle={(title) => suggestId(title, "design")} onClose={() => { setNewDialogOpen(false); setCommandError(undefined); }} onCreate={({ id, title }) => {
        try {
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
      <SelectConnectionEndpointsDialog
        level={connectionEndpointLevel}
        error={commandError}
        onClose={() => { setConnectionEndpointLevelId(undefined); setCommandError(undefined); }}
        onContinue={(connection) => {
          setConnectionEndpointLevelId(undefined);
          createConnection(connection);
        }}
      />
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
