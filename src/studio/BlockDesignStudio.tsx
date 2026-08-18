import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { DockviewApi, EdgeGroupPosition } from "dockview-react";
import {
  Box,
  Braces,
  Cable,
  CheckCircle2,
  CircuitBoard,
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
  Route,
  Save,
  Scan,
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
  type PendingConnection,
} from "../components/EditorDialogs";
import { HierarchyTree } from "../components/HierarchyTree";
import { Inspector } from "../components/Inspector";
import { LoadDesignDialog } from "../components/LoadDesignDialog";
import { MenuBar } from "../components/MenuBar";
import { MessagesPanel } from "../components/MessagesPanel";
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
import { layoutBlockDesign, type PlacementMode } from "../layout";
import {
  validateBlockDesignDocument,
  type BlockDesignDocument,
  type BlockNode,
  type DesignIssue,
  type DesignLevel,
} from "../model";
import type { LayoutResult, SelectionRef } from "./types";

function issueSelection(issue: DesignIssue): SelectionRef {
  if (issue.levelId && issue.connectionId) return { kind: "connection", levelId: issue.levelId, connectionId: issue.connectionId };
  if (issue.levelId && issue.nodeId && issue.portId) return { kind: "port", levelId: issue.levelId, nodeId: issue.nodeId, portId: issue.portId };
  if (issue.levelId && issue.nodeId) return { kind: "node", levelId: issue.levelId, nodeId: issue.nodeId };
  if (issue.levelId) return { kind: "level", levelId: issue.levelId };
  return { kind: "document" };
}

function errorMessage(error: unknown): string {
  const loadError = error as DesignLoadError;
  if (loadError?.causeDetail) return `${loadError.message}\n${loadError.causeDetail}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function hierarchyPath(document: BlockDesignDocument, levelId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = document.levels.find((level) => level.id === levelId);
  while (current && current.id !== document.entryLevelId && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentLevelId
      ? document.levels.find((level) => level.id === current?.parentLevelId)
      : undefined;
  }
  return path;
}

function selectionExists(document: BlockDesignDocument, selection: SelectionRef): boolean {
  if (selection.kind === "document") return true;
  const level = document.levels.find((candidate) => candidate.id === selection.levelId);
  if (!level) return false;
  if (selection.kind === "level") return true;
  if (selection.kind === "connection") return level.connections.some((candidate) => candidate.id === selection.connectionId);
  const node = level.nodes.find((candidate) => candidate.id === selection.nodeId);
  if (!node) return false;
  return selection.kind === "node" || node.ports.some((candidate) => candidate.id === selection.portId);
}

function fileNameFromSource(document: BlockDesignDocument, source: string): string {
  const tail = source.split(/[\\/]/).at(-1);
  return tail?.endsWith(".json") ? tail : suggestedDesignFileName(document);
}

function levelForSelection(document: BlockDesignDocument, selection: SelectionRef): DesignLevel {
  if (selection.kind === "document") {
    return document.levels.find((level) => level.id === document.entryLevelId)!;
  }
  return document.levels.find((level) => level.id === selection.levelId) ??
    document.levels.find((level) => level.id === document.entryLevelId)!;
}

function nodeForSelection(document: BlockDesignDocument, selection: SelectionRef): { level: DesignLevel; node: BlockNode } | undefined {
  if (selection.kind !== "node" && selection.kind !== "port") return undefined;
  const level = document.levels.find((candidate) => candidate.id === selection.levelId);
  const node = level?.nodes.find((candidate) => candidate.id === selection.nodeId);
  return level && node ? { level, node } : undefined;
}

function canvasGeometrySignature(document: BlockDesignDocument): string {
  return JSON.stringify(document.levels.map((level) => ({
    id: level.id,
    layout: level.layout,
    nodes: level.nodes.map((node) => ({
      id: node.id,
      layout: node.layout,
      hierarchy: node.hierarchy?.childLevelId,
      ports: node.ports.map((port) => ({ id: port.id, side: port.side, order: port.order })),
    })),
  })));
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
  const [issues, setIssues] = useState<DesignIssue[]>([]);
  const [layout, setLayout] = useState<LayoutResult>({ nodes: [], edges: [] });
  const [placementMode, setPlacementMode] = useState<PlacementMode>("authored");
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [routeRevision, setRouteRevision] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
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

  const installDocument = useCallback((next: BlockDesignDocument, source: string, saved = true) => {
    editor.replace(next, saved);
    setLayout({ nodes: [], edges: [] });
    fitAfterLayout.current = true;
    setDocumentInstalled(true);
    setExpandedLevelIds(new Set());
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

  const mayDiscardChanges = useCallback(() =>
    !editor.dirty || window.confirm("Discard unsaved changes to the current design?"),
  [editor.dirty]);

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
            levelId: document.entryLevelId,
          },
        ]);
      })
      .finally(() => {
        if (active) setLayoutBusy(false);
      });
    return () => { active = false; };
  }, [document, expandedLevelIds, layoutRevision, placementMode]);

  useEffect(() => {
    if (document && !selectionExists(document, selection)) {
      setSelection({ kind: "level", levelId: document.entryLevelId });
    }
  }, [document, selection]);

  useEffect(() => {
    if (!editor.dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editor.dirty]);

  const runOperation = useCallback((operation: DesignOperation): BlockDesignDocument | undefined => {
    try {
      const previousGeometry = canvasGeometrySignature(editor.document);
      const next = editor.apply(operation);
      if (canvasGeometrySignature(next) !== previousGeometry) fitAfterLayout.current = true;
      setIssues(validateBlockDesignDocument(next));
      setCommandError(undefined);
      setPlacementMode("authored");
      setLayoutBusy(true);
      return next;
    } catch (error) {
      setCommandError(errorMessage(error));
      return undefined;
    }
  }, [editor.apply, editor.document]);

  const undoDesign = useCallback(() => {
    const previousGeometry = canvasGeometrySignature(editor.document);
    const next = editor.undo();
    if (!next) return;
    if (canvasGeometrySignature(next) !== previousGeometry) fitAfterLayout.current = true;
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setLayoutBusy(true);
    setCommandError(undefined);
  }, [editor.document, editor.undo]);

  const redoDesign = useCallback(() => {
    const previousGeometry = canvasGeometrySignature(editor.document);
    const next = editor.redo();
    if (!next) return;
    if (canvasGeometrySignature(next) !== previousGeometry) fitAfterLayout.current = true;
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setLayoutBusy(true);
    setCommandError(undefined);
  }, [editor.document, editor.redo]);

  const saveCurrent = useCallback(() => {
    if (!document) return;
    try {
      const savedName = downloadDesign(document, fileName);
      setFileName(savedName);
      setSourceLabel(savedName);
      editor.markSaved();
      setCommandError(undefined);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  }, [document, editor.markSaved, fileName]);

  const exportCurrent = useCallback(() => {
    if (!document) return;
    try {
      downloadDesign(document, `${document.id}.export.block-design.json`);
      setCommandError(undefined);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  }, [document]);

  const deleteSelection = useCallback(() => {
    if (!document || selection.kind === "document" || selection.kind === "level") return;
    const description = selection.kind === "node"
      ? "Delete this module, its connections, and its exclusively owned child design?"
      : selection.kind === "port"
        ? "Delete this port and all attached connections?"
        : "Delete this connection and its unused interface definition?";
    if (!window.confirm(description)) return;
    const operation: DesignOperation = selection.kind === "node"
      ? { type: "node/delete", levelId: selection.levelId, nodeId: selection.nodeId }
      : selection.kind === "port"
        ? { type: "port/delete", levelId: selection.levelId, nodeId: selection.nodeId, portId: selection.portId }
        : { type: "connection/delete", levelId: selection.levelId, connectionId: selection.connectionId };
    if (runOperation(operation)) setSelection({ kind: "level", levelId: selection.levelId });
  }, [document, runOperation, selection]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) setSaveAsDialogOpen(true);
        else saveCurrent();
        return;
      }
      const target = event.target as HTMLElement | null;
      const editingText = target?.matches("input, textarea, select, [contenteditable='true']");
      if (editingText) return;
      if (modifier && event.key.toLocaleLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoDesign();
        else undoDesign();
      } else if (modifier && event.key.toLocaleLowerCase() === "y") {
        event.preventDefault();
        redoDesign();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [deleteSelection, redoDesign, saveCurrent, undoDesign]);

  const revealLevel = useCallback((levelId: string) => {
    if (!document) return;
    const path = hierarchyPath(document, levelId);
    if (path.length === 0) return;
    fitAfterLayout.current = true;
    setLayoutBusy(true);
    setExpandedLevelIds((current) => new Set([...current, ...path]));
  }, [document]);

  const toggleHierarchy = useCallback((levelId: string) => {
    fitAfterLayout.current = true;
    setLayoutBusy(true);
    setExpandedLevelIds((current) => {
      const next = new Set(current);
      if (next.has(levelId)) {
        next.delete(levelId);
        if (document) {
          document.levels.forEach((level) => {
            if (hierarchyPath(document, level.id).includes(levelId)) next.delete(level.id);
          });
        }
      } else {
        if (document) hierarchyPath(document, levelId).forEach((id) => next.add(id));
        else next.add(levelId);
      }
      return next;
    });
  }, [document]);

  const selectIssue = useCallback((issue: DesignIssue) => {
    if (issue.levelId) revealLevel(issue.levelId);
    setSelection(issueSelection(issue));
  }, [revealLevel]);

  const toggleDock = useCallback((position: EdgeGroupPosition) => {
    const group = dockApi?.getEdgeGroup(position);
    if (!group) return;
    if (group.isCollapsed()) group.expand();
    else group.collapse();
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
  }, [dockApi, document]);

  const openAddBlock = useCallback(() => {
    if (!document) return;
    setCommandError(undefined);
    setAddBlockLevelId(levelForSelection(document, selection).id);
  }, [document, selection]);

  const selectedNode = document ? nodeForSelection(document, selection) : undefined;
  const canDelete = selection.kind === "node" || selection.kind === "port" || selection.kind === "connection";
  const canAddChildDesign = Boolean(selectedNode && !selectedNode.node.hierarchy);

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
        <NewDesignDialog open={newDialogOpen} error={commandError} onClose={() => { setNewDialogOpen(false); setCommandError(undefined); }} onCreate={({ id, title }) => {
          try {
            installDocument(createBlankDesign(id, title), "New unsaved design", false);
            setNewDialogOpen(false);
          } catch (error) { setCommandError(errorMessage(error)); }
        }} />
      </main>
    );
  }

  const activeLevel = levelForSelection(document, selection);
  const addBlockLevel = addBlockLevelId ? document.levels.find((level) => level.id === addBlockLevelId) : undefined;
  const addPortNode = addPortTarget
    ? document.levels.find((level) => level.id === addPortTarget.levelId)?.nodes.find((node) => node.id === addPortTarget.nodeId)
    : undefined;
  const childDesignNode = childDesignTarget
    ? document.levels.find((level) => level.id === childDesignTarget.levelId)?.nodes.find((node) => node.id === childDesignTarget.nodeId)
    : undefined;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const expandedTitles = document.levels.filter((level) => expandedLevelIds.has(level.id)).map((level) => level.title);
  const visibleConnections = layout.edges.filter((edge) => !edge.data?.boundaryContinuation).length;

  const dockContent = {
    sources: <HierarchyTree document={document} expandedLevelIds={expandedLevelIds} selection={selection} onToggleLevel={toggleHierarchy} onRevealLevel={revealLevel} onSelect={setSelection} />,
    diagram: (
      <section className="bd-canvas-pane">
        <ReactFlowProvider>
          <BlockDesignCanvas
            document={document}
            layout={layout}
            selection={selection}
            fitRequest={fitRequest}
            routeRevision={routeRevision}
            onSelect={setSelection}
            onToggleHierarchy={toggleHierarchy}
            onMoveNode={(levelId, nodeId, position) => {
              runOperation({ type: "node/move", levelId, nodeId, position });
            }}
            onCreateConnection={(connection) => {
              const level = document.levels.find((candidate) => candidate.id === connection.levelId);
              if (!level) return;
              const connectionBase = suggestId(`${connection.source.nodeId}-to-${connection.target.nodeId}`, "connection");
              const interfaceBase = suggestId(`${connection.source.nodeId}.${connection.source.portId}-to-${connection.target.nodeId}.${connection.target.portId}`, "interface");
              setPendingConnection({
                ...connection,
                defaultConnectionId: uniqueId(connectionBase, level.connections.map((candidate) => candidate.id)),
                defaultInterfaceId: uniqueId(interfaceBase, Object.keys(document.interfaceDefinitions)),
              });
              setCommandError(undefined);
            }}
          />
        </ReactFlowProvider>
        {(layoutBusy || busy) && <div className="bd-canvas-busy" role="status">Updating diagram...</div>}
      </section>
    ),
    properties: <Inspector document={document} selection={selection} onOperation={runOperation} onDelete={deleteSelection} />,
    messages: <MessagesPanel issues={issues} onSelect={selectIssue} />,
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
        <div className="bd-document-title"><span>{document.title}{editor.dirty ? " *" : ""}</span><small>{sourceLabel}{editor.dirty ? " · Unsaved" : ""}</small></div>
        <div className="bd-validation-summary">
          {errorCount === 0 ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
          <span>{errorCount} errors</span><span>{warningCount} warnings</span>
        </div>
      </header>

      <MenuBar
        sourceRef={document.sourceRef}
        onNew={() => { if (mayDiscardChanges()) { setCommandError(undefined); setNewDialogOpen(true); } }}
        onOpen={() => setLoadDialogOpen(true)}
        onSave={saveCurrent}
        onSaveAs={() => { setCommandError(undefined); setSaveAsDialogOpen(true); }}
        onExport={exportCurrent}
        onUndo={undoDesign}
        onRedo={redoDesign}
        onDelete={deleteSelection}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        canDelete={canDelete}
        onAddBlock={openAddBlock}
        onAddPort={() => selectedNode && setAddPortTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id })}
        onAddChildDesign={() => selectedNode && setChildDesignTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id })}
        canAddPort={Boolean(selectedNode)}
        canAddChildDesign={canAddChildDesign}
        onLayout={() => { fitAfterLayout.current = true; setLayoutBusy(true); setPlacementMode("automatic"); setLayoutRevision((value) => value + 1); }}
        onOptimizeRouting={() => setRouteRevision((value) => value + 1)}
        onFit={() => setFitRequest((value) => value + 1)}
        onValidate={validateDesign}
        onToggleSources={() => toggleDock("left")}
        onToggleProperties={() => toggleDock("right")}
        onToggleMessages={() => toggleDock("bottom")}
        onMaximizeDiagram={maximizeDiagram}
        onResetWorkspace={() => setWorkspaceResetRequest((value) => value + 1)}
      />

      <div className="bd-toolbar">
        <button type="button" className="bd-tool-button" title="新建设计" onClick={() => { if (mayDiscardChanges()) setNewDialogOpen(true); }}><FilePlus2 size={15} /></button>
        <button type="button" className="bd-tool-button" title="打开设计" onClick={() => setLoadDialogOpen(true)}><FolderOpen size={15} /></button>
        <button type="button" className="bd-tool-button" title="保存设计" onClick={saveCurrent}><Save size={15} /></button>
        <span className="bd-toolbar-separator" />
        <button type="button" className="bd-tool-button" title="撤销" disabled={!editor.canUndo} onClick={undoDesign}><Undo2 size={15} /></button>
        <button type="button" className="bd-tool-button" title="重做" disabled={!editor.canRedo} onClick={redoDesign}><Redo2 size={15} /></button>
        <button type="button" className="bd-tool-button" title="删除所选内容" disabled={!canDelete} onClick={deleteSelection}><Trash2 size={15} /></button>
        <span className="bd-toolbar-separator" />
        <button type="button" className="bd-tool-button" title="添加模块" onClick={openAddBlock}><Box size={15} /></button>
        <button type="button" className="bd-tool-button" title="添加端口" disabled={!selectedNode} onClick={() => selectedNode && setAddPortTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id })}><Cable size={15} /></button>
        <button type="button" className="bd-tool-button" title="创建子设计" disabled={!canAddChildDesign} onClick={() => selectedNode && setChildDesignTarget({ levelId: selectedNode.level.id, nodeId: selectedNode.node.id })}><GitBranchPlus size={15} /></button>
        <span className="bd-toolbar-separator" />
        <button type="button" className="bd-tool-button" title="重新生成布局" onClick={() => { fitAfterLayout.current = true; setLayoutBusy(true); setPlacementMode("automatic"); setLayoutRevision((value) => value + 1); }}><LayoutDashboard size={15} /></button>
        <button type="button" className="bd-tool-button" title="仅优化布线" onClick={() => setRouteRevision((value) => value + 1)}><Route size={15} /></button>
        <button type="button" className="bd-tool-button" title="适应窗口" onClick={() => setFitRequest((value) => value + 1)}><Scan size={15} /></button>
        <button type="button" className="bd-tool-button" title="验证设计" onClick={validateDesign}><ShieldCheck size={15} /></button>
        <span className="bd-toolbar-separator" />
        <button type="button" className="bd-tool-button" title="Sources" onClick={() => toggleDock("left")}><PanelLeft size={15} /></button>
        <button type="button" className="bd-tool-button" title="Messages" onClick={() => toggleDock("bottom")}><PanelBottom size={15} /></button>
        <button type="button" className="bd-tool-button" title="Properties" onClick={() => toggleDock("right")}><PanelRight size={15} /></button>
        <button type="button" className="bd-tool-button" title="最大化或还原画布" onClick={maximizeDiagram}>{diagramMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <span className="bd-toolbar-separator" />
        <nav className="bd-breadcrumbs" aria-label="Expanded hierarchy"><strong>{activeLevel.title}</strong>{expandedTitles.map((title) => <span key={title}><b>/</b>{title}</span>)}</nav>
        <span className="bd-level-chip">{expandedLevelIds.size} expanded</span>
      </div>

      <section className="bd-workspace"><DockWorkspace content={dockContent} resetRequest={workspaceResetRequest} onReady={setDockApi} /></section>
      <footer className="bd-statusbar">
        <span><Braces size={12} /> BlockDesignDocument {document.schemaVersion}</span>
        <span className={editor.dirty ? "is-dirty" : ""}>{editor.dirty ? "Unsaved changes" : "Saved"}</span>
        <span>{layout.nodes.length} visible blocks</span><span>{visibleConnections} visible interfaces</span>
        <span>ELK placement · obstacle-aware orthogonal routes</span>
      </footer>

      {commandError && <div className="bd-command-error" role="alert"><TriangleAlert size={15} /><span>{commandError}</span><button type="button" onClick={() => setCommandError(undefined)}>Dismiss</button></div>}
      {dragActive && <div className="bd-drop-overlay"><FileJsonDrop /></div>}
      <LoadDesignDialog open={loadDialogOpen} busy={busy} error={loadError} onClose={() => { setLoadDialogOpen(false); setLoadError(undefined); }} onLoadFile={(file) => void openFile(file)} onLoadUrl={(url) => void openUrl(url)} />
      <NewDesignDialog open={newDialogOpen} error={commandError} onClose={() => { setNewDialogOpen(false); setCommandError(undefined); }} onCreate={({ id, title }) => {
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
      <AddChildDesignDialog
        open={Boolean(childDesignTarget && childDesignNode)}
        blockTitle={childDesignNode?.title ?? "module"}
        defaultId={childDesignNode ? uniqueId(`${childDesignNode.id}-internals`, document.levels.map((level) => level.id)) : "module-internals"}
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
