import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { DockviewApi, EdgeGroupPosition } from "dockview-react";
import {
  Braces,
  CheckCircle2,
  CircuitBoard,
  FolderOpen,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Route,
  Scan,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { BlockDesignCanvas } from "../components/BlockDesignCanvas";
import { DockWorkspace } from "../components/DockWorkspace";
import { HierarchyTree } from "../components/HierarchyTree";
import { Inspector } from "../components/Inspector";
import { LoadDesignDialog } from "../components/LoadDesignDialog";
import { MenuBar } from "../components/MenuBar";
import { MessagesPanel } from "../components/MessagesPanel";
import {
  loadDesignFromFile,
  loadDesignFromObject,
  loadDesignFromUrl,
  type DesignLoadError,
} from "../io/loadDesign";
import { layoutBlockDesign, type PlacementMode } from "../layout";
import {
  validateBlockDesignDocument,
  type BlockDesignDocument,
  type DesignIssue,
} from "../model";
import type { LayoutResult, SelectionRef } from "./types";

function issueSelection(issue: DesignIssue): SelectionRef {
  if (issue.levelId && issue.connectionId) {
    return { kind: "connection", levelId: issue.levelId, connectionId: issue.connectionId };
  }
  if (issue.levelId && issue.nodeId && issue.portId) {
    return { kind: "port", levelId: issue.levelId, nodeId: issue.nodeId, portId: issue.portId };
  }
  if (issue.levelId && issue.nodeId) {
    return { kind: "node", levelId: issue.levelId, nodeId: issue.nodeId };
  }
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

export interface BlockDesignStudioProps {
  initialDocument: unknown;
  initialDesignUrl?: string;
  initialSourceLabel?: string;
}

export function BlockDesignStudio({
  initialDocument,
  initialDesignUrl,
  initialSourceLabel = "embedded document",
}: BlockDesignStudioProps) {
  const [document, setDocument] = useState<BlockDesignDocument>();
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
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [layoutBusy, setLayoutBusy] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [sourceLabel, setSourceLabel] = useState(initialDesignUrl ?? initialSourceLabel);

  const installDocument = useCallback((next: BlockDesignDocument, source: string) => {
    setDocument(next);
    setExpandedLevelIds(new Set());
    setSelection({ kind: "level", levelId: next.entryLevelId });
    setIssues(validateBlockDesignDocument(next));
    setPlacementMode("authored");
    setSourceLabel(source);
    setLoadError(undefined);
    setLoadDialogOpen(false);
    setBusy(false);
    setLayoutBusy(true);
    setLayoutRevision((value) => value + 1);
  }, []);

  const openUrl = useCallback(
    async (url: string, initial = false) => {
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
    },
    [installDocument],
  );

  const openFile = useCallback(
    async (file: File) => {
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
    },
    [installDocument],
  );

  useEffect(() => {
    if (initialDesignUrl) {
      void openUrl(initialDesignUrl, true);
      return;
    }
    try {
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
        if (active) setLayout(result);
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
    return () => {
      active = false;
    };
  }, [document, expandedLevelIds, layoutRevision, placementMode]);

  const revealLevel = useCallback((levelId: string) => {
    if (!document) return;
    const path = hierarchyPath(document, levelId);
    if (path.length === 0) return;
    setLayoutBusy(true);
    setExpandedLevelIds((current) => new Set([...current, ...path]));
  }, [document]);

  const toggleHierarchy = useCallback((levelId: string) => {
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
    }
  }, [dockApi]);

  const validateDesign = useCallback(() => {
    if (!document) return;
    setIssues(validateBlockDesignDocument(document));
    dockApi?.getEdgeGroup("bottom")?.expand();
  }, [dockApi, document]);

  if (!document) {
    return (
      <main className="bd-boot-screen">
        <CircuitBoard size={34} aria-hidden="true" />
        <h1>Architecture Block Studio</h1>
        <p>{busy ? "Loading design document..." : "The design could not be loaded."}</p>
        {loadError && <pre>{loadError}</pre>}
        {!busy && (
          <button type="button" className="bd-command-button" onClick={() => setLoadDialogOpen(true)}>
            <FolderOpen size={15} /> Open another design
          </button>
        )}
        <LoadDesignDialog
          open={loadDialogOpen}
          busy={busy}
          error={loadError}
          onClose={() => setLoadDialogOpen(false)}
          onLoadFile={(file) => void openFile(file)}
          onLoadUrl={(url) => void openUrl(url)}
        />
      </main>
    );
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const expandedTitles = document.levels
    .filter((level) => expandedLevelIds.has(level.id))
    .map((level) => level.title);
  const visibleConnections = layout.edges.filter((edge) => !edge.data?.boundaryContinuation).length;

  const dockContent = {
    sources: (
      <HierarchyTree
        document={document}
        expandedLevelIds={expandedLevelIds}
        selection={selection}
        onToggleLevel={toggleHierarchy}
        onRevealLevel={revealLevel}
        onSelect={setSelection}
      />
    ),
    diagram: (
      <section className="bd-canvas-pane">
        {!layoutBusy && !busy && (
          <ReactFlowProvider>
            <BlockDesignCanvas
              document={document}
              layout={layout}
              selection={selection}
              fitRequest={fitRequest}
              routeRevision={routeRevision}
              onSelect={setSelection}
              onToggleHierarchy={toggleHierarchy}
            />
          </ReactFlowProvider>
        )}
        {(layoutBusy || busy) && <div className="bd-canvas-busy">Computing compound layout...</div>}
      </section>
    ),
    properties: <Inspector document={document} selection={selection} />,
    messages: <MessagesPanel issues={issues} onSelect={selectIssue} />,
  };

  return (
    <main
      className="bd-studio"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <header className="bd-app-header">
        <div className="bd-brand">
          <span className="bd-brand-mark"><CircuitBoard size={16} /></span>
          <strong>Architecture Block Studio</strong>
        </div>
        <div className="bd-document-title">
          <span>{document.title}</span>
          <small>{sourceLabel}</small>
        </div>
        <div className="bd-validation-summary">
          {errorCount === 0 ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
          <span>{errorCount} errors</span>
          <span>{warningCount} warnings</span>
        </div>
      </header>

      <MenuBar
        sourceRef={document.sourceRef}
        onOpen={() => setLoadDialogOpen(true)}
        onLayout={() => {
          setLayoutBusy(true);
          setPlacementMode("automatic");
          setLayoutRevision((value) => value + 1);
        }}
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
        <button type="button" className="bd-tool-button" title="打开设计" onClick={() => setLoadDialogOpen(true)}><FolderOpen size={15} /></button>
        <span className="bd-toolbar-separator" />
        <button type="button" className="bd-tool-button" title="重新生成布局" onClick={() => {
          setLayoutBusy(true);
          setPlacementMode("automatic");
          setLayoutRevision((value) => value + 1);
        }}><LayoutDashboard size={15} /></button>
        <button type="button" className="bd-tool-button" title="仅优化布线" onClick={() => setRouteRevision((value) => value + 1)}><Route size={15} /></button>
        <button type="button" className="bd-tool-button" title="适应窗口" onClick={() => setFitRequest((value) => value + 1)}><Scan size={15} /></button>
        <button type="button" className="bd-tool-button" title="验证设计" onClick={validateDesign}><ShieldCheck size={15} /></button>
        <span className="bd-toolbar-separator" />
        <button type="button" className="bd-tool-button" title="Sources" onClick={() => toggleDock("left")}><PanelLeft size={15} /></button>
        <button type="button" className="bd-tool-button" title="Messages" onClick={() => toggleDock("bottom")}><PanelBottom size={15} /></button>
        <button type="button" className="bd-tool-button" title="Properties" onClick={() => toggleDock("right")}><PanelRight size={15} /></button>
        <button type="button" className="bd-tool-button" title="最大化或还原画布" onClick={maximizeDiagram}>{diagramMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <span className="bd-toolbar-separator" />
        <nav className="bd-breadcrumbs" aria-label="Expanded hierarchy">
          <strong>System</strong>
          {expandedTitles.map((title) => <span key={title}><b>/</b>{title}</span>)}
        </nav>
        <span className="bd-level-chip">{expandedLevelIds.size} expanded</span>
      </div>

      <section className="bd-workspace">
        <DockWorkspace content={dockContent} resetRequest={workspaceResetRequest} onReady={setDockApi} />
      </section>

      <footer className="bd-statusbar">
        <span><Braces size={12} /> BlockDesignDocument {document.schemaVersion}</span>
        <span>{layout.nodes.length} visible blocks</span>
        <span>{visibleConnections} visible interfaces</span>
        <span>ELK placement · obstacle-aware orthogonal routes</span>
      </footer>

      {dragActive && <div className="bd-drop-overlay"><FileJsonDrop /></div>}
      <LoadDesignDialog
        open={loadDialogOpen}
        busy={busy}
        error={loadError}
        onClose={() => setLoadDialogOpen(false)}
        onLoadFile={(file) => void openFile(file)}
        onLoadUrl={(url) => void openUrl(url)}
      />
    </main>
  );
}

function FileJsonDrop() {
  return (
    <div>
      <FolderOpen size={32} />
      <strong>Drop BlockDesignDocument JSON</strong>
    </div>
  );
}
