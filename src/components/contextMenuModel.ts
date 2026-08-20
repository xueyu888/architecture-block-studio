import type { StudioCommandId } from "../studio/commands";
import { diagramSelectionItems, type DiagramSelectionRef, type SelectionRef } from "../studio/selection";

export interface CanvasContextMenuRequest {
  revision: number;
  anchor: { x: number; y: number };
  target: DiagramSelectionRef;
  selection: SelectionRef;
  focusFirst: boolean;
}

export type CanvasContextMenuIntent = Omit<CanvasContextMenuRequest, "revision">;

export interface ContextMenuViewport {
  width: number;
  height: number;
}

export interface ContextMenuSize {
  width: number;
  height: number;
}

const NODE_COMMAND_GROUPS: readonly (readonly StudioCommandId[])[] = [
  ["addPort", "addChildDesign"],
  ["copySelection", "cutSelection", "duplicateSelection", "deleteSelection"],
  ["selectDirectInterfaces", "selectDirectNeighborhood"],
  ["fitSelection"],
];

const CONNECTION_COMMAND_GROUPS: readonly (readonly StudioCommandId[])[] = [
  ["reconnectConnection", "deleteSelection"],
  ["fitSelection"],
];

const MULTIPLE_EDIT_COMMANDS: readonly StudioCommandId[] = [
  "copySelection",
  "cutSelection",
  "duplicateSelection",
  "deleteSelection",
];

const MULTIPLE_ARRANGE_COMMANDS: readonly StudioCommandId[] = [
  "alignSelectionLeft",
  "alignSelectionCenter",
  "alignSelectionRight",
  "alignSelectionTop",
  "alignSelectionMiddle",
  "alignSelectionBottom",
  "distributeSelectionHorizontally",
  "distributeSelectionVertically",
];

const MULTIPLE_DEPENDENCY_COMMANDS: readonly StudioCommandId[] = [
  "selectDirectInterfaces",
  "selectIncomingInterfaces",
  "selectOutgoingInterfaces",
  "selectDirectNeighborhood",
  "selectIncomingNeighborhood",
  "selectOutgoingNeighborhood",
];

/**
 * Projects relevant command identities for the current diagram selection.
 * Labels, availability, reasons, shortcuts, and execution remain owned by
 * StudioCommands; this model only owns context-menu grouping.
 */
export function contextMenuCommandGroups(
  selection: SelectionRef,
  target: DiagramSelectionRef,
): readonly (readonly StudioCommandId[])[] {
  const selectedItems = diagramSelectionItems(selection);
  if (selectedItems.length <= 1) {
    return target.kind === "node" ? NODE_COMMAND_GROUPS : CONNECTION_COMMAND_GROUPS;
  }

  const groups: (readonly StudioCommandId[])[] = [MULTIPLE_EDIT_COMMANDS];
  if (selectedItems.every((item) => item.kind === "node")) groups.push(MULTIPLE_ARRANGE_COMMANDS);
  if (selectedItems.some((item) => item.kind === "node")) groups.push(MULTIPLE_DEPENDENCY_COMMANDS);
  groups.push(["fitSelection"]);
  return groups;
}

export function contextMenuAccessibleName(
  selection: SelectionRef,
  target: DiagramSelectionRef,
): string {
  if (diagramSelectionItems(selection).length > 1) return "Selected diagram objects actions";
  return target.kind === "node" ? "Module actions" : "Interface actions";
}

/** Keeps a fixed popover fully visible without mutating its requested anchor. */
export function clampContextMenuPosition(
  anchor: { x: number; y: number },
  size: ContextMenuSize,
  viewport: ContextMenuViewport,
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(anchor.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(anchor.y, viewport.height - size.height - margin)),
  };
}
