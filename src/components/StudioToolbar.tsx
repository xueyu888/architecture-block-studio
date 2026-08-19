import type { StudioCommand, StudioCommandId, StudioCommands } from "../studio/commands";

function CommandButton({ command }: { command: StudioCommand }) {
  const Icon = command.icon;
  const title = command.toolbarTitle ?? command.label;
  const accessibleTitle = command.enabled ? title : `${title} — ${command.unavailableReason}`;
  return (
    <button
      type="button"
      className="bd-tool-button"
      title={accessibleTitle}
      aria-label={accessibleTitle}
      disabled={!command.enabled}
      onClick={command.execute}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

function CommandGroup({ commands, ids }: { commands: StudioCommands; ids: StudioCommandId[] }) {
  return (
    <>
      {ids.map((id) => <CommandButton key={id} command={commands[id]} />)}
      <span className="bd-toolbar-separator" />
    </>
  );
}

export function StudioToolbar({
  commands,
  activeLevelTitle,
  expandedTitles,
  expandedCount,
}: {
  commands: StudioCommands;
  activeLevelTitle: string;
  expandedTitles: string[];
  expandedCount: number;
}) {
  return (
    <div className="bd-toolbar">
      <CommandGroup commands={commands} ids={["newDesign", "openDesign", "save"]} />
      <CommandGroup commands={commands} ids={["undo", "redo", "deleteSelection"]} />
      <CommandGroup commands={commands} ids={["addBlock", "addPort", "addConnection", "addChildDesign"]} />
      <CommandGroup commands={commands} ids={["regenerateLayout", "optimizeRouting", "fitDesign", "validateDesign"]} />
      <CommandGroup commands={commands} ids={["toggleSources", "toggleMessages", "toggleProperties", "maximizeDiagram"]} />
      <nav className="bd-breadcrumbs" aria-label="Expanded hierarchy">
        <strong>{activeLevelTitle}</strong>
        {expandedTitles.map((title) => <span key={title}><b>/</b>{title}</span>)}
      </nav>
      <span className="bd-level-chip">{expandedCount} expanded</span>
    </div>
  );
}
