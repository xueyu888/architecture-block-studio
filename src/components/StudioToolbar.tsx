import type { StudioCommand, StudioCommandId, StudioCommands } from "../studio/commands";
import { useStudioLocale } from "../i18n/StudioLocale";
import { MODULE_CREATION_DRAG_TYPE } from "./moduleCreationGesture";
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
        draggable={command.id === "addBlock" && command.enabled}
        onDragStart={command.id === "addBlock" ? (event) => {
          if (!command.enabled) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(MODULE_CREATION_DRAG_TYPE, "module");
        } : undefined}
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
  viewRootPath,
  onNavigateViewRoot,
  expandedCount,
}: {
  commands: StudioCommands;
  viewRootPath: readonly { id: string; title: string }[];
  onNavigateViewRoot: (levelId: string) => void;
  expandedCount: number;
}) {
  const { t } = useStudioLocale();
  return (
    <div className="bd-toolbar" role="toolbar" aria-label={t("toolbar.label")}>
      <CommandGroup label={t("toolbar.file")} commands={commands} ids={["newDesign", "openDesign", "save"]} />
      <CommandGroup label={t("toolbar.history")} commands={commands} ids={["undo", "redo", "deleteSelection"]} />
      <CommandGroup label={t("toolbar.create")} commands={commands} ids={["addBlock", "addPort", "addConnection", "addChildDesign"]} />
      <CommandGroup label={t("toolbar.review")} commands={commands} ids={["fitDesign", "validateDesign"]} />
      <nav className="bd-breadcrumbs" aria-label={t("toolbar.hierarchy")}>
        {viewRootPath.map((level, index) => (
          <span key={level.id}>
            {index > 0 && <b aria-hidden="true">/</b>}
            <button
              type="button"
              disabled={index === viewRootPath.length - 1}
              aria-current={index === viewRootPath.length - 1 ? "page" : undefined}
              onClick={() => onNavigateViewRoot(level.id)}
            >
              {level.title}
            </button>
          </span>
        ))}
      </nav>
      <span className="bd-level-chip">{t("toolbar.expanded", { count: expandedCount })}</span>
    </div>
  );
}
