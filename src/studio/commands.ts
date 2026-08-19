import type { LucideIcon } from "lucide-react";

export type StudioCommandId =
  | "newDesign"
  | "openDesign"
  | "save"
  | "saveAs"
  | "exportJson"
  | "undo"
  | "redo"
  | "selectAll"
  | "selectDirectInterfaces"
  | "clearSelection"
  | "copySelection"
  | "paste"
  | "duplicateSelection"
  | "deleteSelection"
  | "alignSelectionLeft"
  | "alignSelectionCenter"
  | "alignSelectionRight"
  | "alignSelectionTop"
  | "alignSelectionMiddle"
  | "alignSelectionBottom"
  | "distributeSelectionHorizontally"
  | "distributeSelectionVertically"
  | "addBlock"
  | "addPort"
  | "addConnection"
  | "reconnectConnection"
  | "addChildDesign"
  | "regenerateLayout"
  | "optimizeRouting"
  | "validateDesign"
  | "fitSelection"
  | "fitDesign"
  | "zoomIn"
  | "zoomOut"
  | "actualSize"
  | "openCommandPalette"
  | "toggleSources"
  | "toggleProperties"
  | "toggleMessages"
  | "maximizeDiagram"
  | "resetWorkspace";

interface StudioCommandDefinition {
  id: StudioCommandId;
  label: string;
  toolbarTitle?: string;
  shortcut?: string;
  showInPalette?: false;
  icon: LucideIcon;
  execute: () => void;
}

export type StudioCommandAvailability =
  | { enabled: true; unavailableReason?: never }
  | { enabled: false; unavailableReason: string };

export type StudioCommand = StudioCommandDefinition & StudioCommandAvailability;

export type StudioCommands = Record<StudioCommandId, StudioCommand>;
