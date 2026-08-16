import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import {
  DockviewDefaultTab,
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Maximize2, PictureInPicture2 } from "lucide-react";

const LAYOUT_STORAGE_KEY = "architecture-block-studio.workspace.v2";

interface DockContent {
  sources: ReactNode;
  diagram: ReactNode;
  properties: ReactNode;
  messages: ReactNode;
}

const DockContentContext = createContext<DockContent | undefined>(undefined);

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
  if (!activePanel) return null;
  return (
    <div className="bd-dock-header-actions">
      <button
        type="button"
        title="Float panel"
        aria-label={`Float ${activePanel.title ?? "panel"}`}
        disabled={location?.type === "floating"}
        onClick={() => containerApi.addFloatingGroup(activePanel)}
      >
        <PictureInPicture2 aria-hidden="true" size={13} />
      </button>
      <button
        type="button"
        title="Maximize or restore panel"
        aria-label={`Maximize or restore ${activePanel.title ?? "panel"}`}
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

function createDefaultLayout(api: DockviewApi): void {
  api.clear();
  api.addPanel({
    id: "diagram",
    component: "diagram",
    title: "Diagram",
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
    title: "Sources",
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
    title: "Properties",
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
    title: "Messages / DRC",
    position: { referenceGroup: messages.id },
  });
}

export function DockWorkspace({
  content,
  resetRequest,
  onReady,
}: {
  content: DockContent;
  resetRequest: number;
  onReady: (api: DockviewApi) => void;
}) {
  const apiRef = useRef<DockviewApi | undefined>(undefined);
  const defaultLayoutRef = useRef<ReturnType<DockviewApi["toJSON"]> | undefined>(undefined);
  const initialResetRequest = useRef(resetRequest);

  useEffect(() => {
    if (resetRequest === initialResetRequest.current || !apiRef.current || !defaultLayoutRef.current) return;
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    apiRef.current.fromJSON(defaultLayoutRef.current);
  }, [resetRequest]);

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
    createDefaultLayout(api);
    defaultLayoutRef.current = api.toJSON();

    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      try {
        api.fromJSON(JSON.parse(saved));
      } catch {
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        api.fromJSON(defaultLayoutRef.current);
      }
    }

    api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    });
    onReady(api);
  };

  return (
    <DockContentContext.Provider value={content}>
      <DockviewReact
        className="bd-dockview"
        theme={themeLight}
        components={dockComponents}
        defaultTabComponent={StudioTab}
        rightHeaderActionsComponent={StudioHeaderActions}
        onReady={handleReady}
      />
    </DockContentContext.Provider>
  );
}
