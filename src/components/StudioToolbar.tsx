import type { StudioCommand, StudioCommandId, StudioCommands } from "../studio/commands";
import { Tooltip } from "./Tooltip";

function CommandButton({ command }: { command: StudioCommand }) {
  const Icon = command.icon;
  const title = command.toolbarTitle ?? command.label;
  const accessibleTitle = command.enabled ? title : `${title} — ${command.unavailableReason}`;
  return (
    <Tooltip
      label={title}
      shortcut={command.shortcut}
      detail={command.enabled ? undefined : command.unavailableReason}
      align="start"
    >
      <button
        type="button"
        className="bd-tool-button"
        aria-label={accessibleTitle}
        disabled={!command.enabled}
        onClick={command.execute}
      >
        <Icon size={15} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function CommandGroup({
  commands,
  ids,
  label,
}: {
  commands: StudioCommands;
  ids: StudioCommandId[];
  label: string;
}) {
  return (
    <div className="bd-toolbar-group" role="group" aria-label={label}>
      {ids.map((id) => <CommandButton key={id} command={commands[id]} />)}
    </div>
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
    <div className="bd-toolbar" role="toolbar" aria-label="Architecture design tools">
      <CommandGroup label="File" commands={commands} ids={["newDesign", "openDesign", "save"]} />
      <CommandGroup label="History and selection" commands={commands} ids={["undo", "redo", "deleteSelection"]} />
      <CommandGroup label="Create" commands={commands} ids={["addBlock", "addPort", "addConnection", "addChildDesign"]} />
      <CommandGroup label="Layout and validation" commands={commands} ids={["regenerateLayout", "optimizeRouting", "fitDesign", "validateDesign"]} />
      <CommandGroup label="Workspace panels" commands={commands} ids={["toggleSources", "toggleMessages", "toggleProperties", "maximizeDiagram"]} />
      <nav className="bd-breadcrumbs" aria-label="Expanded hierarchy">
        <strong>{activeLevelTitle}</strong>
        {expandedTitles.map((title) => <span key={title}><b>/</b>{title}</span>)}
      </nav>
      <span className="bd-level-chip">{expandedCount} expanded</span>
    </div>
  );
}
