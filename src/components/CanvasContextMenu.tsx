import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StudioCommand, StudioCommands } from "../studio/commands";
import {
  clampContextMenuPosition,
  contextMenuAccessibleName,
  contextMenuCommandGroups,
  type CanvasContextMenuRequest,
} from "./contextMenuModel";

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

export function CanvasContextMenu({
  request,
  commands,
  onClose,
}: {
  request: CanvasContextMenuRequest;
  commands: StudioCommands;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const originRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const groups = useMemo(
    () => contextMenuCommandGroups(request.selection, request.target),
    [request.selection, request.target],
  );

  const close = (restoreFocus = false) => {
    onClose();
    if (restoreFocus) {
      window.setTimeout(() => originRef.current?.isConnected && originRef.current.focus(), 0);
    }
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    setPosition(clampContextMenuPosition(
      request.anchor,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [request.anchor]);

  useLayoutEffect(() => {
    if (request.focusFirst && position) itemRefs.current[0]?.focus();
  }, [position, request.focusFirst]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const closeForViewportChange = () => close();
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(request.focusFirst);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("blur", closeForViewportChange);
    window.addEventListener("keydown", closeForEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("blur", closeForViewportChange);
      window.removeEventListener("keydown", closeForEscape, true);
    };
  });

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const moveFocus = (current: HTMLButtonElement, direction: -1 | 1) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    const currentIndex = items.indexOf(current);
    if (currentIndex >= 0) focusItem(currentIndex + direction);
  };

  const moveFocusByCharacter = (current: HTMLButtonElement, character: string) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    const currentIndex = items.indexOf(current);
    for (let distance = 1; distance <= items.length; distance += 1) {
      const candidate = items[(currentIndex + distance + items.length) % items.length];
      if (candidate.textContent?.trim().toLocaleLowerCase().startsWith(character)) {
        candidate.focus();
        return;
      }
    }
  };

  const activate = (command: StudioCommand, event: { preventDefault: () => void }) => {
    if (!command.enabled) {
      event.preventDefault();
      return;
    }
    close();
    command.execute();
  };

  let itemIndex = 0;
  return (
    <div
      ref={rootRef}
      className="bd-context-menu"
      role="menu"
      aria-label={contextMenuAccessibleName(request.selection, request.target)}
      data-context-target-kind={request.target.kind}
      data-context-selection-count={String(request.selection.kind === "multiple" ? request.selection.items.length : 1)}
      style={{
        left: position?.x ?? request.anchor.x,
        top: position?.y ?? request.anchor.y,
        visibility: position ? "visible" : "hidden",
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {groups.map((group, groupIndex) => (
        <div className="bd-context-menu-group" role="group" key={group.join(":")}>
          {groupIndex > 0 && <div className="bd-context-menu-separator" role="separator" />}
          {group.map((commandId) => {
            const command = commands[commandId];
            const index = itemIndex;
            itemIndex += 1;
            return (
              <button
                key={command.id}
                ref={(element) => { itemRefs.current[index] = element; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={command.enabled ? undefined : true}
                onClick={(event) => activate(command, event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(event.currentTarget, event.key === "ArrowUp" ? -1 : 1);
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    focusItem(event.key === "Home" ? 0 : itemRefs.current.length - 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    close(request.focusFirst);
                  } else if (event.key === "Tab") {
                    close();
                  } else if (!command.enabled && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                  } else {
                    const character = printableCharacter(event);
                    if (character) {
                      event.preventDefault();
                      moveFocusByCharacter(event.currentTarget, character);
                    }
                  }
                }}
              >
                <command.icon size={14} aria-hidden="true" />
                <span className="bd-context-menu-copy">
                  <span>{command.label}</span>
                  {!command.enabled && <small>{command.unavailableReason}</small>}
                </span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
