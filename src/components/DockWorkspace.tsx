import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import {
  DockviewDefaultTab,
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type EdgeGroupPosition,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Maximize2, PanelLeftClose, PanelRightClose } from "lucide-react";
import { useStudioLocale } from "../i18n/StudioLocale";

const LAYOUT_STORAGE_KEY = "architecture-block-studio.workspace.v2";

interface DockContent {
  sources: ReactNode;
  diagram: ReactNode;
  properties: ReactNode;
  messages: ReactNode;
}

const DockContentContext = createContext<DockContent | undefined>(undefined);
const DockActionContext = createContext<((position: EdgeGroupPosition) => void) | undefined>(undefined);

function useDockContent(): DockContent {
  const value = useContext(DockContentContext);
  if (!value) throw new Error("Dock panel rendered outside DockContentContext.");
  return value;
}

function SourcesPanel(_: IDockviewPanelProps) {
  return <div className="bd-dock-content">{useDockContent().sources}</div>;
}

function DiagramPanel(_: IDockviewPanelProps) {
  return <div className="bd-dock-content bd-diagram-dock-content">{useDockContent().diagram}</div>;
}

function PropertiesPanel(_: IDockviewPanelProps) {
  return <div className="bd-dock-content">{useDockContent().properties}</div>;
}

function MessagesPanel(_: IDockviewPanelProps) {
  return <div className="bd-dock-content">{useDockContent().messages}</div>;
}

const dockComponents = {
  sources: SourcesPanel,
  diagram: DiagramPanel,
  properties: PropertiesPanel,
  messages: MessagesPanel,
};

function StudioTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose />;
}

function StudioHeaderActions({ activePanel, containerApi, location }: IDockviewHeaderActionsProps) {
  const toggleEdgeGroup = useContext(DockActionContext);
  const { t } = useStudioLocale();
  if (!activePanel) return null;
  const collapsiblePosition = location?.type === "edge" && (location.position === "left" || location.position === "right")
    ? location.position
    : undefined;
  return (
    <div className="bd-dock-header-actions">
      {collapsiblePosition && (
        <button
          type="button"
          className="bd-dock-collapse-action"
          title={t(collapsiblePosition === "left" ? "dock.collapseLeft" : "dock.collapseRight")}
          aria-label={t(collapsiblePosition === "left" ? "dock.collapseLeft" : "dock.collapseRight")}
          onClick={() => toggleEdgeGroup?.(collapsiblePosition)}
        >
          {collapsiblePosition === "left"
            ? <PanelLeftClose aria-hidden="true" size={14} />
            : <PanelRightClose aria-hidden="true" size={14} />}
        </button>
      )}
      <button
        type="button"
        title={t("dock.maximize")}
        aria-label={t("dock.maximizeNamed", { title: activePanel.title ?? "panel" })}
        onClick={() => {
          if (containerApi.hasMaximizedGroup()) containerApi.exitMaximizedGroup();
          else containerApi.maximizeGroup(activePanel);
        }}
      >
        <Maximize2 aria-hidden="true" size={13} />
      </button>
    </div>
  );
}

interface DockTitles {
  diagram: string;
  sources: string;
  properties: string;
  messages: string;
}

type SerializedDockLayout = ReturnType<DockviewApi["toJSON"]>;

function readGroupViewIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("views" in value)) return [];
  const views = (value as { views?: unknown }).views;
  return Array.isArray(views) ? views.filter((view): view is string => typeof view === "string") : [];
}

function readGridViewIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("data" in value)) return [];
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.flatMap((child) => readGridViewIds(child))
    : readGroupViewIds(data);
}

function describePanelTopology(layout: SerializedDockLayout): string[] {
  const topology = readGridViewIds(layout.grid.root).map((panelId) => `center:${panelId}`);
  const edgePositions: EdgeGroupPosition[] = ["top", "bottom", "left", "right"];
  edgePositions.forEach((position) => {
    const edgeGroup = layout.edgeGroups?.[position];
    readGroupViewIds(edgeGroup?.group).forEach((panelId) => topology.push(`${position}:${panelId}`));
  });
  layout.floatingGroups?.forEach((group) => {
    const panelIds = group.data ? readGroupViewIds(group.data) : readGridViewIds(group.grid?.root);
    panelIds.forEach((panelId) => topology.push(`floating:${panelId}`));
  });
  layout.popoutGroups?.forEach((group) => {
    const panelIds = group.data ? readGroupViewIds(group.data) : readGridViewIds(group.grid?.root);
    panelIds.forEach((panelId) => topology.push(`popout:${panelId}`));
  });
  return topology.sort();
}

function hasCanonicalPanelTopology(
  layout: SerializedDockLayout,
  canonicalLayout: SerializedDockLayout,
): boolean {
  const actualPanels = Object.keys(layout.panels).sort();
  const canonicalPanels = Object.keys(canonicalLayout.panels).sort();
  return JSON.stringify(actualPanels) === JSON.stringify(canonicalPanels)
    && JSON.stringify(describePanelTopology(layout)) === JSON.stringify(describePanelTopology(canonicalLayout));
}

function restoreSavedLayout(
  api: DockviewApi,
  saved: string,
  defaultLayout: SerializedDockLayout,
): void {
  try {
    const parsed = JSON.parse(saved) as SerializedDockLayout;
    if (!hasCanonicalPanelTopology(parsed, defaultLayout)) {
      api.fromJSON(defaultLayout);
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(defaultLayout));
      return;
    }
    api.fromJSON(parsed);
  } catch {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    api.fromJSON(defaultLayout);
  }
}

function updatePanelTitles(api: DockviewApi, titles: DockTitles): void {
  (Object.entries(titles) as Array<[keyof DockTitles, string]>).forEach(([id, title]) => {
    api.getPanel(id)?.setTitle(title);
  });
}

function createDefaultLayout(api: DockviewApi, titles: DockTitles): void {
  api.clear();
  api.addPanel({
    id: "diagram",
    component: "diagram",
    title: titles.diagram,
    minimumWidth: 520,
    minimumHeight: 320,
  });

  const sources = api.addEdgeGroup("left", {
    id: "sources-group",
    initialSize: 250,
    minimumSize: 180,
    maximumSize: 620,
    collapsedSize: 30,
  });
  api.addPanel({
    id: "sources",
    component: "sources",
    title: titles.sources,
    position: { referenceGroup: sources.id },
  });

  const properties = api.addEdgeGroup("right", {
    id: "properties-group",
    initialSize: 372,
    minimumSize: 260,
    maximumSize: 720,
    collapsedSize: 30,
  });
  api.addPanel({
    id: "properties",
    component: "properties",
    title: titles.properties,
    position: { referenceGroup: properties.id },
  });

  const messages = api.addEdgeGroup("bottom", {
    id: "messages-group",
    initialSize: 176,
    minimumSize: 96,
    maximumSize: 420,
    collapsedSize: 30,
    collapsed: true,
  });
  api.addPanel({
    id: "messages",
    component: "messages",
    title: titles.messages,
    position: { referenceGroup: messages.id },
  });
}

export function DockWorkspace({
  content,
  resetRequest,
  onReady,
  onToggleEdgeGroup,
}: {
  content: DockContent;
  resetRequest: number;
  onReady: (api: DockviewApi) => void;
  onToggleEdgeGroup: (position: EdgeGroupPosition) => void;
}) {
  const { locale, t } = useStudioLocale();
  const titles: DockTitles = {
    diagram: t("dock.diagram"),
    sources: t("dock.sources"),
    properties: t("dock.properties"),
    messages: t("dock.messages"),
  };
  const apiRef = useRef<DockviewApi | undefined>(undefined);
  const titlesRef = useRef(titles);
  titlesRef.current = titles;
  const defaultLayoutRef = useRef<ReturnType<DockviewApi["toJSON"]> | undefined>(undefined);
  const initialResetRequest = useRef(resetRequest);

  useEffect(() => {
    if (resetRequest === initialResetRequest.current || !apiRef.current || !defaultLayoutRef.current) return;
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    apiRef.current.fromJSON(defaultLayoutRef.current);
    updatePanelTitles(apiRef.current, titlesRef.current);
  }, [resetRequest]);

  useEffect(() => {
    if (apiRef.current) updatePanelTitles(apiRef.current, titles);
  }, [locale]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== "Tab" || !apiRef.current) return;
      event.preventDefault();
      if (event.shiftKey) apiRef.current.activatePrevious({ includePanel: true });
      else apiRef.current.activateNext({ includePanel: true });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleReady = (event: DockviewReadyEvent) => {
    const { api } = event;
    apiRef.current = api;
    createDefaultLayout(api, titlesRef.current);
    defaultLayoutRef.current = api.toJSON();

    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      restoreSavedLayout(api, saved, defaultLayoutRef.current);
    }
    updatePanelTitles(api, titlesRef.current);

    api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    });
    onReady(api);
  };

  return (
    <DockContentContext.Provider value={content}>
      <DockActionContext.Provider value={onToggleEdgeGroup}>
        <DockviewReact
          className="bd-dockview"
          theme={themeLight}
          disableDnd
          components={dockComponents}
          defaultTabComponent={StudioTab}
          rightHeaderActionsComponent={StudioHeaderActions}
          onReady={handleReady}
        />
      </DockActionContext.Provider>
    </DockContentContext.Provider>
  );
}
