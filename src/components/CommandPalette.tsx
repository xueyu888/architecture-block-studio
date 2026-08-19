import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { StudioCommand, StudioCommands } from "../studio/commands";
import { useDialogFocus } from "./useDialogFocus";

function searchableCommandText(command: StudioCommand): string {
  return [command.label, command.toolbarTitle, command.shortcut, command.unavailableReason]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function matchingCommands(commands: StudioCommands, query: string): StudioCommand[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(commands).filter((command) => (
    command.showInPalette !== false && terms.every((term) => searchableCommandText(command).includes(term))
  ));
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: StudioCommands;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const listboxId = useId();
  const { prepareFocusHandoff } = useDialogFocus({ open, dialogRef, onClose });
  const results = useMemo(() => matchingCommands(commands, query), [commands, query]);
  const safeActiveIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const activeCommand = safeActiveIndex >= 0 ? results[safeActiveIndex] : undefined;
  const activeOptionId = activeCommand ? `${listboxId}-option-${activeCommand.id}` : undefined;

  useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId, open]);

  if (!open) return null;

  const activate = (command: StudioCommand | undefined) => {
    if (!command?.enabled) return;
    prepareFocusHandoff();
    onClose();
    command.execute();
  };

  const moveActive = (direction: -1 | 1) => {
    if (results.length === 0) return;
    setActiveIndex((current) => (Math.min(current, results.length - 1) + direction + results.length) % results.length);
  };

  return (
    <div
      className="bd-command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="bd-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <div className="bd-command-palette-search">
          <Search size={18} aria-hidden="true" />
          <input
            data-autofocus="true"
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            spellCheck="false"
            placeholder="Search commands..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(event.key === "ArrowUp" ? -1 : 1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                activate(activeCommand);
              }
            }}
          />
          <kbd>Ctrl/⌘ K</kbd>
        </div>
        <div id={listboxId} className="bd-command-palette-results" role="listbox" aria-label="Commands">
          {results.map((command, index) => {
            const Icon = command.icon;
            const active = index === safeActiveIndex;
            return (
              <button
                key={command.id}
                id={`${listboxId}-option-${command.id}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={active}
                aria-disabled={command.enabled ? undefined : true}
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => activate(command)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="bd-command-palette-copy">
                  <strong>{command.label}</strong>
                  {!command.enabled && <small>{command.unavailableReason}</small>}
                </span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="bd-command-palette-empty">
              <Search size={20} aria-hidden="true" />
              <strong>No matching commands</strong>
              <span>Try a command name, shortcut, or action.</span>
            </div>
          )}
        </div>
        <footer>
          <span role="status">{results.length} {results.length === 1 ? "command" : "commands"}</span>
          <span><kbd>↑↓</kbd> Navigate <kbd>Enter</kbd> Run <kbd>Esc</kbd> Close</span>
        </footer>
      </section>
    </div>
  );
}
