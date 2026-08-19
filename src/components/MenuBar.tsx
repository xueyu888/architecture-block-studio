import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { SourceRef } from "../model";
import type { StudioCommand, StudioCommandId, StudioCommands } from "../studio/commands";

type MenuId = "file" | "edit" | "design" | "arrange" | "view";
type MenuFocusTarget = "first" | "last";

function printableCharacter(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): string | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1 || event.key.trim() === "") {
    return undefined;
  }
  return event.key.toLocaleLowerCase();
}

const MENU_DEFINITIONS: Array<{
  id: MenuId;
  label: string;
  commandIds: StudioCommandId[];
}> = [
  { id: "file", label: "File", commandIds: ["newDesign", "openDesign", "save", "saveAs", "exportJson"] },
  {
    id: "edit",
    label: "Edit",
    commandIds: ["undo", "redo", "copySelection", "paste", "duplicateSelection", "deleteSelection"],
  },
  { id: "design", label: "Design", commandIds: ["addBlock", "addPort", "addConnection", "addChildDesign", "regenerateLayout", "optimizeRouting", "validateDesign"] },
  {
    id: "arrange",
    label: "Arrange",
    commandIds: [
      "alignSelectionLeft",
      "alignSelectionCenter",
      "alignSelectionRight",
      "alignSelectionTop",
      "alignSelectionMiddle",
      "alignSelectionBottom",
      "distributeSelectionHorizontally",
      "distributeSelectionVertically",
    ],
  },
  { id: "view", label: "View", commandIds: ["fitDesign", "toggleSources", "toggleProperties", "toggleMessages", "maximizeDiagram", "resetWorkspace", "openCommandPalette"] },
];

function Menu({
  id,
  label,
  activeMenu,
  commands,
  focusTarget,
  triggerRef,
  onToggle,
  onClose,
  onNavigateMenu,
  onNavigateTrigger,
  onNavigateTriggerByCharacter,
}: {
  id: MenuId;
  label: string;
  activeMenu?: MenuId;
  commands: StudioCommand[];
  focusTarget?: MenuFocusTarget;
  triggerRef: (element: HTMLButtonElement | null) => void;
  onToggle: (id: MenuId, focusTarget?: MenuFocusTarget) => void;
  onClose: (id: MenuId, restoreFocus: boolean) => void;
  onNavigateMenu: (id: MenuId, direction: -1 | 1) => void;
  onNavigateTrigger: (id: MenuId, direction: -1 | 1) => void;
  onNavigateTriggerByCharacter: (id: MenuId, character: string) => void;
}) {
  const open = activeMenu === id;
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusableItems = () => itemRefs.current.filter(
    (item): item is HTMLButtonElement => Boolean(item),
  );
  const focusItem = (target: MenuFocusTarget) => {
    const items = focusableItems();
    (target === "first" ? items[0] : items.at(-1))?.focus();
  };

  useEffect(() => {
    if (open && focusTarget) focusItem(focusTarget);
  }, [focusTarget, open]);

  const moveItemFocus = (current: HTMLButtonElement, direction: -1 | 1) => {
    const items = focusableItems();
    const currentIndex = items.indexOf(current);
    if (currentIndex < 0 || items.length === 0) return;
    items[(currentIndex + direction + items.length) % items.length].focus();
  };

  const moveItemFocusByCharacter = (current: HTMLButtonElement, character: string) => {
    const items = focusableItems();
    const currentIndex = items.indexOf(current);
    for (let distance = 1; distance <= items.length; distance += 1) {
      const item = items[(currentIndex + distance + items.length) % items.length];
      if (item.textContent?.trim().toLocaleLowerCase().startsWith(character)) {
        item.focus();
        return;
      }
    }
  };

  return (
    <div className="bd-menu-root">
      <button
        ref={triggerRef}
        id={`bd-menu-trigger-${id}`}
        type="button"
        className={`bd-menu-button${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `bd-menu-${id}` : undefined}
        onClick={() => onToggle(id)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(id, "first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            onToggle(id, "last");
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onNavigateTrigger(id, event.key === "ArrowLeft" ? -1 : 1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            onClose(id, true);
          } else {
            const character = printableCharacter(event);
            if (character) {
              event.preventDefault();
              onNavigateTriggerByCharacter(id, character);
            }
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div
          id={`bd-menu-${id}`}
          className="bd-menu-popover"
          role="menu"
          aria-labelledby={`bd-menu-trigger-${id}`}
        >
          {commands.map((command, index) => (
            <button
              key={command.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={command.enabled ? undefined : true}
              onClick={(event) => {
                if (!command.enabled) {
                  event.preventDefault();
                  return;
                }
                document.getElementById(`bd-menu-trigger-${id}`)?.focus();
                onClose(id, false);
                command.execute();
              }}
              onKeyDown={(event) => {
                if (!command.enabled && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveItemFocus(event.currentTarget, event.key === "ArrowUp" ? -1 : 1);
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  focusItem(event.key === "Home" ? "first" : "last");
                } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  onNavigateMenu(id, event.key === "ArrowLeft" ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onClose(id, true);
                } else if (event.key === "Tab") {
                  onClose(id, false);
                } else {
                  const character = printableCharacter(event);
                  if (character) {
                    event.preventDefault();
                    moveItemFocusByCharacter(event.currentTarget, character);
                  }
                }
              }}
            >
              <command.icon size={14} aria-hidden="true" />
              <span className="bd-menu-item-copy">
                <span>{command.label}</span>
                {!command.enabled && <small>{command.unavailableReason}</small>}
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MenuBar({
  sourceRef,
  commands,
}: {
  sourceRef?: SourceRef;
  commands: StudioCommands;
}) {
  const [activeMenu, setActiveMenu] = useState<MenuId>();
  const [focusRequest, setFocusRequest] = useState<{ id: MenuId; target: MenuFocusTarget }>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<MenuId, HTMLButtonElement>());

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveMenu(undefined);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  const menuIndex = (id: MenuId) => MENU_DEFINITIONS.findIndex((menu) => menu.id === id);
  const adjacentMenu = (id: MenuId, direction: -1 | 1): MenuId => MENU_DEFINITIONS[
    (menuIndex(id) + direction + MENU_DEFINITIONS.length) % MENU_DEFINITIONS.length
  ].id;

  const menuProps = {
    activeMenu,
    onToggle: (id: MenuId, target?: MenuFocusTarget) => {
      setActiveMenu((current) => current === id && !target ? undefined : id);
      setFocusRequest(target ? { id, target } : undefined);
    },
    onClose: (id: MenuId, restoreFocus: boolean) => {
      setActiveMenu(undefined);
      setFocusRequest(undefined);
      if (restoreFocus) {
        window.setTimeout(() => {
          if (!document.querySelector('[role="dialog"]')) triggerRefs.current.get(id)?.focus();
        }, 0);
      }
    },
    onNavigateMenu: (id: MenuId, direction: -1 | 1) => {
      const next = adjacentMenu(id, direction);
      setActiveMenu(next);
      setFocusRequest({ id: next, target: "first" });
    },
    onNavigateTrigger: (id: MenuId, direction: -1 | 1) => {
      const next = adjacentMenu(id, direction);
      setActiveMenu(undefined);
      setFocusRequest(undefined);
      triggerRefs.current.get(next)?.focus();
    },
    onNavigateTriggerByCharacter: (id: MenuId, character: string) => {
      const start = menuIndex(id);
      for (let distance = 1; distance <= MENU_DEFINITIONS.length; distance += 1) {
        const candidate = MENU_DEFINITIONS[(start + distance) % MENU_DEFINITIONS.length];
        if (candidate.label.toLocaleLowerCase().startsWith(character)) {
          setActiveMenu(undefined);
          setFocusRequest(undefined);
          triggerRefs.current.get(candidate.id)?.focus();
          return;
        }
      }
    },
  };

  return (
    <div className="bd-menubar" ref={rootRef}>
      {MENU_DEFINITIONS.map((menu) => (
        <Menu
          {...menuProps}
          key={menu.id}
          id={menu.id}
          label={menu.label}
          commands={menu.commandIds.map((commandId) => commands[commandId])}
          focusTarget={focusRequest?.id === menu.id ? focusRequest.target : undefined}
          triggerRef={(element) => {
            if (element) triggerRefs.current.set(menu.id, element);
            else triggerRefs.current.delete(menu.id);
          }}
        />
      ))}
      <span />
      {sourceRef && (
        <a href={sourceRef.href} target="_blank" rel="noreferrer">
          {sourceRef.label}
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}
